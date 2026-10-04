import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { BEANCOUNT_LANGUAGE_DATA } from '../beancount-mode';
import {
	fenceCommentPlan,
	fenceLanguageData,
	fenceLanguageExtension,
	posInBeancountFence,
	regionFoldAt,
} from '../fence-language';
import type { MockKeymapExtension, MockLanguageDataExtension, MockView } from './mocks/codemirror';
import { createView } from './mocks/codemirror';

function offsetOf(text: string, needle: string): number {
	const at = text.indexOf(needle);
	if (at < 0) throw new Error(`missing ${JSON.stringify(needle)}`);
	return at;
}

function lineBounds(text: string, line: number): { from: number; to: number } {
	const lines = text.split('\n');
	let from = 0;
	for (let i = 0; i < line; i += 1) from += lines[i].length + 1;
	return { from, to: from + lines[line].length };
}

function commentRun(): (view: EditorView) => boolean {
	const [keymapExt] = fenceLanguageExtension() as unknown as [MockKeymapExtension, ...unknown[]];
	return keymapExt.bindings[0].run as unknown as (view: EditorView) => boolean;
}

describe('posInBeancountFence', () => {
	const doc = [
		'prose before',
		'```beancount',
		'2026-01-01 * "Store"',
		'  Assets:Cash  10.00 USD',
		'```',
		'middle',
		'```bean',
		'; bean alias body',
		'```',
		'```js',
		'const x = 1',
		'```',
		'after',
	].join('\n');

	it('is true only on beancount/bean fence body lines', () => {
		expect(posInBeancountFence(doc, offsetOf(doc, 'prose'))).toBe(false);
		expect(posInBeancountFence(doc, offsetOf(doc, '```beancount'))).toBe(false);
		expect(posInBeancountFence(doc, offsetOf(doc, '2026-01-01'))).toBe(true);
		expect(posInBeancountFence(doc, offsetOf(doc, 'Assets:Cash'))).toBe(true);
		expect(posInBeancountFence(doc, offsetOf(doc, '```\nmiddle'))).toBe(false);
		expect(posInBeancountFence(doc, offsetOf(doc, 'middle'))).toBe(false);
		expect(posInBeancountFence(doc, offsetOf(doc, '; bean alias'))).toBe(true);
		expect(posInBeancountFence(doc, offsetOf(doc, '```js'))).toBe(false);
		expect(posInBeancountFence(doc, offsetOf(doc, 'const x'))).toBe(false);
		expect(posInBeancountFence(doc, offsetOf(doc, 'after'))).toBe(false);
	});

	it('treats an unclosed fence as body through EOF', () => {
		const open = 'intro\n```beancount\n  Assets:Cash\n';
		expect(posInBeancountFence(open, offsetOf(open, 'Assets'))).toBe(true);
		expect(posInBeancountFence(open, open.length)).toBe(true);
		expect(posInBeancountFence(open, offsetOf(open, 'intro'))).toBe(false);
	});

	it('rejects an empty body and a negative pos', () => {
		const empty = '```beancount\n```\n';
		expect(posInBeancountFence(empty, offsetOf(empty, '```beancount'))).toBe(false);
		expect(posInBeancountFence(empty, empty.indexOf('\n```'))).toBe(false);
		expect(posInBeancountFence('```beancount\nx\n```', -1)).toBe(false);
	});
});

describe('fenceLanguageData', () => {
	const text = ['```beancount', '  Assets:Cash', '```', 'prose'].join('\n');

	it('returns beancount tokens inside the fence and nothing in prose', () => {
		expect(fenceLanguageData(text, offsetOf(text, 'Assets'))).toEqual([BEANCOUNT_LANGUAGE_DATA]);
		expect(fenceLanguageData(text, offsetOf(text, 'prose'))).toEqual([]);
	});
});

describe('fenceCommentPlan', () => {
	const doc = ['```beancount', '  Assets:Cash', '; already', '```', 'prose'].join('\n');

	it('comments a fence body line after its indent', () => {
		const at = offsetOf(doc, 'Assets');
		expect(fenceCommentPlan(doc, [{ anchor: at, head: at }])).toEqual({
			changes: [{ from: lineBounds(doc, 1).from + 2, to: lineBounds(doc, 1).from + 2, insert: '; ' }],
			carets: [at + 2],
		});
	});

	it('uncomments ; and one following space', () => {
		const at = offsetOf(doc, 'already');
		const line = lineBounds(doc, 2);
		expect(fenceCommentPlan(doc, [{ anchor: at, head: at }])).toEqual({
			changes: [{ from: line.from, to: line.from + 2, insert: '' }],
			carets: [at - 2],
		});
		expect(fenceCommentPlan(doc, [{ anchor: line.from + 1, head: line.from + 1 }])?.carets).toEqual([
			line.from,
		]);
	});

	it('uncomments a bare semicolon with no space', () => {
		const text = ['```beancount', ';payee', '```'].join('\n');
		const at = offsetOf(text, 'payee');
		expect(fenceCommentPlan(text, [{ anchor: at, head: at }])).toEqual({
			changes: [{ from: lineBounds(text, 1).from, to: lineBounds(text, 1).from + 1, insert: '' }],
			carets: [at - 1],
		});
	});

	it('comments every selected fence line and leaves already-commented lines', () => {
		const text = ['```beancount', '  Assets:Cash', '; keep', '  Expenses:Food', '```'].join('\n');
		const from = lineBounds(text, 1).from;
		const to = lineBounds(text, 3).to;
		const plan = fenceCommentPlan(text, [{ anchor: from, head: to }]);
		expect(plan?.changes).toEqual([
			{ from: lineBounds(text, 1).from + 2, to: lineBounds(text, 1).from + 2, insert: '; ' },
			{ from: lineBounds(text, 3).from + 2, to: lineBounds(text, 3).from + 2, insert: '; ' },
		]);
	});

	it('falls through in prose, on the fence marker, and across a fence boundary', () => {
		const at = offsetOf(doc, 'prose');
		expect(fenceCommentPlan(doc, [{ anchor: at, head: at }])).toBeNull();
		expect(fenceCommentPlan(doc, [{ anchor: 0, head: 0 }])).toBeNull();
		expect(
			fenceCommentPlan(doc, [{ anchor: offsetOf(doc, 'Assets'), head: offsetOf(doc, 'prose') }])
		).toBeNull();
		expect(fenceCommentPlan(doc, [])).toBeNull();
	});
});

describe('regionFoldAt', () => {
	it('folds the body between ;#region and ;#endregion, keeping the end visible', () => {
		const text = ['```beancount', ';#region', '  Assets:Cash', ';#endregion', '```'].join('\n');
		const start = lineBounds(text, 1);
		expect(regionFoldAt(text, start.from, start.to)).toEqual({
			from: start.to,
			to: lineBounds(text, 2).to,
		});
	});

	it('accepts ;;#region and a space after the semicolons', () => {
		const text = ['```bean', ';;#region cash', '  Assets:Cash', '; #endregion', '```'].join('\n');
		const start = lineBounds(text, 1);
		expect(regionFoldAt(text, start.from, start.to)).toEqual({
			from: start.to,
			to: lineBounds(text, 2).to,
		});
	});

	it('pairs nested regions like a stack', () => {
		const text = [
			'```beancount',
			';#region outer',
			';#region inner',
			'x',
			';#endregion',
			'y',
			';#endregion',
			'```',
		].join('\n');
		const outer = lineBounds(text, 1);
		const inner = lineBounds(text, 2);
		expect(regionFoldAt(text, outer.from, outer.to)).toEqual({
			from: outer.to,
			to: lineBounds(text, 5).to,
		});
		expect(regionFoldAt(text, inner.from, inner.to)).toEqual({
			from: inner.to,
			to: lineBounds(text, 3).to,
		});
	});

	it('folds through the last body line when the end marker is missing', () => {
		const text = ['```beancount', ';#region', 'a', 'b', '```'].join('\n');
		const start = lineBounds(text, 1);
		expect(regionFoldAt(text, start.from, start.to)).toEqual({
			from: start.to,
			to: lineBounds(text, 3).to,
		});
		const open = ['```beancount', ';#region', 'tail'].join('\n');
		expect(regionFoldAt(open, lineBounds(open, 1).from, lineBounds(open, 1).to)).toEqual({
			from: lineBounds(open, 1).to,
			to: open.length,
		});
	});

	it('has nothing to fold for an empty region, prose, or a different fence', () => {
		const empty = ['```beancount', ';#region', ';#endregion', '```'].join('\n');
		expect(regionFoldAt(empty, lineBounds(empty, 1).from, lineBounds(empty, 1).to)).toBeNull();

		const prose = ';#region\nbody\n;#endregion';
		expect(regionFoldAt(prose, 0, ';#region'.length)).toBeNull();

		const js = ['```js', ';#region', 'const x = 1', ';#endregion', '```'].join('\n');
		expect(regionFoldAt(js, lineBounds(js, 1).from, lineBounds(js, 1).to)).toBeNull();

		const comment = ['```beancount', '; just a comment', '```'].join('\n');
		expect(regionFoldAt(comment, lineBounds(comment, 1).from, lineBounds(comment, 1).to)).toBeNull();
	});
});

describe('fenceLanguageExtension', () => {
	it('overlays languageData only inside fence bodies', () => {
		const items = fenceLanguageExtension() as unknown as Array<
			MockKeymapExtension | MockLanguageDataExtension
		>;
		const lang = items.find((item): item is MockLanguageDataExtension => 'languageData' in item);
		const text = ['```beancount', '  Assets:Cash', '```', 'prose'].join('\n');
		const state = { doc: { toString: () => text } };
		expect(lang?.languageData(state, offsetOf(text, 'Assets'))).toEqual([BEANCOUNT_LANGUAGE_DATA]);
		expect(lang?.languageData(state, offsetOf(text, 'prose'))).toEqual([]);
	});

	it('toggles ; comments on Mod-/ inside a fence and falls through in prose', () => {
		const run = commentRun();
		const text = ['```beancount', '  Assets:Cash', '```', 'prose'].join('\n');
		const inside: MockView = createView(text, [{ anchor: offsetOf(text, 'Assets') }]);
		expect(run(inside as unknown as EditorView)).toBe(true);
		expect(inside.dispatched[0].changes).toEqual([
			{
				from: lineBounds(text, 1).from + 2,
				to: lineBounds(text, 1).from + 2,
				insert: '; ',
			},
		]);
		const prose: MockView = createView(text, [{ anchor: offsetOf(text, 'prose') }]);
		expect(run(prose as unknown as EditorView)).toBe(false);
		expect(prose.dispatched).toEqual([]);
	});
});
