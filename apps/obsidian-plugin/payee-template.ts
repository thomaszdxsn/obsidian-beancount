/**
 * Posting templates for payee completion, Fava's "fill the last transaction
 * for this payee" behaviour.
 *
 * Vault-wide latest templates live in `LedgerIndex`. This module holds the
 * stored posting shape and the insert rendered under an empty transaction.
 *
 * Amounts become snippet tab stops (`SnippetSession`) rather than `$`
 * placeholders interpolated into the amount text, so a `$` in a commodity
 * cannot become a stop. Only the leading number token of a kept amount is
 * the stop (the old number, selected); the commodity, cost, and price stay
 * literal. The common two-leg transaction collapses to one stop: the first
 * posting keeps its amount and the second is account-only when the history
 * had one implicit leg, or two opposite simple amounts (`NUMBER COMMODITY`,
 * same commodity, numeric sum zero). An amount is not moved onto a different
 * account — if the only explicit amount sits on the second leg, the stop
 * stays there. Three or more postings keep every amount. Two amounts that
 * are not a simple opposite pair (a cost, a price, a second commodity) keep
 * both numbers.
 */
import type { TabStop } from './snippets';

/** One posting of a payee's latest transaction. */
export interface TemplatePosting {
	/** Flag before the account (`!`), or empty. */
	leadingFlag: string;
	account: string;
	/** Flag after the account (`*`), or empty. */
	trailingFlag: string;
	/**
	 * Amount as written after the account and flags, inline comment stripped.
	 * Absent when the posting lets beancount balance it.
	 */
	amount?: string;
}

/** The winning transaction for one payee in one file, or after a vault merge. */
export interface PayeeTemplate {
	/** `YYYY-MM-DD`, slashes already normalized. */
	date: string;
	/** Vault path of the file that held the transaction. */
	path: string;
	/** 0-based header line. Later line wins a date tie in the same file. */
	line: number;
	postings: readonly TemplatePosting[];
}

/** Text inserted under a transaction header, plus stops into that text. */
export interface PayeeAutofillBody {
	/** Starts with a newline; each posting line is indented with two spaces. */
	text: string;
	/** Offsets into `text`. Visit order is array order. */
	stops: TabStop[];
}

const NUMBER_TOKEN = /^[-+]?[0-9][0-9,]*(?:\.[0-9]*)?(?=\s|$)/;
const SIMPLE_AMOUNT =
	/^([-+]?[0-9][0-9,]*(?:\.[0-9]*)?)[ \t]+([A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")$/;

/**
 * Render `postings` as the lines inserted under an empty transaction.
 * Returns null when there is nothing to insert.
 */
export function buildPayeeAutofill(postings: readonly TemplatePosting[]): PayeeAutofillBody | null {
	if (postings.length === 0) return null;
	const keep = amountsToKeep(postings);
	let text = '';
	const stops: TabStop[] = [];
	let index = 1;
	for (let i = 0; i < postings.length; i += 1) {
		const posting = postings[i];
		text += '\n  ';
		if (posting.leadingFlag !== '') text += `${posting.leadingFlag} `;
		text += posting.account;
		if (posting.trailingFlag !== '') text += ` ${posting.trailingFlag}`;
		const amount = keep[i] ? posting.amount : undefined;
		if (amount === undefined) continue;
		text += '  ';
		const number = NUMBER_TOKEN.exec(amount);
		if (number === null) {
			text += amount;
			continue;
		}
		const from = text.length;
		text += number[0];
		stops.push({ index, from, to: text.length });
		index += 1;
		text += amount.slice(number[0].length);
	}
	return { text, stops };
}

/**
 * Which postings keep an amount stop. Two legs collapse to a single amount
 * when one leg is implicit, or when both amounts are a simple opposite pair
 * in one commodity — the second amount is then dropped so beancount balances
 * it. Every other shape keeps each amount where it was written.
 */
function amountsToKeep(postings: readonly TemplatePosting[]): boolean[] {
	const keep = postings.map((posting) => posting.amount !== undefined);
	if (postings.length !== 2) return keep;
	const [first, second] = postings;
	if (first.amount !== undefined && second.amount === undefined) return [true, false];
	if (first.amount === undefined && second.amount !== undefined) return [false, true];
	if (
		first.amount !== undefined &&
		second.amount !== undefined &&
		oppositeAmounts(first.amount, second.amount)
	) {
		return [true, false];
	}
	return keep;
}

function oppositeAmounts(left: string, right: string): boolean {
	const a = SIMPLE_AMOUNT.exec(left);
	const b = SIMPLE_AMOUNT.exec(right);
	if (a === null || b === null || a[2] !== b[2]) return false;
	const x = Number(a[1].replace(/,/g, ''));
	const y = Number(b[1].replace(/,/g, ''));
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	const scale = Math.max(Math.abs(x), Math.abs(y), 1);
	return Math.abs(x + y) <= scale * 1e-9;
}
