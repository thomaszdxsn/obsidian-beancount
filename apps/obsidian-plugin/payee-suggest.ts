/**
 * Payee completion: an `IndexSuggest` popup fed by the vault payee index
 * (`VaultIndex` over `extractPayees`).
 *
 * Typing the first quoted field of a transaction line (`2026-09-30 * "Am…`)
 * triggers a prefix-match popup over every payee cached from the vault;
 * picking one replaces the typed text inside the quotes.
 */
import type { Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { PAYEE_PREFIX_RE } from './payee-index';
import { IndexSuggest } from './suggest';

export class PayeeSuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Mid-field edits (any character but the closing quote right after the
		// cursor) would make selection replace only the typed prefix and garble
		// the rest of the field.
		const after = line.charAt(cursor.ch);
		if (after !== '' && after !== '"') return null;
		const match = PAYEE_PREFIX_RE.exec(line.slice(0, cursor.ch));
		if (!match) return null;
		return this.triggerInfo(cursor, match[1]);
	}
}
