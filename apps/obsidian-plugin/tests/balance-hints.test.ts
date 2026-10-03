import { describe, expect, it } from 'vitest';
import { balanceHints } from '../balance-hints';

const hints = (...lines: string[]) => balanceHints(lines);

describe('balance assertion hints', () => {
	it('subtracts accumulated decimal units exactly without resetting at an assertion', () => {
		expect(hints(
			'2026-01-01 * "Opening"',
			'  Assets:Cash  0.10 USD',
			'  Equity:Opening  -0.10 USD',
			'2026-01-02 * "Deposit"',
			'  Assets:Cash  0.20 USD',
			'  Equity:Opening  -0.20 USD',
			'2026-01-03 balance Assets:Cash 0.35 USD',
			'2026-01-04 balance Assets:Cash 0.30 USD',
		)).toEqual([
			{ line: 6, label: 'Δ +0.05 USD' },
			{ line: 7, label: 'Δ 0.00 USD' },
		]);
	});

	it('evaluates assertions at the start of their date even in an unsorted ledger', () => {
		expect(hints(
			'2026-02-03 * "Later"',
			'  Assets:Cash  100 USD',
			'2026-02-02 * "Same day"',
			'  Assets:Cash  20 USD',
			'2026-02-02 balance Assets:Cash 12 USD',
			'2026-02-01 * "Earlier"',
			'  Assets:Cash  10 USD',
		)).toEqual([{ line: 4, label: 'Δ +2 USD' }]);
	});

	it('includes descendants but not accounts sharing only a string prefix', () => {
		expect(hints(
			'2026-01-01 txn "Opening"',
			'  Assets:Cash:Wallet  +1,200.00 USD',
			'  Assets:Cash:Bank  -200.25 USD',
			'  Assets:Cashback  500 USD',
			'  memo: "Assets:Cash 999 USD"',
			'2026-01-02 balance Assets:Cash 999.50 USD ; comment',
		)).toEqual([{ line: 5, label: 'Δ -0.25 USD' }]);
	});

	it('does not count metadata, comments, price directives or quoted account text', () => {
		expect(hints(
			'2026-01-01 open Assets:Cash USD',
			';  Assets:Cash 90 USD',
			'2026-01-01 price USD 7 CNY',
			'2026-01-01 note Assets:Cash "Assets:Cash 40 USD"',
			'2026-01-01 * "Assets:Cash 30 USD"',
			'  Assets:Cash  5.00 USD',
			'  receipt: "Assets:Cash 20 USD"',
			'2026-01-02 balance Assets:Cash 7.00 USD',
		)).toEqual([{ line: 7, label: 'Δ +2.00 USD' }]);
	});

	it.each(['include "other.bean"', 'plugin "beancount.plugins.auto_accounts"'])(
		'omits source-dependent inventory: %s', (directive) => {
			expect(hints(
				'2026-01-01 * "Deposit"',
				'  Assets:Cash 10 USD',
				'2026-01-02 balance Assets:Cash 12 USD',
				directive,
			)).toEqual([]);
		},
	);

	it.each(['', '10 + 5 USD', '10 USD {2 EUR}', '10 USD @ 2 EUR', '9007199254740992 USD'])(
		'never guesses an unknown posting amount: %s', (amount) => {
			expect(hints(
				'2026-01-01 * "Unknown"',
				`  Assets:Cash:Wallet ${amount}`,
				'2026-01-02 balance Assets:Cash 15 USD',
			)).toEqual([]);
		},
	);

	it('suppresses multi-commodity subtrees and pad-dependent balances', () => {
		expect(hints(
			'2026-01-01 * "Deposit"',
			'  Assets:Cash:Wallet 10 USD',
			'  Assets:Cash:Bank 20 EUR',
			'2026-01-02 balance Assets:Cash 10 USD',
			'2026-01-01 pad Assets:Other Equity:Opening',
			'2026-01-02 balance Assets:Other 50 USD',
		)).toEqual([]);
	});

	it('does not display a difference while the assertion amount is incomplete', () => {
		expect(hints(
			'2026-01-01 * "Deposit"',
			'  Assets:Cash 10 USD',
			'2026-01-02 balance Assets:Cash -',
		)).toEqual([]);
	});

	it('keeps unaffected accounts available when another posting is inferred', () => {
		expect(hints(
			'2026-01-01 * "Deposit"',
			'  Assets:Cash 10.00 USD',
			'  Equity:Opening',
			'2026-01-02 balance Assets:Cash 12.00 USD',
			'2026-01-02 balance Equity:Opening -10.00 USD',
		)).toEqual([{ line: 3, label: 'Δ +2.00 USD' }]);
	});

	it('suppresses sums that overflow exact scaled integer arithmetic', () => {
		expect(hints(
			'2026-01-01 * "Large"',
			'  Assets:Cash 9007199254740991 USD',
			'2026-01-02 * "One more"',
			'  Assets:Cash 1 USD',
			'2026-01-03 balance Assets:Cash 0 USD',
		)).toEqual([]);
	});

	it('counts custom uppercase transaction and posting flags', () => {
		expect(hints(
			'2026-01-01 X "Custom flag"',
			'  Y Assets:Cash 10 USD',
			'2026-01-02 balance Assets:Cash 12 ~ 0.01 USD',
		)).toEqual([{ line: 2, label: 'Δ +2 USD' }]);
	});
});
