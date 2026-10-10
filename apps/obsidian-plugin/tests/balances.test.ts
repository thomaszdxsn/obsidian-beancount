import { describe, expect, it } from 'vitest';
import { accountBalances, loadAccountBalances } from '../balances';
import type { BalanceReport } from '../balances';
import { Decimal } from '../decimal';

function report(files: Record<string, string>, entry = 'main.bean', root = '/vault'): BalanceReport {
	return accountBalances(entry, new Map(Object.entries(files)), root, Object.keys(files));
}

function lines(result: BalanceReport): string[] {
	return result.rows.map((row) => `${row.account} ${row.amounts.map((amount) => `${amount.text} ${amount.currency}`).join(', ')}`);
}

describe('Decimal', () => {
	it('round-trips a float through its shortest string before arithmetic', () => {
		const sum = Decimal.fromNumber(0.1)?.add(Decimal.fromNumber(0.2) as Decimal);
		expect(sum?.format(0)).toBe('0.3');
		expect(Decimal.fromNumber(Number.NaN)).toBeNull();
		expect(Decimal.fromNumber(Number.POSITIVE_INFINITY)).toBeNull();
		expect(Decimal.fromNumber(-0)?.format(2)).toBe('0.00');
		expect(Decimal.fromString('1e-7')?.format(0)).toBe('0.0000001');
		expect(Decimal.fromString('nope')).toBeNull();
	});
});

describe('accountBalances', () => {
	it('fills one omitted posting from the weight residual, including several currencies', () => {
		const result = report({
			'main.bean': [
				'2020-01-01 * "mix"',
				'  Assets:Bank  10 USD',
				'  Assets:Bank  5.5 EUR',
				'  Expenses:Other',
			].join('\n'),
		});
		expect(lines(result)).toEqual(['Assets:Bank 5.5 EUR, 10 USD', 'Expenses:Other -5.5 EUR, -10 USD']);
		expect(result.errors).toEqual([]);
	});

	it('sums 0.1 and 0.2 as 0.3, and uses cost or price as the weight', () => {
		const result = report({
			'main.bean': [
				'2020-01-02 * "cents"',
				'  Assets:Cash  0.1 USD',
				'  Assets:Cash  0.2 USD',
				'  Expenses:Food',
				'2020-01-03 * "per unit"',
				'  Assets:Stocks  2 HOOL {10 USD}',
				'  Assets:Cash',
				'2020-01-04 * "price"',
				'  Assets:Stocks  1 AAPL @ 3 USD',
				'  Assets:Cash',
				'2020-01-05 * "total cost"',
				'  Assets:Stocks  -2 HOOL {{20 USD}}',
				'  Assets:Cash',
				'2020-01-06 * "total price"',
				'  Assets:Stocks  3 MSFT @@ 9 USD',
				'  Assets:Cash',
				'2020-01-07 * "cost wins"',
				'  Assets:Stocks  2 HOOL {10 USD} @ 12 USD',
				'  Assets:Cash',
				'2020-01-08 * "sale at total price"',
				'  Assets:Stocks  -2 HOOL @@ 20 USD',
				'  Assets:Cash',
				'2020-01-09 * "both cost numbers"',
				'  Assets:Stocks  2 HOOL {10 # 20 USD}',
				'  Assets:Cash',
			].join('\n'),
		});
		expect(result.errors).toEqual([]);
		expect(lines(result)).toEqual([
			'Assets:Cash -31.7 USD',
			'Assets:Stocks 1 AAPL, 2 HOOL, 3 MSFT',
			'Expenses:Food -0.3 USD',
		]);
	});

	it('fills a currency-only posting and rejects guessing', () => {
		expect(
			lines(
				report({
					'main.bean': ['2020-01-01 * "cur"', '  Assets:Cash  5 USD', '  Expenses:Food  USD'].join('\n'),
				}),
			),
		).toEqual(['Assets:Cash 5 USD', 'Expenses:Food -5 USD']);

		const other = report({
			'main.bean': ['2020-01-01 * "mix"', '  Assets:Cash  5 USD', '  Assets:Bank  1 EUR', '  Expenses:Food  USD'].join('\n'),
		});
		expect(other.rows).toEqual([]);
		expect(other.errors[0]?.message).toBe('Residual has currencies other than the posting currency');

		const numberOnly = report({
			'main.bean': ['2020-01-01 * "num"', '  Assets:Cash  5 USD', '  Expenses:Food  5'].join('\n'),
		});
		expect(numberOnly.errors[0]?.message).toBe('Cannot interpolate a posting that specifies only a number');

		const two = report({
			'main.bean': ['2020-01-01 * "two"', '  Assets:Cash', '  Expenses:Food'].join('\n'),
		});
		expect(two.errors).toEqual([
			{ file: 'main.bean', line: 1, message: 'Too many postings with missing amounts' },
		]);
		expect(two.rows).toEqual([]);

		const atCost = report({
			'main.bean': ['2020-01-01 * "cost"', '  Assets:Stocks  HOOL {10 USD}', '  Assets:Cash  -20 USD'].join('\n'),
		});
		expect(atCost.errors[0]?.message).toBe('Cannot interpolate a posting that has a cost or a price');

		const emptyCost = report({
			'main.bean': ['2020-01-01 * "empty"', '  Assets:Stocks  2 HOOL {}', '  Assets:Cash'].join('\n'),
		});
		expect(emptyCost.errors[0]?.message).toBe('Cannot interpolate a cost or a price on this transaction');
		expect(emptyCost.rows).toEqual([]);
	});

	it('keeps units when a cost does not need to be interpolated', () => {
		expect(
			lines(
				report({
					'main.bean': ['2020-01-01 * "held"', '  Assets:Stocks  2 HOOL {}', '  Assets:Cash  -20 USD'].join('\n'),
				}),
			),
		).toEqual(['Assets:Cash -20 USD', 'Assets:Stocks 2 HOOL']);
	});

	it('inserts a pad up to the first balance of each currency, including child accounts', () => {
		const result = report({
			'main.bean': [
				'2020-01-02 * "wallet"',
				'  Assets:Cash:Wallet  5 USD',
				'  Expenses:Food',
				'2020-01-03 pad Assets:Cash Equity:Opening',
				'2020-01-04 balance Assets:Cash 20 USD',
				'2020-01-05 balance Assets:Cash 80 USD',
				'2020-01-06 balance Assets:Cash 3 EUR',
			].join('\n'),
		});
		expect(result.errors).toEqual([]);
		// 5 in the wallet counts toward Cash. The USD balance inserts 15 and is consumed;
		// the later USD balance does not. EUR is a new currency, so it still pads.
		expect(lines(result)).toEqual([
			'Assets:Cash 3 EUR, 15 USD',
			'Assets:Cash:Wallet 5 USD',
			'Equity:Opening -3 EUR, -15 USD',
			'Expenses:Food -5 USD',
		]);
	});

	it('does not pad a same-day balance, and a zero difference still consumes the pad', () => {
		expect(
			lines(
				report({
					'main.bean': ['2020-01-05 pad Assets:Cash Equity:Opening', '2020-01-05 balance Assets:Cash 10 USD'].join('\n'),
				}),
			),
		).toEqual([]);

		const consumed = report({
			'main.bean': [
				'2020-01-01 * "have"',
				'  Assets:Cash  10 USD',
				'  Expenses:Food',
				'2020-01-02 pad Assets:Cash Equity:Opening',
				'2020-01-03 balance Assets:Cash 10 USD',
				'2020-01-04 balance Assets:Cash 40 USD',
			].join('\n'),
		});
		expect(lines(consumed)).toEqual(['Assets:Cash 10 USD', 'Expenses:Food -10 USD']);
	});

	it('excludes transactions on the balance date and orders a later file by its own line number', () => {
		const sameDay = report({
			'main.bean': [
				'2020-01-08 * "before"',
				'  Assets:Cash  3 USD',
				'  Expenses:Food',
				'2020-01-09 pad Assets:Cash Equity:Opening',
				'2020-01-10 balance Assets:Cash 0 USD',
				'2020-01-10 * "on the day"',
				'  Assets:Cash  7 USD',
				'  Expenses:Food',
			].join('\n'),
		});
		expect(lines(sameDay)).toEqual(['Assets:Cash 7 USD', 'Equity:Opening 3 USD', 'Expenses:Food -10 USD']);

		const across = report({
			'main.bean': [
				'2020-01-05 pad Assets:Cash Equity:Opening',
				'include "child.bean"',
				'',
				'',
				'',
				'2020-01-10 balance Assets:Cash 100 USD',
			].join('\n'),
			'child.bean': [
				'2020-01-09 * "in"',
				'  Assets:Cash  10 USD',
				'  Expenses:Food',
				'2020-01-10 balance Assets:Cash 40 USD',
			].join('\n'),
		});
		// child.bean:4 sorts before main.bean:6, so 40 consumes the pad and 100 does not.
		expect(lines(across)).toEqual(['Assets:Cash 40 USD', 'Equity:Opening -30 USD', 'Expenses:Food -10 USD']);
	});

	it('hides accounts that net to zero and keeps CJK account names', () => {
		const result = report({
			'main.bean': [
				'2020-01-01 * "cancel"',
				'  Assets:Bank  4 GBP',
				'  Assets:Bank  -4 GBP',
				'2020-01-02 * "午餐"',
				'  Assets:现金  3 CNY',
				'  Expenses:餐饮',
			].join('\n'),
		});
		expect(lines(result)).toEqual(['Assets:现金 3 CNY', 'Expenses:餐饮 -3 CNY']);
	});

	it('reports parse and include failures instead of partial numbers', () => {
		const parsed = report({
			'main.bean': ['2020-01-01 * "ok"', '  Assets:Cash  1 USD', '  Expenses:Food', 'include "bad.bean"'].join('\n'),
			'bad.bean': '2020-01-01 open\n',
		});
		expect(parsed.rows).toEqual([]);
		expect(parsed.errors[0]?.file).toBe('bad.bean');
		expect(parsed.errors[0]?.line).toBe(1);

		const missing = report({ 'main.bean': 'include "nope.bean"\n' });
		expect(missing.rows).toEqual([]);
		expect(missing.errors).toEqual([{ file: 'main.bean', line: 1, message: 'Included file not found: nope.bean' }]);

		const outside = report({ 'main.bean': 'include "../out.bean"\n' });
		expect(outside.errors[0]?.message).toBe('Include is outside the vault: ../out.bean');

		const unmatched = report({ 'main.bean': 'include "none/*.bean"\n' });
		expect(unmatched.errors[0]?.message).toBe('No files match include "none/*.bean"');

		expect(report({}, 'missing.bean').errors[0]?.message).toBe('Entry ledger not found: missing.bean');
	});

	it('follows a glob in sorted order and does not re-enter a cycle', () => {
		const globbed = report({
			'main.bean': 'include "books/*.bean"\n',
			'books/b.bean': '2020-01-01 * "b"\n  Assets:Cash  2 USD\n  Expenses:Food\n',
			'books/a.bean': '2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n',
		});
		expect(lines(globbed)).toEqual(['Assets:Cash 3 USD', 'Expenses:Food -3 USD']);
		expect(globbed.files).toEqual(['main.bean', 'books/a.bean', 'books/b.bean']);

		const cycled = report({
			'a.bean': 'include "b.bean"\n2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n',
			'b.bean': 'include "a.bean"\n2020-01-02 * "b"\n  Assets:Cash  2 USD\n  Expenses:Food\n',
		}, 'a.bean');
		expect(lines(cycled)).toEqual(['Assets:Cash 3 USD', 'Expenses:Food -3 USD']);
	});

	it('leaves a pad unused when no later balance consumes it', () => {
		expect(
			lines(
				report({
					'main.bean': ['2020-01-01 * "have"', '  Assets:Cash  10 USD', '  Income:Job', '2020-01-02 pad Assets:Cash Equity:Opening'].join('\n'),
				}),
			),
		).toEqual(['Assets:Cash 10 USD', 'Income:Job -10 USD']);
	});

	it('pads each currency once, then a new pad can fill a later balance', () => {
		const once = report({
			'main.bean': [
				'2020-01-01 * "have"',
				'  Assets:Cash  10 USD',
				'  Assets:Cash  2 EUR',
				'  Income:Job',
				'2020-01-02 pad Assets:Cash Equity:Opening',
				'2020-01-03 balance Assets:Cash 40 USD',
				'2020-01-04 balance Assets:Cash 5 EUR',
				'2020-01-05 balance Assets:Cash 99 USD',
				'2020-01-06 balance Assets:Cash 9 EUR',
			].join('\n'),
		});
		expect(lines(once)).toEqual(['Assets:Cash 5 EUR, 40 USD', 'Equity:Opening -3 EUR, -30 USD', 'Income:Job -2 EUR, -10 USD']);

		const again = report({
			'main.bean': [
				'2020-01-01 * "have"',
				'  Assets:Cash  10 USD',
				'  Income:Job',
				'2020-01-02 pad Assets:Cash Equity:Opening',
				'2020-01-03 balance Assets:Cash 10 USD',
				'2020-01-04 pad Assets:Cash Equity:Later',
				'2020-01-05 balance Assets:Cash 25 USD',
			].join('\n'),
		});
		expect(lines(again)).toEqual(['Assets:Cash 25 USD', 'Equity:Later -15 USD', 'Income:Job -10 USD']);
	});

	it('counts child postings toward a parent balance and not a same-prefix sibling', () => {
		const result = report({
			'main.bean': [
				'2020-01-02 * "wallet"',
				'  Assets:Cash:Wallet  5 USD',
				'  Expenses:Food',
				'2020-01-03 * "till"',
				'  Assets:Cashier  4 USD',
				'  Expenses:Misc',
				'2020-01-04 pad Assets:Cash Equity:Opening',
				'2020-01-05 balance Assets:Cash 20 USD',
			].join('\n'),
		});
		expect(result.errors).toEqual([]);
		expect(lines(result)).toEqual([
			'Assets:Cash 15 USD',
			'Assets:Cash:Wallet 5 USD',
			'Assets:Cashier 4 USD',
			'Equity:Opening -15 USD',
			'Expenses:Food -5 USD',
			'Expenses:Misc -4 USD',
		]);
	});

	it('sorts a same-day balance before the transaction even when the file writes them backwards', () => {
		const result = report({
			'main.bean': [
				'2020-01-10 close Assets:Cash',
				'2020-01-10 * "txn"',
				'  Assets:Cash  7 USD',
				'  Expenses:Food',
				'2020-01-10 balance Assets:Cash 0 USD',
				'2020-01-10 open Assets:Cash',
				'2020-01-09 pad Assets:Cash Equity:Opening',
			].join('\n'),
		});
		// open < balance < txn < close, so the 7 does not count toward the balance and the pad inserts nothing.
		expect(lines(result)).toEqual(['Assets:Cash 7 USD', 'Expenses:Food -7 USD']);
	});

	it('skips a zero posting, a zero-weight total, and a currency-only fill of a cancelled residual', () => {
		expect(
			lines(
				report({
					'main.bean': ['2020-01-01 * "zero"', '  Assets:Cash  0 USD', '  Assets:Cash  5 USD', '  Expenses:Food'].join('\n'),
				}),
			),
		).toEqual(['Assets:Cash 5 USD', 'Expenses:Food -5 USD']);

		expect(
			lines(
				report({
					'main.bean': ['2020-01-01 * "total"', '  Assets:Stocks  0 HOOL @@ 20 USD', '  Assets:Cash  -4 USD', '  Expenses:Food'].join('\n'),
				}),
			),
		).toEqual(['Assets:Cash -4 USD', 'Expenses:Food 4 USD']);

		expect(
			lines(
				report({
					'main.bean': ['2020-01-01 * "cancel"', '  Assets:Cash  5 USD', '  Assets:Cash  -5 USD', '  Expenses:Food  USD'].join('\n'),
				}),
			),
		).toEqual([]);
	});

	it('rejects a missing posting that carries a price, and a cost or price that itself is incomplete', () => {
		const priced = report({
			'main.bean': ['2020-01-01 * "price"', '  Assets:Stocks  HOOL @ 3 USD', '  Assets:Cash  -20 USD'].join('\n'),
		});
		expect(priced.rows).toEqual([]);
		expect(priced.errors[0]?.message).toBe('Cannot interpolate a posting that has a cost or a price');

		for (const body of ['  Assets:Stocks  2 HOOL {USD}', '  Assets:Stocks  2 HOOL @ USD', '  Assets:Stocks  2 HOOL @@', '  Assets:Stocks  2 HOOL {{USD}}']) {
			const result = report({
				'main.bean': ['2020-01-01 * "fill"', body, '  Assets:Cash'].join('\n'),
			});
			expect(result.rows).toEqual([]);
			expect(result.errors).toEqual([
				{ file: 'main.bean', line: 1, message: 'Cannot interpolate a cost or a price on this transaction' },
			]);
		}
	});

	it('reports a non-finite amount and an included file error at that file path and line', () => {
		const divided = report({
			'main.bean': ['2020-01-01 * "div"', '  Assets:Cash  1/0 USD', '  Expenses:Food'].join('\n'),
		});
		expect(divided.rows).toEqual([]);
		expect(divided.errors[0]?.file).toBe('main.bean');
		expect(divided.errors[0]?.line).toBe(2);
		expect(divided.errors[0]?.message).toMatch(/invalid number/);

		const included = report({
			'main.bean': ['include "bad.bean"', '2020-01-01 * "ok"', '  Assets:Cash  1 USD', '  Expenses:Food'].join('\n'),
			'bad.bean': ['2020-01-01 * "ok"', '  Assets:Cash  1 USD', '  Expenses:Food', '2020-01-02 open'].join('\n'),
		});
		expect(included.rows).toEqual([]);
		expect(included.errors[0]?.file).toBe('bad.bean');
		expect(included.errors[0]?.line).toBe(4);
		expect(included.errors.some((issue) => issue.file === 'main.bean')).toBe(false);
	});

	it('pads display to the widest fraction of that currency and keeps a tiny amount exact', () => {
		expect(
			lines(
				report({
					'main.bean': [
						'2020-01-01 * "wide"',
						'  Assets:Cash  2 USD',
						'  Expenses:A',
						'2020-01-02 * "tenth"',
						'  Assets:Bank  0.5 USD',
						'  Expenses:B',
					].join('\n'),
				}),
			),
		).toEqual(['Assets:Bank 0.5 USD', 'Assets:Cash 2.0 USD', 'Expenses:A -2.0 USD', 'Expenses:B -0.5 USD']);

		expect(
			lines(
				report({
					'main.bean': ['2020-01-03 * "tiny"', '  Assets:Petty  0.0000001 USD', '  Expenses:C'].join('\n'),
				}),
			),
		).toEqual(['Assets:Petty 0.0000001 USD', 'Expenses:C -0.0000001 USD']);
	});

	it('reports an include that resolved but was not loaded', () => {
		const queued = accountBalances(
			'main.bean',
			new Map([['main.bean', 'include "child.bean"\n']]),
			'/vault',
			['main.bean', 'child.bean'],
		);
		expect(queued.rows).toEqual([]);
		expect(queued.errors).toEqual([{ file: 'child.bean', line: 1, message: 'Included file not found: child.bean' }]);
	});
});

describe('loadAccountBalances', () => {
	it('reads the include chain and surfaces a failed read', async () => {
		const files = new Map<string, string>([
			['main.bean', 'include "child.bean"\n'],
			['child.bean', '2020-01-01 * "c"\n  Assets:Cash  4 USD\n  Expenses:Food\n'],
		]);
		const loaded = await loadAccountBalances('main.bean', {
			vaultRoot: '/vault',
			vaultFiles: ['main.bean', 'child.bean'],
			read: async (path) => files.get(path) ?? null,
		});
		expect(lines(loaded)).toEqual(['Assets:Cash 4 USD', 'Expenses:Food -4 USD']);

		const missing = await loadAccountBalances('gone.bean', {
			vaultRoot: '/vault',
			vaultFiles: [],
			read: async () => {
				throw new Error('unreadable');
			},
		});
		expect(missing.rows).toEqual([]);
		expect(missing.errors[0]?.message).toBe('Entry ledger not found: gone.bean');
	});

	it('follows a glob, does not re-read a cycle, and reports an included file the vault cannot read', async () => {
		const files = new Map<string, string>([
			['main.bean', 'include "books/*.bean"\n'],
			['books/a.bean', 'include "../main.bean"\n2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n'],
			['books/b.bean', '2020-01-01 * "b"\n  Assets:Cash  2 USD\n  Expenses:Food\n'],
		]);
		const globbed = await loadAccountBalances('main.bean', {
			vaultRoot: '/vault',
			vaultFiles: [...files.keys()],
			read: async (path) => files.get(path) ?? null,
		});
		expect(lines(globbed)).toEqual(['Assets:Cash 3 USD', 'Expenses:Food -3 USD']);

		const unread = await loadAccountBalances('main.bean', {
			vaultRoot: '/vault',
			vaultFiles: ['main.bean', 'child.bean'],
			read: async (path) => (path === 'main.bean' ? 'include "child.bean"\n' : null),
		});
		expect(unread.rows).toEqual([]);
		expect(unread.errors).toEqual([{ file: 'child.bean', line: 1, message: 'Included file not found: child.bean' }]);

		const skipped = await loadAccountBalances('main.bean', {
			vaultRoot: '/vault',
			vaultFiles: ['main.bean'],
			read: async () => 'include "../out.bean"\ninclude "none/*.bean"\n',
		});
		expect(skipped.rows).toEqual([]);
		expect(skipped.errors.map((issue) => issue.message)).toEqual([
			'Include is outside the vault: ../out.bean',
			'No files match include "none/*.bean"',
		]);
	});
});
