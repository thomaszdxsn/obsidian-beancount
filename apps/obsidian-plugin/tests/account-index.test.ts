import { describe, expect, it } from 'vitest';
import { extractAccounts } from '../account-index';

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
