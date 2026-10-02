/**
 * Account hover: a CodeMirror tooltip on a known vault account name.
 *
 * Hovering a complete account token shows open/close dates and constrained
 * currencies from `AccountIndex`. Unknown names — tokens the vault has never
 * seen — produce no tooltip. Closed accounts still hover: the card is how
 * their close date is visible. Balances are not computed (same reason as
 * completion).
 */
import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import { accountHoverCard, accountTokenAt } from './account-index';
import type { AccountIndex } from './account-index';

/** The CSS contract between the tooltip and `styles.css`. */
export const ACCOUNT_HOVER_CLASS = 'beancount-account-hover';
export const ACCOUNT_HOVER_NAME_CLASS = 'beancount-account-hover-name';

/** The inner DOM of the account hover card. */
export function renderAccountHover(card: { name: string; lines: readonly string[] }): HTMLElement {
	const dom = document.createElement('div');
	dom.className = ACCOUNT_HOVER_CLASS;
	const title = document.createElement('div');
	title.className = ACCOUNT_HOVER_NAME_CLASS;
	title.textContent = card.name;
	dom.appendChild(title);
	if (card.lines.length === 0) return dom;
	const list = document.createElement('ul');
	for (const line of card.lines) {
		const item = document.createElement('li');
		item.textContent = line;
		list.appendChild(item);
	}
	dom.appendChild(list);
	return dom;
}

/** Tooltip source: a card on a known account token, otherwise nothing. */
export function accountHoverTooltip(accounts: AccountIndex): Extension {
	return hoverTooltip((view, pos) => {
		const line = view.state.doc.lineAt(pos);
		const token = accountTokenAt(line.text, pos - line.from);
		if (!token || !accounts.has(token.name)) return null;
		const card = accountHoverCard(token.name, accounts.record(token.name));
		return {
			pos: line.from + token.from,
			end: line.from + token.to,
			create: () => ({ dom: renderAccountHover(card) }),
		};
	});
}
