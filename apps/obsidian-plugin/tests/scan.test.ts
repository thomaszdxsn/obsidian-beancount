/**
 * Ledger line scanner: table-driven coverage of the #70 BDD map on the
 * public `scan.ts` seams only.
 */
import { describe, expect, it } from 'vitest';
import {
	canonicalTxnFlag,
	classifyLine,
	endsInString,
	entryAt,
	inStringOrComment,
	parsePostingLine,
	scanLedger,
} from '../scan';

function kinds(text: string) {
	return [...scanLedger(text).lines];
}

function entries(text: string) {
	return scanLedger(text).entries;
}

function slice(line: string, span: { from: number; to: number } | undefined) {
	return span === undefined ? undefined : line.slice(span.from, span.to);
}

describe('scanLedger', () => {
	it('returns no lines and no entries for empty text', () => {
		expect(scanLedger('')).toEqual({ lines: [], entries: [] });
	});

	it('attaches indented postings, metadata and comments; blank and column-0 comments end the entry', () => {
		const text = [
			'2026-01-01 * "Store"',
			'  invoice: "9"',
			'  ; note',
			'  Expenses:Food  1.00 USD',
			'  Assets:Cash',
			'',
			'; column 0',
			'2026-01-02 * "Next"',
			'  Assets:Cash  2.00 USD',
		].join('\n');
		expect(kinds(text)).toEqual([
			'txn-header',
			'metadata',
			'comment',
			'posting',
			'posting',
			'blank',
			'comment',
			'txn-header',
			'posting',
		]);
		const found = entries(text);
		expect(found).toHaveLength(2);
		expect(found[0]).toMatchObject({ startLine: 0, endLine: 4, damaged: false });
		expect(found[0].postings.map((p) => p.account?.text)).toEqual(['Expenses:Food', 'Assets:Cash']);
		expect(found[1]).toMatchObject({ startLine: 7, endLine: 8, damaged: false });
	});

	it('keeps multi-line strings across blank and column-0 lines, and does not treat inner posting-shaped text as a posting', () => {
		const text = [
			'2026-01-05 * "x"',
			'  memo: "first',
			'',
			'last ; not a comment"',
			'  Assets:Cash  1 USD',
			'  Income:Job',
			'2026-01-06 * "next"',
		].join('\n');
		expect(kinds(text)).toEqual([
			'txn-header',
			'metadata',
			'string-continue',
			'string-continue',
			'posting',
			'posting',
			'txn-header',
		]);
		expect(classifyLine('last ; not a comment"', true)).toBe('string-continue');
		expect(classifyLine('  Assets:Cash  1 USD', true)).toBe('string-continue');
		const found = entries(text);
		expect(found).toHaveLength(2);
		expect(found[0]).toMatchObject({ startLine: 0, endLine: 5, damaged: false });
		expect(found[0].postings.map((p) => p.account?.text)).toEqual(['Assets:Cash', 'Income:Job']);
		expect(found[1]).toMatchObject({ startLine: 6, endLine: 6 });
	});

	it('marks a damaged middle entry without swallowing its neighbours', () => {
		const text = [
			'2026-01-01 * "Good"',
			'  Assets:Cash  1 USD',
			'  Income:Job',
			'2026-01-02 * "Typing',
			'  Assets:Cash  1 U$D',
			'2026-01-03 * "Also good"',
			'  Assets:Cash  2 USD',
			'  Income:Job',
		].join('\n');
		const found = entries(text);
		expect(found).toHaveLength(3);
		expect(found[0]).toMatchObject({ startLine: 0, endLine: 2, damaged: false });
		expect(found[1]).toMatchObject({ startLine: 3, endLine: 4, damaged: true });
		expect(found[2]).toMatchObject({ startLine: 5, endLine: 7, damaged: false });
		expect(found[2].header).toMatchObject({ date: '2026-01-03', flag: '*' });
	});

	it('treats an org heading as not a transaction and ends the previous entry', () => {
		const text = ['2026-01-01 * "A"', '  Assets:Cash  1 USD', '* Heading', '2026-01-02 * "B"'].join('\n');
		expect(kinds(text)).toEqual(['txn-header', 'posting', 'org', 'txn-header']);
		const found = entries(text);
		expect(found).toHaveLength(2);
		expect(found[0]).toMatchObject({ startLine: 0, endLine: 1, damaged: false });
		expect(found[1]).toMatchObject({ startLine: 3, endLine: 3, damaged: false });
	});
});

describe('classifyLine', () => {
	it.each([
		['2026-01-01 * "x"', 'txn-header'],
		['2026-01-01\t*\t"x"', 'txn-header'],
		['2026/01/02 * "x"', 'txn-header'],
		['2026-10-01! "x"', 'txn-header'],
		['2026-10-01txn "x"', 'txn-header'],
		['2026-10-01 txn "x"', 'txn-header'],
		['2026-01-01 P "cleared"', 'txn-header'],
		['2026-01-01 open Assets:Cash', 'directive'],
		['2026-01-01 close Assets:Cash', 'directive'],
		['2026-01-01 balance Assets:Cash 0 USD', 'directive'],
		['2026-01-01 pad Assets:Cash Equity:Opening', 'directive'],
		['* Org title', 'org'],
		['** Nested', 'org'],
		['; a comment', 'comment'],
		['  ; indented comment', 'comment'],
		['', 'blank'],
		['   ', 'blank'],
		['  invoice: "9"', 'metadata'],
		['  Expenses:Food  1.00 USD', 'posting'],
		['include "other.bean"', 'other'],
	] as const)('%j → %s', (line, kind) => {
		expect(classifyLine(line)).toBe(kind);
	});
});

describe('parsePostingLine', () => {
	it('parses a leading flag, CJK account, thousands, cost, price and an inline comment', () => {
		const cjk = '  Expenses:餐饮  18.00 CNY';
		const parsed = parsePostingLine(cjk);
		expect(parsed?.account?.text).toBe('Expenses:餐饮');
		expect(slice(cjk, parsed?.number)).toBe('18.00');
		expect(slice(cjk, parsed?.commodity)).toBe('CNY');
		expect(parsed?.hasCost).toBe(false);
		expect(parsed?.hasPrice).toBe(false);

		const flagged = '  ! Assets:Cash  1,234.50 USD';
		expect(parsePostingLine(flagged)?.flag).toBe('!');
		expect(parsePostingLine(flagged)?.account?.text).toBe('Assets:Cash');
		expect(slice(flagged, parsePostingLine(flagged)?.number)).toBe('1,234.50');

		const trailing = '  Expenses:Food * 12.50 USD';
		expect(parsePostingLine(trailing)?.flag).toBe('*');
		expect(parsePostingLine(trailing)?.account?.text).toBe('Expenses:Food');

		const cost = '  Assets:Broker:AAPL  10 AAPL {150.00 USD}';
		expect(parsePostingLine(cost)).toMatchObject({ hasCost: true, hasPrice: false });
		expect(slice(cost, parsePostingLine(cost)?.number)).toBe('10');

		const price = '  Expenses:餐饮:午餐  12.00 CNY @ 0.14 USD';
		expect(parsePostingLine(price)).toMatchObject({ hasCost: false, hasPrice: true });
		expect(slice(price, parsePostingLine(price)?.number)).toBe('12.00');

		const commented = '  Assets:Cash  10 USD ; 99 EUR';
		expect(slice(commented, parsePostingLine(commented)?.number)).toBe('10');
		expect(slice(commented, parsePostingLine(commented)?.commodity)).toBe('USD');

		expect(parsePostingLine('  Expenses:卡片・ローン  1 JPY')?.account?.text).toBe('Expenses:卡片・ローン');
		expect(parsePostingLine('  Assets:Cash_ISA  1 USD')?.account?.text).toBe('Assets:Cash_ISA');
		expect(parsePostingLine('  invoice: "9"')).toBeNull();
		expect(parsePostingLine('  ; note')).toBeNull();
		expect(parsePostingLine('2026-01-01 * "x"')).toBeNull();
	});
});

describe('entryAt', () => {
	it('returns the inclusive range of the entry that holds a line', () => {
		const lines = ['2026-01-01 * "A"', '  Assets:Cash  1 USD', '', '2026-01-02 * "B"', '  Expenses:Food  1 USD'];
		expect(entryAt(lines, 0)).toEqual({ from: 0, to: 1 });
		expect(entryAt(lines, 1)).toEqual({ from: 0, to: 1 });
		expect(entryAt(lines, 2)).toBeNull();
		expect(entryAt(lines, 3)).toEqual({ from: 3, to: 4 });
		expect(entryAt(lines, 4)).toEqual({ from: 3, to: 4 });
	});
});

describe('endsInString / inStringOrComment', () => {
	it('does not end a string on an escaped quote; a semicolon inside a string is not a comment', () => {
		expect(endsInString('2026-01-01 * "say \\"hi\\""', false)).toBe(false);
		expect(endsInString('  memo: "first', false)).toBe(true);
		expect(endsInString('last ; not a comment"', true)).toBe(false);
		expect(endsInString('  Assets:Cash  10 USD "a \\" ; b" ; 99 EUR', false)).toBe(false);
		expect(endsInString('; a " in a comment', false)).toBe(false);
		expect(inStringOrComment('2026-01-01 * "say \\"hi')).toBe(true);
		expect(inStringOrComment('2026-01-01 * "hi" ; a " in a comment')).toBe(true);
		expect(inStringOrComment('2026-01-01 * "hi" #tr')).toBe(false);
	});
});

describe('canonicalTxnFlag', () => {
	it('maps txn to * and leaves other flag tokens unchanged', () => {
		expect(canonicalTxnFlag('txn')).toBe('*');
		expect(canonicalTxnFlag('*')).toBe('*');
		expect(canonicalTxnFlag('!')).toBe('!');
		expect(canonicalTxnFlag('P')).toBe('P');
	});
});

describe('header fields', () => {
	it('keeps slash dates as written and txn as the source flag token', () => {
		const slash = scanLedger('2026/01/02 * "Cafe" "Lunch"').entries[0];
		expect(slash.header).toMatchObject({ date: '2026/01/02', flag: '*' });
		expect(slice('2026/01/02 * "Cafe" "Lunch"', slash.header?.payee)).toBe('Cafe');
		expect(slice('2026/01/02 * "Cafe" "Lunch"', slash.header?.narration)).toBe('Lunch');

		const txn = scanLedger('2026-10-01txn "x"').entries[0];
		expect(txn.header).toMatchObject({ date: '2026-10-01', flag: 'txn' });
		expect(canonicalTxnFlag(txn.header?.flag ?? '')).toBe('*');

		const bang = scanLedger('2026-10-01! "x"').entries[0];
		expect(bang.header).toMatchObject({ date: '2026-10-01', flag: '!' });

		const open = scanLedger('2026-01-01 open Assets:Cash USD').entries[0];
		expect(open.header).toMatchObject({ date: '2026-01-01', keyword: 'open' });
		expect(open.header?.flag).toBeUndefined();
	});
});
