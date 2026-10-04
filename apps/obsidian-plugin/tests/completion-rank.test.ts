import { describe, expect, it } from 'vitest';
import { extractAccounts } from '../account-index';
import { AccountIndex } from '../account-index';
import { CompletionUsage, rankCompletions } from '../completion-rank';
import { MAX_SUGGESTIONS, VaultIndex } from '../vault-index';

const HOUR = 36e5;

describe('CompletionUsage.parse', () => {
	it('loads counts and lastUsed from plugin data', () => {
		const usage = CompletionUsage.parse({
			completionUsage: {
				'Assets:Cash': { count: 3, lastUsed: 1000 },
			},
		});
		expect(usage.score('Assets:Cash', 1000)).toBeGreaterThan(0);
		expect(usage.score('Assets:Broker', 1000)).toBe(0);
	});

	it('ignores corrupt usage bags so ranking stays alphabetical', () => {
		const usage = CompletionUsage.parse({
			completionUsage: {
				'': { count: 9, lastUsed: 1 },
				'Assets:BadCount': { count: 0, lastUsed: 1 },
				'Assets:Float': { count: 1.5, lastUsed: 1 },
				'Assets:NoTime': { count: 2 },
				'Assets:NaN': { count: 2, lastUsed: Number.NaN },
				'Assets:Array': [{ count: 2, lastUsed: 1 }],
				'Assets:Cash': { count: 4, lastUsed: 50 },
			},
		});
		expect(usage.score('Assets:Cash', 50)).toBeGreaterThan(0);
		expect(usage.score('Assets:BadCount', 50)).toBe(0);
		expect(usage.score('Assets:Float', 50)).toBe(0);
		expect(usage.score('Assets:NoTime', 50)).toBe(0);
		expect(usage.score('Assets:NaN', 50)).toBe(0);
		expect(CompletionUsage.parse(null).toJSON()).toEqual({});
		expect(CompletionUsage.parse('nope').toJSON()).toEqual({});
		expect(CompletionUsage.parse({ completionUsage: 'nope' }).toJSON()).toEqual({});
		expect(CompletionUsage.parse({ completionUsage: [] }).toJSON()).toEqual({});
	});

	it('serializes only remembered strings', () => {
		const usage = CompletionUsage.parse({}, () => 10);
		usage.remember('Assets:Cash');
		expect(usage.toJSON()).toEqual({ 'Assets:Cash': { count: 1, lastUsed: 10 } });
		usage.remember('Assets:Cash');
		expect(usage.toJSON()).toEqual({ 'Assets:Cash': { count: 2, lastUsed: 10 } });
	});

	it('ignores an empty pick and notifies onChange for a real one', () => {
		let writes = 0;
		const usage = CompletionUsage.parse({}, () => 3, () => {
			writes += 1;
		});
		usage.remember('');
		expect(usage.toJSON()).toEqual({});
		expect(writes).toBe(0);
		usage.remember('Assets:Cash');
		expect(writes).toBe(1);
	});
});

describe('rankCompletions', () => {
	const names = ['Assets:Broker:IBKR', 'Assets:Cash:Wallet', 'Expenses:Food'];

	it('keeps code-point order when nothing has been used', () => {
		expect(rankCompletions(names, 'Assets:')).toEqual([
			'Assets:Broker:IBKR',
			'Assets:Cash:Wallet',
		]);
		expect(rankCompletions(names, '')).toEqual(names);
	});

	it('ranks prefix matches ahead of subsequence matches', () => {
		const usage = CompletionUsage.parse(
			{
				completionUsage: {
					'Assets:Cash:Wallet': { count: 99, lastUsed: 1 },
				},
			},
			() => 1
		);
		// "fo" prefixes nothing; it is a subsequence of Expenses:Food.
		expect(rankCompletions(['Assets:Cash:Wallet', 'Expenses:Food'], 'fo', usage)).toEqual([
			'Expenses:Food',
		]);
		// Prefix "e" (Expenses:Food) beats a hot subsequence hit inside Assets:*.
		expect(rankCompletions(names, 'e', usage)).toEqual([
			'Expenses:Food',
			'Assets:Cash:Wallet',
			'Assets:Broker:IBKR',
		]);
	});

	it('breaks prefix ties by frecency, then code-point order', () => {
		const usage = CompletionUsage.parse(
			{
				completionUsage: {
					'Assets:Cash:Wallet': { count: 2, lastUsed: 1 },
				},
			},
			() => 1
		);
		expect(rankCompletions(names, 'Assets:', usage)).toEqual([
			'Assets:Cash:Wallet',
			'Assets:Broker:IBKR',
		]);
	});

	it('prefers a more recent pick over an older one with the same count', () => {
		const now = 30 * 24 * HOUR;
		const usage = CompletionUsage.parse(
			{
				completionUsage: {
					'Assets:Broker:IBKR': { count: 2, lastUsed: 0 },
					'Assets:Cash:Wallet': { count: 2, lastUsed: now },
				},
			},
			() => now
		);
		expect(rankCompletions(names, 'Assets:', usage)).toEqual([
			'Assets:Cash:Wallet',
			'Assets:Broker:IBKR',
		]);
	});

	it('orders same-count picks from newest recency bucket to oldest', () => {
		const now = 40 * 24 * HOUR;
		const names = ['Assets:A', 'Assets:B', 'Assets:C', 'Assets:D', 'Assets:E', 'Assets:F'];
		const usage = CompletionUsage.parse(
			{
				completionUsage: {
					'Assets:A': { count: 1, lastUsed: now },
					'Assets:B': { count: 1, lastUsed: now - 5 * HOUR },
					'Assets:C': { count: 1, lastUsed: now - 2 * 24 * HOUR },
					'Assets:D': { count: 1, lastUsed: now - 4 * 24 * HOUR },
					'Assets:E': { count: 1, lastUsed: now - 10 * 24 * HOUR },
					'Assets:F': { count: 1, lastUsed: 0 },
				},
			},
			() => now
		);
		expect(rankCompletions(names, 'Assets:', usage)).toEqual(names);
	});
	it('lets a hot name surface inside the popup cap', () => {
		const accounts = Array.from({ length: 60 }, (_, i) => `Assets:A${String(i).padStart(2, '0')}`);
		const hot = accounts[59];
		const usage = CompletionUsage.parse(
			{ completionUsage: { [hot]: { count: 5, lastUsed: 1 } } },
			() => 1
		);
		const ranked = rankCompletions(accounts, 'Assets:', usage);
		expect(ranked).toHaveLength(MAX_SUGGESTIONS);
		expect(ranked[0]).toBe(hot);
		expect(ranked).not.toContain(accounts[49]);
	});
});

describe('VaultIndex.match ranking', () => {
	it('returns subsequence hits after prefixes', () => {
		const index = new VaultIndex(extractAccounts);
		index.setFileContent('a.md', 'Assets:Cash:Wallet Expenses:Food');
		expect(index.match('fd')).toEqual(['Expenses:Food']);
		expect(index.match('e')).toEqual(['Expenses:Food', 'Assets:Cash:Wallet']);
	});
	it('promotes a remembered prefix match', () => {
		const usage = CompletionUsage.parse({}, () => 1);
		const index = new VaultIndex(extractAccounts, usage);
		index.setFileContent('a.md', 'Assets:Broker:IBKR Assets:Cash:Wallet');
		index.remember?.('Assets:Cash:Wallet');
		expect(index.match('Assets:')).toEqual(['Assets:Cash:Wallet', 'Assets:Broker:IBKR']);
	});
});

describe('AccountIndex.match ranking', () => {
	it('still hides closed accounts when they were frequently picked', () => {
		const usage = CompletionUsage.parse(
			{
				completionUsage: {
					'Assets:Cash': { count: 9, lastUsed: 1 },
				},
			},
			() => 1
		);
		const index = new AccountIndex(usage);
		index.setFileContent(
			'a.bean',
			[
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'2020-01-01 open Assets:Broker',
			].join('\n')
		);
		expect(index.match('Assets:')).toEqual(['Assets:Broker']);
		expect(index.match('as')).toEqual(['Assets:Broker']);
	});

	it('ranks still-open accounts by frecency', () => {
		const usage = CompletionUsage.parse({}, () => 1);
		const index = new AccountIndex(usage);
		index.setFileContent(
			'a.bean',
			['2020-01-01 open Assets:Broker', '2020-01-01 open Assets:Cash'].join('\n')
		);
		index.remember?.('Assets:Cash');
		expect(index.match('Assets:')).toEqual(['Assets:Cash', 'Assets:Broker']);
	});
});
