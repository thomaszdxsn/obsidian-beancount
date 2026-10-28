import { describe, expect, it } from 'vitest';
import {
	accountHoverCard,
	accountTokenAt,
	describeAccount,
	isAccountClosed,
} from '../account-index';

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
