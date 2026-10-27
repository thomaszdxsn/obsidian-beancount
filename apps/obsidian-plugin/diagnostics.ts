/**
 * Editor markers: bean-check complaints in one CodeMirror field, Flag as okay
 * markers in another. A wavy underline carries the tooltip; a gutter dot
 * marks any line either field names. Same line, bean-check text wins.
 *
 * Bean-check publishes with one effect; edits carry those markers along.
 * Flag markers follow the document (`!` lines in ledger regions).
 */
import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range, Transaction } from '@codemirror/state';
import { Decoration, GutterMarker, gutter, ViewPlugin } from '@codemirror/view';
import type { BlockInfo, DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { Editor } from 'obsidian';
import type { LineDiagnostic } from './bean-check';
import { flagDiagnostics, flagDiagnosticsFromRegions, mergeDiagnostics } from './code-actions';
import { ledgerDoc, ledgerKind } from './fences';

/** Publishes bean-check diagnostics; an empty list clears that field. */
export const setBeanDiagnostics = StateEffect.define<readonly LineDiagnostic[]>();

/** Publishes Flag as okay diagnostics; an empty list clears that field. */
export const setFlagOkayDiagnostics = StateEffect.define<readonly LineDiagnostic[]>();

/** The line a marker rides to through an edit; `null` when the edit consumed its line. */
function movedLine(line: number, tr: Transaction): number | null {
	if (line < 0 || line >= tr.startState.doc.lines) return null;
	const span = tr.startState.doc.line(line + 1);
	const from = tr.changes.mapPos(span.from, 1);
	// A non-empty line the change consumed maps both ends onto one point.
	if (span.to > span.from && tr.changes.mapPos(span.to, -1) === from) return null;
	return tr.state.doc.lineAt(from).number - 1;
}

function mapDiagnostics(value: readonly LineDiagnostic[], tr: Transaction): readonly LineDiagnostic[] {
	if (!tr.docChanged || value.length === 0) return value;
	const mapped: LineDiagnostic[] = [];
	for (const diagnostic of value) {
		const line = movedLine(diagnostic.line, tr);
		if (line !== null) mapped.push({ line, message: diagnostic.message });
	}
	return mapped;
}

export const beanDiagnostics = StateField.define<readonly LineDiagnostic[]>({
	create: () => [],
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setBeanDiagnostics)) return effect.value;
		}
		return mapDiagnostics(value, tr);
	},
});

function flagsFromState(state: EditorState): readonly LineDiagnostic[] {
	const file = state.field(editorInfoField, false)?.file;
	if (ledgerKind(file) === 'ledger-file') return flagDiagnostics(state.doc.toString());
	return flagDiagnosticsFromRegions(ledgerDoc('fenced', state.doc).regions);
}

function touchedLineRange(tr: Transaction): { from: number; toExclusive: number } | null {
	const changes = tr.changes;
	if (!changes || typeof changes.iterChangedRanges !== 'function') return null;
	let from = Number.POSITIVE_INFINITY;
	let toExclusive = 0;
	changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
		const start = tr.state.doc.lineAt(fromB).number - 1;
		const endPos = Math.max(fromB, toB - (toB > fromB ? 1 : 0));
		const end = tr.state.doc.lineAt(endPos).number;
		from = Math.min(from, start);
		toExclusive = Math.max(toExclusive, end);
	});
	if (from === Number.POSITIVE_INFINITY) return { from: 0, toExclusive: 0 };
	return { from, toExclusive };
}

function flagsFromTouchedLines(tr: Transaction, mapped: readonly LineDiagnostic[]): readonly LineDiagnostic[] {
	const range = touchedLineRange(tr);
	if (range === null) return flagsFromState(tr.state);
	const file = tr.state.field(editorInfoField, false)?.file;
	if (ledgerKind(file) !== 'ledger-file') return flagsFromState(tr.state);
	const kept = mapped.filter((diagnostic) => diagnostic.line < range.from || diagnostic.line >= range.toExclusive);
	const lines: string[] = [];
	for (let line = range.from; line < range.toExclusive; line += 1) {
		lines.push(tr.state.doc.line(line + 1).text);
	}
	const added = flagDiagnostics(lines.join('\n')).map((diagnostic) => ({
		line: diagnostic.line + range.from,
		message: diagnostic.message,
	}));
	return [...kept, ...added].sort((a, b) => a.line - b.line);
}

export function updateFlagOkayDiagnostics(
	value: readonly LineDiagnostic[],
	tr: Transaction,
): readonly LineDiagnostic[] {
	if (!tr.docChanged) return value;
	if (!tr.changes || typeof tr.changes.iterChangedRanges !== 'function') {
		return flagsFromState(tr.state);
	}
	return flagsFromTouchedLines(tr, mapDiagnostics(value, tr));
}

export const flagOkayDiagnostics = StateField.define<readonly LineDiagnostic[]>({
	create: (state) => (state === undefined ? [] : flagsFromState(state)),
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setFlagOkayDiagnostics)) return effect.value;
		}
		return updateFlagOkayDiagnostics(value, tr);
	},
});

/** The CSS contract between these markers and `styles.css`. */
export const ERROR_LINE_CLASS = 'cm-beancount-error-line';
export const ERROR_UNDERLINE_CLASS = 'cm-beancount-error-underline';
export const ERROR_GUTTER_CLASS = 'cm-beancount-error-gutter';
export const ERROR_GUTTER_MARKER_CLASS = 'cm-beancount-error-gutter-marker';

/** The doc surface the markers need: real `Text`, or a test's fake. */
export interface DiagnosticsDoc {
	/** Number of lines in the document. */
	lines: number;
	/** The 1-based line `at`. */
	line(at: number): { from: number; to: number };
	/** The line holding `pos`. */
	lineAt(pos: number): { number: number };
}

/** The line decoration at every marked line's start, and the underline of its text. */
export function diagnosticDecorations(
	doc: DiagnosticsDoc,
	diagnostics: readonly LineDiagnostic[],
): Array<Range<Decoration>> {
	const ranges: Array<Range<Decoration>> = [];
	for (const diagnostic of diagnostics) {
		if (diagnostic.line < 0 || diagnostic.line >= doc.lines) continue;
		const line = doc.line(diagnostic.line + 1);
		ranges.push(Decoration.line({ class: ERROR_LINE_CLASS }).range(line.from, line.from));
		// An empty line has no text to underline; the line marker stays.
		if (line.to > line.from) {
			const underline = Decoration.mark({
				class: ERROR_UNDERLINE_CLASS,
				attributes: { title: diagnostic.message },
			});
			ranges.push(underline.range(line.from, line.to));
		}
	}
	return ranges;
}

function fieldOf(state: { field(field: unknown): unknown }, field: unknown): readonly LineDiagnostic[] {
	const value = state.field(field);
	return Array.isArray(value) ? (value as readonly LineDiagnostic[]) : [];
}

function mergedDiagnostics(state: { field(field: unknown): unknown }): readonly LineDiagnostic[] {
	return mergeDiagnostics(fieldOf(state, beanDiagnostics), fieldOf(state, flagOkayDiagnostics));
}

/** The live decorations for both fields, rebuilt whenever either moves. */
export class DiagnosticsPlugin {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = this.build(view);
	}

	update(update: ViewUpdate): void {
		const previous = update.startState;
		const next = update.state;
		if (
			update.docChanged ||
			previous.field(beanDiagnostics) !== next.field(beanDiagnostics) ||
			previous.field(flagOkayDiagnostics) !== next.field(flagOkayDiagnostics)
		) {
			this.decorations = this.build(update.view);
		}
	}

	private build(view: EditorView): DecorationSet {
		const ranges = diagnosticDecorations(view.state.doc, mergedDiagnostics(view.state));
		// `sort` because a run's diagnostics may reach the builder in any order.
		return Decoration.set(ranges, true);
	}
}

export const diagnosticsView = ViewPlugin.fromClass(DiagnosticsPlugin, {
	decorations: (plugin) => plugin.decorations,
});

/** The dot a marked line gets in the diagnostics gutter. */
class ErrorGutterMarker extends GutterMarker {
	elementClass = ERROR_GUTTER_MARKER_CLASS;
}

const GUTTER_DOT = new ErrorGutterMarker();

function lineIsMarked(state: { field(field: unknown): unknown }, line0: number): boolean {
	return (
		fieldOf(state, beanDiagnostics).some((diagnostic) => diagnostic.line === line0) ||
		fieldOf(state, flagOkayDiagnostics).some((diagnostic) => diagnostic.line === line0)
	);
}

/** Click on a gutter dot: the host shows the quick-fix menu for that line. */
export interface DiagnosticClickHost {
	onDiagnosticClick(view: EditorView, line: number, event: MouseEvent): boolean;
}

export function createDiagnosticsGutter(host?: DiagnosticClickHost) {
	return gutter({
		class: ERROR_GUTTER_CLASS,
		lineMarker(view: EditorView, block: BlockInfo) {
			const line = view.state.doc.lineAt(block.from);
			return lineIsMarked(view.state, line.number - 1) ? GUTTER_DOT : null;
		},
		// Markers read both fields, which a run can replace without touching
		// the document — the gutter must redraw on that too.
		lineMarkerChange: (update) =>
			update.startState.field(beanDiagnostics) !== update.state.field(beanDiagnostics) ||
			update.startState.field(flagOkayDiagnostics) !== update.state.field(flagOkayDiagnostics),
		domEventHandlers: host
			? {
					mousedown(view: EditorView, block: BlockInfo, event: Event) {
						const line = view.state.doc.lineAt(block.from);
						return host.onDiagnosticClick(view, line.number - 1, event as MouseEvent);
					},
			  }
			: undefined,
	});
}

export const diagnosticsGutter = createDiagnosticsGutter();

export function createDiagnosticsExtension(host?: DiagnosticClickHost): Extension {
	return [
		beanDiagnostics,
		flagOkayDiagnostics,
		diagnosticsView,
		host ? createDiagnosticsGutter(host) : diagnosticsGutter,
	];
}

export const diagnosticsExtension: Extension = createDiagnosticsExtension();

function publishDiagnostics(
	editor: Editor,
	effect: { of(value: readonly LineDiagnostic[]): StateEffect<readonly LineDiagnostic[]> },
	diagnostics: readonly LineDiagnostic[],
): void {
	const view = (editor as Editor & { cm?: EditorView }).cm;
	if (!view) return;
	view.dispatch({ effects: [effect.of(diagnostics)] });
}

/**
 * Publish bean-check `diagnostics` to the CodeMirror view behind `editor`
 * (empty: clear that field). Flag markers live in their own field.
 */
export function setEditorBeanDiagnostics(editor: Editor, diagnostics: readonly LineDiagnostic[]): void {
	publishDiagnostics(editor, setBeanDiagnostics, diagnostics);
}
