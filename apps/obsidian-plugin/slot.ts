/**
 * Completion slot: one pass over a line and caret decides which field owns
 * the keystroke (snippet, payee, narration, tag, link, commodity, account)
 * and the query range. Adapters map a kind onto an index; they do not
 * re-decide ownership or look at the vault.
 */
import { ACCOUNT_CHAR_RE, ACCOUNT_PREFIX_RE } from './account-index';
import { PAYEE_PREFIX_RE } from './payee-index';
import { datedPrefix, inStringOrComment } from './scan';
import { SNIPPETS } from './snippets';
import {
	COMMODITY_CHAR_RE,
	COMMODITY_PREFIX_RE,
	LINK_PREFIX_RE,
	NARRATION_PREFIX_RE,
	TAG_LINK_CHAR_RE,
	TAG_PREFIX_RE,
} from './token-index';

export type SlotKind = 'snippet' | 'payee' | 'narration' | 'account' | 'commodity' | 'tag' | 'link';

export interface CompletionSlot {
	kind: SlotKind;
	query: string;
	startCh: number;
	endCh: number;
}

export function completionSlot(input: {
	line: string;
	ch: number;
	lineIsLedger: () => boolean;
	completeNarration: boolean;
}): CompletionSlot | null {
	const { line, ch } = input;
	const after = line.charAt(ch);
	const prefix = line.slice(0, ch);

	if (after === '' || after === ' ' || after === '\t') {
		if (prefix.length > 0 && !prefix.includes(' ') && !prefix.includes('\t')) {
			if (SNIPPETS.some((snippet) => snippet.prefix.startsWith(prefix))) {
				return input.lineIsLedger() ? { kind: 'snippet', query: prefix, startCh: 0, endCh: ch } : null;
			}
		}
	}

	if (after === '' || after === '"') {
		const payee = PAYEE_PREFIX_RE.exec(prefix);
		if (payee) return input.lineIsLedger() ? found('payee', payee[1], ch) : null;
		if (input.completeNarration) {
			const narration = NARRATION_PREFIX_RE.exec(prefix);
			if (narration) return input.lineIsLedger() ? found('narration', narration[1], ch) : null;
		}
	}

	if (inStringOrComment(prefix)) return null;

	const tag = TAG_PREFIX_RE.exec(prefix);
	if (tag && !(tag[1] === '' && isBareTxnFlag(prefix))) {
		if (after !== '' && TAG_LINK_CHAR_RE.test(after)) return null;
		return input.lineIsLedger() ? found('tag', `#${tag[1]}`, ch) : null;
	}
	const link = LINK_PREFIX_RE.exec(prefix);
	if (link) {
		if (after !== '' && TAG_LINK_CHAR_RE.test(after)) return null;
		return input.lineIsLedger() ? found('link', `^${link[1]}`, ch) : null;
	}
	const commodity = COMMODITY_PREFIX_RE.exec(prefix);
	if (commodity) {
		if (after !== '' && COMMODITY_CHAR_RE.test(after)) return null;
		return input.lineIsLedger() ? found('commodity', commodity[1], ch) : null;
	}

	if (after !== '' && ACCOUNT_CHAR_RE.test(after)) return null;
	const account = ACCOUNT_PREFIX_RE.exec(prefix);
	if (account) return input.lineIsLedger() ? found('account', account[1], ch) : null;
	return null;
}

function found(kind: SlotKind, query: string, endCh: number): CompletionSlot {
	return { kind, query, startCh: endCh - query.length, endCh };
}

/** A `#` that is the transaction flag, not an empty tag name. */
function isBareTxnFlag(prefix: string): boolean {
	const head = datedPrefix(prefix);
	return head !== null && head.text.slice(head.afterDate) === '#';
}

/** Whether any registered completion popover currently has a context. */
export class PopoverOpen {
	private readonly suggests: { context: unknown }[] = [];

	add(suggest: { context: unknown }): void {
		this.suggests.push(suggest);
	}

	get isOpen(): boolean {
		return this.suggests.some((suggest) => suggest.context !== null);
	}
}
