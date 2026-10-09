import { describe, expect, it } from 'vitest';
import {
	AccountIndex,
	accountHoverCard,
	accountTokenAt,
	describeAccount,
	extractAccountDirectives,
	extractAccounts,
	isAccountClosed,
} from '../account-index';
import type { AccountRecord } from '../account-index';

describe('extractAccounts', () => {
	it('extracts every account-shaped name in the content', () => {
		const content = [
			'2026-09-30 open Assets:Cash:Wallet',
			'2026-09-30 open Liabilities:Credit-Card:Chase',
			'  Assets:Cash:Wallet  10.00 USD',
		].join('\n');
		expect([...extractAccounts(content)].sort()).toEqual([
			'Assets:Cash:Wallet',
			'Liabilities:Credit-Card:Chase',
		]);
	});

	it('deduplicates names inside one file', () => {
		const content = 'Assets:Cash\nAssets:Cash\nAssets:Cash';
		expect([...extractAccounts(content)]).toEqual(['Assets:Cash']);
	});

	it('keeps dashes, underscores and digits inside segments', () => {
		const content = 'Expenses:Food_and-Drink:Rest_2024 Income:Salary:Acme-Inc';
		expect([...extractAccounts(content)].sort()).toEqual([
			'Expenses:Food_and-Drink:Rest_2024',
			'Income:Salary:Acme-Inc',
		]);
	});

	it('strips trailing punctuation but keeps the name', () => {
		expect([...extractAccounts('(see Assets:Cash), then Assets:Broker.')]).toEqual([
			'Assets:Cash',
			'Assets:Broker',
		]);
	});

	it('ignores dates, times, urls and prose without the account shape', () => {
		const content = [
			'2026-09-30  12:30  https://github.com/user:repo',
			'plain words and 100.00 USD',
			'Meeting: ',
			'Assets',
		].join('\n');
		expect([...extractAccounts(content)]).toEqual([]);
	});

	it('does not leak names out of longer tokens or URL paths', () => {
		const content = 'pre-Assets:Cash 2024-Assets:Cash https://github.com/User:Repo https://en.wikipedia.org/wiki/World:History';
		expect([...extractAccounts(content)]).toEqual([]);
	});

	it('keeps a name that follows a boundary character', () => {
		expect([...extractAccounts('(Assets:Cash) "Assets:Broker" #note')]).toEqual(['Assets:Cash', 'Assets:Broker']);
	});

	it('requires a capitalized root and non-empty segments', () => {
		expect([...extractAccounts('assets:cash Assets: Assets::Cash Meeting:Notes')]).toEqual(['Meeting:Notes']);
	});

	it('keeps a trailing underscore and drops a trailing dash', () => {
		expect([...extractAccounts('Assets:Cash_ Assets:现金-')]).toEqual(['Assets:Cash_', 'Assets:现金']);
	});

	it('extracts names with non-ASCII segments', () => {
		const content = [
			'2026-09-30 open Expenses:餐饮:午饭 CNY',
			'  Assets:现金  -30.00 CNY',
			'  Expenses:食費:ランチ Assets:은행:2024',
		].join('\n');
		expect([...extractAccounts(content)].sort()).toEqual([
			'Assets:现金',
			'Assets:은행:2024',
			'Expenses:食費:ランチ',
			'Expenses:餐饮:午饭',
		]);
	});

	it('keeps combining marks inside and at the end of a segment', () => {
		// Decomposed `é` (e + U+0301) and Devanagari vowel signs are \p{M}.
		expect([...extractAccounts('Expenses:Cafe\u0301:Bar Expenses:खर्च')]).toEqual([
			'Expenses:Cafe\u0301:Bar',
			'Expenses:खर्च',
		]);
	});

	it('ends a name at CJK punctuation, fullwidth colon and symbols', () => {
		expect([...extractAccounts('（Expenses:餐饮，午饭）记到 Assets:现金。')]).toEqual(['Expenses:餐饮', 'Assets:现金']);
		expect([...extractAccounts('Expenses:餐饮：午饭')]).toEqual(['Expenses:餐饮']);
		expect([...extractAccounts('Expenses:咖☕啡')]).toEqual(['Expenses:咖']);
	});

	it('does not leak a name glued to a preceding CJK letter', () => {
		expect([...extractAccounts('见Expenses:餐饮 日期Assets:现金')]).toEqual([]);
	});

	it('keeps CJK middle dots inside a segment instead of cutting the name short', () => {
		expect([...extractAccounts('  Expenses:カード・ローン  10 JPY\n  Assets:银行·招商')]).toEqual([
			'Expenses:カード・ローン',
			'Assets:银行·招商',
		]);
	});

	it('returns an empty set for empty content', () => {
		expect([...extractAccounts('')]).toEqual([]);
	});
});

function records(content: string): Record<string, AccountRecord> {
	return Object.fromEntries(extractAccountDirectives(content));
}

describe('extractAccountDirectives', () => {
	it('reads open date, currencies and close date from column-0 directives', () => {
		const content = [
			'2020-01-01 open Assets:Cash USD, EUR',
			'2021-06-15 close Assets:Cash',
			'2022-03-01 open Liabilities:Card CNY',
		].join('\n');
		expect(records(content)).toEqual({
			'Assets:Cash': { open: '2020-01-01', close: '2021-06-15', currencies: ['USD', 'EUR'] },
			'Liabilities:Card': { open: '2022-03-01', currencies: ['CNY'] },
		});
	});

	it('reads directives for accounts with non-ASCII segments', () => {
		const content = ['2020-01-01 open Expenses:餐饮:午饭 CNY', '2021-06-15 close Expenses:餐饮:午饭'].join('\n');
		expect(records(content)).toEqual({
			'Expenses:餐饮:午饭': { open: '2020-01-01', close: '2021-06-15', currencies: ['CNY'] },
		});
	});

	it('ignores indented lines, comments and non-open/close dated entries', () => {
		const content = [
			'; 2020-01-01 open Assets:Cash USD',
			'  2020-01-01 open Assets:Cash USD',
			'2020-01-01 * "payee" "narration"',
			'  Assets:Cash  10.00 USD',
			'2020-01-01 pad Assets:Cash Assets:Backup',
			'2020-01-01 balance Assets:Cash 10.00 USD',
		].join('\n');
		expect(records(content)).toEqual({});
	});

	it('strips comments and booking methods from the currency list', () => {
		expect(records('2020-01-01 open Assets:Cash USD, EUR "STRICT" ; note')).toEqual({
			'Assets:Cash': { open: '2020-01-01', currencies: ['USD', 'EUR'] },
		});
	});

	it('normalizes slash dates and keeps the latest open and close independently', () => {
		const content = [
			'2020/01/01 open Assets:Cash USD',
			'2021/06/15 close Assets:Cash',
			'2022/03/01 open Assets:Cash CNY',
		].join('\n');
		expect(records(content)).toEqual({
			'Assets:Cash': { open: '2022-03-01', close: '2021-06-15', currencies: ['CNY'] },
		});
	});

	it('same-date later line wins for that directive', () => {
		const content = [
			'2020-01-01 open Assets:Cash USD',
			'2020-01-01 open Assets:Cash EUR',
		].join('\n');
		expect(records(content)).toEqual({
			'Assets:Cash': { open: '2020-01-01', currencies: ['EUR'] },
		});
	});

	it('ignores an earlier close after a later one', () => {
		const content = [
			'2022-01-01 close Assets:Cash',
			'2020-01-01 close Assets:Cash',
		].join('\n');
		expect(records(content)).toEqual({
			'Assets:Cash': { close: '2022-01-01', currencies: [] },
		});
	});

	it('ignores an earlier open after a later one', () => {
		const content = [
			'2022-03-01 open Assets:Cash CNY',
			'2020-01-01 open Assets:Cash USD',
		].join('\n');
		expect(records(content)).toEqual({
			'Assets:Cash': { open: '2022-03-01', currencies: ['CNY'] },
		});
	});
});

describe('isAccountClosed', () => {
	it('is open when there is no close, or a later open reopens it', () => {
		expect(isAccountClosed(undefined)).toBe(false);
		expect(isAccountClosed({ currencies: [] })).toBe(false);
		expect(isAccountClosed({ open: '2020-01-01', currencies: ['USD'] })).toBe(false);
		expect(isAccountClosed({ open: '2022-01-01', close: '2021-01-01', currencies: [] })).toBe(false);
	});

	it('is closed when a close exists and is not superseded by a later open', () => {
		expect(isAccountClosed({ close: '2021-01-01', currencies: [] })).toBe(true);
		expect(isAccountClosed({ open: '2020-01-01', close: '2021-01-01', currencies: [] })).toBe(true);
		expect(isAccountClosed({ open: '2021-01-01', close: '2021-01-01', currencies: [] })).toBe(true);
	});
});

describe('describeAccount', () => {
	it('returns open date and currencies, omitting missing fields', () => {
		expect(describeAccount(undefined)).toBe('');
		expect(describeAccount({ currencies: [] })).toBe('');
		expect(describeAccount({ open: '2020-01-01', currencies: [] })).toBe('opened on 2020-01-01');
		expect(describeAccount({ currencies: ['USD', 'CNY'] })).toBe('currencies: USD, CNY');
		expect(describeAccount({ open: '2020-01-01', currencies: ['USD'] })).toBe(
			'opened on 2020-01-01\ncurrencies: USD'
		);
	});
});

describe('accountTokenAt', () => {
	it('returns the complete token covering the offset, including both ends', () => {
		expect(accountTokenAt('  Assets:Cash  10.00 USD', 2)).toEqual({
			name: 'Assets:Cash',
			from: 2,
			to: 13,
		});
		expect(accountTokenAt('  Assets:Cash  10.00 USD', 13)).toEqual({
			name: 'Assets:Cash',
			from: 2,
			to: 13,
		});
		expect(accountTokenAt('  Assets:Cash  10.00 USD', 1)).toBeNull();
		expect(accountTokenAt('  Assets:Cash  10.00 USD', 14)).toBeNull();
	});

	it('picks the token under the cursor when a line has two accounts', () => {
		const line = 'Assets:Cash Assets:Broker';
		expect(accountTokenAt(line, 0)?.name).toBe('Assets:Cash');
		expect(accountTokenAt(line, 12)?.name).toBe('Assets:Broker');
	});

	it('ignores incomplete prefixes and prose', () => {
		expect(accountTokenAt('Assets:', 3)).toBeNull();
		expect(accountTokenAt('just prose', 3)).toBeNull();
	});

	it('covers non-ASCII segments', () => {
		expect(accountTokenAt('  Expenses:餐饮:午饭  30.00 CNY', 12)).toEqual({
			name: 'Expenses:餐饮:午饭',
			from: 2,
			to: 16,
		});
	});
});

describe('accountHoverCard', () => {
	it('lists open, close and currencies and omits missing fields', () => {
		expect(accountHoverCard('Assets:Cash', undefined)).toEqual({ name: 'Assets:Cash', lines: [] });
		expect(accountHoverCard('Assets:Cash', { currencies: [] })).toEqual({
			name: 'Assets:Cash',
			lines: [],
		});
		expect(
			accountHoverCard('Assets:Cash', {
				open: '2020-01-01',
				close: '2021-01-01',
				currencies: ['USD', 'CNY'],
			})
		).toEqual({
			name: 'Assets:Cash',
			lines: ['opened on 2020-01-01', 'closed on 2021-01-01', 'currencies: USD, CNY'],
		});
	});

	it('omits a close that a later open has superseded', () => {
		expect(
			accountHoverCard('Assets:Cash', {
				open: '2022-01-01',
				close: '2021-01-01',
				currencies: ['CNY'],
			})
		).toEqual({
			name: 'Assets:Cash',
			lines: ['opened on 2022-01-01', 'currencies: CNY'],
		});
	});
});

describe('AccountIndex', () => {
	it('hides closed accounts from prefix matches and keeps posting-only names', () => {
		const index = new AccountIndex();
		index.setFileContent(
			'a.bean',
			[
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'2020-01-01 open Assets:Broker',
				'  Expenses:Food  10.00 USD',
			].join('\n')
		);
		expect(index.match('Assets:')).toEqual(['Assets:Broker']);
		expect(index.match('Expenses:')).toEqual(['Expenses:Food']);
		expect(index.match('Assets:Cash')).toEqual([]);
	});

	it('hides a closed non-ASCII account while keeping its open sibling', () => {
		const index = new AccountIndex();
		index.setFileContent(
			'a.bean',
			[
				'2020-01-01 open Expenses:餐饮:午饭 CNY',
				'2020-01-01 open Expenses:餐饮:晚饭 CNY',
				'2021-01-01 close Expenses:餐饮:晚饭',
			].join('\n')
		);
		expect(index.match('Expenses:餐饮:')).toEqual(['Expenses:餐饮:午饭']);
	});

	it('reports known names including closed and posting-only, and rejects unknown ones', () => {
		const index = new AccountIndex();
		index.setFileContent(
			'a.bean',
			[
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'  Expenses:Food  10.00 USD',
			].join('\n')
		);
		expect(index.has('Assets:Cash')).toBe(true);
		expect(index.has('Expenses:Food')).toBe(true);
		expect(index.has('Expenses:Ghost')).toBe(false);
		index.removeFile('a.bean');
		expect(index.has('Assets:Cash')).toBe(false);
	});

	it('reopens an account when a later open supersedes its close', () => {
		const index = new AccountIndex();
		index.setFileContent(
			'a.bean',
			[
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'2022-01-01 open Assets:Cash CNY',
			].join('\n')
		);
		expect(index.match('Assets:')).toEqual(['Assets:Cash']);
		expect(index.record('Assets:Cash')).toEqual({
			open: '2022-01-01',
			close: '2021-01-01',
			currencies: ['CNY'],
		});
	});

	it('merges open and close across files by latest date', () => {
		const index = new AccountIndex();
		index.setFileContent('open.bean', '2020-01-01 open Assets:Cash USD');
		index.setFileContent('close.bean', '2021-01-01 close Assets:Cash');
		expect(index.match('Assets:')).toEqual([]);
		index.removeFile('close.bean');
		expect(index.match('Assets:')).toEqual(['Assets:Cash']);
	});

	it('skips closed names when filling the popup window', () => {
		const index = new AccountIndex();
		const closed = Array.from({ length: 60 }, (_, i) => {
			const name = `Assets:Z${String(i).padStart(2, '0')}`;
			return `2020-01-01 open ${name}\n2021-01-01 close ${name}`;
		});
		const open = Array.from({ length: 3 }, (_, i) => `2020-01-01 open Assets:A${i}`);
		index.setFileContent('a.bean', [...closed, ...open].join('\n'));
		expect(index.match('Assets:')).toEqual(['Assets:A0', 'Assets:A1', 'Assets:A2']);
	});

	it('re-keys directives on rename so a moved close still hides the account', () => {
		const index = new AccountIndex();
		index.setFileContent('dir/a.bean', '2020-01-01 open Assets:Cash USD');
		index.setFileContent('dir/b.bean', '2021-01-01 close Assets:Cash');
		expect(index.renameFile('dir', 'moved')).toBe(true);
		expect(index.match('Assets:')).toEqual([]);
		index.removeFile('moved/b.bean');
		expect(index.match('Assets:')).toEqual(['Assets:Cash']);
	});

	it('keeps the latest open and close when several files declare the same account', () => {
		const index = new AccountIndex();
		index.setFileContent('a.bean', '2020-01-01 open Assets:Cash USD');
		index.setFileContent('b.bean', '2022-01-01 open Assets:Cash CNY');
		index.setFileContent('c.bean', '2021-01-01 open Assets:Cash EUR');
		expect(index.record('Assets:Cash')).toEqual({ open: '2022-01-01', currencies: ['CNY'] });
		index.setFileContent('d.bean', '2021-01-01 close Assets:Cash');
		index.setFileContent('e.bean', '2023-01-01 close Assets:Cash');
		index.setFileContent('f.bean', '2022-06-01 close Assets:Cash');
		expect(index.record('Assets:Cash')).toEqual({
			open: '2022-01-01',
			close: '2023-01-01',
			currencies: ['CNY'],
		});
		expect(index.match('Assets:')).toEqual([]);
	});

	it('caps still-open matches at the popup window', () => {
		const index = new AccountIndex();
		const accounts = Array.from({ length: 60 }, (_, i) => `2020-01-01 open Assets:A${String(i).padStart(2, '0')}`);
		index.setFileContent('a.bean', accounts.join('\n'));
		expect(index.match('Assets:')).toEqual(
			Array.from({ length: 50 }, (_, i) => `Assets:A${String(i).padStart(2, '0')}`)
		);
	});

	it('drops posting-only names without clearing other lifecycle', () => {
		const index = new AccountIndex();
		index.setFileContent('a.bean', '2020-01-01 open Assets:Cash USD');
		index.setFileContent('b.bean', '  Expenses:Food  10.00 USD');
		index.removeFile('b.bean');
		expect(index.match('Expenses:')).toEqual([]);
		expect(index.match('Assets:')).toEqual(['Assets:Cash']);
	});

	it('re-keys a posting-only file and ignores unknown renames', () => {
		const index = new AccountIndex();
		index.setFileContent('a.bean', '  Expenses:Food  10.00 USD');
		index.setFileContent('keep.bean', '2020-01-01 open Assets:Cash USD');
		expect(index.renameFile('missing.bean', 'gone.bean')).toBe(false);
		expect(index.renameFile('a.bean', 'b.bean')).toBe(true);
		expect(index.match('Expenses:')).toEqual(['Expenses:Food']);
		expect(index.match('Assets:')).toEqual(['Assets:Cash']);
	});

	it('indexes a note’s beancount fences but not its prose', () => {
		const index = new AccountIndex();
		index.setFileContent(
			'note.md',
			[
				'LangGraph长期记忆SDK:Semantic and PG_DATA_DIR:-supabase-db-data',
				'```beancount',
				'2020-01-01 open Assets:Cash USD',
				'  Expenses:Food  10.00 USD',
				'```',
			].join('\n')
		);
		index.setFileContent('ledger.bean', '; Notes:Prose in a ledger comment still counts');
		expect(index.match('')).toEqual(['Assets:Cash', 'Expenses:Food', 'Notes:Prose']);
		expect(index.record('Assets:Cash')).toEqual({ open: '2020-01-01', currencies: ['USD'] });
		expect(index.has('PG_DATA_DIR:-supabase-db-data')).toBe(false);
	});
});
