import type { EditorState } from '@codemirror/state';
import { BeancountParser } from '@repo/beancount-parser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transactionFoldAt, transactionFoldInState } from '../transaction-fold';
import type { FoldBody, FoldDoc } from '../transaction-fold';

interface FakeLine {
	number: number;
	from: number;
	to: number;
	text: string;
}

/** A CM6 `Text` stand-in: 1-based lines with document offsets. */
function textDoc(text: string): FoldDoc & { lineAt(pos: number): FakeLine; toString(): string } {
	const lines: FakeLine[] = [];
	let from = 0;
	text.split('\n').forEach((line, i) => {
		lines.push({ number: i + 1, from, to: from + line.length, text: line });
		from += line.length + 1;
	});
	return {
		lines: lines.length,
		line: (n: number) => lines[n - 1],
		lineAt: (pos: number) => lines.filter((l) => l.from <= pos).pop()!,
		toString: () => text,
	} as unknown as FoldDoc & { lineAt(pos: number): FakeLine; toString(): string };
}

function stateFor(text: string, file: { path: string; extension: string } | null): EditorState {
	return { doc: textDoc(text), field: () => (file ? { file } : undefined) } as unknown as EditorState;
}

/** The text a fold hides, to assert ranges without hand-counted offsets. */
function folded(text: string, line: number, body?: FoldBody): string | null {
	const range = transactionFoldAt(textDoc(text), line, body);
	return range ? text.slice(range.from, range.to) : null;
}

const LEDGER = [
	'2026-01-01 open Assets:Cash', // 1
	'', // 2
	'2026-01-02 * "Store" "Lunch" #food', // 3
	'  memo: "receipt"', // 4
	'  Expenses:Food   12.00 USD ; tip incl.', // 5
	'    ; between postings', // 6
	'  Assets:Cash', // 7
	'  ; trailing note', // 8
	'', // 9
	'2026-01-03 txn "Bus"', // 10
	'\tExpenses:Transport  2 USD', // 11
	'\tAssets:Cash', // 12
	'* Section', // 13
].join('\n');

describe('transactionFoldAt', () => {
	it('hides metadata and postings through the last posting, keeping the header and a trailing comment', () => {
		expect(folded(LEDGER, 3)).toBe(
			['', '  memo: "receipt"', '  Expenses:Food   12.00 USD ; tip incl.', '    ; between postings', '  Assets:Cash'].join(
				'\n'
			)
		);
	});

	it('folds a `txn` entry with tab-indented postings that a column-0 heading ends', () => {
		expect(folded(LEDGER, 10)).toBe('\n\tExpenses:Transport  2 USD\n\tAssets:Cash');
	});

	it('offers no fold on non-transaction directives or posting lines', () => {
		expect(folded(LEDGER, 1)).toBeNull();
		expect(folded(LEDGER, 5)).toBeNull();
		const open = '2026-01-01 open Assets:Cash USD\n  note: "x"';
		expect(folded(open, 1)).toBeNull();
	});

	it('offers no fold on a transaction with nothing under its header', () => {
		expect(folded('2026-01-01 * "Empty"\n\n  Assets:Cash 1 USD', 1)).toBeNull();
		expect(folded('2026-01-01 * "Only a comment"\n  ; note', 1)).toBeNull();
	});

	it('drops only the fold of the entry being edited into invalid syntax', () => {
		const broken = [
			'2026-01-01 * "Good"',
			'  Assets:Cash  1 USD',
			'  Income:Job',
			'2026-01-02 * "Typing',
			'  Assets:Cash  1 U$D',
			'2026-01-03 * "Also good"',
			'  Assets:Cash  2 USD',
			'  Income:Job',
		].join('\n');
		expect(folded(broken, 1)).toBe('\n  Assets:Cash  1 USD\n  Income:Job');
		expect(folded(broken, 4)).toBeNull();
		expect(folded(broken, 6)).toBe('\n  Assets:Cash  2 USD\n  Income:Job');
	});

	it('does not let pushtag context elsewhere in the file break an entry', () => {
		const doc = 'pushtag #trip\n2026-01-01 * "Hotel"\n  Expenses:Travel  100 USD\n  Assets:Cash\npoptag #trip';
		expect(folded(doc, 2)).toBe('\n  Expenses:Travel  100 USD\n  Assets:Cash');
	});

	it('stops at the end of `body` so a fence end is never folded into the entry', () => {
		const doc = '2026-01-01 * "x"\n  Assets:Cash  1 USD\n  Income:Job\n  Expenses:Food 2 USD';
		const body = { first: 1, lines: doc.split('\n').slice(0, 3) };
		expect(folded(doc, 1, body)).toBe('\n  Assets:Cash  1 USD\n  Income:Job');
	});

	it('keeps a multi-line string that continues at column 0 or across a blank line inside the entry', () => {
		const doc = [
			'2026-01-05 * "x"', // 1
			'  memo: "first', // 2
			'', // 3
			'last ; not a comment"', // 4
			'  Assets:Cash  1 USD', // 5
			'  Income:Job', // 6
			'2026-01-06 * "next"', // 7
		].join('\n');
		expect(folded(doc, 1)).toBe('\n  memo: "first\n\nlast ; not a comment"\n  Assets:Cash  1 USD\n  Income:Job');
		// Escaped quotes and quotes inside comments do not toggle the string.
		const escaped = '2026-01-05 * "say \\"hi\\"" ; a " in a comment\n  Assets:Cash  1 USD\n  Income:Job';
		expect(folded(escaped, 1)).toBe('\n  Assets:Cash  1 USD\n  Income:Job');
	});

	it('offers no fold while a string is left open to the end', () => {
		expect(folded('2026-01-05 * "x"\n  memo: "open\n  Assets:Cash  1 USD\n', 1)).toBeNull();
	});

	it('folds an entry of up to 300 lines and gives no partial fold to a longer one', () => {
		const entry = (postings: number) =>
			['2026-01-05 * "big"', ...Array.from({ length: postings }, (_, i) => `  Assets:A${i}  1 USD`), '  Income:Job'].join('\n');
		expect(folded(entry(298), 1)?.split('\n')).toHaveLength(300);
		expect(folded(entry(299), 1)).toBeNull();
	});
});

describe('transactionFoldInState', () => {
	const NOTE = [
		'Notes about lunch', // 1
		'2026-01-02 * "Not in a fence"', // 2
		'  Assets:Cash  1 USD', // 3
		'```beancount', // 4
		'2026-01-02 * "Store"', // 5
		'  Expenses:Food  12.00 USD', // 6
		'  Assets:Cash', // 7
		'   ```', // 8 — an indented close still ends the fence
		'  indented prose after the fence', // 9
	].join('\n');
	const lineStart = (text: string, line: number) => textDoc(text).line(line).from;

	it('folds every transaction of a ledger file', () => {
		const range = transactionFoldInState(stateFor(LEDGER, { path: 'a.bean', extension: 'bean' }), lineStart(LEDGER, 3));
		expect(range && LEDGER.slice(range.from, range.to)).toContain('  Assets:Cash');
	});

	it('folds only fence bodies in a markdown note, never past the closing fence', () => {
		const state = stateFor(NOTE, { path: 'n.md', extension: 'md' });
		expect(transactionFoldInState(state, lineStart(NOTE, 2))).toBeNull();
		const range = transactionFoldInState(state, lineStart(NOTE, 5));
		expect(range && NOTE.slice(range.from, range.to)).toBe('\n  Expenses:Food  12.00 USD\n  Assets:Cash');
	});

	it('folds a fence indented under a list item the way bean-check reads it', () => {
		const note = [
			'- groceries', // 1
			'  ```beancount', // 2
			'  2026-01-05 * "x"', // 3
			'    Assets:Cash  1 USD', // 4
			'    Income:Job', // 5
			'  ```', // 6
		].join('\n');
		const range = transactionFoldInState(stateFor(note, { path: 'n.md', extension: 'md' }), lineStart(note, 3));
		expect(range && note.slice(range.from, range.to)).toBe('\n    Assets:Cash  1 USD\n    Income:Job');
	});

	it('folds nothing in other files or an editor without a file', () => {
		expect(transactionFoldInState(stateFor(LEDGER, { path: 'a.txt', extension: 'txt' }), lineStart(LEDGER, 3))).toBeNull();
		expect(transactionFoldInState(stateFor(LEDGER, null), lineStart(LEDGER, 3))).toBeNull();
	});

	it('offers no fold from a posting line of a ledger file', () => {
		expect(transactionFoldInState(stateFor(LEDGER, { path: 'a.bean', extension: 'bean' }), lineStart(LEDGER, 5))).toBeNull();
	});
});

describe('transactionFoldAt across edits', () => {
	it('folds an entry again once a syntax error is fixed', () => {
		const valid = '2026-02-01 * "Fix me"\n  Assets:Cash  1 USD\n  Income:Job';
		const typing = '2026-02-01 * "Fix me\n  Assets:Cash  1 USD\n  Income:Job';
		expect(folded(typing, 1)).toBeNull();
		expect(folded(valid, 1)).toBe('\n  Assets:Cash  1 USD\n  Income:Job');
		expect(folded(typing, 1)).toBeNull();
	});

	it('evicts the least recently used entry once the cache is full', () => {
		const parse = vi.spyOn(BeancountParser, 'parse');
		const entry = (i: number) => `2026-03-01 * "lru${i}"\n  Assets:Cash  ${i} USD\n  Income:Job`;
		for (let i = 0; i < 5000; i += 1) folded(entry(i), 1);
		// Touch entry 0 so entry 1 becomes the oldest, then overflow by one.
		folded(entry(0), 1);
		folded(entry(5000), 1);
		parse.mockClear();
		expect(folded(entry(0), 1)).toBe('\n  Assets:Cash  0 USD\n  Income:Job');
		expect(parse).not.toHaveBeenCalled();
		expect(folded(entry(1), 1)).toBe('\n  Assets:Cash  1 USD\n  Income:Job');
		expect(parse).toHaveBeenCalledTimes(1);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});
