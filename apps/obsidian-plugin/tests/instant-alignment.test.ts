/**
 * Instant alignment: typing `.` in a posting amount inserts the decimal
 * point, lines the transaction block up on the separator column, and leaves
 * the caret just after the point — one transaction, so one undo restores it.
 */
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
	instantAlignmentExtension,
	instantAlignmentPlan,
} from '../instant-alignment';
import type { InstantPlan } from '../instant-alignment';
import type { MockKeymapExtension } from './mocks/codemirror';
import { createView } from './mocks/codemirror';

type Host = { settings: { instantAlignment: boolean; separatorColumn: number } };
type Run = (view: EditorView) => boolean;

function runOf(host: Host): Run {
	const extension = instantAlignmentExtension(host) as unknown as MockKeymapExtension;
	return extension.bindings[0].run as unknown as Run;
}

/** Apply a plan's simultaneous changes from the right, as CodeMirror does. */
function apply(text: string, plan: InstantPlan): string {
	let next = text;
	for (const change of [...plan.changes].sort((a, b) => b.from - a.from)) {
		next = next.slice(0, change.from) + change.insert + next.slice(change.to);
	}
	return next;
}

const COLUMN = 20;

describe('instantAlignmentPlan', () => {
	it('inserts the decimal, pads the amount to the separator column, and parks the caret after the point', () => {
		const text = '2026-10-01 * "S"\n  Assets:Cash 12 USD';
		const caret = text.indexOf('12') + 2;
		const plan = instantAlignmentPlan(text, [{ anchor: caret, head: caret }], COLUMN);
		expect(plan).not.toBeNull();
		const next = apply(text, plan!);
		expect(next).toBe('2026-10-01 * "S"\n  Assets:Cash    12. USD');
		expect(plan!.carets).toEqual([next.indexOf('.') + 1]);
	});

	it('aligns every posting in the cursor’s transaction block to the same column', () => {
		const text = [
			'2026-10-01 * "S"',
			'  Expenses:Food 12 USD',
			'  Assets:Cash -12 USD',
		].join('\n');
		const caret = text.indexOf('12') + 2;
		const next = apply(text, instantAlignmentPlan(text, [{ anchor: caret, head: caret }], COLUMN)!);
		expect(next.split('\n')).toEqual([
			'2026-10-01 * "S"',
			'  Expenses:Food  12. USD',
			'  Assets:Cash   -12 USD',
		]);
	});

	it('does not move a neighbouring transaction', () => {
		const text = [
			'2026-10-01 * "A"',
			'  Assets:Cash 12 USD',
			'2026-10-02 * "B"',
			'  Assets:Cash 34 USD',
		].join('\n');
		const caret = text.indexOf('12') + 2;
		const next = apply(text, instantAlignmentPlan(text, [{ anchor: caret, head: caret }], COLUMN)!);
		expect(next.split('\n')[3]).toBe('  Assets:Cash 34 USD');
		expect(next.split('\n')[1]).toBe('  Assets:Cash    12. USD');
	});

	it('inserts per caret and keeps each one after its own decimal', () => {
		const text = [
			'2026-10-01 * "S"',
			'  Expenses:Food 12 USD',
			'  Assets:Cash -34 USD',
		].join('\n');
		const a = text.indexOf('12') + 2;
		const b = text.indexOf('-34') + 3;
		const plan = instantAlignmentPlan(
			text,
			[
				{ anchor: b, head: b },
				{ anchor: a, head: a },
			],
			COLUMN
		)!;
		const next = apply(text, plan);
		expect(next.split('\n')).toEqual([
			'2026-10-01 * "S"',
			'  Expenses:Food  12. USD',
			'  Assets:Cash   -34. USD',
		]);
		expect(plan.carets).toEqual([next.indexOf('12.') + 3, next.indexOf('-34.') + 4]);
	});

	it('inserts a prose caret’s dot too, without treating it as an amount', () => {
		const text = 'note\n  Assets:Cash 12 USD';
		const prose = 4;
		const amount = text.indexOf('12') + 2;
		const plan = instantAlignmentPlan(
			text,
			[
				{ anchor: prose, head: prose },
				{ anchor: amount, head: amount },
			],
			COLUMN
		)!;
		const next = apply(text, plan);
		expect(next.split('\n')[0]).toBe('note.');
		expect(next.split('\n')[1]).toBe('  Assets:Cash    12. USD');
		expect(plan.carets).toEqual([5, next.lastIndexOf('.') + 1]);
		expect(next[plan.carets[1] - 1]).toBe('.');
	});

	it('has nothing to say outside a posting amount and falls through', () => {
		const prose = 'Hello there';
		expect(instantAlignmentPlan(prose, [{ anchor: 5, head: 5 }], COLUMN)).toBeNull();
		const payee = '2026-10-01 * "Store"';
		expect(instantAlignmentPlan(payee, [{ anchor: 16, head: 16 }], COLUMN)).toBeNull();
		const already = '  Assets:Cash 12.5 USD';
		const insideFraction = already.indexOf('5');
		expect(
			instantAlignmentPlan(already, [{ anchor: insideFraction, head: insideFraction }], COLUMN)
		).toBeNull();
	});

	it('lets a selection fall through, like a replace rather than an insert', () => {
		const text = '  Assets:Cash 12 USD';
		const caret = text.indexOf('12') + 2;
		expect(
			instantAlignmentPlan(text, [{ anchor: caret - 2, head: caret }], COLUMN)
		).toBeNull();
	});

	it('still inserts a decimal when the amount has no commodity yet', () => {
		const text = '  Assets:Cash 12';
		const caret = text.length;
		const next = apply(text, instantAlignmentPlan(text, [{ anchor: caret, head: caret }], COLUMN)!);
		expect(next).toBe('  Assets:Cash    12.');
	});

	it('measures a CJK account as two cells when padding to the column', () => {
		const text = '  Expenses:餐饮 12 USD';
		const caret = text.indexOf('12') + 2;
		const next = apply(text, instantAlignmentPlan(text, [{ anchor: caret, head: caret }], COLUMN)!);
		// `  Expenses:` = 11, `餐饮` = 4 cells → prefix 15; beforeDot 2; target 19
		// → gap of 2 spaces.
		expect(next).toBe('  Expenses:餐饮  12. USD');
	});
});


describe('instantAlignmentExtension', () => {
	const host: Host = { settings: { instantAlignment: true, separatorColumn: COLUMN } };

	it('binds the period key only', () => {
		const extension = instantAlignmentExtension(host) as unknown as MockKeymapExtension;
		expect(extension.bindings.map((binding) => binding.key)).toEqual(['.']);
	});

	it('dispatches the insert and alignment as one transaction', () => {
		const text = '  Assets:Cash 12 USD';
		const caret = text.indexOf('12') + 2;
		const view = createView(text, [{ anchor: caret }]);
		expect(runOf(host)(view as unknown as EditorView)).toBe(true);
		expect(view.dispatched).toHaveLength(1);
		const next = apply(text, view.dispatched[0] as InstantPlan);
		expect(next).toBe('  Assets:Cash    12. USD');
		expect(view.dispatched[0].selection.ranges).toEqual([
			{ anchor: next.indexOf('.') + 1, head: next.indexOf('.') + 1 },
		]);
	});

	it('hands the key back to the editor outside an amount', () => {
		const view = createView('prose', [{ anchor: 5 }]);
		expect(runOf(host)(view as unknown as EditorView)).toBe(false);
		expect(view.dispatched).toEqual([]);
	});

	it('stays out of the way while the setting is off', () => {
		const text = '  Assets:Cash 12 USD';
		const caret = text.indexOf('12') + 2;
		const view = createView(text, [{ anchor: caret }]);
		expect(
			runOf({ settings: { instantAlignment: false, separatorColumn: COLUMN } })(
				view as unknown as EditorView
			)
		).toBe(false);
		expect(view.dispatched).toEqual([]);
	});
});
