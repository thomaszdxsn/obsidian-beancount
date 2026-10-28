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
import { planInstantDot } from './edits';
import { ledgerDoc, ledgerKind } from './fences';

export type { InstantChange, InstantPlan } from './edits';
export { planInstantDot, instantAlignmentPlan } from './edits';

/** A caret as whole-text offsets; `head` is the active end. */
export interface Caret {
	anchor: number;
	head: number;
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
		const ledger = ledgerDoc(ledgerKind(file), view.state.doc);
		if (!carets.every((caret) => ledger.lineIsLedger(view.state.doc.lineAt(caret.head).number - 1))) {
			return false;
		}
		const plan = planInstantDot(
			view.state.doc.toString(),
			carets,
			host.settings.separatorColumn,
			(lineIndex) => ledger.lineIsLedger(lineIndex),
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
