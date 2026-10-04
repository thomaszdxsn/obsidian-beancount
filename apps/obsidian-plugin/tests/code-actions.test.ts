/**
 * Quick fixes: the three edits a diagnostic marker can offer, and the
 * vault indexes that feed account inference and the `open` target file.
 */
import { describe, expect, it } from 'vitest';
import type { LineDiagnostic } from '../bean-check';
import {
	FLAG_OKAY_TITLE,
	FLAGGED_MESSAGE,
	OpenFileIndex,
	PAD_TRANSACTION_TITLE,
	PairingIndex,
	extractPairings,
	flagDiagnostics,
	flagDiagnosticsFromFences,
	flagOkayEdit,
	inferBalancingAccount,
	insertOpenDirective,
	mergeDiagnostics,
	openAccountTitle,
	padEdit,
	quickFixesForLine,
} from '../code-actions';
import type { Pairing, QuickFixContext, TextEdit } from '../code-actions';

function apply(lines: readonly string[], edit: TextEdit): string[] {
	const next = [...lines];
	const line = next[edit.line] ?? '';
	next[edit.line] = line.slice(0, edit.fromCh) + edit.text + line.slice(edit.toCh);
	return next.join('\n').split('\n');
}

function context(partial: Partial<QuickFixContext> & Pick<QuickFixContext, 'lines' | 'line' | 'message'>): QuickFixContext {
	return {
		pairings: [],
		openFile: 'accounts.bean',
		openedAccounts: new Set(),
		...partial,
	};
}

describe('flagOkayEdit', () => {
	it('replaces a transaction header ! with *', () => {
		const lines = ['2026-10-01 ! "Cafe"', '  Assets:Cash  10.00 USD'];
		const edit = flagOkayEdit(lines, 0);
		expect(edit).toEqual({ line: 0, fromCh: 11, toCh: 12, text: '*' });
		expect(apply(lines, edit!).join('\n')).toBe('2026-10-01 * "Cafe"\n  Assets:Cash  10.00 USD');
	});

	it('deletes a posting’s leading flag and the space after it', () => {
		const lines = ['2026-10-01 * "Cafe"', '  ! Assets:Cash  10.00 USD'];
		const edit = flagOkayEdit(lines, 1);
		expect(edit).toEqual({ line: 1, fromCh: 2, toCh: 4, text: '' });
		expect(apply(lines, edit!).join('\n')).toBe('2026-10-01 * "Cafe"\n  Assets:Cash  10.00 USD');
	});

	it('ignores a cleared header and a non-flag bang', () => {
		expect(flagOkayEdit(['2026-10-01 * "Cafe"'], 0)).toBeNull();
		expect(flagOkayEdit(['; wow!'], 0)).toBeNull();
		expect(flagOkayEdit(['2026-10-01 * "Cafe"'], 4)).toBeNull();
	});
});

describe('flagDiagnostics', () => {
	it('marks every ! header and leading posting flag', () => {
		const text = ['2026-10-01 ! "Cafe"', '  ! Assets:Cash  10.00 USD', '2026-10-02 * "Ok"'].join('\n');
		expect(flagDiagnostics(text)).toEqual([
			{ line: 0, message: FLAGGED_MESSAGE },
			{ line: 1, message: FLAGGED_MESSAGE },
		]);
	});
});

describe('mergeDiagnostics', () => {
	it('adds flag markers on quiet lines and keeps bean-check’s message on busy ones', () => {
		const bean: LineDiagnostic[] = [{ line: 0, message: "Invalid reference to unknown account 'Assets:Cash'" }];
		const flags: LineDiagnostic[] = [
			{ line: 0, message: FLAGGED_MESSAGE },
			{ line: 2, message: FLAGGED_MESSAGE },
		];
		expect(mergeDiagnostics(bean, flags)).toEqual([
			{ line: 0, message: "Invalid reference to unknown account 'Assets:Cash'" },
			{ line: 2, message: FLAGGED_MESSAGE },
		]);
	});
});

describe('extractPairings / inferBalancingAccount', () => {
	it('indexes two-leg single-commodity transactions', () => {
		const content = [
			'2026-09-01 * "Cafe"',
			'  Expenses:Food  10.00 USD',
			'  Assets:Cash   -10.00 USD',
			'',
			'2026-09-02 * "Cafe"',
			'  Expenses:Food  4.00 USD',
			'  Assets:Bank    -4.00 USD',
			'',
			'2026-09-03 * "Rent"',
			'  Expenses:Rent  1.00 USD',
			'  Assets:Bank   -1.00 USD',
			'',
			'2026-09-04 * "Mixed"',
			'  Assets:Cash  1.00 USD',
			'  Assets:Bank  1.00 EUR',
		].join('\n');
		const pairings = extractPairings(content);
		expect(pairings).toEqual([
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
			{ date: '2026-09-02', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Bank'] },
			{ date: '2026-09-03', payee: 'Rent', accounts: ['Expenses:Rent', 'Assets:Bank'] },
		]);
		expect(inferBalancingAccount('Expenses:Food', 'Cafe', pairings)).toBe('Assets:Bank');
		expect(inferBalancingAccount('Assets:Bank', 'Rent', pairings)).toBe('Expenses:Rent');
		expect(inferBalancingAccount('Assets:Cash', undefined, pairings)).toBe('Expenses:Food');
		expect(inferBalancingAccount('Liabilities:Card', 'Cafe', pairings)).toBeNull();
		expect(
			inferBalancingAccount('Expenses:Food', 'Cafe', [
				{ date: '2026-09-02', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Bank'] },
				{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Bank'] },
			])
		).toBe('Assets:Bank');
	});
});

describe('padEdit', () => {
	const history: Pairing[] = [
		{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
	];
	const unbalanced = 'Transaction does not balance: (10.00 USD)';

	it('inserts the negated residual against the inferred account', () => {
		const lines = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'];
		const edit = padEdit(lines, 0, history, unbalanced);
		expect(edit).toEqual({
			line: 1,
			fromCh: lines[1].length,
			toCh: lines[1].length,
			text: '\n  Assets:Cash  -10.00 USD',
		});
		expect(apply(lines, edit!).join('\n')).toBe(
			['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD'].join('\n')
		);
	});

	it('refuses two-leg transactions, missing history, and multi-commodity residuals', () => {
		const two = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash'];
		expect(padEdit(two, 0, history, unbalanced)).toBeNull();
		const one = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'];
		expect(padEdit(one, 0, [], unbalanced)).toBeNull();
		expect(padEdit(one, 0, history, 'Transaction does not balance: (10.00 USD, 1.00 EUR)')).toBeNull();
		expect(padEdit(one, 0, history, 'Invalid token')).toBeNull();
	});

	it('negates the posting when the message has no residual amount', () => {
		const lines = ['2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD'];
		const edit = padEdit(lines, 0, history, 'Transaction does not balance');
		expect(edit?.text).toBe('\n  Expenses:Food  10.00 USD');
	});

	it('treats a trailing posting flag as still one amount leg', () => {
		const lines = ['2026-10-01 * "Cafe"', '  Expenses:Food * 10.00 USD'];
		expect(padEdit(lines, 0, history, unbalanced)?.text).toBe('\n  Assets:Cash  -10.00 USD');
	});
});

describe('insertOpenDirective', () => {
	it('inserts in date order among existing opens', () => {
		const lines = ['2020-01-01 open Assets:Cash USD', '2026-06-01 open Expenses:Rent USD', ''];
		const edit = insertOpenDirective(lines, '2026-01-01', 'Expenses:Food', 'USD');
		expect(apply(lines, edit)).toEqual([
			'2020-01-01 open Assets:Cash USD',
			'2026-01-01 open Expenses:Food USD',
			'2026-06-01 open Expenses:Rent USD',
			'',
		]);
	});

	it('starts an empty file with a single open line', () => {
		expect(apply([''], insertOpenDirective([''], '2026-10-01', 'Assets:Cash'))).toEqual([
			'2026-10-01 open Assets:Cash',
		]);
	});

	it('prepends the open when the file has no existing opens', () => {
		expect(apply(['include "prices.bean"'], insertOpenDirective(['include "prices.bean"'], '2026-10-01', 'Assets:Cash'))).toEqual([
			'2026-10-01 open Assets:Cash',
			'include "prices.bean"',
		]);
	});
});

describe('quickFixesForLine', () => {
	it('offers Flag as okay on a ! header', () => {
		const fixes = quickFixesForLine(
			context({
				lines: ['2026-10-01 ! "Cafe"', '  Assets:Cash  10.00 USD'],
				line: 0,
				message: FLAGGED_MESSAGE,
			})
		);
		expect(fixes.map((fix) => fix.title)).toEqual([FLAG_OKAY_TITLE]);
	});

	it('offers a balancing posting when the transaction is one-leg and history knows the other account', () => {
		const fixes = quickFixesForLine(
			context({
				lines: ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'],
				line: 0,
				message: 'Transaction does not balance: (10.00 USD)',
				pairings: [{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] }],
			})
		);
		expect(fixes.map((fix) => fix.title)).toEqual([PAD_TRANSACTION_TITLE]);
	});

	it('offers an open per unknown account, skipping names already opened', () => {
		const lines = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash   -10.00 USD'];
		const message =
			"Invalid reference to unknown account 'Expenses:Food'\nInvalid reference to unknown account 'Assets:Cash'";
		const fixes = quickFixesForLine(
			context({
				lines,
				line: 0,
				message,
				openedAccounts: new Set(['Assets:Cash']),
			})
		);
		expect(fixes).toEqual([
			{
				title: openAccountTitle('Expenses:Food'),
				kind: 'open-account',
				account: 'Expenses:Food',
				date: '2026-10-01',
				commodity: 'USD',
				path: 'accounts.bean',
			},
		]);
	});
});

describe('PairingIndex', () => {
	it('unions pairings across files and re-keys on rename', () => {
		const index = new PairingIndex();
		index.setFileContent(
			'a.bean',
			['2026-09-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash   -10.00 USD'].join('\n')
		);
		index.setFileContent('empty.bean', 'option "operating_currency" "USD"\n');
		expect(index.all()).toHaveLength(1);
		expect(index.renameFile('a.bean', 'b.bean')).toBe(true);
		index.removeFile('b.bean');
		expect(index.all()).toEqual([]);
		expect(index.renameFile('gone.bean', 'x.bean')).toBe(false);
		index.setFileContent(
			'dir/a.bean',
			['2026-09-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash   -10.00 USD'].join('\n')
		);
		expect(index.renameFile('dir', 'other')).toBe(true);
		expect(index.all()).toHaveLength(1);
	});
});

describe('OpenFileIndex', () => {
	it('picks the ledger with the most opens over a markdown note', () => {
		const index = new OpenFileIndex();
		index.setFileContent(
			'note.md',
			'2020-01-01 open Assets:Cash\n2020-01-02 open Assets:Bank\n2020-01-03 open Assets:Gold\n'
		);
		index.setFileContent('accounts.bean', '2020-01-01 open Assets:Cash USD\n2020-01-02 open Expenses:Food USD\n');
		expect(index.bestFile()).toBe('accounts.bean');
		expect([...index.openedIn('accounts.bean')].sort()).toEqual(['Assets:Cash', 'Expenses:Food']);
		index.removeFile('accounts.bean');
		expect(index.bestFile()).toBe('note.md');
		expect(index.renameFile('note.md', 'journal.md')).toBe(true);
		expect(index.bestFile()).toBe('journal.md');
		index.setFileContent('journal.md', '');
		expect(index.bestFile()).toBeNull();
		index.setFileContent('dir/opens.bean', '2020-01-01 open Assets:Cash\n');
		expect(index.renameFile('dir', 'books')).toBe(true);
		expect(index.bestFile()).toBe('books/opens.bean');
	});
});

describe('edge postings and residuals', () => {
	const history: Pairing[] = [
		{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
	];

	it('pads a leading-flag posting and skips implicit / annotated legs', () => {
		const flagged = ['2026-10-01 * "Cafe"', '  * Expenses:Food  10.00 USD'];
		expect(padEdit(flagged, 0, history, 'Transaction does not balance: (10.00 USD)')?.text).toBe(
			'\n  Assets:Cash  -10.00 USD'
		);
		expect(
			padEdit(
				['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  ; comment'],
				0,
				history,
				'Transaction does not balance: (10.00 USD)'
			)
		).toBeNull();
		expect(
			extractPairings(
				['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  {1 USD}', '  Assets:Bank  @ 1 USD'].join(
					'\n'
				)
			)
		).toEqual([]);
	});

	it('refuses a missing commodity, a residual in another currency, and an out-of-range line', () => {
		const noCommodity = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00'];
		expect(padEdit(noCommodity, 0, history, 'Transaction does not balance')).toBeNull();
		const usd = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'];
		expect(padEdit(usd, 0, history, 'Transaction does not balance: (10.00 EUR)')).toBeNull();
		expect(padEdit(usd, -1, history, 'Transaction does not balance: (10.00 USD)')).toBeNull();
		expect(padEdit(usd, 9, history, 'Transaction does not balance: (10.00 USD)')).toBeNull();
	});

	it('flags a slash-date header and inserts opens against slash-dated files', () => {
		expect(flagOkayEdit(['2026/10/01 ! "Cafe"'], 0)).toEqual({ line: 0, fromCh: 11, toCh: 12, text: '*' });
		expect(
			apply(['2020/01/01 open Assets:Cash USD'], insertOpenDirective(['2020/01/01 open Assets:Cash USD'], '2026/10/01', 'Expenses:Food'))
		).toEqual(['2020/01/01 open Assets:Cash USD', '2026/10/01 open Expenses:Food']);
		expect(apply([], insertOpenDirective([], '2026-10-01', 'Assets:Cash'))).toEqual(['2026-10-01 open Assets:Cash']);
	});

	it('offers flag and pad together, and opens from a posting line', () => {
		expect(
			quickFixesForLine(
				context({
					lines: ['2026-10-01 ! "Cafe"', '  Expenses:Food  10.00 USD'],
					line: 0,
					message: 'Transaction does not balance: (10.00 USD)',
					pairings: history,
				})
			).map((fix) => fix.kind)
		).toEqual(['flag-okay', 'pad']);
		expect(
			quickFixesForLine(
				context({
					lines: ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'],
					line: 1,
					message: "Invalid reference to unknown account 'Expenses:Food'",
				})
			)
		).toMatchObject([{ kind: 'open-account', account: 'Expenses:Food', date: '2026-10-01' }]);
		expect(
			quickFixesForLine(
				context({
					lines: ['  Expenses:Food  10.00 USD'],
					line: 0,
					message: "Invalid reference to unknown account 'Expenses:Food'",
				})
			)
		).toEqual([]);
	});

	it('picks the ledger with more opens among two ledgers', () => {
		const index = new OpenFileIndex();
		index.setFileContent('a.bean', '2020-01-01 open Assets:Cash\n');
		index.setFileContent('b.bean', '2020-01-01 open Assets:Cash\n2020-01-02 open Expenses:Food\n');
		expect(index.bestFile()).toBe('b.bean');
	});

	it('breaks an equal-count pairing tie on name when dates match', () => {
		expect(
			inferBalancingAccount('Expenses:Food', undefined, [
				{ date: '2026-09-01', payee: undefined, accounts: ['Expenses:Food', 'Assets:Zoo'] },
				{ date: '2026-09-01', payee: undefined, accounts: ['Expenses:Food', 'Assets:Cash'] },
			])
		).toBe('Assets:Cash');
	});

	it('opens an unknown account on a balance directive and skips markdown without an open file', () => {
		expect(
			quickFixesForLine(
				context({
					lines: ['2026-10-01 balance Expenses:Food  0.00 USD'],
					line: 0,
					message: "Invalid reference to unknown account 'Expenses:Food'",
				})
			)
		).toMatchObject([{ kind: 'open-account', account: 'Expenses:Food', date: '2026-10-01' }]);
		expect(
			quickFixesForLine(
				context({
					lines: ['```beancount', '2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '```'],
					line: 1,
					message: "Invalid reference to unknown account 'Expenses:Food'",
					openFile: null,
				})
			)
		).toEqual([]);
	});

	it('maps flag markers onto markdown fence host lines and ignores prose bangs', () => {
		expect(
			flagDiagnosticsFromFences([
				{ startLine: 2, lines: ['2026-10-01 ! "Cafe"', '  Assets:Cash  10.00 USD'] },
			])
		).toEqual([{ line: 2, message: FLAGGED_MESSAGE }]);
		expect(flagDiagnostics('Wow! not a flag\n!nope')).toEqual([]);
	});

	it('prefers the counterpart with the later date when counts tie', () => {
		expect(
			inferBalancingAccount('Expenses:Food', undefined, [
				{ date: '2026-09-01', payee: undefined, accounts: ['Expenses:Food', 'Assets:Zoo'] },
				{ date: '2026-09-02', payee: undefined, accounts: ['Expenses:Food', 'Assets:Cash'] },
			])
		).toBe('Assets:Cash');
	});

	it('keeps the newer date when an older pairing for the same counterpart arrives later', () => {
		expect(
			inferBalancingAccount('Expenses:Food', undefined, [
				{ date: '2026-09-03', payee: undefined, accounts: ['Expenses:Food', 'Assets:Cash'] },
				{ date: '2026-09-01', payee: undefined, accounts: ['Expenses:Food', 'Assets:Cash'] },
				{ date: '2026-09-02', payee: undefined, accounts: ['Expenses:Food', 'Assets:Zoo'] },
				{ date: '2026-09-02', payee: undefined, accounts: ['Expenses:Food', 'Assets:Zoo'] },
			])
		).toBe('Assets:Cash');
	});

	it('skips indented comments and account lines whose rest is not an amount', () => {
		expect(
			extractPairings(
				['2026-10-01 * "Cafe"', '  ; not a posting', '  Assets:Cash  leftover', '  Expenses:Food  10.00 USD'].join(
					'\n'
				)
			)
		).toEqual([]);
		expect(
			padEdit(
				['2026-10-01 * "Cafe"', '  Expenses:Food  leftover'],
				0,
				[{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] }],
				'Transaction does not balance'
			)
		).toBeNull();
	});

	it('pads a quoted commodity and negates a residual that starts with +', () => {
		const history: Pairing[] = [
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		];
		const lines = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 "HOOL"'];
		expect(padEdit(lines, 0, history, 'Transaction does not balance: (+10.00 "HOOL")')?.text).toBe(
			'\n  Assets:Cash  -10.00 "HOOL"'
		);
	});

	it('indexes a txn header and reports a duplicate unknown account once', () => {
		expect(
			extractPairings(
				['2026-10-01 txn "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD'].join('\n')
			)
		).toEqual([{ date: '2026-10-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] }]);
		expect(
			quickFixesForLine(
				context({
					lines: ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'],
					line: 0,
					message:
						"Invalid reference to unknown account 'Expenses:Food'\nInvalid reference to unknown account 'Expenses:Food'",
				})
			)
		).toHaveLength(1);
	});

	it('returns false when OpenFileIndex rename misses, and maps empty fences to no flags', () => {
		const index = new OpenFileIndex();
		expect(index.renameFile('gone.bean', 'x.bean')).toBe(false);
		expect(flagDiagnosticsFromFences([])).toEqual([]);
	});

	it('pads from the posting when the residual text is not an amount', () => {
		const lines = ['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'];
		expect(
			padEdit(
				lines,
				0,
				[{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] }],
				'Transaction does not balance: (???)'
			)?.text
		).toBe('\n  Assets:Cash  -10.00 USD');
	});

	it('keeps the alphabetically first counterpart when a later name ties on count and date', () => {
		expect(
			inferBalancingAccount('Expenses:Food', undefined, [
				{ date: '2026-09-01', payee: undefined, accounts: ['Expenses:Food', 'Assets:Cash'] },
				{ date: '2026-09-01', payee: undefined, accounts: ['Expenses:Food', 'Assets:Zoo'] },
			])
		).toBe('Assets:Cash');
	});


});

