/**
 * Ledger line scanner: table-driven coverage of the #70 BDD map on the
 * public `scan.ts` seams only.
 */
import { describe, expect, it } from 'vitest';
import { generateLedger } from '../bench/common';
import {
	canonicalTxnFlag,
	classifyLine,
	COMMODITY_EXACT,
	commodityEndAt,
	commodityOf,
	endsInString,
	entryAt,
	entryExtent,
	headerPayee,
	inStringOrComment,
	isSpace,
	parseHeaderLine,
	parsePostingLine,
	parseTxnFlag,
	postingAmountCols,
	scanLedger,
	stripComment,
	unescapeQuoted,
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
		expect(found[0].postings.map((p) => p.account.text)).toEqual(['Expenses:Food', 'Assets:Cash']);
		expect(found[1]).toMatchObject({ startLine: 7, endLine: 8, damaged: false });
	});

	it('keeps multi-line strings across blank and column-0 lines, including a dated column-0 continuation', () => {
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
		expect(classifyLine('2026-01-06 * "next"', true)).toBe('string-continue');
		const found = entries(text);
		expect(found).toHaveLength(2);
		expect(found[0]).toMatchObject({ startLine: 0, endLine: 5, damaged: false });
		expect(found[0].postings.map((p) => p.account.text)).toEqual(['Assets:Cash', 'Income:Job']);
	});

	it('marks a damaged middle posting without swallowing neighbours', () => {
		const text = [
			'2026-01-01 * "Good"',
			'  Assets:Cash  1 USD',
			'  Income:Job',
			'2026-01-02 * "Bad"',
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
		['  Assets:Cash.Old  10 USD', 'other'],
		['  Assets:Cash,Old  10 USD', 'other'],
		['  Assets:Cash"Old  10 USD', 'other'],
		['  Assets:Cash(Old  10 USD', 'other'],
		['  Expenses:餐饮，午饭  10 CNY', 'other'],
		['  Expenses:餐饮：午饭  10 CNY', 'other'],
		['include "other.bean"', 'other'],
	] as const)('%j → %s', (line, kind) => {
		expect(classifyLine(line)).toBe(kind);
	});
});

describe('parsePostingLine', () => {
	it.each([
		['  Expenses:餐饮  18.00 CNY', { account: 'Expenses:餐饮', number: '18.00', commodity: 'CNY', hasCost: false, hasPrice: false }],
		['  ! Assets:Cash  1,234.50 USD', { account: 'Assets:Cash', number: '1,234.50', flag: '!', leadingFlag: '!' }],
		['  Expenses:Food * 12.50 USD', { account: 'Expenses:Food', flag: '*', trailingFlag: '*' }],
		['  Assets:Broker:AAPL  10 AAPL {150.00 USD}', { account: 'Assets:Broker:AAPL', number: '10', hasCost: true, hasPrice: false }],
		['  Expenses:餐饮:午餐  12.00 CNY @ 0.14 USD', { account: 'Expenses:餐饮:午餐', number: '12.00', hasCost: false, hasPrice: true }],
		['  Assets:Cash  10 USD ; 99 EUR', { account: 'Assets:Cash', number: '10', commodity: 'USD' }],
		['  Expenses:卡片・ローン  1 JPY', { account: 'Expenses:卡片・ローン' }],
		['  Assets:Cash_ISA  1 USD', { account: 'Assets:Cash_ISA' }],
		['  ! Assets:Cash * 10 USD', { account: 'Assets:Cash', leadingFlag: '!', trailingFlag: '*', number: '10' }],
	])('%j', (line, expected) => {
		const parsed = parsePostingLine(line);
		expect(parsed).not.toBeNull();
		if (parsed === null) return;
		expect(parsed.account.text).toBe(expected.account);
		if ('number' in expected && expected.number !== undefined) {
			expect(slice(line, parsed.number)).toBe(expected.number);
		}
		if ('commodity' in expected && expected.commodity !== undefined) {
			expect(slice(line, parsed.commodity)).toBe(expected.commodity);
		}
		if ('flag' in expected) expect(parsed.flag).toBe(expected.flag);
		if ('leadingFlag' in expected) expect(parsed.leadingFlag).toBe(expected.leadingFlag);
		if ('trailingFlag' in expected) expect(parsed.trailingFlag).toBe(expected.trailingFlag);
		if ('hasCost' in expected) expect(parsed.hasCost).toBe(expected.hasCost);
		if ('hasPrice' in expected) expect(parsed.hasPrice).toBe(expected.hasPrice);
	});

	it('rejects metadata, comments and column-0 directives', () => {
		expect(parsePostingLine('  invoice: "9"')).toBeNull();
		expect(parsePostingLine('  ; note')).toBeNull();
		expect(parsePostingLine('2026-01-01 * "x"')).toBeNull();
	});

	it('rejects an account followed by ASCII or CJK punctuation instead of a gap', () => {
		expect(parsePostingLine('  Assets:Cash.Old  10 USD')).toBeNull();
		expect(parsePostingLine('  Assets:Cash,Old  10 USD')).toBeNull();
		expect(parsePostingLine('  Assets:Cash"Old  10 USD')).toBeNull();
		expect(parsePostingLine('  Assets:Cash(Old  10 USD')).toBeNull();
		expect(parsePostingLine('  Expenses:餐饮，午饭  10 CNY')).toBeNull();
		expect(parsePostingLine('  Expenses:餐饮：午饭  10 CNY')).toBeNull();
		expect(postingAmountCols('  Assets:Cash.Old  10 USD')).toBeNull();
		expect(parsePostingLine('  Assets:Cash  10 USD')?.account.text).toBe('Assets:Cash');
		expect(parsePostingLine('  Assets:Cash; leftover')?.account.text).toBe('Assets:Cash');
	});
});

describe('entryAt / entryExtent', () => {
	it('returns the inclusive range of the entry that holds a line', () => {
		const lines = ['2026-01-01 * "A"', '  Assets:Cash  1 USD', '', '2026-01-02 * "B"', '  Expenses:Food  1 USD'];
		expect(entryAt(lines, 0)).toEqual({ from: 0, to: 1 });
		expect(entryAt(lines, 1)).toEqual({ from: 0, to: 1 });
		expect(entryAt(lines, 2)).toBeNull();
		expect(entryAt(lines, 3)).toEqual({ from: 3, to: 4 });
		expect(entryAt(lines, 4)).toEqual({ from: 3, to: 4 });
	});

	it('does not read lines after the entry ends', () => {
		const lines = [
			'2026-01-01 * "A"',
			'  Assets:Cash  1 USD',
			'',
			'2026-01-02 * "B"',
			'  Expenses:Food  1 USD',
		];
		const seen: number[] = [];
		const range = entryExtent(
			(i) => {
				seen.push(i);
				return lines[i];
			},
			0
		);
		expect(range).toEqual({ from: 0, to: 1 });
		expect(Math.max(...seen)).toBe(2);
		expect(seen.includes(3)).toBe(false);
	});
});

describe('endsInString / inStringOrComment / stripComment', () => {
	it('does not end a string on an escaped quote; a semicolon inside a string is not a comment', () => {
		expect(endsInString('2026-01-01 * "say \\"hi\\""', false)).toBe(false);
		expect(endsInString('  memo: "first', false)).toBe(true);
		expect(endsInString('last ; not a comment"', true)).toBe(false);
		expect(endsInString('  Assets:Cash  10 USD "a \\" ; b" ; 99 EUR', false)).toBe(false);
		expect(endsInString('; a " in a comment', false)).toBe(false);
		expect(inStringOrComment('2026-01-01 * "say \\"hi')).toBe(true);
		expect(inStringOrComment('2026-01-01 * "hi" ; a " in a comment')).toBe(true);
		expect(inStringOrComment('2026-01-01 * "hi" #tr')).toBe(false);
		expect(stripComment('  Assets:Cash  10 USD "a \\" ; b" ; 99 EUR')).toBe('  Assets:Cash  10 USD "a \\" ; b" ');
	});

	it('treats a trailing backslash as not escaping the next line', () => {
		expect(endsInString('"foo\\', false)).toBe(true);
		expect(inStringOrComment('"foo\\')).toBe(true);
		expect(stripComment('"foo\\ ; bar')).toBe('"foo\\ ; bar');
		expect(endsInString('"foo\\"', false)).toBe(true);
		expect(inStringOrComment('"foo\\"')).toBe(true);
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

describe('parseHeaderLine', () => {
	it('keeps slash dates as written and txn as the source flag token', () => {
		const slashLine = '2026/01/02 * "Cafe" "Lunch"';
		const slash = parseHeaderLine(slashLine);
		expect(slash).toMatchObject({ kind: 'txn-header', date: '2026/01/02', flag: '*' });
		expect(headerPayee(slashLine, slash!)).toBe('Cafe');
		expect(slice(slashLine, slash?.narration)).toBe('Lunch');
		expect(unescapeQuoted('Say \\"hi\\"')).toBe('Say "hi"');

		const txn = parseHeaderLine('2026-10-01txn "x"');
		expect(txn).toMatchObject({ date: '2026-10-01', flag: 'txn' });
		expect(canonicalTxnFlag(txn?.flag ?? '')).toBe('*');

		const bang = parseHeaderLine('2026-10-01! "x"');
		expect(bang).toMatchObject({ date: '2026-10-01', flag: '!' });
		expect(bang?.flagSpan).toEqual({ from: 10, to: 11 });

		const open = parseHeaderLine('2026-01-01 open Assets:Cash USD');
		expect(open).toMatchObject({ kind: 'directive', date: '2026-01-01', keyword: 'open' });
		expect(open?.flag).toBeUndefined();
		expect(slice('2026-01-01 open Assets:Cash USD', open?.keywordSpan)).toBe('open');
	});
});

describe('scanner helper equivalence', () => {
	const edges = [
		'  Expenses:餐饮:午餐  12.00 CNY @ 0.14 USD',
		'  Expenses:卡片・ローン  1 JPY',
		'  Assets:Cash.Old  10 USD',
		'  Assets:Cash,Old  10 USD',
		'  Expenses:餐饮，午饭  10 CNY',
		'  Assets:Cash  10 USD\r',
		'2026-01-01 * "Cafe" "Lunch"\r',
		'2026-01-01! "x"',
		'2026-10-01txn "x"',
		'2026-01-01 open Assets:Cash',
		'  ! Assets:Cash * 10 USD',
		'  Assets:Broker:AAPL  10 AAPL {150.00 USD}',
		'  Assets:Cash  10 "HOOL LAND"',
		'  Assets:Cash  10 USD ; leftover',
		'  Assets:Cash',
	];

	function snapCols(line: string) {
		const cols = postingAmountCols(line);
		return cols === null ? null : { gapStart: cols.gapStart, numberFrom: cols.numberFrom, numberTo: cols.numberTo };
	}

	function assertPostingCols(line: string) {
		const parsed = parsePostingLine(line);
		const cols = snapCols(line);
		if (parsed === null || parsed.number === undefined) {
			expect(cols).toBeNull();
			return;
		}
		expect(cols).toEqual({
			gapStart: parsed.gapStart,
			numberFrom: parsed.number.from,
			numberTo: parsed.number.to,
		});
	}

	function assertTxnFlag(line: string) {
		const header = parseHeaderLine(line);
		const flag = parseTxnFlag(line);
		if (header?.kind === 'txn-header') expect(flag).toBe(header.flag);
		else expect(flag).toBeUndefined();
	}

	function assertCommodity(line: string) {
		const parsed = parsePostingLine(line);
		if (parsed?.commodity === undefined) return;
		const from = parsed.commodity.from;
		const to = parsed.commodity.to;
		const token = line.replace(/\r$/, '').slice(from, to);
		expect(commodityEndAt(line.replace(/\r$/, ''), from)).toBe(to);
		expect(COMMODITY_EXACT.test(token)).toBe(true);
		expect(commodityOf(token)).not.toBeNull();
		if (to < line.replace(/\r$/, '').length) {
			expect(isSpace(line.replace(/\r$/, '').charCodeAt(to))).toBe(true);
		}
	}

	it('agrees on generateLedger(200) plus punctuation, CJK, CR, cost, price and flag edges', () => {
		const lines = [...generateLedger(200).split('\n'), ...edges];
		for (const line of lines) {
			assertPostingCols(line);
			assertTxnFlag(line);
			assertCommodity(line);
		}
	});
});

