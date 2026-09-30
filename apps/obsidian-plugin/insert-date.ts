/**
 * Date quick-insert: the `Insert today's date` command and its hotkey drop
 * today's date — `YYYY-MM-DD`, the canonical beancount date shape — where the
 * user is typing.
 */
import type { Editor } from 'obsidian';

/**
 * `YYYY-MM-DD` in the local timezone: beancount dates are written with zero
 * padded month and day, and "today" is the user's local day — a ledger entry
 * made just before midnight belongs to the local date, not the UTC one.
 */
export function todayDate(now: Date = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The `Insert today's date` command: overwrite every selection with the date
 * (an empty selection just places it at the caret) and leave the caret after
 * it — `replaceSelection` is Obsidian's own insert-at-cursor primitive and
 * maps the undo stack through the edit.
 */
export function insertTodayDate(editor: Editor): void {
	editor.replaceSelection(todayDate());
}
