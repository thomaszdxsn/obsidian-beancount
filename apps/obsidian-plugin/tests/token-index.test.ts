import { describe, expect, it } from 'vitest';
import {
	extractCommodities,
	extractLinks,
	extractNarrations,
	extractTags,
	COMMODITY_PREFIX_RE,
	LINK_PREFIX_RE,
	NARRATION_PREFIX_RE,
	TAG_PREFIX_RE,
} from '../token-index';

describe('extractCommodities', () => {
	it('extracts the unit commodity of posting lines', () => {
		const content = ['2026-09-30 * "Shell" "Fuel"', '  Assets:Cash  -10.00 USD', '  Expenses:Food  10.00 USD'].join('\n');
		expect([...extractCommodities(content)]).toEqual(['USD']);
	});

	it('extracts both currencies of a price directive', () => {
		expect([...extractCommodities('2026-09-30 price USD 1.10 CAD')]).toEqual(['USD', 'CAD']);
	});

	it('extracts the token of a commodity directive', () => {
		expect([...extractCommodities('2026-09-30 commodity AAPL')]).toEqual(['AAPL']);
	});

	it('extracts cost and price annotations and balance amounts', () => {
		const content = [
			'2026-09-30 * "Buy"',
			'  Assets:Stock  2 AAPL {150.00 USD} @ 1.10 CAD',
			'2026-09-30 balance Assets:Cash 100.00 EUR',
		].join('\n');
		expect([...extractCommodities(content)].sort()).toEqual(['AAPL', 'CAD', 'EUR', 'USD']);
	});

	it('ignores account segments that look like commodities', () => {
		expect([...extractCommodities('  Stocks:AAPL  2 AAPL')]).toEqual(['AAPL']);
	});

	it('ignores lowercase tokens and prose amounts', () => {
		expect([...extractCommodities('paid 10 usd for lunch')]).toEqual([]);
	});

	it('does not read a commodity before the digit-space boundary', () => {
		// `USD` glued to the number without whitespace is not an amount.
		expect([...extractCommodities('  Assets:Cash  10.00USD')]).toEqual([]);
	});

	it('returns an empty set for empty content', () => {
		expect([...extractCommodities('')]).toEqual([]);
	});
});

describe('extractTags', () => {
	it('extracts tags with their sigil', () => {
		expect([...extractTags('2026-09-30 * "P" "N" #trip #london-2026')]).toEqual(['#trip', '#london-2026']);
	});

	it('accepts the sigil characters the syntax mode highlights', () => {
		expect([...extractTags('#a.b-c_d/e')]).toEqual(['#a.b-c_d/e']);
	});

	it('ignores markdown headings', () => {
		expect([...extractTags('# Heading\n## Subheading')]).toEqual([]);
	});

	it('deduplicates tags', () => {
		expect([...extractTags('#trip and again #trip')]).toEqual(['#trip']);
	});

	it('returns an empty set for empty content', () => {
		expect([...extractTags('')]).toEqual([]);
	});
});

describe('extractLinks', () => {
	it('extracts links with their sigil', () => {
		expect([...extractLinks('2026-09-30 * "P" "N" ^trip ^receipt-42')]).toEqual(['^trip', '^receipt-42']);
	});

	it('ignores carets without a name', () => {
		expect([...extractLinks('2 ^ 3')]).toEqual([]);
	});

	it('returns an empty set for empty content', () => {
		expect([...extractLinks('')]).toEqual([]);
	});
});

describe('extractNarrations', () => {
	it('extracts the second quoted field of transaction lines', () => {
		expect([...extractNarrations('2026-09-30 * "Whole Foods" "Groceries"')]).toEqual(['Groceries']);
	});

	it('ignores one-string entries: their field is the payee position', () => {
		expect([...extractNarrations('2026-09-30 * "Groceries"')]).toEqual([]);
	});

	it('ignores the payee field', () => {
		expect([...extractNarrations('2026-09-30 * "Shell" "Fuel"')]).not.toContain('Shell');
	});

	it('skips empty narration fields', () => {
		expect([...extractNarrations('2026-09-30 * "Shell" ""')]).toEqual([]);
	});

	it('ignores non-transaction entries', () => {
		expect([...extractNarrations('2026-09-30 note Assets:Cash "memo"')]).toEqual([]);
	});

	it('returns an empty set for empty content', () => {
		expect([...extractNarrations('')]).toEqual([]);
	});
});

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
