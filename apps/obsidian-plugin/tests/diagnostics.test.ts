/**
 * The diagnostics extension draws bean-check's per-line complaints: a line
 * marker, an underline whose tooltip is the message, and a gutter dot. The
 * CodeMirror pieces are the test double; the behaviour under test is which
 * ranges get which message.
 */
import { describe, expect, it } from 'vitest';
import type { Editor } from 'obsidian';
import type { LineDiagnostic } from '../bean-check';
import {
	diagnosticDecorations,
	diagnosticsGutter,
	DiagnosticsPlugin,
	ERROR_GUTTER_CLASS,
	ERROR_GUTTER_MARKER_CLASS,
	ERROR_LINE_CLASS,
	ERROR_UNDERLINE_CLASS,
	diagnosticsView,
	lineDiagnostics,
	setEditorLineDiagnostics,
	setLineDiagnostics,
} from '../diagnostics';
import type {
	MockDecorationRange,
	MockGutterConfig,
	MockStateField,
	MockViewPlugin,
} from './mocks/codemirror';
import { createEditor } from './fakes';

interface FakeDoc {
	lines: number;
	line(at: number): { from: number; to: number; number: number };
	lineAt(pos: number): { from: number; to: number; number: number };
}

/** A document of `text` with 1-based line lookups, like CodeMirror's `Text`. */
function fakeDoc(text: string): FakeDoc {
	const pieces = text.split('\n');
	const spans = pieces.map((piece, index) => {
		const from = pieces.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
		return { from, to: from + piece.length, number: index + 1 };
	});
	return {
		lines: pieces.length,
		line: (at: number) => spans[at - 1],
		lineAt: (pos: number) => spans.find((span) => pos <= span.to) ?? spans[spans.length - 1],
	};
}

interface FakeDiagnosticView {
	state: {
		doc: FakeDoc;
		field(field: unknown): readonly LineDiagnostic[];
	};
}

/** A view whose diagnostics field holds `diagnostics`. */
function fakeView(text: string, diagnostics: readonly LineDiagnostic[]): FakeDiagnosticView {
	const doc = fakeDoc(text);
	return {
		state: {
			doc,
			field: (field: unknown) => (field === lineDiagnostics ? diagnostics : []),
		},
	};
}

describe('lineDiagnostics', () => {
	it('starts empty and is replaced wholesale by a set effect', () => {
		// The field's create/update are CodeMirror-internal; tests drive the mock shape.
		const field = lineDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		expect(field.create()).toEqual([]);

		const next = [{ line: 2, message: 'nope' }];
		const updated = field.update([], { effects: [setLineDiagnostics.of(next)] });
		expect(updated).toBe(next);
		// Anything else — including another field's effect — leaves it.
		expect(field.update(next, { effects: [{ is: () => false, value: [] }] })).toBe(next);
	});
});

describe('diagnosticDecorations', () => {
	it('underlines each marked line and puts its messages in the tooltip', () => {
		const first = '2026-10-01 * "Broken"';
		const second = '  Assets:Cash  10.00 USD';
		const doc = fakeDoc(`${first}\n${second}\n`);
		const ranges = diagnosticDecorations(doc, [
			{ line: 1, message: 'Transaction does not balance: (10.00 USD)' },
			{ line: 0, message: 'first\nsecond' },
		]) as unknown as MockDecorationRange[];

		const underlines = ranges.filter((range) => range.value.kind === 'mark');
		// Ranges keep the diagnostics' order; the plugin's `Decoration.set(…, true)` sorts.
		expect(underlines.map((range) => [range.from, range.to, range.value.spec])).toEqual([
			[
				first.length + 1,
				first.length + 1 + second.length,
				{ class: ERROR_UNDERLINE_CLASS, attributes: { title: 'Transaction does not balance: (10.00 USD)' } },
			],
			[0, first.length, { class: ERROR_UNDERLINE_CLASS, attributes: { title: 'first\nsecond' } }],
		]);
		expect(
			ranges.filter((range) => range.value.kind === 'line').map((range) => range.value.spec)
		).toEqual([{ class: ERROR_LINE_CLASS }, { class: ERROR_LINE_CLASS }]);
	});

	it('skips a line the document no longer has, and does not underline an empty one', () => {
		const doc = fakeDoc('kept\n');
		const ranges = diagnosticDecorations(doc, [
			{ line: 1, message: 'blank' },
			{ line: 4, message: 'gone' },
			{ line: -1, message: 'nope' },
		]) as unknown as MockDecorationRange[];

		expect(ranges).toHaveLength(1);
		expect(ranges[0].value.kind).toBe('line');
	});
});

describe('diagnostics gutter', () => {
	it('dots exactly the marked lines', () => {
		const gutterConfig = diagnosticsGutter as unknown as MockGutterConfig;
		expect(gutterConfig.class).toBe(ERROR_GUTTER_CLASS);
		const view = fakeView('one\ntwo\n', [{ line: 1, message: 'bad' }]);

		const marked = gutterConfig.lineMarker?.(view, { from: 4, to: 7 }, []);
		const clear = gutterConfig.lineMarker?.(view, { from: 0, to: 3 }, []);

		expect(marked?.elementClass).toBe(ERROR_GUTTER_MARKER_CLASS);
		expect(clear).toBeNull();
		// A run replaces the field without editing: the gutter must redraw.
		const clean = fakeView('one\ntwo\n', []);
		expect(
			gutterConfig.lineMarkerChange?.({ startState: clean.state, state: view.state })
		).toBe(true);
		expect(gutterConfig.lineMarkerChange?.({ startState: view.state, state: view.state })).toBe(false);
	});
});

describe('DiagnosticsPlugin', () => {
	it('rebuilds when the diagnostics move and sorts ranges by position', () => {
		const diagnostics = [{ line: 1, message: 'later' }];
		const view = fakeView('one\ntwo', diagnostics);
		const plugin = new DiagnosticsPlugin(view as never);
		const registered = diagnosticsView as unknown as MockViewPlugin<DiagnosticsPlugin>;
		expect(registered.cls).toBe(DiagnosticsPlugin);

		const decorations = registered.spec.decorations(plugin) as Array<{ from: number }>;
		expect(decorations.map((range) => range.from)).toEqual([4, 4]);

		const next = fakeView('one\ntwo', [
			{ line: 1, message: 'later' },
			{ line: 0, message: 'sooner' },
		]);
		plugin.update({
			docChanged: true,
			view: next,
			startState: view.state,
			state: next.state,
		} as never);
		const rebuilt = registered.spec.decorations(plugin) as Array<{ from: number }>;
		// Line 0's decorations sort before line 1's, whatever order the run reported.
		expect(rebuilt.map((range) => range.from)).toEqual([0, 0, 4, 4]);

		// Nothing moved and the field is the same value: the set stays put.
		const kept = registered.spec.decorations(plugin);
		plugin.update({ docChanged: false, view: next, startState: next.state, state: next.state } as never);
		expect(registered.spec.decorations(plugin)).toBe(kept);
	});
});

describe('setEditorLineDiagnostics', () => {
	it('publishes the diagnostics to the editor view, and tolerates an editor without one', () => {
		const editor = createEditor(['line']);
		const diagnostics = [{ line: 0, message: 'bad' }];

		setEditorLineDiagnostics(editor as unknown as Editor, diagnostics);

		const [effect] = editor.cm.dispatched[0].effects as Array<{ value: unknown; is(spec: unknown): boolean }>;
		expect(effect.is(setLineDiagnostics)).toBe(true);
		expect(effect.value).toBe(diagnostics);

		const bare = { ...editor, cm: undefined };
		expect(() => setEditorLineDiagnostics(bare as unknown as Editor, [])).not.toThrow();
	});
});
