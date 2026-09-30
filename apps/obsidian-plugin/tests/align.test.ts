/**
 * Decimal-point alignment: which lines count as postings, how the shared
 * column is computed, and that the rewrite is idempotent and surgical.
 */
import { describe, expect, it } from 'vitest';
import { alignText, computeAlignment } from '../align';

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

	it('shares one document-wide column across transactions', () => {
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
			'  Expenses:Food   12.50 CNY',
			'  Assets:Cash    -12.50 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Car -1234.50 CNY',
			'  Assets:Cash   1234.50 CNY',
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
		expect(align(['  * Assets:Cash 12.5 CNY', '  Expenses:A -12.5 CNY'])).toEqual([
			'  * Assets:Cash 12.5 CNY',
			'  Expenses:A   -12.5 CNY',
		]);
	});

	it('aligns flagged postings like any other', () => {
		expect(align(['  * Assets:Broker -12345.67 USD', '  Expenses:Food 1.00 USD'])).toEqual([
			'  * Assets:Broker -12345.67 USD',
			'  Expenses:Food        1.00 USD',
		]);
	});

	it('leaves non-account tokens out of the column', () => {
		// None of these are accounts (bean-check rejects them too): they must
		// not set the shared column, so the real posting below stays put.
		const lines = [
			'  https://example.com:8080 12.5 USD',
			'  [[Assets:Cash]] 100 USD',
			'  Assets:现金 12.5 CNY',
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

	it('changes nothing in documents without postings', () => {
		const prose = 'just a note\n  indented prose 12.5 USD-ish\n';
		expect(alignText(prose)).toBe(prose);
		expect(alignText('')).toBe('');
	});
});

describe('computeAlignment', () => {
	it('emits gap edits only where the gap is wrong', () => {
		// `Assets:Cash` already sits on the column; only `Expenses:A` moves.
		expect(computeAlignment(['  Assets:Cash -12.5 CNY', '  Expenses:A 12.5 CNY'])).toEqual([
			{ line: 1, from: 12, to: 13, text: '   ' },
		]);
	});
});
