/**
 * Transaction-flag markers: vscode-beancount `flagWarnings` maps a txn flag
 * (`!`, `*`, `P`, …) onto error / warning / none. `*` is silent by default;
 * `!` is a warning. Mixed `!` / `*` ledgers therefore get distinguishable
 * styles without waiting for bean-check.
 */
import { StateEffect } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { ERROR_LINE_CLASS, ERROR_UNDERLINE_CLASS } from './diagnostics';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';

/** The CSS contract between these markers and `styles.css`. */
export const WARNING_LINE_CLASS = 'cm-beancount-warning-line';
export const WARNING_UNDERLINE_CLASS = 'cm-beancount-warning-underline';

/** Error vs warning; `null` hides the flag. */
export type FlagWarningLevel = 'error' | 'warning' | null;

/**
 * vscode-beancount defaults: `!` is DiagnosticSeverity.Warning (1);
 * cleared `*` and the other letters are silent.
 */
export const DEFAULT_FLAG_WARNINGS: Record<string, FlagWarningLevel> = {
	'*': null,
	'!': 'warning',
	P: null,
	S: null,
	T: null,
	C: null,
	U: null,
	R: null,
	M: null,
};

/** One flagged transaction line, ready for the editor's markers. */
export interface FlagDiagnostic {
	/** The 0-based line, as CodeMirror numbers it. */
	line: number;
	/** The flag character after mapping `txn` → `*`. */
	flag: string;
	/** The configured marker style; never `null`. */
	severity: 'error' | 'warning';
	/** Tooltip copy. */
	message: string;
}

/** Live settings the markers read when they rebuild. */
export interface FlagWarningHost {
	settings: { flagWarnings: Record<string, FlagWarningLevel> };
}

/** Asks every tracked view to rebuild without touching the document. */
const refreshFlagWarnings = StateEffect.define<null>();

/**
 * A dated transaction header: date, then `txn` or a one-character flag.
 * Org-mode `*` headings have no date and never match.
 */
const TXN_FLAG_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]+(txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;

/**
 * Flagged transaction lines in `text` whose configured level is error or
 * warning. `txn` is Beancount's alias for `*`.
 */
export function collectFlagDiagnostics(
	text: string,
	flagWarnings: Readonly<Record<string, FlagWarningLevel | undefined>>
): FlagDiagnostic[] {
	const lines = text.split('\n');
	const diagnostics: FlagDiagnostic[] = [];
	for (let line = 0; line < lines.length; line++) {
		const match = TXN_FLAG_RE.exec(lines[line] ?? '');
		if (!match) continue;
		const flag = match[2] === 'txn' ? '*' : match[2];
		const severity = flagWarnings[flag];
		if (severity !== 'error' && severity !== 'warning') continue;
		diagnostics.push({
			line,
			flag,
			severity,
			message: `Transaction flagged ${flag}`,
		});
	}
	return diagnostics;
}

/** Obsidian's editor-info field; tests and the live view put `{ file }` on it. */
interface EditorFileInfo {
	file?: { path: string; extension: string };
}

/** File identity for an editor that can change files in place. */
function editorFileKey(state: EditorState): string {
	const info = state.field(editorInfoField, false) as EditorFileInfo | undefined;
	const file = info?.file;
	return file ? `${file.path}\0${file.extension}` : '';
}

/**
 * Host lines with fence bodies in place and every other line blank, so
 * flag regexes see ledger text at the host line numbers.
 */
function fenceMaskedLines(text: string): string[] | null {
	const fences = extractBeancountFences(text);
	if (fences.length === 0) return null;
	const masked = text.split('\n').map(() => '');
	for (const fence of fences) {
		for (let i = 0; i < fence.lines.length; i++) {
			masked[fence.startLine + i] = fence.lines[i] ?? '';
		}
	}
	return masked;
}

function scanText(view: EditorView): string | null {
	const info = view.state.field(editorInfoField, false) as EditorFileInfo | undefined;
	const file = info?.file;
	const text = view.state.doc.toString();
	if (!file) return text;
	if (isLedgerFile(file)) return text;
	const masked = fenceMaskedLines(text);
	return masked ? masked.join('\n') : null;
}

/** The line decoration and wavy underline for each flagged transaction. */
export function flagDecorationRanges(
	doc: { lines: number; line(at: number): { from: number; to: number } },
	diagnostics: readonly FlagDiagnostic[]
): Array<Range<Decoration>> {
	const ranges: Array<Range<Decoration>> = [];
	for (const diagnostic of diagnostics) {
		if (diagnostic.line < 0 || diagnostic.line >= doc.lines) continue;
		const line = doc.line(diagnostic.line + 1);
		const markClass = diagnostic.severity === 'warning' ? WARNING_LINE_CLASS : ERROR_LINE_CLASS;
		const waveClass = diagnostic.severity === 'warning' ? WARNING_UNDERLINE_CLASS : ERROR_UNDERLINE_CLASS;
		ranges.push(Decoration.line({ class: markClass }).range(line.from, line.from));
		if (line.to > line.from) {
			ranges.push(
				Decoration.mark({
					class: waveClass,
					attributes: { title: diagnostic.message },
				}).range(line.from, line.to)
			);
		}
	}
	return ranges;
}

function flagDecorations(view: EditorView, host: FlagWarningHost): DecorationSet {
	const text = scanText(view);
	if (text === null) return Decoration.none;
	const ranges = flagDecorationRanges(view.state.doc, collectFlagDiagnostics(text, host.settings.flagWarnings));
	return Decoration.set(ranges, true);
}

function flagPlugin(host: FlagWarningHost, views: Set<EditorView>) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private fileKey: string;

			constructor(private readonly view: EditorView) {
				views.add(view);
				this.fileKey = editorFileKey(view.state);
				this.decorations = flagDecorations(view, host);
			}

			update(update: ViewUpdate): void {
				const key = editorFileKey(update.state);
				const refresh = update.transactions.some((tr) =>
					tr.effects.some((effect) => effect.is(refreshFlagWarnings))
				);
				if (update.docChanged || key !== this.fileKey || refresh) {
					this.fileKey = key;
					this.decorations = flagDecorations(update.view, host);
				}
			}

			destroy(): void {
				views.delete(this.view);
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);
}

/**
 * One controller per plugin. Register `extension` once; `refresh` reapplies
 * the current settings to every editor still showing them.
 */
export class FlagWarningController {
	readonly extension: Extension;
	private readonly views = new Set<EditorView>();

	constructor(host: FlagWarningHost) {
		this.extension = flagPlugin(host, this.views);
	}

	refresh(): void {
		for (const view of this.views) {
			view.dispatch({ effects: [refreshFlagWarnings.of(null)] });
		}
	}

	destroy(): void {
		this.views.clear();
	}
}
