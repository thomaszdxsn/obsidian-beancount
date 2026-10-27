import { describe, expect, it } from 'vitest';
import { BalanceLineCache, balanceHints } from '../balance-hints';
import { stripComment } from '../scan';

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

	it('does not let future unknown postings or unrelated pads hide earlier known inventory', () => {
		expect(hints(
			'2026-01-01 * "Deposit"',
			'  Assets:Cash 10 USD',
			'2026-01-03 * "Unknown later"',
			'  Assets:Cash',
			'2026-01-04 pad Assets:Cash Equity:Opening',
			'2026-01-01 pad Assets:Other Equity:Other',
			'2026-01-02 balance Assets:Cash 12 USD',
			'2026-01-04 balance Assets:Cash 12 USD',
		)).toEqual([{ line: 6, label: 'Δ +2 USD' }]);
	});

	it('retains fractional precision from postings when the assertion is integral', () => {
		expect(hints(
			'2026-01-01 * "Fraction"',
			'  Assets:Cash 0.001 USD',
			'2026-01-02 balance Assets:Cash 0 USD',
			'2026-01-02 balance Assets:Cash 0.001 USD',
		)).toEqual([
			{ line: 2, label: 'Δ -0.001 USD' },
			{ line: 3, label: 'Δ 0.000 USD' },
		]);
	});

	it('does not infer conversion when the asserted currency differs', () => {
		expect(hints(
			'2026-01-01 * "Deposit"',
			'  Assets:Cash 10 EUR',
			'2026-01-02 balance Assets:Cash 12 USD',
		)).toEqual([]);
	});

	it.each([
		['9007199254740991', '0.1'],
		['-9007199254740991', '0.1'],
		['-9007199254740991', '9007199254740991'],
	])('omits unsafe scale alignment or subtraction: %s against %s', (posting, assertion) => {
		expect(hints(
			'2026-01-01 * "Boundary"',
			`  Assets:Cash ${posting} USD`,
			`2026-01-02 balance Assets:Cash ${assertion} USD`,
		)).toEqual([]);
	});

	it.each([
		'Assets:Cash',
		'Assets:Cash 1',
		'Assets:Cash 1 EUR extra',
		'Assets:Cash 1 ~ USD',
		'Assets:Cash 1 ~ 0.1 USD ~ 0.1',
		'Assets:Cash 1,23 USD',
		'Assets:Cash 9007199254740992 USD',
	])('never publishes an incomplete or malformed assertion: %s', (assertion) => {
		expect(hints(`2026-01-02 balance ${assertion}`)).toEqual([]);
	});

	it.each([
		'2026-01-01 unsupported Assets:Cash 12 USD',
		'2026-01-01 pad Assets:Cash',
	])('does not treat unknown inventory effects as zero: %s', (directive) => {
		expect(hints(directive, '2026-01-02 balance Assets:Cash 12 USD')).toEqual([]);
	});

	it('ignores directive words inside metadata and quoted comments', () => {
		expect(hints(
			'* Cash',
			'; include "other.bean"',
			'2026/01/01 * "Deposit; \\"quoted\\""',
			'  Assets:现金 10 USD',
			'  include: "other.bean"',
			'  plugin: "plugin"',
			'2026/01/02 balance Assets:现金 12 USD\r',
		)).toEqual([{ line: 6, label: 'Δ +2 USD' }]);
	});

	it('accumulates the asserted account and its children, not an unrelated tree', () => {
		expect(hints(
			'2026-01-01 * "Children"',
			'  Assets:Cash  10 USD',
			'  Assets:Cash:Wallet  3 USD',
			'  Expenses:Food  1 USD',
			'2026-01-02 balance Assets:Cash 0 USD',
		)).toEqual([{ line: 4, label: 'Δ -13 USD' }]);
	});

	it('ignores a pad on an unasserted ancestor but a pad in the asserted subtree taints', () => {
		expect(hints(
			'2026-01-01 * "Mixed"',
			'  Assets:Cash:Wallet  4 USD',
			'  Assets:Bank  9 USD',
			'2026-01-01 pad Assets:Cash Equity:Opening',
			'2026-01-02 balance Assets:Cash:Wallet 10 USD',
			'2026-01-03 pad Assets:Cash:Wallet:Pocket Equity:Opening',
			'2026-01-04 balance Assets:Cash:Wallet 10 USD',
		)).toEqual([{ line: 4, label: 'Δ +6 USD' }]);
	});

	it('counts a repeated posting line only where a transaction is open', () => {
		const posting = '  Assets:Cash  5 USD';
		expect(hints(
			posting,
			'2026-01-01 * "In"',
			posting,
			'2026-01-02 open Assets:Bank',
			posting,
			'2026-01-03 balance Assets:Cash 0 USD',
		)).toEqual([{ line: 5, label: 'Δ -5 USD' }]);
	});

	it('refuses the whole buffer for an unknown dated directive after a known assertion', () => {
		expect(hints(
			'2026-01-01 * "Ok"',
			'  Assets:Cash  10 USD',
			'2026-01-02 balance Assets:Cash 10 USD',
			'2026-01-03 frobnicate Assets:Cash',
		)).toEqual([]);
	});

	it('refuses an indented include or plugin, which is not a posting', () => {
		expect(hints(
			'2026-01-01 * "Ok"',
			'  Assets:Cash  10 USD',
			'  plugin "beancount.plugins.auto"',
			'2026-01-02 balance Assets:Cash 10 USD',
		)).toEqual([]);
		expect(hints(
			'2026-01-01 * "Ok"',
			'  include "other.bean"',
			'2026-01-02 balance Assets:Cash 10 USD',
		)).toEqual([]);
	});

	it('strips a trailing CR before classifying a posting or assertion', () => {
		expect(hints(
			'2026-01-01 * "Deposit"\r',
			'  Assets:Cash  10 USD\r',
			'2026-01-02 balance Assets:Cash 12 USD\r',
		)).toEqual([{ line: 2, label: 'Δ +2 USD' }]);
	});

	it('accepts a quoted commodity and drops a lowercase one without refusing the file', () => {
		expect(hints(
			'2026-01-01 * "D"',
			'  Assets:Cash  10 USD',
			'  Assets:Bank  1 USD',
			'2026-01-02 balance Assets:Cash 12 "USD"',
			'2026-01-02 balance Assets:Bank 1 usd',
		)).toEqual([{ line: 3, label: 'Δ +2 "USD"' }]);
	});

	it('does not let an escaped quote end a string before a semicolon', () => {
		expect(stripComment('  Assets:Cash  10 USD "a \\" ; b" ; 99 EUR')).toBe(
			'  Assets:Cash  10 USD "a \\" ; b" ',
		);
	});
});

describe('a reused line cache', () => {
	const ledger = [
		'2026-01-01 * "D"',
		'  Assets:Cash  10 USD',
		'  Assets:Cash:Wallet  2 USD',
		'2026-01-02 balance Assets:Cash 15 USD',
	];

	it('gives each document the hints of a fresh cache, whatever it saw before', () => {
		const cache = new BalanceLineCache();
		// The same posting text outside a transaction, then a refused buffer.
		balanceHints(['  Assets:Cash  10 USD', '2026-01-02 balance Assets:Cash 15 USD'], cache);
		balanceHints(['plugin "auto"', ...ledger], cache);
		expect(balanceHints(ledger, cache)).toEqual([{ line: 3, label: 'Δ +3 USD' }]);
		// An edited line is reclassified, not served from the previous call.
		const edited = [...ledger.slice(0, 2), '  Assets:Cash:Wallet  4 USD', ledger[3]];
		expect(balanceHints(edited, cache)).toEqual(balanceHints(edited));
		expect(balanceHints(edited, cache)).toEqual([{ line: 3, label: 'Δ +1 USD' }]);
	});

	it('stays bounded by the current document while documents keep changing', () => {
		const cache = new BalanceLineCache();
		// Every call is a different 3-line document, as typing produces.
		for (let n = 0; n < 200; n += 1) {
			balanceHints([`2026-01-01 * "T${n}"`, `  Assets:Cash  ${n} USD`, '2026-01-02 balance Assets:Cash 1 USD'], cache);
		}
		expect(cache.lines.size).toBeLessThan(200);
	});

	it('stays bounded while a refused buffer is edited', () => {
		const cache = new BalanceLineCache();
		for (let n = 0; n < 200; n += 1) {
			balanceHints([`  Assets:Cash  ${n} USD`, 'include "other.beancount"'], cache);
		}
		expect(cache.lines.size).toBeLessThan(200);
	});
});
