/**
 * Account completion: an `IndexSuggest` popup fed by `AccountIndex`.
 *
 * Typing an account-shaped token (`Assets:Ca…`) triggers a prefix-match
 * popup over still-open account names cached from the vault; picking one
 * replaces the typed token in place. Closed accounts (a `close` not
 * superseded by a later `open`) are omitted. The popup subtitle shows
 * open date and constrained currencies when the ledger declared them.
 */
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { ACCOUNT_PREFIX_RE, describeAccount } from './account-index';
import type { AccountIndex } from './account-index';
import { PAYEE_PREFIX_RE } from './payee-index';
import { IndexSuggest } from './suggest';

export class AccountSuggest extends IndexSuggest {
	constructor(
		app: App,
		private readonly accounts: AccountIndex
	) {
		super(app, accounts);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
		const detail = describeAccount(this.accounts.record(value));
		if (detail.length === 0) return;
		el.createDiv({ text: detail, cls: 'beancount-account-suggest-meta' });
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Mid-token edits (a word character right after the cursor) would make
		// selection replace only the typed prefix and garble the rest.
		const after = line.charAt(cursor.ch);
		if (after !== '' && /[A-Za-z0-9\-_:]/.test(after)) return null;
		const prefix = line.slice(0, cursor.ch);
		// Inside a transaction's first quoted field the payee suggest owns the
		// popup: `"Exp` there is payee text, not an account — the quote is an
		// account-token boundary, so without this the account popup would
		// hijack the payee field and Enter would insert an account name.
		if (PAYEE_PREFIX_RE.test(prefix)) return null;
		const match = ACCOUNT_PREFIX_RE.exec(prefix);
		if (!match) return null;
		return this.triggerInfo(cursor, match[1]);
	}
}
