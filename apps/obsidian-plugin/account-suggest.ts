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
import { describeAccount } from './account-index';
import type { AccountQuery } from './ledger-index';
import { IndexSuggest, ownSlot } from './suggest';

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
		const slot = ownSlot('account', cursor, editor, file, true);
		if (!slot) return null;
		return this.triggerInfo(cursor, slot);
	}
}
