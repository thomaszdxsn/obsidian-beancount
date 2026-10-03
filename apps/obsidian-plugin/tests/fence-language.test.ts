import { describe, expect, it } from 'vitest';
import {
	BEANCOUNT_LANGUAGE_DATA,
	fenceLanguageData,
	fenceLanguageExtension,
	posInBeancountFence,
	regionFoldAt,
} from '../fence-language';
import type { MockLanguageDataExtension } from './mocks/codemirror';

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
		expect(BEANCOUNT_LANGUAGE_DATA.commentTokens).toEqual({ line: ';' });
		expect(BEANCOUNT_LANGUAGE_DATA.closeBrackets.brackets).toEqual(['(', '[', '{', "'"]);
		expect(BEANCOUNT_LANGUAGE_DATA.closeBrackets.brackets).not.toContain('"');
		expect(BEANCOUNT_LANGUAGE_DATA.wordChars).toBe(':');
	});
});

describe('regionFoldAt', () => {
	it('folds the body between ;#region and ;#endregion, keeping the end visible', () => {
		const text = ['```beancount', ';#region', '  Assets:Cash', ';#endregion', '```'].join('\n');
		const start = lineBounds(text, 1);
		const inner = lineBounds(text, 2);
		const end = lineBounds(text, 3);
		expect(regionFoldAt(text, start.from, start.to)).toEqual({ from: start.to, to: end.from });
		expect(inner.from).toBeGreaterThan(start.to);
		expect(inner.to).toBeLessThan(end.from);
	});

	it('accepts ;;#region and a space after the semicolons', () => {
		const text = ['```bean', ';;#region cash', '  Assets:Cash', '; #endregion', '```'].join('\n');
		const start = lineBounds(text, 1);
		const end = lineBounds(text, 3);
		expect(regionFoldAt(text, start.from, start.to)).toEqual({ from: start.to, to: end.from });
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
			to: lineBounds(text, 6).from,
		});
		expect(regionFoldAt(text, inner.from, inner.to)).toEqual({
			from: inner.to,
			to: lineBounds(text, 4).from,
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
		const [lang] = fenceLanguageExtension() as unknown as [MockLanguageDataExtension, unknown];
		const text = ['```beancount', '  Assets:Cash', '```', 'prose'].join('\n');
		const state = { doc: { toString: () => text } };
		expect(lang.languageData(state, offsetOf(text, 'Assets'))).toEqual([BEANCOUNT_LANGUAGE_DATA]);
		expect(lang.languageData(state, offsetOf(text, 'prose'))).toEqual([]);
	});
});
