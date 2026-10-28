import { describe, expect, it } from 'vitest';
import { PAYEE_PREFIX_RE, transactionPayee } from '../payee-index';

describe('transactionPayee', () => {
	it('returns the first quoted field of a transaction line', () => {
		expect(transactionPayee('2026-09-30 * "Whole Foods" "Groceries"')).toBe('Whole Foods');
		expect(transactionPayee('2026-09-30 * "Say \\"hi\\"" "N"')).toBe('Say \\"hi\\"');
		expect(transactionPayee('2026-09-30 * "" "Narration only"')).toBeNull();
		expect(transactionPayee('2026-09-30 open Assets:Cash "x"')).toBeNull();
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
