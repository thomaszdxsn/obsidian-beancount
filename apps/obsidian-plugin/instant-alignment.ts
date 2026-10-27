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
import { editorInfoField } from 'obsidian';
import { alignmentTarget, blockRangeInLedger, computeAlignment, isAmountDotInsert } from './align';
import type { LineEdit } from './align';
import { ledgerDoc, ledgerKind } from './fences';

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

/** Lines of `text` and the offset each starts at. */
interface Lines {
	text: string[];
	starts: number[];
}

function linesOf(text: string): Lines {
	const lines = text.split('\n');
	const starts = new Array<number>(lines.length);
	let start = 0;
	for (let line = 0; line < lines.length; line += 1) {
		starts[line] = start;
		start += lines[line].length + 1;
	}
	return { text: lines, starts };
}

/** The line holding `offset`: the last one starting at or before it (line 0 before the text). */
function lineAt(lines: Lines, offset: number): number {
	let lo = 0;
	let hi = lines.starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lines.starts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
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
	separatorColumn: number,
	ledgerLine?: (lineIndex: number) => boolean
): InstantPlan | null {
	if (carets.some((caret) => caret.anchor !== caret.head)) return null;

	const lines = linesOf(text);
	const inserts: Array<{ line: number; ch: number; amount: boolean }> = [];
	for (const caret of carets) {
		const line = lineAt(lines, caret.head);
		const ch = caret.head - lines.starts[line];
		inserts.push({ line, ch, amount: isAmountDotInsert(lines.text[line], ch) });
	}
	if (!inserts.some((insert) => insert.amount)) return null;

	const working = lines.text.slice();
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

	const targetColumn = alignmentTarget(separatorColumn);
	const claimed = new Set<string>();
	const edits: LineEdit[] = [];
	for (const insert of inserts) {
		if (!insert.amount) continue;
		const range = blockRangeInLedger(working, insert.line, ledgerLine);
		const key = `${range.from}:${range.to}`;
		if (claimed.has(key)) continue;
		claimed.add(key);
		edits.push(...computeAlignment(working, range, targetColumn, ledgerLine));
	}
	for (const edit of edits) {
		const line = working[edit.line];
		working[edit.line] = line.slice(0, edit.from) + edit.text + line.slice(edit.to);
	}

	// Only lines that got a dot or an edit can differ; in document order.
	const touched = [...new Set([...dotsOfLine.keys(), ...edits.map((edit) => edit.line)])].sort((a, b) => a - b);
	const changes: InstantChange[] = [];
	for (const line of touched) {
		const before = lines.text[line];
		if (before === working[line]) continue;
		changes.push({ from: lines.starts[line], to: lines.starts[line] + before.length, insert: working[line] });
	}
	// Where `line` starts after the changes: shifted by every changed line above it.
	const newStart = (line: number): number => {
		let start = lines.starts[line];
		for (const t of touched) if (t < line) start += working[t].length - lines.text[t].length;
		return start;
	};

	const ordered = [...carets].sort((a, b) => a.head - b.head);
	const landed: number[] = [];
	for (const caret of ordered) {
		const line = lineAt(lines, caret.head);
		const origCh = caret.head - lines.starts[line];
		const dots = (dotsOfLine.get(line) ?? []).filter((ch) => ch <= origCh).length;
		let ch = origCh + dots;
		for (const edit of edits) {
			if (edit.line !== line) continue;
			if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
			else if (ch > edit.from) ch = edit.from + edit.text.length;
		}
		landed.push(newStart(line) + ch);
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
		const carets = view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head }));
		const file = view.state.field(editorInfoField, false)?.file;
		const ld = ledgerDoc(ledgerKind(file), view.state.doc);
		if (!carets.every((caret) => ld.lineIsLedger(view.state.doc.lineAt(caret.head).number - 1))) {
			return false;
		}
		const plan = instantAlignmentPlan(
			view.state.doc.toString(),
			carets,
			host.settings.separatorColumn,
			(lineIndex) => ld.lineIsLedger(lineIndex)
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
