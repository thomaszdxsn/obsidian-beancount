import { describe, expect, it } from 'vitest';
import { extractPayees, PAYEE_PREFIX_RE } from '../payee-index';

describe('extractPayees', () => {
	it('extracts the first quoted field of transaction lines', () => {
		const content = [
			'2026-09-30 * "Whole Foods" "Groceries"',
			'2026-10-01 ! "Shell" "Fuel"',
			'2026-10-02 txn "Landlord" "Rent"',
		].join('\n');
		expect([...extractPayees(content)].sort()).toEqual(['Landlord', 'Shell', 'Whole Foods']);
	});

	it('ignores the second quoted field (the narration)', () => {
		expect([...extractPayees('2026-09-30 * "Whole Foods" "Groceries at Whole Foods"')]).toEqual(['Whole Foods']);
	});

	it('indexes the first quoted field of one-string entries too', () => {
		// Beancount reads a lone string as the narration, but it sits in the
		// same field that is completed, so it is indexed like any other.
		expect([...extractPayees('2026-09-30 * "Rent"')]).toEqual(['Rent']);
	});

	it('deduplicates payees inside one file', () => {
		const content = '2026-09-30 * "Shell" "a"\n2026-10-01 * "Shell" "b"';
		expect([...extractPayees(content)]).toEqual(['Shell']);
	});

	it('accepts slash-separated dates and the flag right after the date', () => {
		expect([...extractPayees('2026/09/30 *"Payee" "N"')]).toEqual(['Payee']);
	});

	it('accepts tabs between the date, flag and string', () => {
		expect([...extractPayees('2026-09-30\t*\t"Payee" "N"')]).toEqual(['Payee']);
	});

	it('keeps punctuation and spaces inside the payee verbatim', () => {
		const content = '2026-09-30 * "Joe\'s Cafe, Inc. (24h)" "N"';
		expect([...extractPayees(content)]).toEqual(["Joe's Cafe, Inc. (24h)"]);
	});

	it('keeps escapes as written', () => {
		expect([...extractPayees('2026-09-30 * "Say \\"hi\\"" "N"')]).toEqual(['Say \\"hi\\"']);
	});

	it('skips empty payee fields', () => {
		expect([...extractPayees('2026-09-30 * "" "Narration only"')]).toEqual([]);
	});

	it('ignores non-transaction entries and their strings', () => {
		const content = [
			'2026-09-30 open Assets:Cash',
			'2026-09-30 note Assets:Cash "a note"',
			'2026-09-30 event "topic" "detail"',
			'2026-09-30 query "name" "SELECT *"',
			'2026-09-30 price USD "why"',
			'option "title" "My Ledger"',
			'include "other.bean"',
			'pushtag #foo',
		].join('\n');
		expect([...extractPayees(content)]).toEqual([]);
	});

	it('ignores postings, metadata and prose with strings', () => {
		const content = [
			'  Expenses:Food  10.00 USD "not a payee"',
			'  note: "metadata"',
			'just a line with "quotes"',
			'  2026-09-30 * "indented entry"',
		].join('\n');
		expect([...extractPayees(content)]).toEqual([]);
	});

	it('ignores a flag-like marker glued to a word', () => {
		expect([...extractPayees('2026-09-30 *tag "Payee" "N"')]).toEqual([]);
	});

	it('does not treat the narration of a later line as the payee', () => {
		// A multi-line string is not indexed (see the module comment), and the
		// line that continues it must not be read as an entry either.
		expect([...extractPayees('2026-09-30 * "Payee\n  still the string"\n2026-10-01 * "Next"')]).toEqual(['Next']);
	});

	it('returns an empty set for empty content', () => {
		expect([...extractPayees('')]).toEqual([]);
	});
});

describe('PAYEE_PREFIX_RE', () => {
	/** `|` marks the cursor; the trigger sees the text before it. */
	function typedBefore(marked: string): string | null {
		const match = PAYEE_PREFIX_RE.exec(marked.slice(0, marked.indexOf('|')));
		return match ? match[1] : null;
	}

	it('matches the field being typed on a transaction line', () => {
		expect(typedBefore('2026-09-30 * "Whole Fo|')).toBe('Whole Fo');
		expect(typedBefore('2026-09-30 txn "|')).toBe('');
		expect(typedBefore('2026-09-30 ! "Shell|')).toBe('Shell');
	});

	it('matches when the cursor sits before the closing quote', () => {
		expect(typedBefore('2026-09-30 * "Whole Foods|"')).toBe('Whole Foods');
	});

	it('matches the raw body with escapes', () => {
		expect(typedBefore('2026-09-30 * "Say \\"hi|')).toBe('Say \\"hi');
	});

	it('does not match the second quoted field', () => {
		expect(typedBefore('2026-09-30 * "Whole Foods" "Groceries at|')).toBeNull();
	});

	it('reports the body up to the cursor inside a closed first field', () => {
		expect(typedBefore('2026-09-30 * "Whole| Foods"')).toBe('Whole');
		expect(typedBefore('2026-09-30 * "Whole| Foods" "N"')).toBe('Whole');
	});

	it('does not match non-transaction lines', () => {
		expect(typedBefore('2026-09-30 open Assets:Cash "x|')).toBeNull();
		expect(typedBefore('2026-09-30 note Assets:Cash "a note|')).toBeNull();
		expect(typedBefore('  Expenses:Food  10.00 USD "not a payee|')).toBeNull();
		expect(typedBefore('just prose "with quotes|')).toBeNull();
	});

	it('does not match an unterminated escape at the cursor', () => {
		expect(typedBefore('2026-09-30 * "Whole\\|')).toBeNull();
	});
});
