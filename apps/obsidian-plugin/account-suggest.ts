/**
 * Account completion: an `IndexSuggest` popup fed by the vault account index
 * (`VaultIndex` over `extractAccounts`).
 *
 * Typing an account-shaped token (`Assets:Ca…`) triggers a prefix-match
 * popup over every account name cached from the vault; picking one replaces
 * the typed token in place.
 */
import type { Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { ACCOUNT_PREFIX_RE } from './account-index';
import { IndexSuggest } from './suggest';

export class AccountSuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Mid-token edits (a word character right after the cursor) would make
		// selection replace only the typed prefix and garble the rest.
		const after = line.charAt(cursor.ch);
		if (after !== '' && /[A-Za-z0-9\-_:]/.test(after)) return null;
		const match = ACCOUNT_PREFIX_RE.exec(line.slice(0, cursor.ch));
		if (!match) return null;
		return this.triggerInfo(cursor, match[1]);
	}
}
