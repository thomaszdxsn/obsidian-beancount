/**
 * Posting auto-indent: pressing Enter inside a beancount entry opens the
 * continuation line with the entry's two-space indent already typed.
 *
 * A beancount entry is a dated header at column 0 plus the indented lines
 * under it (`2026-01-01 * "Store"` → `  Assets:Cash  12.5 USD`); every
 * continuation line of the entry starts with two spaces, so Enter does that
 * typing for the user.
 *
 * The Enter binding claims the key only where the indent belongs and returns
 * false everywhere else, so the editor's own Enter behaviour — plain
 * newlines, list continuation, accepting a completion popover — is left
 * untouched. While one of the plugin's own completion popovers is open, Enter
 * belongs to the popover and the binding stays out of the way.
 */
import { EditorSelection, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { blockRangeAt } from './align';
import { DATED_ENTRY_RE } from './beancount-mode';

/** The text Enter inserts where an entry continues: newline plus its indent. */
const ENTRY_INDENT = '\n  ';

/** A caret as whole-text offsets; `head` is the active end. */
export interface Caret {
	anchor: number;
	head: number;
}

/** A text replacement in whole-text offsets. */
export interface IndentChange {
	from: number;
	to: number;
	insert: string;
}

export interface IndentPlan {
	/** Insertions and selection replacements, ordered like a change set. */
	changes: IndentChange[];
	/** Where each caret lands after the changes, ordered like `changes`. */
	carets: number[];
}

/**
 * Whether the next line after `line` (0-based) must start with the entry
 * indent: either the line is a dated entry header, or it continues an entry
 * that is already open. Blank lines never do — Enter on the empty indent must
 * leave the entry instead of stacking empty postings — and loose indented
 * text outside any entry keeps the editor's own Enter behaviour.
 */
export function wantsIndent(lines: readonly string[], line: number): boolean {
	const text = lines[line] ?? '';
	if (DATED_ENTRY_RE.test(text)) return true;
	if (!/^[ \t]/.test(text) || text.trim() === '') return false;
	const { from } = blockRangeAt(lines, line);
	return DATED_ENTRY_RE.test(lines[from] ?? '');
}

/**
 * The Enter handling for `text` and its carets, or null when no caret sits
 * where an indent belongs. Selections are replaced by the newline like the
 * editor's own Enter, and each caret lands after the indent it got.
 */
export function postingIndentPlan(text: string, carets: readonly Caret[]): IndentPlan | null {
	const lines = text.split('\n');
	const lineAt = (at: number): number => {
		let start = 0;
		for (let line = 0; line < lines.length; line += 1) {
			const end = start + lines[line].length;
			if (at <= end) return line;
			start = end + 1;
		}
		return lines.length - 1;
	};

	// Change sets and selections are ordered; multi-caret edits may arrive in
	// any order.
	const ordered = [...carets].sort(
		(a, b) => Math.min(a.anchor, a.head) - Math.min(b.anchor, b.head)
	);
	const changes: IndentChange[] = [];
	const landed: number[] = [];
	let delta = 0;
	let indented = false;
	for (const caret of ordered) {
		const from = Math.min(caret.anchor, caret.head);
		const to = Math.max(caret.anchor, caret.head);
		// The line holding the start of the edit decides: that is the line
		// the newline splits, collapsed carets and single-line selections
		// included.
		const insert = wantsIndent(lines, lineAt(from)) ? ENTRY_INDENT : '\n';
		if (insert === ENTRY_INDENT) indented = true;
		// The caret lands at the end of its insert — after the indent — and
		// everything after this change shifts by what the earlier ones did.
		landed.push(from + insert.length + delta);
		delta += insert.length - (to - from);
		changes.push({ from, to, insert });
	}
	return indented ? { changes, carets: landed } : null;
}

/** A completion popover whose open state decides who owns Enter. */
interface SuggestState {
	context: unknown;
}

/**
 * The `Enter` keymap binding. `Prec.high` so it is asked before the editor's
 * own Enter bindings, but returning false hands the key straight on to them.
 */
export function postingIndentExtension(suggests: readonly SuggestState[]): Extension {
	const run = (view: EditorView): boolean => {
		// Enter accepts the open completion popover, ours included; the
		// indent must not steal the keystroke from under it.
		if (suggests.some((suggest) => suggest.context !== null)) return false;
		const plan = postingIndentPlan(
			view.state.doc.toString(),
			view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head }))
		);
		if (plan === null) return false;
		view.dispatch({
			changes: plan.changes,
			selection: EditorSelection.create(plan.carets.map((head) => EditorSelection.cursor(head))),
		});
		return true;
	};
	return Prec.high(keymap.of([{ key: 'Enter', run }]));
}
