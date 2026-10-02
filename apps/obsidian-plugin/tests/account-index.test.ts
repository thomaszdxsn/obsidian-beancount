import { describe, expect, it } from 'vitest';
import {
	AccountIndex,
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
		expect([...extractAccounts('assets:cash Assets: Meeting:Notes')]).toEqual(['Meeting:Notes']);
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
});
