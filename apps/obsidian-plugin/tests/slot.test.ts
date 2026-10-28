import { describe, expect, it } from 'vitest';
import { completionSlot, PopoverOpen } from '../slot';
import type { CompletionSlot } from '../slot';

/** `|` marks the cursor. */
function caret(marked: string): { line: string; ch: number } {
	const ch = marked.indexOf('|');
	return { line: marked.replace('|', ''), ch };
}

function slotOf(
	marked: string,
	opts: { lineIsLedger?: boolean; completeNarration?: boolean } = {}
): CompletionSlot | null {
	const { line, ch } = caret(marked);
	return completionSlot({
		line,
		ch,
		lineIsLedger: opts.lineIsLedger ?? true,
		completeNarration: opts.completeNarration ?? true,
	});
}

describe('completionSlot', () => {
	it.each([
		['txn|', { kind: 'snippet', query: 'txn', startCh: 0, endCh: 3 }],
		['tx|', { kind: 'snippet', query: 'tx', startCh: 0, endCh: 2 }],
		['2026-10-04 txn|', null],
		['tx|n', null],
		['  txn|', null],
		['2026-10-02 * "Ex|', { kind: 'payee', query: 'Ex', startCh: 14, endCh: 16 }],
		['  Expenses:Fo|', { kind: 'account', query: 'Expenses:Fo', startCh: 2, endCh: 13 }],
		['2026-09-30 * "Shell" "Fu|', { kind: 'narration', query: 'Fu', startCh: 22, endCh: 24 }],
		['2026-09-30 * "Shel|', { kind: 'payee', query: 'Shel', startCh: 14, endCh: 18 }],
		['  Assets:Ca|', { kind: 'account', query: 'Assets:Ca', startCh: 2, endCh: 11 }],
		['  Assets:Cash  10.00 US|', { kind: 'commodity', query: 'US', startCh: 21, endCh: 23 }],
		['  Assets:Cash  10.00 U|', { kind: 'commodity', query: 'U', startCh: 21, endCh: 22 }],
		['#fo|', { kind: 'tag', query: '#fo', startCh: 0, endCh: 3 }],
		['^re|', { kind: 'link', query: '^re', startCh: 0, endCh: 3 }],
		['2026-09-30 #|', null],
		['2026-09-30 * #|', { kind: 'tag', query: '#', startCh: 13, endCh: 14 }],
		['Assets:|Cash', null],
		['#t|r', null],
		['^r|e', null],
		['10.00 U|S', null],
		['"Who|le Foods"', null],
		['"Fu|el"', null],
		['2026-09-30 * "Shel|"', { kind: 'payee', query: 'Shel', startCh: 14, endCh: 18 }],
		['2026-09-30 * "Shell" "Fu|"', { kind: 'narration', query: 'Fu', startCh: 22, endCh: 24 }],
		['"Shell" "Fix #|', null],
		['; leftover #fo|', null],
		['; see ^re|', null],
		['; bought 10.00 US|', null],
		['  invoice: "#fo|', null],
		['; Assets:Ca|', null],
		['  note: "Assets:Ca|', null],
		['2026-09-30 * "Say \\"hi" #tr|', { kind: 'tag', query: '#tr', startCh: 24, endCh: 27 }],
		['2026-10-04 * "|', { kind: 'payee', query: '', startCh: 14, endCh: 14 }],
	] as const)('%s', (marked, want) => {
		expect(slotOf(marked)).toEqual(want);
	});

	it('stays quiet on a narration field when completeNarration is off', () => {
		expect(slotOf('2026-09-30 * "Shell" "Fu|', { completeNarration: false })).toBeNull();
	});

	it.each(['txn|', '#tr|', '^re|', '  Assets:Cash  10.00 US|'])(
		'stays quiet outside ledger text: %s',
		(marked) => {
			expect(slotOf(marked, { lineIsLedger: false })).toBeNull();
		}
	);
});

describe('PopoverOpen', () => {
	it('is closed until a registered suggest has context, then closed again', () => {
		const popovers = new PopoverOpen();
		const suggest: { context: unknown } = { context: null };
		popovers.add(suggest);
		expect(popovers.isOpen).toBe(false);
		suggest.context = {};
		expect(popovers.isOpen).toBe(true);
		suggest.context = null;
		expect(popovers.isOpen).toBe(false);
	});

	it('is open when any of several registered suggests has context', () => {
		const popovers = new PopoverOpen();
		const a: { context: unknown } = { context: null };
		const b: { context: unknown } = { context: null };
		popovers.add(a);
		popovers.add(b);
		expect(popovers.isOpen).toBe(false);
		b.context = {};
		expect(popovers.isOpen).toBe(true);
		a.context = {};
		b.context = null;
		expect(popovers.isOpen).toBe(true);
	});
});
