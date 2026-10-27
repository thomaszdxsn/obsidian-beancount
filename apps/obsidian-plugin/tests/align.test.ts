/**
 * Decimal-point alignment: which lines count as postings, how the shared
 * column is computed, and that the rewrite is idempotent and surgical.
 */
import { describe, expect, it } from 'vitest';
import {
	alignFencedDocument,
	alignmentRanges,
	alignLines,
	alignText,
	blockRangeAt,
	blockRangeInLedger,
	computeAlignment,
	displayWidth,
	intersectRange,
	isAmountDotInsert,
} from '../align';

/** Align a document given as lines; return the document as lines. */
function align(lines: string[]): string[] {
	return alignText(lines.join('\n')).split('\n');
}

describe('alignText', () => {
	it('aligns the decimal points of a transaction', () => {
		expect(
			align([
				'2026-10-01 * "Store"',
				'  Expenses:Food 12.5 USD',
				'  Assets:Cash -12.5 USD',
			])
		).toEqual([
			'2026-10-01 * "Store"',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash  -12.5 USD',
		]);
	});

	it('aligns each transaction block to its own column', () => {
		expect(
			align([
				'2026-10-01 * "A"',
				'  Expenses:Food 12.50 CNY',
				'  Assets:Cash -12.50 CNY',
				'',
				'2026-10-02 * "B"',
				'  Expenses:Car -1234.50 CNY',
				'  Assets:Cash 1234.50 CNY',
			])
		).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.50 CNY',
			'  Assets:Cash  -12.50 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Car -1234.50 CNY',
			'  Assets:Cash   1234.50 CNY',
		]);
	});

	it('keeps one column across a block even around its metadata', () => {
		expect(
			align([
				'2026-01-01 * "A"',
				'  Assets:Cash -1.00 USD',
				'  note: 12.5 USD mentioned',
				'  Expenses:Food 1.00 USD',
			])
		).toEqual([
			'2026-01-01 * "A"',
			'  Assets:Cash  -1.00 USD',
			'  note: 12.5 USD mentioned',
			'  Expenses:Food 1.00 USD',
		]);
	});

	it('ends a block at a comment at column 0', () => {
		expect(
			align([
				'  Expenses:Food 12.5 CNY',
				'  Assets:Cash -12.5 CNY',
				'; a comment at column 0 ends the block',
				'  Expenses:Food:Rest 1.00 USD',
				'  Assets:Cash -1.00 USD',
			])
		).toEqual([
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash  -12.5 CNY',
			'; a comment at column 0 ends the block',
			'  Expenses:Food:Rest 1.00 USD',
			'  Assets:Cash       -1.00 USD',
		]);
	});

	it('starts a fresh block at back-to-back headers', () => {
		const lines = [
			'2026-01-01 * "A"',
			'  Expenses:Food 1.00 USD',
			'2026-01-02 * "B"',
			'  Expenses:Food:Rest -1234.00 USD',
		];
		// Each posting keeps its own block's column; the wide amount in the
		// second transaction never pads the first.
		expect(align(lines)).toEqual(lines);
	});

	it('starts a fresh block after a whitespace-only separator', () => {
		const lines = [
			'2026-01-01 * "A"',
			'  Expenses:Food 1.00 USD',
			'   ',
			'  Expenses:Food:Rest -1234.00 USD',
		];
		expect(align(lines)).toEqual(lines);
	});

	it('keeps one column around an indented comment inside the block', () => {
		expect(
			align([
				'2026-01-01 * "A"',
				'  Expenses:Food 1.00 USD',
				'  ; note inside the transaction',
				'  Expenses:Food:Rest -1234.00 USD',
			])
		).toEqual([
			'2026-01-01 * "A"',
			'  Expenses:Food          1.00 USD',
			'  ; note inside the transaction',
			'  Expenses:Food:Rest -1234.00 USD',
		]);
	});

	it('keeps one column across commodities and leaves cost annotations in place', () => {
		expect(
			align([
				'  Assets:Broker:Stock 10 AAPL {150.00 USD}',
				'  Assets:Broker:Cash -1500.00 USD',
			])
		).toEqual([
			'  Assets:Broker:Stock   10 AAPL {150.00 USD}',
			'  Assets:Broker:Cash -1500.00 USD',
		]);
	});

	it('aligns integer amounts at the units column beside decimals', () => {
		expect(
			align(['  Assets:Broker:Stock 100 AAPL', '  Assets:Broker:Cash -5.25 USD'])
		).toEqual(['  Assets:Broker:Stock 100 AAPL', '  Assets:Broker:Cash   -5.25 USD']);
	});

	it('measures negative signs and thousands separators', () => {
		expect(align(['  Assets:Cash -1,234.5 CNY', '  Expenses:A 12.5 CNY'])).toEqual([
			'  Assets:Cash -1,234.5 CNY',
			'  Expenses:A      12.5 CNY',
		]);
	});

	it('keeps a posting flag with its account while moving the amount', () => {
		expect(align(['  ! Assets:Cash 12.5 CNY', '  Expenses:A -12.5 CNY'])).toEqual([
			'  ! Assets:Cash 12.5 CNY',
			'  Expenses:A   -12.5 CNY',
		]);
	});

	it('aligns flagged postings like any other', () => {
		expect(align(['  P Assets:Broker -12345.67 USD', '  Expenses:Food 1.00 USD'])).toEqual([
			'  P Assets:Broker -12345.67 USD',
			'  Expenses:Food        1.00 USD',
		]);
	});

	it('keeps a flag between account and amount with the account', () => {
		expect(align(['  Expenses:Food * 12.50 USD', '  Assets:Cash -12.50 USD'])).toEqual([
			'  Expenses:Food * 12.50 USD',
			'  Assets:Cash    -12.50 USD',
		]);
	});

	it('measures non-ASCII account segments as two cells', () => {
		expect(align(['  Expenses:Food 12.5 CNY', '  Assets:现金 -1234.5 CNY'])).toEqual([
			'  Expenses:Food  12.5 CNY',
			'  Assets:现金 -1234.5 CNY',
		]);
	});

	it('leaves non-account tokens out of the column', () => {
		// Neither token is an account the syntax mode would highlight (a URL
		// starts lowercase, a wikilink starts with a bracket), so they must
		// not set the block's column and the real posting below stays put.
		const lines = [
			'  https://example.com:8080 12.5 USD',
			'  [[Assets:Cash]] 100 USD',
			'  Expenses:Food 1 USD',
		];
		expect(align(lines)).toEqual(lines);
	});

	it('replaces tab gaps with spaces', () => {
		expect(align(['  Assets:Cash\t12.5 CNY', '  Expenses:A:B:C -1234.5 CNY'])).toEqual([
			'  Assets:Cash       12.5 CNY',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
	});

	it('leaves non-posting lines alone', () => {
		const lines = [
			'2026-10-01 balance Assets:Cash 100.00 CNY',
			'  note: 12.5 USD mentioned',
			'  ; comment 12.5 USD',
			'include "other.bean"',
			'  TODO: fix 12 bugs',
			'  Assets:Cash 12.50 USD',
			'  Expenses:Food:Rest 1234.50 USD',
		];
		expect(align(lines)).toEqual([
			'2026-10-01 balance Assets:Cash 100.00 CNY',
			'  note: 12.5 USD mentioned',
			'  ; comment 12.5 USD',
			'include "other.bean"',
			'  TODO: fix 12 bugs',
			'  Assets:Cash          12.50 USD',
			'  Expenses:Food:Rest 1234.50 USD',
		]);
	});

	it('leaves half-typed amounts it cannot recognize', () => {
		const lines = [
			'  Assets:Cash 12.34.56 USD',
			'  Assets:Cash 12.5USD',
			'  Assets:Cash 12.5 usd',
			'  Assets:Cash',
			'  Expenses:A:B:C -1234.5 CNY',
		];
		expect(align(lines)).toEqual([
			'  Assets:Cash 12.34.56 USD',
			'  Assets:Cash 12.5USD',
			'  Assets:Cash 12.5 usd',
			'  Assets:Cash',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
	});

	it('aligns an amount still missing its commodity', () => {
		expect(align(['  Assets:Cash 12.5', '  Expenses:A:B:C -1234.5 CNY'])).toEqual([
			'  Assets:Cash       12.5',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
	});

	it('aligns amounts followed by annotation or comment syntax', () => {
		expect(
			align(['  Assets:Cash 12.5 ; note', '  Expenses:A:B:C -1234.5 CNY'])
		).toEqual(['  Assets:Cash       12.5 ; note', '  Expenses:A:B:C -1234.5 CNY']);
	});

	it('keeps CRLF endings', () => {
		expect(alignText('  Expenses:Food 12.5 USD\r\n  Assets:Cash -12.5 USD\r\n')).toBe(
			'  Expenses:Food 12.5 USD\r\n  Assets:Cash  -12.5 USD\r\n'
		);
	});

	it('is idempotent', () => {
		const once = alignText('  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD\n');
		expect(alignText(once)).toBe(once);
		expect(computeAlignment(once.split('\n'))).toEqual([]);
	});

	it('keeps today’s tight column when called without a target, and pads when given one', () => {
		const src = '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD\n';
		const tight = '  Expenses:Food 12.5 USD\n  Assets:Cash  -12.5 USD\n';
		expect(alignText(src)).toBe(tight);
		expect(alignText(src, 0)).toBe(tight);
		const lines = src.split('\n');
		alignLines(lines, 49);
		expect(lines[1].indexOf('.')).toBe(49);
		expect(alignText(lines.join('\n'), 49)).toBe(lines.join('\n'));
	});

	it('changes nothing in documents without postings', () => {
		const prose = 'just a note\n  indented prose 12.5 USD-ish\n';
		expect(alignText(prose)).toBe(prose);
		expect(alignText('')).toBe('');
	});
	it('does not rewrite a posting-shaped line inside a multi-line string', () => {
		const text = ['2020-02-01 * "x', '  Assets:Cash    10.5 USD', '"', '  Expenses:Food 1 USD', '  Assets:Cash -1 USD', ''].join(
			'\n'
		);
		expect(alignText(text)).toBe(
			['2020-02-01 * "x', '  Assets:Cash    10.5 USD', '"', '  Expenses:Food 1 USD', '  Assets:Cash  -1 USD', ''].join('\n')
		);
	});

	it('still aligns the posting after a quote in a comment', () => {
		expect(align(['  Assets:Cash 1 USD ; "', '  Expenses:Food -12.5 USD'])).toEqual([
			'  Assets:Cash     1 USD ; "',
			'  Expenses:Food -12.5 USD',
		]);
	});

	it('treats ideographic space and nbsp as the gap, not as indent', () => {
		// A single non-ASCII space is already the right width, but it is not
		// U+0020, so the gap is still rewritten. A length-only comparison would
		// leave it in place.
		expect(align(['  Assets:Cash\u00a012.5 USD'])).toEqual(['  Assets:Cash 12.5 USD']);
		expect(align(['  Assets:Cash\u300012.50 USD', '  Expenses:A:B:C -1234.5 CNY'])).toEqual([
			'  Assets:Cash       12.50 USD',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
		// The same space in front of the account is not an indent: the line is
		// not a posting, and it must not set the column.
		expect(align(['\u3000Assets:Cash 12.50 USD', '  Expenses:Food 1 USD'])).toEqual([
			'\u3000Assets:Cash 12.50 USD',
			'  Expenses:Food 1 USD',
		]);
	});

	it('keeps a flag separated by nbsp with the account', () => {
		expect(align(['  Assets:Cash\u00a0*\u00a012.50 USD', '  Expenses:A:B:C -1234.5 CNY'])).toEqual([
			'  Assets:Cash\u00a0*     12.50 USD',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
		// A leading flag needs a space or tab after it. nbsp does not count,
		// so the line is not a posting and must not widen the other column.
		expect(align(['  *\u00a0Assets:Cash 12 USD', '  Expenses:A:B:C -1234.5 CNY'])).toEqual([
			'  *\u00a0Assets:Cash 12 USD',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
	});

});

describe('alignFencedDocument', () => {
	it('aligns fence bodies and leaves posting-shaped prose, including no-fence notes', () => {
		const note = [
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash -12.5 USD',
			'```',
			'  Assets:Cash -12.5 USD',
			'',
		].join('\n');
		expect(alignFencedDocument(note)).toBe(
			[
				'  Expenses:Food 12.5 USD',
				'```beancount',
				'  Expenses:Food 12.5 USD',
				'  Assets:Cash  -12.5 USD',
				'```',
				'  Assets:Cash -12.5 USD',
				'',
			].join('\n')
		);
		const prose = '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD\n';
		expect(alignFencedDocument(prose)).toBe(prose);
	});

	it('keeps an indented fence’s indent and pads to a target column', () => {
		const note = ['  ```beancount', '    Expenses:Food 12.5 USD', '    Assets:Cash -12.5 USD', '  ```', ''].join('\n');
		const aligned = alignFencedDocument(note, 49);
		const lines = aligned.split('\n');
		expect(lines[0]).toBe('  ```beancount');
		expect(lines[1].startsWith('    ')).toBe(true);
		expect(lines[1].indexOf('.')).toBe(49);
		expect(lines[3]).toBe('  ```');
		expect(alignFencedDocument(aligned, 49)).toBe(aligned);
	});

	it('aligns an unclosed fence through EOF the way a closed body would', () => {
		expect(alignFencedDocument('intro\n```beancount\n  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD\n')).toBe(
			'intro\n```beancount\n  Expenses:Food 12.5 USD\n  Assets:Cash  -12.5 USD\n'
		);
	});
});

describe('alignmentRanges', () => {
	it('covers a ledger buffer, and only non-empty fence bodies in a note', () => {
		const ledger = ['2026-10-01 * "A"', '  Assets:Cash -1 USD'];
		expect(alignmentRanges(ledger, true)).toEqual([{ from: 0, to: 1 }]);
		expect(alignmentRanges([], true)).toEqual([]);
		const note = [
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'  Assets:Cash -12.5 USD',
			'```',
			'```beancount',
			'```',
			'  Assets:Cash -12.5 USD',
		];
		expect(alignmentRanges(note, false)).toEqual([{ from: 2, to: 2 }]);
		expect(intersectRange({ from: 0, to: 6 }, { from: 2, to: 2 })).toEqual({ from: 2, to: 2 });
		expect(intersectRange({ from: 0, to: 1 }, { from: 2, to: 2 })).toBeNull();
	});
});

describe('computeAlignment', () => {
	it('emits gap edits only where the gap is wrong', () => {
		// `Assets:Cash` already sits on the column; only `Expenses:A` moves.
		expect(computeAlignment(['  Assets:Cash -12.5 CNY', '  Expenses:A 12.5 CNY'])).toEqual([
			{ line: 1, from: 12, to: 13, text: '   ' },
		]);
	});

	it('computes the column from the postings inside the range only', () => {
		const lines = ['  Expenses:Food:Rest 1234.5 CNY', '  Assets:Cash -12.5 CNY'];
		// Whole block: the wide amount sets the column and the short one pads.
		expect(computeAlignment(lines)).toEqual([{ line: 1, from: 13, to: 14, text: '         ' }]);
		// Only the short one in range: it already sits on its own column.
		expect(computeAlignment(lines, { from: 1, to: 1 })).toEqual([]);
	});

	it('pads a block up to a target decimal column', () => {
		// prefix `  Assets:Cash` = 13, beforeDot 2, target 19 → gap of 4.
		expect(computeAlignment(['  Assets:Cash 12.5 USD'], undefined, 19)).toEqual([
			{ line: 0, from: 13, to: 14, text: '    ' },
		]);
	});

	it('keeps a column already past the target', () => {
		expect(computeAlignment(['  Expenses:Food:Rest 1234.5 CNY'], undefined, 10)).toEqual([]);
	});

	it('ignores a posting-shaped continuation of a string opened above the range', () => {
		const lines = [
			'2026-01-01 * "open',
			'  Assets:Cash    10.5 USD',
			'"',
			'  Expenses:Food 1 USD',
			'  Assets:Bank -100.00 USD',
		];
		// Line 1 is still inside the payee string. Only the postings after the close move.
		expect(computeAlignment(lines, { from: 1, to: 4 })).toEqual([{ line: 3, from: 15, to: 16, text: '  ' }]);
		expect(computeAlignment(lines, { from: 1, to: 1 })).toEqual([]);
	});

	it('does not share a column across a block boundary inside the range', () => {
		const lines = [
			'2026-01-01 * "A"',
			'  Expenses:Food 1.00 USD',
			'  Assets:Cash -1000.00 USD',
			'  Assets:Bank 2.00 USD',
			'',
			'2026-01-02 * "B"',
			'  Assets:Cash 2.00 USD',
		];
		// The range starts mid-block. The blank still splits it from the next
		// transaction, so only Assets:Bank pads up to -1000.
		expect(computeAlignment(lines, { from: 2, to: 6 })).toEqual([
			{ line: 3, from: 13, to: 14, text: '     ' },
		]);
	});

});

describe('isAmountDotInsert', () => {
	it('accepts the first decimal of a posting amount', () => {
		expect(isAmountDotInsert('  Assets:Cash 12 USD', 16)).toBe(true);
		expect(isAmountDotInsert('  Assets:Cash 12', 16)).toBe(true);
		expect(isAmountDotInsert('  Assets:Cash -12 USD', 17)).toBe(true);
		// Splitting the integer (`1|2` → `1.2`) is still the units decimal.
		expect(isAmountDotInsert('  Assets:Cash 12 USD', 15)).toBe(true);
	});

	it('rejects a second dot, the gap, annotations, and prose', () => {
		expect(isAmountDotInsert('  Assets:Cash 12.5 USD', 17)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12.5 USD', 18)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12 USD', 13)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12 USD', 14)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12 USD @ 7', 23)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12 USD {150', 24)).toBe(false);
		expect(isAmountDotInsert('2026-10-01 * "Store"', 16)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12 USD', -1)).toBe(false);
		expect(isAmountDotInsert('  Assets:Cash 12 USD', 99)).toBe(false);
	});
});

describe('blockRangeAt', () => {
	const lines = [
		'2026-01-01 * "A"',
		'  Assets:Cash -1.00 USD',
		'  Expenses:Food 1.00 USD',
		'',
		'2026-01-02 * "B"',
		'  Assets:Cash -2.00 USD',
		'; trailing comment',
	];

	it('spans the header and the indented lines under it', () => {
		expect(blockRangeAt(lines, 2)).toEqual({ from: 0, to: 2 });
		expect(blockRangeAt(lines, 0)).toEqual({ from: 0, to: 2 });
	});

	it('spans a later block wherever the cursor sits in it', () => {
		expect(blockRangeAt(lines, 4)).toEqual({ from: 4, to: 5 });
	});

	it('is a lone line on a blank or a comment at column 0', () => {
		expect(blockRangeAt(lines, 3)).toEqual({ from: 3, to: 3 });
		expect(blockRangeAt(lines, 6)).toEqual({ from: 6, to: 6 });
	});

	it('spans a loose run of postings', () => {
		expect(blockRangeAt(['  Assets:Cash 1.00 USD', '  Expenses:Food 2.00 USD'], 1)).toEqual({
			from: 0,
			to: 1,
		});
	});

	it('does not pull a loose run into the header that follows it', () => {
		const lines = ['  Assets:Cash 1.00 USD', '2026-01-01 * "A"', '  Expenses:Food 2.00 USD'];
		expect(blockRangeAt(lines, 0)).toEqual({ from: 0, to: 0 });
		expect(blockRangeAt(lines, 1)).toEqual({ from: 1, to: 2 });
		expect(blockRangeAt(lines, 2)).toEqual({ from: 1, to: 2 });
	});

	it('closes the block at a column-0 comment so later indents do not join it', () => {
		const lines = [
			'2026-01-01 * "A"',
			'  Assets:Cash 1 USD',
			'; comment',
			'  Expenses:Food 2.00 USD',
			'  Assets:Bank -100.00 USD',
		];
		expect(blockRangeAt(lines, 1)).toEqual({ from: 0, to: 1 });
		expect(blockRangeAt(lines, 2)).toEqual({ from: 2, to: 2 });
		expect(blockRangeAt(lines, 4)).toEqual({ from: 3, to: 4 });
	});

	it('closes a block on ideographic space, and treats a nbsp line as column-0 content', () => {
		const ideo = ['2026-01-01 * "A"', '  Expenses:Food 1.00 USD', '\u3000', '  Assets:Cash -1.00 USD'];
		expect(blockRangeAt(ideo, 1)).toEqual({ from: 0, to: 1 });
		expect(blockRangeAt(ideo, 2)).toEqual({ from: 2, to: 2 });
		expect(blockRangeAt(ideo, 3)).toEqual({ from: 3, to: 3 });
		// nbsp is not an indent, so the line opens its own block and the posting under it joins that.
		const nbsp = ['  Expenses:Food 12.5 CNY', '\u00a0not a posting', '  Assets:Cash -12.5 CNY'];
		expect(blockRangeAt(nbsp, 0)).toEqual({ from: 0, to: 0 });
		expect(blockRangeAt(nbsp, 2)).toEqual({ from: 1, to: 2 });
	});

	it('is a lone line when the index is outside the document', () => {
		expect(blockRangeAt(lines, -1)).toEqual({ from: -1, to: -1 });
		expect(blockRangeAt(lines, lines.length)).toEqual({ from: lines.length, to: lines.length });
		expect(blockRangeAt([], 0)).toEqual({ from: 0, to: 0 });
	});

});

describe('blockRangeInLedger', () => {
	it('matches blockRangeAt when every line is ledger text', () => {
		const lines = ['2026-10-01 * "A"', '  Assets:Cash 1.00 USD', '  Expenses:Food 2.00 USD'];
		expect(blockRangeInLedger(lines, 2, undefined)).toEqual(blockRangeAt(lines, 2));
		expect(blockRangeInLedger(lines, 2, () => true)).toEqual(blockRangeAt(lines, 2));
	});

	it('does not look past a fence-shaped gap in the ledger-line filter', () => {
		const lines = ['2026-10-14 open questions', '   ```beancount', '  Assets:Cash', '```'];
		expect(blockRangeInLedger(lines, 2, (i) => i === 2)).toEqual({ from: 2, to: 2 });
	});
});

describe('displayWidth', () => {
	it('counts wide characters as two cells and everything else as one', () => {
		expect(displayWidth('')).toBe(0);
		expect(displayWidth('abc')).toBe(3);
		expect(displayWidth('资产')).toBe(4);
		expect(displayWidth('Assets:现金')).toBe(11);
		expect(displayWidth('a产b')).toBe(4);
		expect(displayWidth('\u{1F600}')).toBe(2);
		expect(displayWidth('\u{1F697}')).toBe(2);
		expect(displayWidth('\u{1FA99}')).toBe(2);
	});

	it('counts combining marks and zero-width characters as nothing', () => {
		expect(displayWidth('e\u0301')).toBe(1);
		expect(displayWidth('a\u200bb')).toBe(2);
	});

	it('keeps the fast path from widening the cutoff, a narrow mark, or a non-wide surrogate', () => {
		// U+02FF is the last unit on the ASCII path; U+0300 is the first combining mark.
		expect(displayWidth('\u02FF')).toBe(1);
		expect(displayWidth('\u0300')).toBe(0);
		// Above the fast path, neither wide nor zero-width.
		expect(displayWidth('\u20AC')).toBe(1);
		// Fullwidth, a wide range the CJK samples do not hit.
		expect(displayWidth('\uFF21')).toBe(2);
		// Supplementary and outside the emoji wide ranges: one cell, not two UTF-16 units.
		expect(displayWidth('\u{1F100}')).toBe(1);
		expect(displayWidth('a\u{1F600}b')).toBe(4);
	});

});
