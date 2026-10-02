/**
 * Instant decimal alignment: typing `.` in a posting amount inserts the
 * decimal point, aligns the amounts of that transaction block onto the
 * separator column, and leaves the caret just after the point. One
 * transaction, so one undo restores the line.
 *
 * The binding claims `.` only when at least one caret would become an
 * amount's decimal point and returns false everywhere else, so typing a
 * period in prose, payees, or an existing fraction is the editor's own.
 * A range selection is a replace, not an insert, and also falls through.
 */
import { EditorSelection, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { blockRangeAt, computeAlignment, isAmountDotInsert } from './align';
import type { LineEdit } from './align';

/** A caret as whole-text offsets; `head` is the active end. */
export interface Caret {
	anchor: number;
	head: number;
}

/** A text replacement in whole-text offsets. */
export interface InstantChange {
	from: number;
	to: number;
	insert: string;
}

export interface InstantPlan {
	/** Line rewrites (dot insert plus gap padding), ordered like a change set. */
	changes: InstantChange[];
	/** Where each caret lands after the changes, in document order. */
	carets: number[];
}

interface LineSpan {
	line: number;
	start: number;
	text: string;
}

function lineSpans(text: string): LineSpan[] {
	const spans: LineSpan[] = [];
	let start = 0;
	let line = 0;
	for (;;) {
		const nl = text.indexOf('\n', start);
		const end = nl === -1 ? text.length : nl;
		spans.push({ line, start, text: text.slice(start, end) });
		if (nl === -1) return spans;
		start = nl + 1;
		line += 1;
	}
}

function lineAt(spans: readonly LineSpan[], offset: number): LineSpan {
	for (const span of spans) {
		if (offset <= span.start + span.text.length) return span;
	}
	return spans[spans.length - 1];
}

/**
 * The `.` handling for `text` and its carets, or null when no caret sits
 * where an amount decimal belongs. Every collapsed caret still receives a
 * `.` once the key is claimed, so multi-cursor does not drop a prose
 * caret's insert; only the blocks that gained an amount decimal are aligned.
 */
export function instantAlignmentPlan(
	text: string,
	carets: readonly Caret[],
	separatorColumn: number
): InstantPlan | null {
	if (carets.some((caret) => caret.anchor !== caret.head)) return null;

	const spans = lineSpans(text);
	const inserts: Array<{ line: number; ch: number; amount: boolean }> = [];
	for (const caret of carets) {
		const span = lineAt(spans, caret.head);
		const ch = caret.head - span.start;
		inserts.push({ line: span.line, ch, amount: isAmountDotInsert(span.text, ch) });
	}
	if (!inserts.some((insert) => insert.amount)) return null;

	const working = spans.map((span) => span.text);
	const dotsOfLine = new Map<number, number[]>();
	for (const insert of inserts) {
		const list = dotsOfLine.get(insert.line) ?? [];
		list.push(insert.ch);
		dotsOfLine.set(insert.line, list);
	}
	for (const [line, chs] of dotsOfLine) {
		chs.sort((a, b) => b - a);
		let next = working[line];
		for (const ch of chs) next = next.slice(0, ch) + '.' + next.slice(ch);
		working[line] = next;
	}

	const targetColumn = Math.max(0, separatorColumn - 1);
	const claimed = new Set<string>();
	const edits: LineEdit[] = [];
	for (const insert of inserts) {
		if (!insert.amount) continue;
		const range = blockRangeAt(working, insert.line);
		const key = `${range.from}:${range.to}`;
		if (claimed.has(key)) continue;
		claimed.add(key);
		edits.push(...computeAlignment(working, range, targetColumn));
	}
	for (const edit of edits) {
		const line = working[edit.line];
		working[edit.line] = line.slice(0, edit.from) + edit.text + line.slice(edit.to);
	}

	const changes: InstantChange[] = [];
	for (const span of spans) {
		if (span.text === working[span.line]) continue;
		changes.push({
			from: span.start,
			to: span.start + span.text.length,
			insert: working[span.line],
		});
	}

	const newStarts: number[] = [];
	let start = 0;
	for (let line = 0; line < working.length; line += 1) {
		newStarts.push(start);
		start += working[line].length + (line + 1 < working.length ? 1 : 0);
	}

	const ordered = [...carets].sort((a, b) => a.head - b.head);
	const landed: number[] = [];
	for (const caret of ordered) {
		const span = lineAt(spans, caret.head);
		const origCh = caret.head - span.start;
		const dots = (dotsOfLine.get(span.line) ?? []).filter((ch) => ch <= origCh).length;
		let ch = origCh + dots;
		for (const edit of edits) {
			if (edit.line !== span.line) continue;
			if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
			else if (ch > edit.from) ch = edit.from + edit.text.length;
		}
		landed.push(newStarts[span.line] + ch);
	}

	return { changes, carets: landed };
}

/** Live settings the period binding reads on each keystroke. */
export interface InstantAlignmentHost {
	settings: { instantAlignment: boolean; separatorColumn: number };
}

/**
 * The `.` keymap binding. `Prec.high` so it is asked before the editor
 * inserts the character, but returning false hands the key straight on.
 */
export function instantAlignmentExtension(host: InstantAlignmentHost): Extension {
	const run = (view: EditorView): boolean => {
		if (!host.settings.instantAlignment) return false;
		const plan = instantAlignmentPlan(
			view.state.doc.toString(),
			view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
			host.settings.separatorColumn
		);
		if (plan === null) return false;
		view.dispatch({
			changes: plan.changes,
			selection: EditorSelection.create(plan.carets.map((head) => EditorSelection.cursor(head))),
			userEvent: 'input.type',
			scrollIntoView: true,
		});
		return true;
	};
	return Prec.high(keymap.of([{ key: '.', run }]));
}
