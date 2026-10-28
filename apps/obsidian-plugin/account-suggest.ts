/**
 * Account completion: an `IndexSuggest` popup fed by vault account facts.
 *
 * Typing an account-shaped token (`Assets:Ca…`) triggers a prefix-match
 * popup over still-open account names cached from the vault; picking one
 * replaces the typed token in place. Closed accounts (a `close` not
 * superseded by a later `open`) are omitted. The popup subtitle shows
 * open date and constrained currencies when the ledger declared them.
 */
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { ACCOUNT_CHAR_RE, ACCOUNT_PREFIX_RE, describeAccount } from './account-index';
import type { AccountQuery } from './ledger-index';
import { editorLedger } from './fences';
import { COMMODITY_PREFIX_RE, LINK_PREFIX_RE, TAG_PREFIX_RE } from './token-index';
import { inStringOrComment } from './scan';
import { IndexSuggest } from './suggest';

export class AccountSuggest extends IndexSuggest {
	constructor(
		app: App,
		private readonly accounts: AccountQuery
	) {
		super(app, accounts);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
		const detail = describeAccount(this.accounts.record(value));
		if (detail.length === 0) return;
		el.createDiv({ text: detail, cls: 'beancount-account-suggest-meta' });
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Mid-token edits (an account character right after the cursor, CJK
		// included) would make selection replace only the typed prefix and
		// garble the rest.
		const after = line.charAt(cursor.ch);
		if (after !== '' && ACCOUNT_CHAR_RE.test(after)) return null;
		const prefix = line.slice(0, cursor.ch);
		// `^Tr` / `#Tr` are link/tag text (their sigils are account-token
		// boundaries) and `10.00 U` on a posting is a commodity unit. Payee
		// and narration fields are unclosed strings, so `inStringOrComment`
		// already leaves them to those suggesters.
		if (LINK_PREFIX_RE.test(prefix) || TAG_PREFIX_RE.test(prefix)) return null;
		if (COMMODITY_PREFIX_RE.test(prefix)) return null;
		const match = ACCOUNT_PREFIX_RE.exec(prefix);
		if (!match) return null;
		if (inStringOrComment(prefix) || !editorLedger(editor, file).lineIsLedger(cursor.line)) return null;
		return this.triggerInfo(cursor, match[1]);
	}
}
