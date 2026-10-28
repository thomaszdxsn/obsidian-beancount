import { describe, expect, it } from 'vitest';
import { isTextFile } from '../vault-index';

describe('isTextFile', () => {
	it('accepts markdown and ledger extensions', () => {
		expect(isTextFile({ path: 'a.md', extension: 'md' })).toBe(true);
		expect(isTextFile({ path: 'a.bean', extension: 'bean' })).toBe(true);
		expect(isTextFile({ path: 'a.beancount', extension: 'beancount' })).toBe(true);
	});

	it('rejects other extensions including prototype names', () => {
		expect(isTextFile({ path: 'd.png', extension: 'png' })).toBe(false);
		expect(isTextFile({ path: 'a.txt', extension: 'txt' })).toBe(false);
		expect(isTextFile({ path: 'trap.constructor', extension: 'constructor' })).toBe(false);
		expect(isTextFile({ path: 'trap.toString', extension: 'toString' })).toBe(false);
	});
});
