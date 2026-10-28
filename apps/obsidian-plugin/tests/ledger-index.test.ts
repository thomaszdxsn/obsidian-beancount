import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { Plugin, PluginManifest } from 'obsidian';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { LedgerIndex } from '../ledger-index';
import { FakeVault, flush } from './fakes';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

function posting(partial: { account: string; leadingFlag?: string; trailingFlag?: string; amount?: string }) {
	return { leadingFlag: '', trailingFlag: '', ...partial };
}

function names(index: LedgerIndex): string[] {
	return index.accounts.match('');
}

describe('LedgerIndex two-fence scan', () => {
	it('does not let the first fence header swallow the second fence postings', () => {
		const raw = [
			'```bean',
			'2026-01-01 * "Cafe"',
			'```',
			'```bean',
			'  Expenses:Food  10.00 USD',
			'  Assets:Cash   -10.00 USD',
			'```',
		].join('\n');
		const index = new LedgerIndex();
		index.setFile('note.md', raw);
		expect(index.pairings()).toEqual([]);
		expect(names(index).sort()).toEqual(['Assets:Cash', 'Expenses:Food']);
		expect(index.templateFor('Cafe')).toBeNull();
	});

	it('indexes accounts and payees from one ledger-file read', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-09-30 * "Whole Foods" "Groceries"', '  Expenses:Food  10.00 USD'].join('\n')
		);
		expect(index.accounts.match('Expenses:')).toEqual(['Expenses:Food']);
		expect(index.payees.match('')).toEqual(['Whole Foods']);
	});

	it('indexes note accounts only from fence bodies', () => {
		const index = new LedgerIndex();
		index.setFile(
			'note.md',
			[
				'PG_DATA_DIR:-supabase-db-data',
				'```bean',
				'2020-01-01 open Assets:Cash USD',
				'  Expenses:Food  10.00 USD',
				'```',
			].join('\n')
		);
		expect(names(index).sort()).toEqual(['Assets:Cash', 'Expenses:Food']);
		expect(names(index)).not.toContain('PG_DATA_DIR:-supabase-db-data');
	});

	it('ignores note prose outside fences for payee, narration, template, pairing and open count', () => {
		const index = new LedgerIndex();
		index.setFile(
			'note.md',
			[
				'2026-09-01 * "Cafe" "Lunch"',
				'  Expenses:Food  10.00 USD',
				'  Assets:Wallet  -10.00 USD',
				'2026-01-01 open Assets:Prose USD',
				'```bean',
				'2026-08-01 * "Cafe" "Fence meal"',
				'  Expenses:Food  4.00 USD',
				'  Assets:Cash  -4.00 USD',
				'2026-01-01 open Assets:Cash USD',
				'```',
			].join('\n')
		);
		expect(index.payees.match('')).toEqual(['Cafe']);
		expect(index.narrations.match('')).toEqual(['Fence meal']);
		expect(index.templateFor('Cafe')?.postings.some((row) => row.account === 'Assets:Wallet')).toBe(false);
		expect(index.templateFor('Cafe')?.postings[0]?.account).toBe('Expenses:Food');
		expect(index.pairings()).toEqual([
			{ date: '2026-08-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		expect(index.bestOpenFile()).toBe('note.md');
		expect([...index.openedIn('note.md')]).toEqual(['Assets:Cash']);
	});
});

describe('LedgerIndex queries', () => {
	it('hides closed accounts from match, keeps posting-only names, and still has closed ones', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			[
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'2020-01-01 open Assets:Broker',
				'  Expenses:Food  10.00 USD',
			].join('\n')
		);
		expect(index.accounts.match('Assets:')).toEqual(['Assets:Broker']);
		expect(index.accounts.match('Expenses:')).toEqual(['Expenses:Food']);
		expect(index.accounts.has('Assets:Cash')).toBe(true);
		expect(index.accounts.record('Assets:Cash')).toEqual({
			open: '2020-01-01',
			close: '2021-01-01',
			currencies: ['USD'],
		});
		index.setFile(
			'a.bean',
			[
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'2020-01-01 open Assets:Broker',
				'  Expenses:Food  10.00 USD',
				'2022-01-01 open Assets:Cash CNY',
			].join('\n')
		);
		expect(index.accounts.match('Assets:')).toEqual(['Assets:Broker', 'Assets:Cash']);
		expect(index.accounts.record('Assets:Cash')).toEqual({
			open: '2022-01-01',
			close: '2021-01-01',
			currencies: ['CNY'],
		});
	});

	it('picks the latest payee template by date, then path, then host line', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			[
				'2026-01-01 * "Cafe" "old"',
				'  Expenses:Food  4.00 USD',
				'  Assets:Cash  -4.00 USD',
				'',
				'2026-02-01 * "Cafe"',
				'  Expenses:Rent  9.00 USD',
				'  Assets:Cash  -9.00 USD',
			].join('\n')
		);
		index.setFile('b.bean', '2026-02-01 * "Cafe"\n  Expenses:Fuel  3.00 USD\n  Assets:Cash');
		index.setFile('c.bean', '2026/02/01 * "Cafe"\n  Expenses:Late  1.00 USD\n  Assets:Cash');
		expect(index.templateFor('Cafe')).toMatchObject({
			date: '2026-02-01',
			path: 'c.bean',
			postings: [
				posting({ account: 'Expenses:Late', amount: '1.00 USD' }),
				posting({ account: 'Assets:Cash' }),
			],
		});
		index.setFile(
			'd.bean',
			['2026-12-01 * "Cafe" "just a note"', '  ; comment', '    statement: "no"'].join('\n')
		);
		expect(index.templateFor('Cafe')?.path).toBe('c.bean');
	});

	it('clears pairings after rename then delete', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-09-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash   -10.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		expect(index.renameFile('a.bean', 'b.bean')).toBe(true);
		index.removeFile('b.bean');
		expect(index.pairings()).toEqual([]);
	});

	it('picks the ledger file with the most opens over a note, then null when none remain', () => {
		const index = new LedgerIndex();
		index.setFile(
			'note.md',
			[
				'```bean',
				'2020-01-01 open Assets:Cash',
				'2020-01-02 open Assets:Bank',
				'2020-01-03 open Assets:Gold',
				'```',
			].join('\n')
		);
		index.setFile(
			'accounts.bean',
			['2020-01-01 open Assets:Cash USD', '2020-01-02 open Expenses:Food USD'].join('\n')
		);
		expect(index.bestOpenFile()).toBe('accounts.bean');
		index.removeFile('accounts.bean');
		index.removeFile('note.md');
		index.setFile('a.bean', '2020-01-01 open Assets:Cash\n');
		index.setFile('b.bean', '2020-01-01 open Assets:Cash\n2020-01-02 open Expenses:Food\n');
		expect(index.bestOpenFile()).toBe('b.bean');
		index.removeFile('a.bean');
		index.removeFile('b.bean');
		expect(index.bestOpenFile()).toBeNull();
	});

	it('rewrites template paths on rename so a date tie follows the file', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '2026-02-01 * "Cafe"\n  Expenses:A  1 USD\n  Assets:Cash');
		index.setFile('b.bean', '2026-02-01 * "Cafe"\n  Expenses:B  1 USD\n  Assets:Cash');
		expect(index.templateFor('Cafe')?.path).toBe('b.bean');
		index.renameFile('b.bean', '0.bean');
		expect(index.templateFor('Cafe')?.path).toBe('a.bean');
		expect(index.templateFor('Cafe')?.postings[0]?.account).toBe('Expenses:A');
	});

	it('drops values longer than a name could be and leaves empty files untracked', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', `Assets:Cash Assets:${'x'.repeat(300)}`);
		expect(names(index)).toEqual(['Assets:Cash']);
		index.setFile('a.bean', 'just prose, no names');
		expect(index.renameFile('a.bean', 'b.bean')).toBe(false);
	});

	it('extracts account-shaped names the way completion used to', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '(see Assets:Cash), then Assets:Broker.');
		expect(names(index)).toEqual(['Assets:Broker', 'Assets:Cash']);
		index.setFile('a.bean', 'pre-Assets:Cash 2024-Assets:Cash https://github.com/User:Repo');
		expect(names(index)).toEqual([]);
		index.setFile('a.bean', '  Expenses:カード・ローン  10 JPY\n  Assets:银行·招商');
		expect(names(index)).toEqual(['Assets:银行·招商', 'Expenses:カード・ローン']);
	});

	it('indexes payees, narrations, tags, links and commodities from scan', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			[
				'2026-09-30 * "Whole Foods" "Groceries"',
				'  Assets:Cash  -10.00 USD',
				'  Expenses:Food  10.00 USD #trip ^receipt',
				'2026-09-30 price USD 1.10 CAD',
				'2026-09-30 commodity AAPL',
			].join('\n')
		);
		expect(index.payees.match('')).toEqual(['Whole Foods']);
		expect(index.narrations.match('')).toEqual(['Groceries']);
		expect(index.tags.match('')).toEqual(['#trip']);
		expect(index.links.match('')).toEqual(['^receipt']);
		expect(index.commodities.match('')).toEqual(['AAPL', 'CAD', 'USD']);
	});

	it('indexes a line-start tag and link in a region', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '#trip\n^receipt');
		expect(index.tags.match('')).toEqual(['#trip']);
		expect(index.links.match('')).toEqual(['^receipt']);
	});

	it('does not treat quoted metadata as commodities', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			[
				'2026-09-30 * "Shell" "Fuel"',
				'  invoice: "Order 2024 Q1"',
				'  memo: "paid 2 ATM fees"',
				'  invoice: "Order; 2 EUR"  10.00 USD ; 3 GBP',
			].join('\n')
		);
		expect(index.commodities.match('')).toEqual(['USD']);
	});

	it('treats U+2028 as a line break between commodity directives', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '2026-09-30 commodity AAPL\u20282026-10-01 commodity MSFT');
		expect(index.commodities.match('')).toEqual(['AAPL', 'MSFT']);
	});

	it('strips booking methods and comments from open currencies', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '2020-01-01 open Assets:Cash USD, EUR "STRICT" ; note');
		expect(index.accounts.record('Assets:Cash')).toEqual({
			open: '2020-01-01',
			currencies: ['USD', 'EUR'],
		});
	});

	it('lets a later same-date open win and merges latest open/close across files', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '2020-01-01 open Assets:Cash USD\n2020-01-01 open Assets:Cash EUR');
		expect(index.accounts.record('Assets:Cash')).toEqual({ open: '2020-01-01', currencies: ['EUR'] });
		index.setFile('b.bean', '2022-01-01 open Assets:Cash CNY');
		index.setFile('c.bean', '2021-01-01 open Assets:Cash USD');
		index.setFile('d.bean', '2023-01-01 close Assets:Cash');
		index.setFile('e.bean', '2022-06-01 close Assets:Cash');
		expect(index.accounts.record('Assets:Cash')).toEqual({
			open: '2022-01-01',
			close: '2023-01-01',
			currencies: ['CNY'],
		});
		expect(index.accounts.match('Assets:')).toEqual([]);
	});

	it('skips closed names when filling the popup window', () => {
		const index = new LedgerIndex();
		const closed = Array.from({ length: 60 }, (_, i) => {
			const name = `Assets:Z${String(i).padStart(2, '0')}`;
			return `2020-01-01 open ${name}\n2021-01-01 close ${name}`;
		});
		const open = Array.from({ length: 3 }, (_, i) => `2020-01-01 open Assets:A${i}`);
		index.setFile('a.bean', [...closed, ...open].join('\n'));
		expect(index.accounts.match('Assets:')).toEqual(['Assets:A0', 'Assets:A1', 'Assets:A2']);
	});

	it('reads CRLF commodities and payee templates like LF', () => {
		const lf = ['2026-03-01 * "Cafe"', '  Expenses:Food * 12.50 USD', '  Assets:Cash !', '2026-09-30 commodity AAPL'].join(
			'\n'
		);
		const crlf = lf.split('\n').join('\r\n');
		const left = new LedgerIndex();
		const right = new LedgerIndex();
		left.setFile('a.bean', lf);
		right.setFile('a.bean', crlf);
		expect(right.commodities.match('')).toEqual(left.commodities.match(''));
		expect(right.templateFor('Cafe')).toEqual(left.templateFor('Cafe'));
	});

	it('ends a payee template at a blank line, column-0 comment, next header, or directive', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-01-01 * "Blank"', '  Expenses:Food  1.00 USD', '  Assets:Cash', '', '  Expenses:Stolen  9.00 USD'].join('\n')
		);
		expect(index.templateFor('Blank')?.postings.map((row) => row.account)).toEqual(['Expenses:Food', 'Assets:Cash']);
		index.setFile(
			'a.bean',
			['2026-01-01 * "Comment"', '  Expenses:Food  1.00 USD', '; column-0 comment', '  Expenses:Stolen  9.00 USD'].join(
				'\n'
			)
		);
		expect(index.templateFor('Comment')?.postings.map((row) => row.account)).toEqual(['Expenses:Food']);
		index.setFile(
			'a.bean',
			[
				'2026-01-01 * "Next"',
				'  Expenses:Food  1.00 USD',
				'2026-01-02 * "Other"',
				'  Expenses:Rent  2.00 USD',
				'  Assets:Bank',
			].join('\n')
		);
		expect(index.templateFor('Next')?.postings.map((row) => row.account)).toEqual(['Expenses:Food']);
		index.setFile(
			'a.bean',
			['2026-01-01 * "Open"', '  Expenses:Food  1.00 USD', '2026-01-02 open Assets:New', '  Expenses:Stolen  9.00 USD'].join(
				'\n'
			)
		);
		expect(index.templateFor('Open')?.postings.map((row) => row.account)).toEqual(['Expenses:Food']);
	});

	it('keeps a trailing posting flag off the amount and keys escaped payees as written', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-03-01 * "Cafe"', '  Expenses:Food * 12.50 USD', '  Assets:Cash !'].join('\n')
		);
		expect(index.templateFor('Cafe')?.postings).toEqual([
			{ leadingFlag: '', trailingFlag: '*', account: 'Expenses:Food', amount: '12.50 USD' },
			{ leadingFlag: '', trailingFlag: '!', account: 'Assets:Cash' },
		]);
		index.setFile('a.bean', '2026-01-01 * "Cafe \\"North\\""\n  Expenses:Food  1 USD\n  Assets:Cash');
		expect(index.templateFor('Cafe \\"North\\"')?.postings[0]?.account).toBe('Expenses:Food');
	});

	it('does not count open inside a comment or narration', () => {
		const index = new LedgerIndex();
		index.setFile(
			'notes.bean',
			['; do not open Assets:Nope', '2026-01-01 * "please open Assets:Narr"', '  Expenses:Opening  1.00 USD'].join('\n')
		);
		expect(index.bestOpenFile()).toBeNull();
		expect([...index.openedIn('notes.bean')]).toEqual([]);
	});

	it('counts a CJK open line', () => {
		const index = new LedgerIndex();
		index.setFile('accounts.bean', '2026-01-01 open Expenses:餐饮 CNY\n');
		expect(index.bestOpenFile()).toBe('accounts.bean');
		expect([...index.openedIn('accounts.bean')]).toEqual(['Expenses:餐饮']);
		expect(index.accounts.has('Expenses:餐饮')).toBe(true);
	});

	it('covers account-shape boundaries used by completion', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '（Expenses:餐饮，午饭）记到 Assets:现金。');
		expect(names(index)).toEqual(['Assets:现金', 'Expenses:餐饮']);
		index.setFile('a.bean', 'Expenses:Cafe\u0301:Bar Expenses:खर्च');
		expect(names(index)).toEqual(['Expenses:Cafe\u0301:Bar', 'Expenses:खर्च']);
		index.setFile('a.bean', '2026-09-30  12:30  https://github.com/user:repo\nplain words');
		expect(names(index)).toEqual([]);
		index.setFile('a.bean', '见Expenses:餐饮 日期Assets:现金');
		expect(names(index)).toEqual([]);
	});

	it('indexes payee fields across flags, tabs, empties and non-transaction lines', () => {
		const index = new LedgerIndex();
		index.setFile('a.bean', '2026/09/30 *"Payee" "N"');
		expect(index.payees.match('')).toEqual(['Payee']);
		index.setFile('a.bean', '2026-09-30\t*\t"Payee" "N"');
		expect(index.payees.match('')).toEqual(['Payee']);
		index.setFile('a.bean', '2026-09-30 * "" "Narration only"');
		expect(index.payees.match('')).toEqual([]);
		index.setFile('a.bean', '2026-09-30 open Assets:Cash "x"');
		expect(index.payees.match('')).toEqual([]);
		index.setFile('a.bean', '2026-09-30 *tag "Payee" "N"');
		expect(index.payees.match('')).toEqual([]);
	});

	it('reports nothing moved when renaming an untracked path', () => {
		const index = new LedgerIndex();
		index.setFile('keep.bean', 'Assets:Cash');
		expect(index.renameFile('missing.bean', 'gone.bean')).toBe(false);
		expect(names(index)).toEqual(['Assets:Cash']);
	});

	it('indexes two-leg pairings and excludes three-leg, mixed-commodity, and same-account rows', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-09-01 * "面馆"', '  Expenses:餐饮  18.00 CNY', '  Assets:Cash  -18.00 CNY'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-09-01', payee: '面馆', accounts: ['Expenses:餐饮', 'Assets:Cash'] },
		]);
		index.setFile(
			'a.bean',
			['2026-09-01 * "Split"', '  Expenses:Food  6.00 USD', '  Expenses:Tip  4.00 USD', '  Assets:Cash  -10.00 USD'].join(
				'\n'
			)
		);
		expect(index.pairings()).toEqual([]);
		index.setFile(
			'a.bean',
			['2026-09-01 * "Split"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD', '  Expenses:Tip'].join('\n')
		);
		expect(index.pairings()).toEqual([]);
		index.setFile(
			'a.bean',
			['2026-09-04 * "Mixed"', '  Assets:Cash  1.00 USD', '  Assets:Bank  1.00 EUR'].join('\n')
		);
		expect(index.pairings()).toEqual([]);
		index.setFile(
			'a.bean',
			['2026-09-01 * "Same"', '  Assets:Cash  1.00 USD', '  Assets:Cash  -1.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([]);
	});

	it('pairs flagged legs, metadata-separated postings, slash dates, and txn headers', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-09-01 ! "Cafe"', '  ! Expenses:Food  10.00 USD', '  Assets:Cash * -10.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		index.setFile(
			'a.bean',
			['2026-09-01 * "Cafe"', '  invoice: "abc"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		index.setFile(
			'a.bean',
			['2026/09/01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		index.setFile(
			'a.bean',
			['2026-10-01 txn "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-10-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		index.setFile(
			'a.bean',
			['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  {1 USD}', '  Assets:Bank  @ 1 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([]);
		index.setFile(
			'a.bean',
			['2026-10-01 * "Cafe"', '  ; not a posting', '  Assets:Cash  leftover', '  Expenses:Food  10.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([]);
	});

	it('merges two-leg pairings across two files', () => {
		const index = new LedgerIndex();
		index.setFile(
			'a.bean',
			['2026-09-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash   -10.00 USD'].join('\n')
		);
		index.setFile(
			'b.bean',
			['2026-09-02 * "Cafe"', '  Expenses:Food  4.00 USD', '  Assets:Bank    -4.00 USD'].join('\n')
		);
		expect(index.pairings()).toEqual([
			{ date: '2026-09-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
			{ date: '2026-09-02', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Bank'] },
		]);
	});
});

interface Fixture {
	vault: FakeVault;
	index: LedgerIndex;
	plugin: RecordingPlugin;
}

function setup(files: Record<string, string> = {}): Fixture {
	const vault = new FakeVault();
	for (const [path, content] of Object.entries(files)) vault.write(path, content);
	const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
	const index = new LedgerIndex();
	index.applyVault(plugin as unknown as Plugin);
	return { vault, index, plugin };
}

describe('LedgerIndex.applyVault', () => {
	it('scans indexed extensions once and skips everything else', async () => {
		const vault = new FakeVault();
		vault.folder('notes');
		vault.write('a.md', '```bean\nAssets:Cash\n```');
		vault.write('b.bean', 'Expenses:Food');
		vault.write('c.beancount', 'Income:Salary');
		vault.write('d.png', 'Assets:Ignored');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await flush();

		expect(names(index).sort()).toEqual(['Assets:Cash', 'Expenses:Food', 'Income:Salary']);
		expect([...vault.reads].sort()).toEqual(['a.md', 'b.bean', 'c.beancount']);
	});

	it('feeds every fact from a single read', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-09-30 * "Whole Foods" "Groceries"\n  Expenses:Food  10.00 USD');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await flush();

		expect(vault.reads).toEqual(['ledger.bean']);
		expect(index.accounts.match('')).toEqual(['Expenses:Food']);
		expect(index.payees.match('')).toEqual(['Whole Foods']);
	});

	it('registers the four vault events', () => {
		const { plugin, vault } = setup();
		expect(plugin.registrations.events).toHaveLength(4);
		expect([...vault.handlers.keys()].sort()).toEqual(['create', 'delete', 'modify', 'rename']);
	});

	it('re-indexes a modified file without touching another path', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old', 'b.bean': 'Expenses:Keep' });
		await flush();
		const file = vault.write('a.bean', 'Assets:New Expenses:Food');
		await vault.emit('modify', file);
		expect(names(index).sort()).toEqual(['Assets:New', 'Expenses:Food', 'Expenses:Keep']);
		expect(names(index)).not.toContain('Assets:Old');
	});

	it('indexes files created after load', async () => {
		const { vault, index } = setup();
		await flush();
		const file = vault.write('new.bean', 'Liabilities:Card');
		await vault.emit('create', file);
		expect(names(index)).toEqual(['Liabilities:Card']);
	});

	it('drops strings when a file is deleted', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Cash', 'b.bean': 'Expenses:Food' });
		await flush();
		await vault.emit('delete', vault.delete('a.bean'));
		expect(names(index)).toEqual(['Expenses:Food']);
	});

	it('ignores events for files outside the indexed extensions', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Cash' });
		await flush();
		const file = vault.write('d.png', 'Assets:Ignored');
		await vault.emit('modify', file);
		expect(names(index)).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['a.bean']);
	});

	it('keeps cached strings on rename without re-reading, then drops them on vault delete', async () => {
		const { vault, index } = setup({ 'dir/a.bean': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('dir/a.bean', 'dir/b.bean');
		await vault.emit('rename', renamed, 'dir/a.bean');
		expect(names(index)).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['dir/a.bean']);
		await vault.emit('delete', vault.delete('dir/b.bean'));
		expect(names(index)).toEqual([]);
	});

	it('moves every child entry on a folder rename, including a moved close', async () => {
		const { vault, index } = setup({
			'dir/a.md': '```bean\nAssets:Cash\n```',
			'other.md': '```bean\nExpenses:Food\n```',
			'dir/a.bean': '2020-01-01 open Assets:Cash USD',
			'dir/b.bean': '2021-01-01 close Assets:Cash',
		});
		await flush();
		const renamed = vault.rename('dir', 'moved');
		await vault.emit('rename', renamed, 'dir');
		expect(index.accounts.match('Assets:')).toEqual([]);
		index.removeFile('moved/b.bean');
		expect(index.accounts.match('Assets:')).toEqual(['Assets:Cash']);
		index.removeFile('moved/a.md');
		expect(index.accounts.match('Expenses:')).toEqual(['Expenses:Food']);
	});

	it('reads the file when a rename makes it indexable', async () => {
		const { vault, index } = setup({ 'note.txt': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('note.txt', 'note.bean');
		await vault.emit('rename', renamed, 'note.txt');
		expect(names(index)).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['note.bean']);
	});

	it('re-reads a note ↔ ledger rename, whose ledger text differs', async () => {
		const vault = new FakeVault();
		vault.write('x.md', 'Prose:Name\n```bean\n  Expenses:Food  1 USD\n```');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await flush();
		expect(index.accounts.match('').sort()).toEqual(['Expenses:Food']);

		await vault.emit('rename', vault.rename('x.md', 'x.bean'), 'x.md');
		await flush();
		expect(index.accounts.match('').sort()).toEqual(['Expenses:Food', 'Prose:Name']);

		await vault.emit('rename', vault.rename('x.bean', 'x.md'), 'x.bean');
		await flush();
		expect(index.accounts.match('').sort()).toEqual(['Expenses:Food']);
	});

	it('indexes payee facts from ledger text only, then both after a note becomes a ledger file', async () => {
		const prose = [
			'2026-09-01 * "Cafe" "Lunch"',
			'  Expenses:Food  10.00 USD',
			'  Assets:Wallet  -10.00 USD',
			'2026-01-01 open Assets:Prose USD',
		].join('\n');
		const fence = [
			'```bean',
			'2026-08-01 * "Cafe" "Fence meal"',
			'  Expenses:Food  4.00 USD',
			'  Assets:Cash  -4.00 USD',
			'2026-01-01 open Assets:Cash USD',
			'```',
		].join('\n');
		const vault = new FakeVault();
		vault.write('note.md', `${prose}\n${fence}\n`);
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await flush();
		expect(index.payees.match('')).toEqual(['Cafe']);
		expect(index.narrations.match('')).toEqual(['Fence meal']);
		expect(index.templateFor('Cafe')?.postings[0]?.account).toBe('Expenses:Food');
		expect(index.templateFor('Cafe')?.postings.some((row) => row.account === 'Assets:Wallet')).toBe(false);
		expect(index.pairings()).toEqual([
			{ date: '2026-08-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		expect(index.bestOpenFile()).toBe('note.md');
		expect([...index.openedIn('note.md')]).toEqual(['Assets:Cash']);

		await vault.emit('rename', vault.rename('note.md', 'note.bean'), 'note.md');
		await flush();
		expect(index.narrations.match('').sort()).toEqual(['Fence meal', 'Lunch']);
		expect(index.pairings().map((pairing) => pairing.accounts[1]).sort()).toEqual(['Assets:Cash', 'Assets:Wallet']);
		expect([...index.openedIn('note.bean')].sort()).toEqual(['Assets:Cash', 'Assets:Prose']);

		await vault.emit('rename', vault.rename('note.bean', 'note.md'), 'note.bean');
		await flush();
		expect(index.narrations.match('')).toEqual(['Fence meal']);
		expect(index.pairings()).toEqual([
			{ date: '2026-08-01', payee: 'Cafe', accounts: ['Expenses:Food', 'Assets:Cash'] },
		]);
		expect([...index.openedIn('note.md')]).toEqual(['Assets:Cash']);
	});

	it('drops the entry when a rename makes the file unindexable', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('a.bean', 'a.txt');
		await vault.emit('rename', renamed, 'a.bean');
		expect(names(index)).toEqual([]);
	});

	it('replaces a dropped in-flight read after rename', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old' });
		await flush();
		vault.delays.set('a.bean', [50]);
		const file = vault.write('a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('a.bean', 'b.bean');
		await vault.emit('rename', renamed, 'a.bean');
		expect(names(index)).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(names(index)).toEqual(['Assets:Fresh']);
		index.removeFile('b.bean');
		expect(names(index)).toEqual([]);
	});

	it('does not let a stale read overwrite a recreated file', async () => {
		const vault = new FakeVault();
		vault.delays.set('a.bean', [50]);
		vault.write('a.bean', 'Assets:Stale');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await vault.emit('delete', vault.delete('a.bean'));
		const recreated = vault.write('a.bean', 'Assets:Fresh');
		await vault.emit('create', recreated);
		expect(names(index)).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(names(index)).toEqual(['Assets:Fresh']);
	});

	it('skips prototype-named extensions in the scan', async () => {
		const vault = new FakeVault();
		vault.write('a.bean', 'Assets:Cash');
		vault.write('trap.constructor', 'Expenses:Trap');
		vault.write('trap.toString', 'Expenses:Trap');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await flush();
		expect(names(index)).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['a.bean']);
	});

	it('replaces dropped in-flight child reads on a folder rename', async () => {
		const { vault, index } = setup({ 'dir/a.bean': 'Assets:Old', 'other.bean': 'Expenses:Food' });
		await flush();
		vault.delays.set('dir/a.bean', [50]);
		const file = vault.write('dir/a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('dir', 'moved');
		await vault.emit('rename', renamed, 'dir');
		await delay(100);
		expect(names(index).sort()).toEqual(['Assets:Fresh', 'Expenses:Food']);
		index.removeFile('moved/a.bean');
		expect(names(index)).toEqual(['Expenses:Food']);
	});

	it('discards an in-flight read when the rename makes the file unindexable', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old' });
		await flush();
		vault.delays.set('a.bean', [50]);
		const file = vault.write('a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('a.bean', 'a.txt');
		await vault.emit('rename', renamed, 'a.bean');
		await delay(100);
		expect(names(index)).toEqual([]);
	});

	it('discards an in-flight read when the file is deleted', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old' });
		await flush();
		vault.delays.set('a.bean', [50]);
		const file = vault.write('a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		await vault.emit('delete', vault.delete('a.bean'));
		await delay(100);
		expect(names(index)).toEqual([]);
	});

	it('leaves unrelated in-flight reads alone on rename', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old', 'other.bean': 'Expenses:Food' });
		await flush();
		vault.delays.set('other.bean', [20]);
		const other = vault.write('other.bean', 'Expenses:Fresh');
		await vault.emit('modify', other);
		const renamed = vault.rename('a.bean', 'b.bean');
		await vault.emit('rename', renamed, 'a.bean');
		expect(names(index).sort()).toEqual(['Assets:Old', 'Expenses:Food']);
		await delay(60);
		expect(names(index).sort()).toEqual(['Assets:Old', 'Expenses:Fresh']);
	});

	it('ignores dropped children that vanished from the file listing', async () => {
		const { vault, index } = setup({ 'dir/a.bean': 'Assets:Old' });
		await flush();
		vault.delays.set('dir/a.bean', [50]);
		const file = vault.write('dir/a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('dir', 'moved');
		vault.files.delete('moved/a.bean');
		await vault.emit('rename', renamed, 'dir');
		await delay(100);
		expect(names(index)).toEqual(['Assets:Old']);
	});

	it('drops stale out-of-order reads instead of applying them', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old' });
		await flush();
		vault.delays.set('a.bean', [50, 0]);
		const file = vault.write('a.bean', 'Assets:Old');
		await vault.emit('modify', file);
		vault.write('a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		expect(names(index)).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(names(index)).toEqual(['Assets:Fresh']);
	});

	it('keeps the last good cache entry when a read fails, then applies a later success', async () => {
		const { vault, index } = setup({ 'a.bean': 'Assets:Old', 'b.bean': 'Expenses:Food' });
		await flush();
		vault.failures.add('a.bean');
		const file = vault.write('a.bean', 'Assets:New');
		await vault.emit('modify', file);
		expect(names(index).sort()).toEqual(['Assets:Old', 'Expenses:Food']);
		vault.failures.delete('a.bean');
		vault.write('a.bean', 'Assets:Fresh');
		await vault.emit('modify', file);
		expect(names(index).sort()).toEqual(['Assets:Fresh', 'Expenses:Food']);
	});

	it('indexes a path after its earlier read failed', async () => {
		const vault = new FakeVault();
		vault.write('a.bean', 'Assets:Cash');
		vault.write('b.bean', 'Expenses:Food');
		vault.failures.add('a.bean');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new LedgerIndex();
		index.applyVault(plugin as unknown as Plugin);
		await flush();
		expect(names(index)).toEqual(['Expenses:Food']);
		vault.failures.delete('a.bean');
		await vault.emit('modify', vault.files.get('a.bean')!);
		expect(names(index).sort()).toEqual(['Assets:Cash', 'Expenses:Food']);
	});
});
