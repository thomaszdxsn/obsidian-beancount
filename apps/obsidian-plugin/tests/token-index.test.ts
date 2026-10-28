import { describe, expect, it } from 'vitest';
import {
	COMMODITY_PREFIX_RE,
	LINK_PREFIX_RE,
	NARRATION_PREFIX_RE,
	TAG_PREFIX_RE,
} from '../token-index';

describe('COMMODITY_PREFIX_RE', () => {
	it('matches a partial posting unit after the amount', () => {
		expect(COMMODITY_PREFIX_RE.exec('  Assets:Cash  10.00 US')?.[1]).toBe('US');
	});

	it('matches a partial commodity after the price keyword', () => {
		expect(COMMODITY_PREFIX_RE.exec('2026-09-30 price US')?.[1]).toBe('US');
	});

	it('matches a partial token of a commodity directive', () => {
		expect(COMMODITY_PREFIX_RE.exec('2026-09-30 commodity AA')?.[1]).toBe('AA');
	});

	it('matches a single typed letter', () => {
		expect(COMMODITY_PREFIX_RE.exec('  Assets:Cash  10.00 U')?.[1]).toBe('U');
	});

	it('does not match a trailing colon or a bare account tail', () => {
		expect(COMMODITY_PREFIX_RE.test('  Expenses:Fo')).toBe(false);
		expect(COMMODITY_PREFIX_RE.test('  Assets:Cash  10.00 ')).toBe(false);
	});
});

describe('TAG_PREFIX_RE and LINK_PREFIX_RE', () => {
	it('match the sigil plus the partial name', () => {
		expect(TAG_PREFIX_RE.exec('#cr')?.[1]).toBe('cr');
		expect(LINK_PREFIX_RE.exec('^pa')?.[1]).toBe('pa');
		expect(TAG_PREFIX_RE.exec('note #')?.[1]).toBe('');
	});

	it('require the sigil at a token boundary', () => {
		expect(TAG_PREFIX_RE.test('a#cr')).toBe(false);
		expect(LINK_PREFIX_RE.test('a^pa')).toBe(false);
	});
});

describe('NARRATION_PREFIX_RE', () => {
	it('matches an open second field after a closed payee', () => {
		const match = NARRATION_PREFIX_RE.exec('2026-09-30 * "Shell" "Fu');
		expect(match?.[1]).toBe('Fu');
	});

	it('matches right after the opening quote with an empty field', () => {
		expect(NARRATION_PREFIX_RE.exec('2026-09-30 * "Shell" "')?.[1]).toBe('');
	});

	it('keeps escapes as written in the partial narration', () => {
		expect(NARRATION_PREFIX_RE.exec('2026-09-30 * "Shell" "Say \\"hi')?.[1]).toBe('Say \\"hi');
	});

	it('does not match the payee field', () => {
		expect(NARRATION_PREFIX_RE.test('2026-09-30 * "Shel')).toBe(false);
	});
});
