/**
 * Whole-file beancount presentation for `.bean` / `.beancount` notes.
 *
 * Obsidian registers those extensions as markdown (`main.ts`), so the CM5
 * fence mode never runs on the document: org `* Section` lines, `#tag`,
 * emphasis, and links get markdown styling, in a proportional font. This
 * extension paints the same `cm-<token>` classes the fence highlighter
 * would, marks the editor `beancount-ledger-file` so `styles.css` can
 * neutralize that markdown presentation, and draws Fava's decimal-column
 * ruler (`frontend/src/codemirror/ruler.ts`).
 *
 * Token state is carried from line 0 — strings, BQL regions, and entry
 * context span lines. Marks are emitted only for the viewport; the walk
 * resumes from the nearest `LedgerStateCache` checkpoint (a copy of the mode
 * state every `CHECKPOINT_LINES` lines) at or above it. An edit drops only
 * the checkpoints after its first changed line — the state at the start of
 * a line depends on the lines before it alone — so typing near the end of a
 * long ledger does not re-tokenize the whole prefix.
 *
 * Live Preview can still replace text with widgets (list bullets, task
 * checkboxes, embeds). CSS can only show markers that were hidden, not
 * restore characters a widget removed — Source mode is the reliable view.
 */
import { StringStream } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { StateEffect } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { beancountMode } from './beancount-mode';
import type { BeancountState } from './beancount-mode';
import { isLedgerFile } from './vault-index';

/** Class on `.cm-editor` while a ledger file is open. `styles.css` keys off it. */
export const LEDGER_FILE_CLASS = 'beancount-ledger-file';

/** Class on the dotted separator-column ruler. */
export const RULER_CLASS = 'beancount-ledger-ruler';

/** One inclusive line slice, 0-based, of the document the marks should cover. */
export interface LedgerLineSpan {
	fromLine: number;
	toLine: number;
}

/** A mark decoration the fence highlighter would have painted as `cm-<style>`. */
export interface LedgerMark {
	from: number;
	to: number;
	class: string;
}

/** Live settings the ruler reads when it measures. */
export interface LedgerFileHost {
	settings: { showRuler: boolean; separatorColumn: number };
}

interface EditorFileInfo {
	file?: { path: string; extension?: string } | null;
}

/** Tab size the mode tests drive `StringStream` with; display columns are not used. */
const STREAM_TAB_SIZE = 4;
const STREAM_INDENT_UNIT = 2;

const refreshLedgerFile = StateEffect.define<null>();

/** Line distance between cached mode states. */
const CHECKPOINT_LINES = 256;

/** Document access the tokenizer needs: 1-based lines with their start offsets. */
export interface LedgerDoc {
	readonly lines: number;
	line(n: number): { readonly text: string; readonly from: number };
}

function copyState(state: BeancountState): BeancountState {
	return { ...state, pending: state.pending.slice() };
}

/**
 * Mode states at the start of lines `0, N, 2N, …` of one document version.
 * `invalidateFrom` must be called with the first changed line on every edit,
 * and `reset` when the editor switches documents.
 */
export class LedgerStateCache {
	private checkpoints: BeancountState[] = [];

	reset(): void {
		this.checkpoints = [];
	}

	/** Keep only checkpoints at or before `line` (0-based): their prefix is unchanged. */
	invalidateFrom(line: number): void {
		const keep = Math.floor(Math.max(0, line) / CHECKPOINT_LINES) + 1;
		if (this.checkpoints.length > keep) this.checkpoints.length = keep;
	}

	/**
	 * Marks for the lines inside `spans` (0-based, inclusive). Tokenization
	 * starts at the last checkpoint at or above the first span and stops at
	 * the last requested line, recording checkpoints it passes.
	 */
	marks(doc: LedgerDoc, spans: readonly LedgerLineSpan[]): LedgerMark[] {
		if (doc.lines === 0 || spans.length === 0) return [];
		let first = Number.POSITIVE_INFINITY;
		let last = -1;
		for (const span of spans) {
			if (span.fromLine < first) first = span.fromLine;
			if (span.toLine > last) last = span.toLine;
		}
		if (last < 0) return [];
		last = Math.min(last, doc.lines - 1);
		first = Math.max(0, Math.min(first, last));
		if (this.checkpoints.length === 0) this.checkpoints.push(beancountMode.startState());
		const index = Math.min(Math.floor(first / CHECKPOINT_LINES), this.checkpoints.length - 1);
		const state = copyState(this.checkpoints[index]);
		const marks: LedgerMark[] = [];
		for (let line = index * CHECKPOINT_LINES; line <= last; line++) {
			if (line % CHECKPOINT_LINES === 0 && line / CHECKPOINT_LINES === this.checkpoints.length) {
				this.checkpoints.push(copyState(state));
			}
			const { text, from } = doc.line(line + 1);
			tokenizeLine(text, state, from, lineEmitted(line, spans), marks);
		}
		return marks;
	}
}

/**
 * Beancount mark ranges for a ledger file, or nothing when `file` is not a
 * `.bean` / `.beancount` note (markdown notes and a missing file included).
 *
 * `lines` are document lines without their separators. Offsets assume a
 * single `\n` between lines, which is what an Obsidian `Text` document
 * stores. `spans` limits which lines emit marks; omitted means the whole
 * document. State is still carried from line 0, so a string or BQL region
 * opened above a span styles the visible continuation. Tokenization stops
 * at the last requested line.
 */
export function ledgerMarkRanges(
	file: { path: string; extension?: string } | null | undefined,
	lines: readonly string[],
	spans?: readonly LedgerLineSpan[]
): LedgerMark[] {
	if (!file || !isLedgerFile(file)) return [];
	const starts: number[] = [];
	let offset = 0;
	for (const text of lines) {
		starts.push(offset);
		offset += text.length + 1;
	}
	const doc: LedgerDoc = { lines: lines.length, line: (n) => ({ text: lines[n - 1], from: starts[n - 1] }) };
	return new LedgerStateCache().marks(doc, spans ?? [{ fromLine: 0, toLine: lines.length - 1 }]);
}

/**
 * Pixel offset of the dotted ruler from the editor element's left edge.
 *
 * `separatorColumn` is the 1-based display column of the decimal point.
 * The line sits on the left edge of that column: measured gutter width
 * (content-box left minus editor left — horizontal scroll is already in
 * that measurement, matching Fava) plus the line's content padding plus
 * `(column - 1) * characterWidth`. A column below 1, or a non-finite
 * term, contributes nothing for that term.
 */
export function rulerLineOffset(
	separatorColumn: number,
	characterWidth: number,
	gutterWidth: number,
	contentPaddingLeft: number
): number {
	const column = Number.isFinite(separatorColumn) ? Math.max(0, separatorColumn - 1) : 0;
	const width = Number.isFinite(characterWidth) ? characterWidth : 0;
	const gutter = Number.isFinite(gutterWidth) ? gutterWidth : 0;
	const padding = Number.isFinite(contentPaddingLeft) ? contentPaddingLeft : 0;
	return gutter + padding + column * width;
}

function lineEmitted(line: number, spans: readonly LedgerLineSpan[] | undefined): boolean {
	if (!spans) return true;
	for (const span of spans) {
		if (line >= span.fromLine && line <= span.toLine) return true;
	}
	return false;
}

/**
 * Fence rendering maps each legacy style word to `cm-<word>` and merges
 * adjacent same-style tokens. Unstyled spans (whitespace, loose org
 * headings) get no mark, so they also break a merge.
 */
function tokenizeLine(
	line: string,
	state: BeancountState,
	offset: number,
	emit: boolean,
	marks: LedgerMark[]
): void {
	// An empty line never reaches `token`; `blankLine` ends the entry but
	// leaves string / BQL state, which is what lets a quote span the gap.
	if (line.length === 0) {
		beancountMode.blankLine(state);
		return;
	}
	const stream = new StringStream(line, STREAM_TAB_SIZE, STREAM_INDENT_UNIT);
	let open: LedgerMark | null = null;
	while (!stream.eol()) {
		stream.start = stream.pos;
		const style = beancountMode.token(stream, state);
		if (stream.pos === stream.start) stream.next();
		const from = offset + stream.start;
		const to = offset + stream.pos;
		const cls = style ? styleClass(style) : '';
		if (!emit || cls.length === 0 || from === to) {
			open = null;
			continue;
		}
		if (open && open.class === cls && open.to === from) {
			open.to = to;
			continue;
		}
		open = { from, to, class: cls };
		marks.push(open);
	}
}

function styleClass(style: string): string {
	let cls = '';
	for (const part of style.split(/\s+/)) {
		if (part.length === 0) continue;
		cls = cls.length === 0 ? `cm-${part}` : `${cls} cm-${part}`;
	}
	return cls;
}

function editorFile(state: EditorState): { path: string; extension?: string } | null {
	const info = state.field(editorInfoField, false) as EditorFileInfo | undefined;
	return info?.file ?? null;
}

function editorFileKey(state: EditorState): string {
	const file = editorFile(state);
	return file ? `${file.path}\0${file.extension ?? ''}` : '';
}

function visibleSpans(view: EditorView): LedgerLineSpan[] {
	const doc = view.state.doc;
	if (doc.lines === 0) return [];
	const ranges = view.visibleRanges;
	if (!ranges || ranges.length === 0) return [{ fromLine: 0, toLine: doc.lines - 1 }];
	const spans: LedgerLineSpan[] = [];
	for (const range of ranges) {
		const fromLine = doc.lineAt(range.from).number - 1;
		const end = range.to > range.from ? range.to - 1 : range.from;
		const toLine = doc.lineAt(end).number - 1;
		if (toLine >= fromLine) spans.push({ fromLine, toLine });
	}
	return spans;
}

function highlightDecorations(view: EditorView, cache: LedgerStateCache): DecorationSet {
	const file = editorFile(view.state);
	if (!file || !isLedgerFile(file)) return Decoration.none;
	const ranges: Array<Range<Decoration>> = [];
	for (const mark of cache.marks(view.state.doc, visibleSpans(view))) {
		ranges.push(Decoration.mark({ class: mark.class }).range(mark.from, mark.to));
	}
	return Decoration.set(ranges, true);
}

function refreshRequested(update: ViewUpdate): boolean {
	return update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshLedgerFile)));
}

function highlightPlugin(views: Set<EditorView>) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private fileKey: string;
			private readonly cache = new LedgerStateCache();

			constructor(private readonly view: EditorView) {
				views.add(view);
				this.fileKey = editorFileKey(view.state);
				this.decorations = highlightDecorations(view, this.cache);
			}

			update(update: ViewUpdate): void {
				const key = editorFileKey(update.state);
				if (key !== this.fileKey) {
					this.cache.reset();
				} else if (update.docChanged) {
					let changed = Number.POSITIVE_INFINITY;
					update.changes.iterChangedRanges((fromA) => {
						changed = Math.min(changed, update.startState.doc.lineAt(fromA).number - 1);
					});
					this.cache.invalidateFrom(changed);
				}
				if (update.docChanged || update.viewportChanged || key !== this.fileKey || refreshRequested(update)) {
					this.fileKey = key;
					this.decorations = highlightDecorations(update.view, this.cache);
				}
			}

			destroy(): void {
				views.delete(this.view);
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);
}

function paddingLeftOf(view: EditorView): number {
	const line = view.contentDOM?.querySelector?.('.cm-line');
	if (!line) return 0;
	const parsed = Number.parseFloat(getComputedStyle(line).paddingLeft);
	return Number.isFinite(parsed) ? parsed : 0;
}

function gutterWidthOf(view: EditorView): number {
	if (!view.contentDOM || !view.dom) return 0;
	return view.contentDOM.getBoundingClientRect().left - view.dom.getBoundingClientRect().left;
}

function rulerPlugin(host: LedgerFileHost, views: Set<EditorView>) {
	return ViewPlugin.fromClass(
		class {
			private ruler: HTMLElement | null = null;
			private fileKey: string;

			constructor(private readonly view: EditorView) {
				views.add(view);
				this.fileKey = editorFileKey(view.state);
				this.sync(view);
			}

			update(update: ViewUpdate): void {
				const key = editorFileKey(update.state);
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.geometryChanged ||
					key !== this.fileKey ||
					refreshRequested(update)
				) {
					this.fileKey = key;
					this.sync(update.view);
				}
			}

			destroy(): void {
				views.delete(this.view);
				this.removeRuler();
			}

			private sync(view: EditorView): void {
				const file = editorFile(view.state);
				if (!host.settings.showRuler || !file || !isLedgerFile(file)) {
					this.removeRuler();
					return;
				}
				if (!this.ruler) {
					const ruler = view.dom.createDiv({ cls: RULER_CLASS, attr: { 'aria-hidden': 'true' } });
					this.ruler = ruler;
				}
				const ruler = this.ruler;
				view.requestMeasure({
					read: () =>
						rulerLineOffset(
							host.settings.separatorColumn,
							view.defaultCharacterWidth,
							gutterWidthOf(view),
							paddingLeftOf(view)
						),
					write: (offset) => {
						ruler.style.left = `${offset}px`;
					},
				});
			}

			private removeRuler(): void {
				this.ruler?.remove();
				this.ruler = null;
			}
		},
		// The ruler is a DOM sibling of the content, not a decoration.
		{ decorations: () => Decoration.none }
	);
}

/**
 * Editor class, beancount mark decorations, and the separator ruler.
 * Active only while the editor's file is a ledger file. Register once;
 * `LedgerFileController.refresh` reapplies `showRuler` / `separatorColumn`.
 */
export function ledgerFileExtension(host: LedgerFileHost, views: Set<EditorView>): Extension {
	return [
		EditorView.editorAttributes.of((view) => {
			const file = editorFile(view.state);
			return file && isLedgerFile(file) ? { class: LEDGER_FILE_CLASS } : null;
		}),
		highlightPlugin(views),
		rulerPlugin(host, views),
	];
}

/**
 * One controller per plugin. Register `extension` once; `refresh` reapplies
 * the current settings to every editor still showing them.
 */
export class LedgerFileController {
	readonly extension: Extension;
	private readonly views = new Set<EditorView>();

	constructor(host: LedgerFileHost) {
		this.extension = ledgerFileExtension(host, this.views);
	}

	refresh(): void {
		for (const view of this.views) {
			view.dispatch({ effects: refreshLedgerFile.of(null) });
		}
	}

	destroy(): void {
		this.views.clear();
	}
}
