import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { postingIndentExtension, postingIndentPlan, wantsIndent } from '../posting-indent';
import { PopoverOpen } from '../slot';
import type { MockKeymapExtension, MockView } from './mocks/codemirror';
import { createView } from './mocks/codemirror';

const BEAN_FILE = { path: 'ledger.bean', extension: 'bean' };
const NOTE_FILE = { path: 'note.md', extension: 'md' };

function attachFile(view: MockView, file: { path: string; extension: string }): MockView {
	(view.state as { field?: (spec?: unknown, required?: boolean) => { file: typeof file } }).field = () => ({
		file,
	});
	return view;
}

type Run = (view: EditorView) => boolean;

function runOf(popovers: PopoverOpen = new PopoverOpen()): Run {
	const extension = postingIndentExtension(popovers) as unknown as MockKeymapExtension;
	return extension.bindings[0].run as unknown as Run;
}

describe('wantsIndent', () => {
	it('indents the line after a dated entry header', () => {
		// Postings follow the transaction header; entry metadata follows any
		// dated directive.
		expect(wantsIndent(['2026-10-01 * "Store"'], 0)).toBe(true);
		expect(wantsIndent(['2026-10-01 txn "Store" "food"'], 0)).toBe(true);
		expect(wantsIndent(['2026-10-01* "Store"'], 0)).toBe(true);
		expect(wantsIndent(['2026-01-01 open Assets:Cash USD'], 0)).toBe(true);
		expect(wantsIndent(['2026-01-01 balance Assets:Cash 10.00 USD'], 0)).toBe(true);
	});

	it('indents the next line of an entry that is already open', () => {
		expect(wantsIndent(['2026-10-01 * "Store"', '  Assets:Cash  12.5 USD'], 1)).toBe(true);
		expect(wantsIndent(['2026-10-01 * "Store"', '  note: "bought coffee"'], 1)).toBe(true);
		expect(wantsIndent(['2026-10-01 * "Store"', '  ; inner note'], 1)).toBe(true);
	});

	it('never indents a blank line, so Enter leaves the entry', () => {
		expect(wantsIndent(['2026-10-01 * "Store"', ''], 1)).toBe(false);
		expect(wantsIndent(['2026-10-01 * "Store"', '   '], 1)).toBe(false);
	});

	it('leaves prose, directives and loose indented text alone', () => {
		expect(wantsIndent(['prose'], 0)).toBe(false);
		expect(wantsIndent(['include "other.bean"'], 0)).toBe(false);
		expect(wantsIndent(['; note'], 0)).toBe(false);
		// Not a dated entry: the boundary is what the syntax mode enforces.
		expect(wantsIndent(['2026-01-01open Assets:Cash'], 0)).toBe(false);
		expect(wantsIndent(['2026-01-01 was a good day'], 0)).toBe(false);
		// An indented run with no dated entry above it is loose text.
		expect(wantsIndent(['prose', '  Assets:Cash'], 1)).toBe(false);
		// A column-0 comment or blank line closes the entry first.
		expect(wantsIndent(['; note', '  Assets:Cash'], 1)).toBe(false);
		expect(wantsIndent(['2026-10-01 * "Store"', '', '  Assets:Cash'], 2)).toBe(false);
		expect(wantsIndent([], 0)).toBe(false);
	});

	it('does not look past a fence boundary when a ledger-line filter is given', () => {
		const lines = ['2026-10-14 open questions', '   ```beancount', '  Assets:Cash', '```'];
		const inFence = (i: number) => i === 2;
		expect(wantsIndent(lines, 2, inFence)).toBe(false);
		expect(wantsIndent(['```beancount', '2026-10-01 * "Store"', '```'], 1, (i) => i === 1)).toBe(true);
	});
});

describe('postingIndentPlan', () => {
	it('opens the continuation line of an entry with the indent', () => {
		const text = '2026-10-01 * "Store"';
		expect(postingIndentPlan(text, [{ anchor: 20, head: 20 }])).toEqual({
			changes: [{ from: 20, to: 20, insert: '\n  ' }],
			carets: [23],
		});
	});

	it('splits a line and indents the tail that follows the caret', () => {
		const text = '2026-10-01 * "Store"\n  Assets:Cash  12.5 USD';
		// The caret right before the amount.
		expect(postingIndentPlan(text, [{ anchor: 36, head: 36 }])).toEqual({
			changes: [{ from: 36, to: 36, insert: '\n  ' }],
			carets: [39],
		});
	});

	it('replaces a selection with the newline, like the editor does', () => {
		const text = '2026-10-01 * "Store"';
		// The quoted field selected end to end, as before retyping it.
		expect(postingIndentPlan(text, [{ anchor: 13, head: 20 }])).toEqual({
			changes: [{ from: 13, to: 20, insert: '\n  ' }],
			carets: [16],
		});
	});

	it('indents per caret and orders the result by position', () => {
		const text = '2026-10-01 * "S"\nprose';
		// One caret inside the entry, one in the prose below: the entry caret
		// gets the indent, the other a plain newline. Input order is reversed
		// — change sets and selections must come out sorted.
		expect(
			postingIndentPlan(text, [
				{ anchor: 22, head: 22 },
				{ anchor: 16, head: 16 },
			])
		).toEqual({
			changes: [
				{ from: 16, to: 16, insert: '\n  ' },
				{ from: 22, to: 22, insert: '\n' },
			],
			carets: [19, 26],
		});
	});

	it('shifts later carets by what the earlier inserts did', () => {
		const text = '2026-10-01 * "S"\n  Assets:Cash  12.5 USD';
		// Two carets on one line: the second lands past both indents.
		expect(
			postingIndentPlan(text, [
				{ anchor: 22, head: 22 },
				{ anchor: 35, head: 35 },
			])
		).toEqual({
			changes: [
				{ from: 22, to: 22, insert: '\n  ' },
				{ from: 35, to: 35, insert: '\n  ' },
			],
			carets: [25, 41],
		});
	});

	it('shifts later carets past a replaced selection, not into its deleted span', () => {
		const text = '2026-01-01 * "A"\n  Assets:Cash';
		// `"Assets"` selected (6 chars) and a caret at the end of the line.
		// The deletion shortens the document by 3, so the later caret lands
		// at 30 = end of the new text — not 33, past its end.
		expect(
			postingIndentPlan(text, [
				{ anchor: 19, head: 25 },
				{ anchor: 30, head: 30 },
			])
		).toEqual({
			changes: [
				{ from: 19, to: 25, insert: '\n  ' },
				{ from: 30, to: 30, insert: '\n  ' },
			],
			carets: [22, 30],
		});
	});

	it('lets the line the edit starts on decide the indent', () => {
		const text = '2026-10-01 * "S"\n  Assets:Cash\nprose';
		// From inside the entry to the end of the prose below: the newline
		// splits the posting line, so the entry continues — in either
		// selection direction.
		const forward = postingIndentPlan(text, [{ anchor: 25, head: 36 }]);
		expect(forward).toEqual({
			changes: [{ from: 25, to: 36, insert: '\n  ' }],
			carets: [28],
		});
		expect(postingIndentPlan(text, [{ anchor: 36, head: 25 }])).toEqual(forward);
		// From the prose above into the entry: the edit starts outside, so
		// Enter stays the editor's own.
		const outside = 'prose\n2026-10-01 * "S"\n  Assets:Cash';
		expect(postingIndentPlan(outside, [{ anchor: 2, head: 30 }])).toBeNull();
	});

	it('has nothing to say outside entries and falls through', () => {
		// Every caret on plain text or a blank line: the editor's own Enter
		// handling does the work.
		expect(postingIndentPlan('prose', [{ anchor: 5, head: 5 }])).toBeNull();
		expect(postingIndentPlan('2026-10-01 * "S"\n', [{ anchor: 17, head: 17 }])).toBeNull();
		expect(postingIndentPlan('2026-10-01 * "S"\n  ', [{ anchor: 19, head: 19 }])).toBeNull();
		expect(
			postingIndentPlan('prose\n  Assets:Cash', [
				{ anchor: 0, head: 0 },
				{ anchor: 19, head: 19 },
			])
		).toBeNull();
	});
});

describe('postingIndentExtension', () => {
	it('binds plain Enter only', () => {
		const extension = postingIndentExtension(new PopoverOpen()) as unknown as MockKeymapExtension;
		expect(extension.bindings.map((binding) => binding.key)).toEqual(['Enter']);
	});

	it('dispatches the indent and claims the key inside an entry', () => {
		const view = attachFile(createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]), BEAN_FILE);
		expect(runOf()(view as unknown as EditorView)).toBe(true);
		expect(view.dispatched).toEqual([
			{
				changes: [{ from: 20, to: 20, insert: '\n  ' }],
				selection: { ranges: [{ anchor: 23, head: 23 }] },
			},
		]);
	});

	it('hands the key back to the editor outside entries', () => {
		const view = attachFile(createView('prose', [{ anchor: 5, head: 5 }]), BEAN_FILE);
		expect(runOf()(view as unknown as EditorView)).toBe(false);
		expect(view.dispatched).toEqual([]);
	});

	it('lets an open completion popover keep Enter', () => {
		const suggest: { context: unknown } = { context: null };
		const popovers = new PopoverOpen();
		popovers.add(suggest);
		const run = runOf(popovers);
		suggest.context = {};
		const open: MockView = attachFile(
			createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]),
			BEAN_FILE
		);
		expect(run(open as unknown as EditorView)).toBe(false);
		expect(open.dispatched).toEqual([]);
		suggest.context = null;
		const closed: MockView = attachFile(
			createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]),
			BEAN_FILE
		);
		expect(run(closed as unknown as EditorView)).toBe(true);
		expect(closed.dispatched).toHaveLength(1);
	});

	it('hands Enter back in a markdown note outside fences', () => {
		const text = '2026-10-14 open questions';
		const view = attachFile(createView(text, [{ anchor: text.length, head: text.length }]), NOTE_FILE);
		expect(runOf()(view as unknown as EditorView)).toBe(false);
		expect(view.dispatched).toEqual([]);
	});

	it('indents inside a beancount fence and not from a header above the opener', () => {
		const inside = ['# note', '```beancount', '2026-10-01 * "Store"', '```'].join('\n');
		const caret = inside.indexOf('"Store"') + '"Store"'.length;
		const view = attachFile(createView(inside, [{ anchor: caret, head: caret }]), NOTE_FILE);
		expect(runOf()(view as unknown as EditorView)).toBe(true);
		expect(view.dispatched[0].changes[0].insert).toBe('\n  ');

		const crossed = ['2026-10-14 open questions', '   ```beancount', '  Assets:Cash', '```'].join('\n');
		const body = crossed.indexOf('Assets:Cash') + 'Assets:Cash'.length;
		const isolated = attachFile(createView(crossed, [{ anchor: body, head: body }]), NOTE_FILE);
		expect(runOf()(isolated as unknown as EditorView)).toBe(false);
	});

	it('indents inside ~~~bean, indented, and unclosed fences', () => {
		for (const lines of [
			['prose', '~~~bean', '2026-10-01 * "Store"'],
			['prose', '  ```bean', '2026-10-01 * "Store"'],
			['prose', '```beancount', '2026-10-01 * "Store"'],
		]) {
			const text = lines.join('\n');
			const caret = text.length;
			const view = attachFile(createView(text, [{ anchor: caret, head: caret }]), NOTE_FILE);
			expect(runOf()(view as unknown as EditorView)).toBe(true);
		}
	});
});
