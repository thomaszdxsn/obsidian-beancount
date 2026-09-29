import { describe, expect, it } from 'vitest';
import { AccountIndex, extractAccounts } from '../account-index';

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

describe('AccountIndex', () => {
	it('caches accounts per file and exposes a sorted union', () => {
		const index = new AccountIndex();
		index.setFileContent('b.md', 'Expenses:Food');
		index.setFileContent('a.md', 'Assets:Cash Expenses:Food');
		expect(index.accounts()).toEqual(['Assets:Cash', 'Expenses:Food']);
		expect(index.accounts()).toBe(index.accounts()); // cached between calls
	});

	it('replaces a file’s accounts when its content changes', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Old');
		index.setFileContent('a.md', 'Assets:New');
		expect(index.accounts()).toEqual(['Assets:New']);
	});

	it('tracks nothing for content without accounts', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash');
		index.setFileContent('a.md', 'just prose, no names');
		expect(index.accounts()).toEqual([]);
		// Account-less files are untracked: a rename needs a fresh read.
		expect(index.renameFile('a.md', 'b.md')).toBe(false);
	});

	it('drops a file’s accounts on removal', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash');
		index.setFileContent('b.md', 'Expenses:Food');
		index.removeFile('a.md');
		expect(index.accounts()).toEqual(['Expenses:Food']);
	});

	it('keeps an account that another file still contains', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash');
		index.setFileContent('b.md', 'Assets:Cash');
		index.removeFile('a.md');
		expect(index.accounts()).toEqual(['Assets:Cash']);
	});

	it('ignores removal of untracked paths', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash');
		index.removeFile('missing.md');
		expect(index.accounts()).toEqual(['Assets:Cash']);
	});

	it('re-keys a renamed file without re-reading its content', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash');
		expect(index.renameFile('a.md', 'b.md')).toBe(true);
		expect(index.accounts()).toEqual(['Assets:Cash']);
		index.removeFile('a.md');
		expect(index.accounts()).toEqual(['Assets:Cash']);
	});

	it('re-keys children on a folder rename', () => {
		const index = new AccountIndex();
		index.setFileContent('dir/a.md', 'Assets:Cash');
		index.setFileContent('other.md', 'Expenses:Food');
		expect(index.renameFile('dir', 'moved')).toBe(true);
		expect(index.accounts()).toEqual(['Assets:Cash', 'Expenses:Food']);
		index.removeFile('moved/a.md');
		expect(index.accounts()).toEqual(['Expenses:Food']);
	});

	it('reports nothing moved for unknown rename sources', () => {
		const index = new AccountIndex();
		expect(index.renameFile('missing.md', 'b.md')).toBe(false);
	});

	it('matches prefixes case-insensitively in sorted order', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash:Wallet Assets:Broker:IBKR');
		expect(index.match('assets:ca')).toEqual(['Assets:Cash:Wallet']);
		expect(index.match('Assets:')).toEqual(['Assets:Broker:IBKR', 'Assets:Cash:Wallet']);
	});

	it('returns every account for an empty query and nothing for a miss', () => {
		const index = new AccountIndex();
		index.setFileContent('a.md', 'Assets:Cash Expenses:Food');
		expect(index.match('')).toEqual(['Assets:Cash', 'Expenses:Food']);
		expect(index.match('Income')).toEqual([]);
	});
});
