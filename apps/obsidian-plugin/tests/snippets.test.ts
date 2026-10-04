import { afterEach, describe, expect, it, vi } from 'vitest';
import { expandSnippet, matchSnippets, SNIPPETS } from '../snippets';

afterEach(() => {
	vi.useRealTimers();
});

function snippet(prefix: string): string {
	const found = SNIPPETS.find((entry) => entry.prefix === prefix);
	if (!found) throw new Error(`missing snippet ${prefix}`);
	return found.body;
}

describe('SNIPPETS', () => {
	it('covers the vscode-beancount prefixes plus txn', () => {
		expect(SNIPPETS.map((entry) => entry.prefix)).toEqual([
			'option',
			'open',
			'close',
			'commodity',
			'txn',
			'txn*',
			'txn!',
			'balance',
			'pad',
			'note',
			'document',
			'price',
			'event',
			'plugin',
			'include',
			'query',
			'custom',
			'pushtag',
			'poptag',
			'budget',
		]);
	});
});

describe('matchSnippets', () => {
	it('lists txn variants with the exact prefix first', () => {
		expect(matchSnippets('txn').map((entry) => entry.prefix)).toEqual(['txn', 'txn!', 'txn*']);
		expect(matchSnippets('txn*').map((entry) => entry.prefix)).toEqual(['txn*']);
		expect(matchSnippets('zzz')).toEqual([]);
	});

	it('ranks an exact match ahead of a longer prefix regardless of catalog order', () => {
		expect(matchSnippets('open').map((entry) => entry.prefix)).toEqual(['open']);
		expect(matchSnippets('o').map((entry) => entry.prefix)).toEqual(['open', 'option']);
		expect(matchSnippets('p').map((entry) => entry.prefix)).toEqual([
			'pad',
			'plugin',
			'poptag',
			'price',
			'pushtag',
		]);
	});
});

describe('expandSnippet', () => {
	it('expands txn to today’s date with the caret in the payee quotes', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		expect(expandSnippet(snippet('txn'))).toEqual({
			text: '2026-10-04 * "" ""',
			stops: [
				{ index: 1, from: 14, to: 14 },
				{ index: 2, from: 17, to: 17 },
			],
		});
	});

	it('fills $CURRENT_* inside ${n:default} tab stops', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 0, 5));
		expect(expandSnippet('${1:$CURRENT_YEAR}-${2:$CURRENT_MONTH}-${3:$CURRENT_DATE}')).toEqual({
			text: '2026-01-05',
			stops: [
				{ index: 1, from: 0, to: 4 },
				{ index: 2, from: 5, to: 7 },
				{ index: 3, from: 8, to: 10 },
			],
		});
	});

	it('inserts the first choice of ${n|a,b|} and visits $0 last', () => {
		expect(expandSnippet('${1|daily,weekly|} $0')).toEqual({
			text: 'daily ',
			stops: [
				{ index: 1, from: 0, to: 5 },
				{ index: 0, from: 6, to: 6 },
			],
		});
	});

	it('parks the caret at the end when the body has no stops', () => {
		expect(expandSnippet('plugin "foo"')).toEqual({
			text: 'plugin "foo"',
			stops: [{ index: 0, from: 12, to: 12 }],
		});
	});

	it('selects the Assets: placeholder on open', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		const expansion = expandSnippet(snippet('open'));
		expect(expansion.text).toBe('2026-10-04 open Assets: \n');
		expect(expansion.stops[0]).toEqual({ index: 1, from: 16, to: 23 });
	});

	it('resolves ${CURRENT_*} braces and leaves unknown dollars alone', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		expect(expandSnippet('${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE} $x')).toEqual({
			text: '2026-10-04 $x',
			stops: [{ index: 0, from: 13, to: 13 }],
		});
	});

	it('stamps today’s date onto every dated directive body', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		for (const prefix of [
			'open',
			'close',
			'commodity',
			'txn*',
			'txn!',
			'balance',
			'pad',
			'note',
			'document',
			'price',
			'event',
			'query',
			'custom',
			'budget',
		]) {
			expect(expandSnippet(snippet(prefix)).text.startsWith('2026-10-04')).toBe(true);
		}
		expect(expandSnippet(snippet('option')).text.startsWith('option ')).toBe(true);
		expect(expandSnippet(snippet('budget')).text).toContain('"daily"');
	});
});
