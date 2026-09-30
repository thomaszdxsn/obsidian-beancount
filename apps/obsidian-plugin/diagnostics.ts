/**
 * Editor markers for bean-check complaints: a wavy underline carrying the
 * message as its tooltip on the offending line, plus a dot in a dedicated
 * gutter — the two places the editor already teaches "this line has a
 * problem".
 *
 * The diagnostics live in a CodeMirror state field, so a validation run
 * publishes them with one effect and every later edit carries them along like
 * the rest of the document state. A line the document no longer has (it
 * shrank since the run) marks nothing; the next run's report replaces the
 * field wholesale.
 */
import { StateEffect, StateField } from '@codemirror/state';
import type { Extension, Range, Transaction } from '@codemirror/state';
import { Decoration, GutterMarker, gutter, ViewPlugin } from '@codemirror/view';
import type { BlockInfo, DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import type { Editor } from 'obsidian';
import type { LineDiagnostic } from './bean-check';

/** Publishes one file's diagnostics; an empty list clears the markers. */
export const setLineDiagnostics = StateEffect.define<readonly LineDiagnostic[]>();

/** The line a marker rides to through an edit; `null` when the edit consumed its line. */
function movedLine(line: number, tr: Transaction): number | null {
	if (line < 0 || line >= tr.startState.doc.lines) return null;
	const span = tr.startState.doc.line(line + 1);
	const from = tr.changes.mapPos(span.from, 1);
	// A non-empty line the change consumed maps both ends onto one point.
	if (span.to > span.from && tr.changes.mapPos(span.to, -1) === from) return null;
	return tr.state.doc.lineAt(from).number - 1;
}

export const lineDiagnostics = StateField.define<readonly LineDiagnostic[]>({
	create: () => [],
	update(value, tr) {
		// A run's report replaces the value wholesale; edits carry each
		// marker along to the line it now sits on.
		for (const effect of tr.effects) {
			if (effect.is(setLineDiagnostics)) return effect.value;
		}
		if (!tr.docChanged || value.length === 0) return value;
		const mapped: LineDiagnostic[] = [];
		for (const diagnostic of value) {
			const line = movedLine(diagnostic.line, tr);
			if (line !== null) mapped.push({ line, message: diagnostic.message });
		}
		return mapped;
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
	diagnostics: readonly LineDiagnostic[]
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

/** The live decorations for the field's diagnostics, rebuilt whenever they move. */
export class DiagnosticsPlugin {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = this.build(view);
	}

	update(update: ViewUpdate): void {
		// Edits move lines around, and a run replaces the field wholesale.
		const previous = update.startState.field(lineDiagnostics);
		if (update.docChanged || previous !== update.state.field(lineDiagnostics)) {
			this.decorations = this.build(update.view);
		}
	}

	private build(view: EditorView): DecorationSet {
		const ranges = diagnosticDecorations(view.state.doc, view.state.field(lineDiagnostics));
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

export const diagnosticsGutter = gutter({
	class: ERROR_GUTTER_CLASS,
	lineMarker(view: EditorView, block: BlockInfo) {
		const line = view.state.doc.lineAt(block.from);
		const marked = view.state.field(lineDiagnostics).some((diagnostic) => diagnostic.line === line.number - 1);
		return marked ? GUTTER_DOT : null;
	},
	// Markers read the diagnostics field, which a run replaces without
	// touching the document — the gutter must redraw on that too.
	lineMarkerChange: (update) => update.startState.field(lineDiagnostics) !== update.state.field(lineDiagnostics),
});

export const diagnosticsExtension: Extension = [lineDiagnostics, diagnosticsView, diagnosticsGutter];

/**
 * Publish `diagnostics` to the CodeMirror view behind `editor` (empty: clear).
 * Obsidian's `Editor` wraps an `EditorView` as `cm` without declaring it —
 * the same kind of narrow host cast `main` needs for the CM5 mode registry.
 */
export function setEditorLineDiagnostics(editor: Editor, diagnostics: readonly LineDiagnostic[]): void {
	const view = (editor as Editor & { cm?: EditorView }).cm;
	if (!view) return;
	view.dispatch({ effects: [setLineDiagnostics.of(diagnostics)] });
}
