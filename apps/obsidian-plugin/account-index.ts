/**
 * Account names: how to recognize one while typing (`ACCOUNT_PREFIX_RE`),
 * the token under a hover (`accountTokenAt`), and the open/close lifecycle
 * used to hide closed accounts from completion and to fill the hover card.
 * Vault-wide facts live in `LedgerIndex`.
 */
import { ACCOUNT_SEGMENT_CHARS, ACCOUNT_SHAPE } from './scan';

export { ACCOUNT_SHAPE } from './scan';

/**
 * A complete account name: a capitalized root segment plus one or more
 * `:segment` parts, e.g. `Assets:Cash:Wallet` or `Expenses:餐饮:午饭`.
 * Segment characters are Unicode letters, digits and marks, `-`, `_` and the
 * middle dots `·` / `・` that join words in CJK names (`Expenses:カード・ローン`),
 * so the non-ASCII accounts the syntax mode highlights and alignment
 * recognizes are completable too. Those two accept any non-space segment
 * character; here other punctuation and symbols (`，`, `：`, `☕`) end a
 * name, so prose like `Expenses:餐饮，午饭` indexes `Expenses:餐饮` rather than
 * the whole clause. Prose words, dates (`2026-09-30`), times (`12:30`) and
 * URLs never leak in because they lack the capitalized-root-plus-colon shape.
 * Empty segments (`Meeting:`, `Assets::Cash`) are not names, and a name ends
 * on a letter, digit, mark or `_` (a trailing `-` or dot is dropped). The
 * lookbehind keeps a name from leaking out of a longer token or URL path
 * (`pre-Assets:Cash`, `见Assets:Cash`, `github.com/User:Repo`), mirroring
 * the prefix regex.
 */
const SEGMENT = `[${ACCOUNT_SEGMENT_CHARS}]`;
const ACCOUNT_RE = new RegExp(`(?<![${ACCOUNT_SEGMENT_CHARS}:/])${ACCOUNT_SHAPE}`, 'gu');

/** The same shape while typing, where the last segment may be partial. */
export const ACCOUNT_PREFIX_RE = new RegExp(
	`(?:^|[^${ACCOUNT_SEGMENT_CHARS}:/])([A-Z]${SEGMENT}*(?::${SEGMENT}*)*)$`,
	'u'
);

/** A character that continues an account token: a segment character or `:`. */
export const ACCOUNT_CHAR_RE = new RegExp(`[${ACCOUNT_SEGMENT_CHARS}:]`, 'u');

/** The complete account token covering `offset`, if any. */
export function accountTokenAt(
	text: string,
	offset: number
): { name: string; from: number; to: number } | null {
	for (const match of text.matchAll(ACCOUNT_RE)) {
		const from = match.index ?? 0;
		const to = from + match[0].length;
		if (offset >= from && offset <= to) return { name: match[0], from, to };
	}
	return null;
}

export interface AccountRecord {
	open?: string;
	close?: string;
	currencies: readonly string[];
}

/** Closed when a `close` exists and no later `open` reopens the account. */
export function isAccountClosed(record: AccountRecord | undefined): boolean {
	if (record?.close === undefined) return false;
	return record.open === undefined || record.close >= record.open;
}

/** Popup subtitle: open date and constrained currencies, when known. */
export function describeAccount(record: AccountRecord | undefined): string {
	if (!record) return '';
	const lines: string[] = [];
	if (record.open !== undefined) lines.push(`opened on ${record.open}`);
	if (record.currencies.length > 0) lines.push(`currencies: ${record.currencies.join(', ')}`);
	return lines.join('\n');
}

/**
 * Hover card: the name, then open/close dates and constrained currencies.
 * A close is listed only while it still closes the account — a later open
 * hides the stale date. A posting-only name yields just the title.
 */
export function accountHoverCard(
	name: string,
	record: AccountRecord | undefined
): { name: string; lines: string[] } {
	const lines: string[] = [];
	if (record?.open !== undefined) lines.push(`opened on ${record.open}`);
	if (record?.close !== undefined && isAccountClosed(record)) lines.push(`closed on ${record.close}`);
	if (record !== undefined && record.currencies.length > 0) {
		lines.push(`currencies: ${record.currencies.join(', ')}`);
	}
	return { name, lines };
}
