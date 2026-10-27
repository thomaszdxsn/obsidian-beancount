/**
 * Bean-check and Flag as okay markers live in separate CodeMirror fields.
 * Decorations merge them (bean tooltip wins on the same line); the gutter
 * dots the union.
 */
import { describe, expect, it } from 'vitest';
import type { Editor } from 'obsidian';
import { editorInfoField } from 'obsidian';
import type { LineDiagnostic } from '../bean-check';
import { FLAGGED_MESSAGE } from '../code-actions';
import {
	beanDiagnostics,
	createDiagnosticsExtension,
	diagnosticDecorations,
	diagnosticsExtension,
	diagnosticsGutter,
	DiagnosticsPlugin,
	ERROR_GUTTER_CLASS,
	ERROR_GUTTER_MARKER_CLASS,
	ERROR_LINE_CLASS,
	ERROR_UNDERLINE_CLASS,
	diagnosticsView,
	flagOkayDiagnostics,
	setBeanDiagnostics,
	setEditorBeanDiagnostics,
	setFlagOkayDiagnostics,
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

/** A view whose bean and flag fields hold the given diagnostics. */
function fakeView(
	text: string,
	bean: readonly LineDiagnostic[],
	flags: readonly LineDiagnostic[] = [],
): FakeDiagnosticView {
	const doc = fakeDoc(text);
	return {
		state: {
			doc,
			field: (field: unknown) => {
				if (field === beanDiagnostics) return bean;
				if (field === flagOkayDiagnostics) return flags;
				return [];
			},
		},
	};
}

function gutterOf(extension: unknown): MockGutterConfig {
	const members = extension as unknown[];
	const found = members.find((member) => member && typeof member === 'object' && 'lineMarker' in member);
	if (!found) throw new Error('missing diagnostics gutter');
	return found as MockGutterConfig;
}

describe('beanDiagnostics', () => {
	it('starts empty and is replaced wholesale by a set effect', () => {
		const field = beanDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		expect(field.create()).toEqual([]);

		const next = [{ line: 2, message: 'nope' }];
		const updated = field.update([], { effects: [setBeanDiagnostics.of(next)] });
		expect(updated).toBe(next);
		expect(field.update(next, { effects: [{ is: () => false, value: [] }] })).toBe(next);
	});

	it('ignores a flag-field effect', () => {
		const field = beanDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		const bean = [{ line: 0, message: 'unknown account' }];
		expect(field.update(bean, { effects: [setFlagOkayDiagnostics.of([{ line: 1, message: 'flagged' }])] })).toBe(
			bean,
		);
	});

	it('carries markers along edits and drops the ones whose line is consumed', () => {
		const field = beanDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		const marked = [{ line: 1, message: 'bad' }];

		const inserted = field.update(marked, {
			effects: [],
			docChanged: true,
			startState: { doc: fakeDoc('one\ntwo') },
			state: { doc: fakeDoc('new\none\ntwo') },
			changes: { mapPos: (pos: number) => pos + 4 },
		});
		expect(inserted).toEqual([{ line: 2, message: 'bad' }]);

		const consumed = field.update([{ line: 0, message: 'gone' }], {
			effects: [],
			docChanged: true,
			startState: { doc: fakeDoc('one\ntwo') },
			state: { doc: fakeDoc('two') },
			changes: { mapPos: () => 0 },
		});
		expect(consumed).toEqual([]);

		expect(
			field.update([{ line: -1, message: 'load' }], {
				effects: [],
				docChanged: true,
				startState: { doc: fakeDoc('one') },
				state: { doc: fakeDoc('one\ntwo') },
				changes: { mapPos: (pos: number) => pos },
			}),
		).toEqual([]);

		const next = [{ line: 0, message: 'new' }];
		expect(
			field.update(marked, {
				effects: [setBeanDiagnostics.of(next)],
				docChanged: true,
				startState: { doc: fakeDoc('one\ntwo') },
				state: { doc: fakeDoc('new\none\ntwo') },
				changes: { mapPos: (pos: number) => pos + 4 },
			}),
		).toBe(next);
	});

	it('ships both fields, the view plugin and the gutter in one extension', () => {
		const members = diagnosticsExtension as unknown as unknown[];
		expect(members).toContain(beanDiagnostics);
		expect(members).toContain(flagOkayDiagnostics);
		expect(members).toContain(diagnosticsView);
		expect(members).toContain(diagnosticsGutter);

		const field = beanDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		const diagnostics = [{ line: 0, message: 'x' }];
		const value = field.update(field.create(), { effects: [setBeanDiagnostics.of(diagnostics)] });
		const gutterConfig = diagnosticsGutter as unknown as MockGutterConfig;
		const view = fakeView('one', value);
		expect(gutterConfig.lineMarker?.(view, { from: 0, to: 3 }, [])).not.toBeNull();
	});
});

describe('flagOkayDiagnostics', () => {
	function stateFor(text: string, extension: string) {
		return {
			doc: {
				toString: () => text,
				line: (n: number) => {
					const lines = text.split('\n');
					return { text: lines[n - 1] ?? '', from: 0, to: 0, number: n };
				},
				lineAt: () => ({ number: 1, from: 0, to: 0 }),
			},
			field: (field: unknown) =>
				field === editorInfoField ? { file: { extension, path: `x.${extension}` } } : undefined,
		};
	}

	it('starts empty and is replaced wholesale by a set effect', () => {
		const field = flagOkayDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		expect(field.create()).toEqual([]);
		const next = [{ line: 0, message: FLAGGED_MESSAGE }];
		expect(field.update([], { effects: [setFlagOkayDiagnostics.of(next)] })).toBe(next);
	});

	it('ignores a bean-field effect', () => {
		const field = flagOkayDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		const flags = [{ line: 0, message: FLAGGED_MESSAGE }];
		expect(field.update(flags, { effects: [setBeanDiagnostics.of([{ line: 2, message: 'oops' }])] })).toBe(flags);
	});

	it('marks a ! transaction from the document and clears it when the bang is gone', () => {
		const field = flagOkayDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		const bang = stateFor('2026-10-01 ! "Cafe"\n  Assets:Cash  10.00 USD\n', 'bean');
		const flags = field.update([], { effects: [], docChanged: true, state: bang });
		expect(flags).toEqual([{ line: 0, message: FLAGGED_MESSAGE }]);
		const star = stateFor('2026-10-01 * "Cafe"\n  Assets:Cash  10.00 USD\n', 'bean');
		expect(field.update(flags, { effects: [], docChanged: true, state: star })).toEqual([]);
	});

	it('marks a bang only inside a markdown fence', () => {
		const field = flagOkayDiagnostics as unknown as MockStateField<readonly LineDiagnostic[]>;
		const note = stateFor('Wow!\n```beancount\n2026-10-01 ! "Cafe"\n```\n', 'md');
		expect(field.update([], { effects: [], docChanged: true, state: note })).toEqual([
			{ line: 2, message: FLAGGED_MESSAGE },
		]);
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
		expect(underlines.map((range) => [range.from, range.to, range.value.spec])).toEqual([
			[
				first.length + 1,
				first.length + 1 + second.length,
				{ class: ERROR_UNDERLINE_CLASS, attributes: { title: 'Transaction does not balance: (10.00 USD)' } },
			],
			[0, first.length, { class: ERROR_UNDERLINE_CLASS, attributes: { title: 'first\nsecond' } }],
		]);
		expect(
			ranges.filter((range) => range.value.kind === 'line').map((range) => range.value.spec),
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
	it('dots the union of bean and flag lines', () => {
		const gutterConfig = diagnosticsGutter as unknown as MockGutterConfig;
		expect(gutterConfig.class).toBe(ERROR_GUTTER_CLASS);
		const view = fakeView(
			'one\ntwo\n',
			[{ line: 1, message: 'bad' }],
			[{ line: 0, message: 'Transaction is flagged incomplete' }],
		);

		expect(gutterConfig.lineMarker?.(view, { from: 4, to: 7 }, [])?.elementClass).toBe(ERROR_GUTTER_MARKER_CLASS);
		expect(gutterConfig.lineMarker?.(view, { from: 0, to: 3 }, [])?.elementClass).toBe(ERROR_GUTTER_MARKER_CLASS);
		const neither = fakeView('one\ntwo\n', [], []);
		expect(gutterConfig.lineMarker?.(neither, { from: 0, to: 3 }, [])).toBeNull();

		const clean = fakeView('one\ntwo\n', [], []);
		expect(gutterConfig.lineMarkerChange?.({ startState: clean.state, state: view.state })).toBe(true);
		expect(gutterConfig.lineMarkerChange?.({ startState: view.state, state: view.state })).toBe(false);
		const flagOnly = fakeView('one\ntwo\n', [], [{ line: 0, message: 'Transaction is flagged incomplete' }]);
		expect(gutterConfig.lineMarkerChange?.({ startState: neither.state, state: flagOnly.state })).toBe(true);
	});
});

describe('createDiagnosticsExtension', () => {
	it('forwards a gutter mousedown on a marked line to the host', () => {
		const clicks: Array<{ line: number }> = [];
		const extension = createDiagnosticsExtension({
			onDiagnosticClick(_view, line) {
				clicks.push({ line });
				return true;
			},
		});
		const gutterConfig = gutterOf(extension);
		const view = fakeView('one\ntwo\n', [{ line: 1, message: 'bad' }]);
		expect(gutterConfig.domEventHandlers?.mousedown?.(view, { from: 4, to: 7 }, {} as Event)).toBe(true);
		expect(clicks).toEqual([{ line: 1 }]);
	});
});

describe('DiagnosticsPlugin', () => {
	it('rebuilds when either field moves and prefers bean tooltip on the same line', () => {
		const diagnostics = [{ line: 1, message: 'later' }];
		const view = fakeView('one\ntwo', diagnostics);
		const plugin = new DiagnosticsPlugin(view as never);
		const registered = diagnosticsView as unknown as MockViewPlugin<DiagnosticsPlugin>;
		expect(registered.cls).toBe(DiagnosticsPlugin);

		const decorations = registered.spec.decorations(plugin) as Array<{ from: number }>;
		expect(decorations.map((range) => range.from)).toEqual([4, 4]);

		const next = fakeView(
			'one\ntwo',
			[{ line: 1, message: 'later' }, { line: 0, message: 'sooner' }],
			[{ line: 0, message: 'Transaction is flagged incomplete' }],
		);
		plugin.update({
			docChanged: true,
			view: next,
			startState: view.state,
			state: next.state,
		} as never);
		const rebuilt = registered.spec.decorations(plugin) as Array<{ from: number; value: { spec?: { attributes?: { title?: string } } } }>;
		expect(rebuilt.map((range) => range.from)).toEqual([0, 0, 4, 4]);
		const titles = rebuilt
			.map((range) => range.value.spec?.attributes?.title)
			.filter((title): title is string => typeof title === 'string');
		expect(titles).toContain('sooner');
		expect(titles).not.toContain('Transaction is flagged incomplete');

		const kept = registered.spec.decorations(plugin);
		plugin.update({ docChanged: false, view: next, startState: next.state, state: next.state } as never);
		expect(registered.spec.decorations(plugin)).toBe(kept);
	});

	it('keeps flag decorations when bean diagnostics are cleared', () => {
		const start = fakeView('one\ntwo', [{ line: 1, message: 'oops' }], [
			{ line: 0, message: 'Transaction is flagged incomplete' },
		]);
		const plugin = new DiagnosticsPlugin(start as never);
		const registered = diagnosticsView as unknown as MockViewPlugin<DiagnosticsPlugin>;
		const cleared = fakeView('one\ntwo', [], [{ line: 0, message: 'Transaction is flagged incomplete' }]);
		plugin.update({
			docChanged: false,
			view: cleared,
			startState: start.state,
			state: cleared.state,
		} as never);
		const decorations = registered.spec.decorations(plugin) as Array<{ from: number }>;
		expect(decorations.map((range) => range.from)).toEqual([0, 0]);
	});
});

describe('setEditorBeanDiagnostics', () => {
	it('publishes bean diagnostics without touching the flag effect', () => {
		const editor = createEditor(['line']);
		const diagnostics = [{ line: 0, message: 'bad' }];

		setEditorBeanDiagnostics(editor as unknown as Editor, diagnostics);

		const [effect] = editor.cm.dispatched[0].effects as Array<{ value: unknown; is(spec: unknown): boolean }>;
		expect(effect.is(setBeanDiagnostics)).toBe(true);
		expect(effect.is(setFlagOkayDiagnostics)).toBe(false);
		expect(effect.value).toBe(diagnostics);

		const bare = { ...editor, cm: undefined };
		expect(() => setEditorBeanDiagnostics(bare as unknown as Editor, [])).not.toThrow();
	});


});
