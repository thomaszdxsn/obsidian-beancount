/**
 * Inferred posting amounts and unbalanced-transaction warnings.
 *
 * Not a booking engine. A hint is shown only when every posting in the
 * transaction is a plain `number COMMODITY` — optional flag, tags, links,
 * and a trailing comment — or exactly one of them omits its amount. Cost
 * (`{}`), price (`@` / `@@`), arithmetic, and any other shape suppress the
 * whole transaction: a wrong number is worse than no number.
 *
 * The omitted amount is the negated per-commodity sum. It is shown only when
 * the transaction has more than two postings or more than one commodity;
 * two legs of one commodity are obvious (the vscode-beancount rule). Decimal
 * places are the most fractional digits among the amounts summed for that
 * commodity, using the same exact scaled-integer arithmetic as balance
 * assertion deltas. Thousands separators are accepted on input and not
 * rewritten into the hint.
 *
 * When every posting has an amount, the header gets a warning if any
 * commodity's sum exceeds beancount's default inferred tolerance — half a
 * unit of the coarsest fractional precision written for that commodity,
 * exact zero for integer-only amounts (`≠ 0: 1.00 USD`). Configured
 * `inferred_tolerance_*` options are not read. A configured entry ledger does not
 * matter here — the postings of one transaction are all in the block.
 *
 * A blank line or a column-0 comment ends the entry, matching the syntax
 * mode and `align.ts`. Metadata and indented comments are not postings.
 * The inferred amount is padded so its decimal point (or where an integer's
 * decimal point would sit) lines up with the nearest earlier amount in the
 * block. If that posting is first, `separatorColumn` (1-based) is the
 * fallback; without it the label has no pad and the widget supplies the gap.
 */
import { displayWidth } from './align';
import {
	ACCOUNT_EXACT,
	FLAG_EXACT,
	META_RE,
	TXN_RE,
	add,
	commodityOf,
	stripComment,
	toQty,
} from './balance-hints';
import type { Qty } from './balance-hints';

export type PostingHintKind = 'inferred' | 'unbalanced';

export interface PostingHint {
	/** Zero-based line the widget sits on. */
	line: number;
	kind: PostingHintKind;
	/**
	 * Visible text. An aligned inferred label starts with spaces that put
	 * its decimal on the amount column; the widget must not add its own gap.
	 */
	label: string;
	/** False when no earlier amount and no separator column set the decimal. */
	aligned: boolean;
}

export interface PostingHintOptions {
	/** 1-based decimal column, used only when no earlier amount sets one. */
	separatorColumn?: number;
}

interface SimplePosting {
	kind: 'simple';
	qty: Qty;
	commodity: string;
	/** Commodity token as written, quotes included. */
	display: string;
	/** Display column of the decimal point, or where it would sit on an integer. */
	dotColumn: number;
}

type Classified =
	| { kind: 'skip' }
	| { kind: 'missing' }
	| { kind: 'complex' }
	| SimplePosting;

interface Seen {
	line: number;
	parsed: SimplePosting | { kind: 'missing' };
}

interface Txn {
	header: number;
	postings: Seen[];
	complex: boolean;
}

const TAG_OR_LINK_RE = /^(?:#[A-Za-z0-9_./-]+|\^[A-Za-z0-9_./-]+)$/;

function stripCarriage(line: string): string {
	return line.charAt(line.length - 1) === '\r' ? line.slice(0, -1) : line;
}

/** Offset of `token` as a whole whitespace-delimited word, or -1. */
function tokenOffset(text: string, token: string): number {
	let i = 0;
	while (i < text.length) {
		while (i < text.length && (text.charAt(i) === ' ' || text.charAt(i) === '\t')) i++;
		if (i >= text.length) break;
		let end = i;
		while (end < text.length && text.charAt(end) !== ' ' && text.charAt(end) !== '\t') end++;
		if (text.slice(i, end) === token) return i;
		i = end;
	}
	return -1;
}

function numberDotColumn(body: string, numberToken: string): number | null {
	const at = tokenOffset(body, numberToken);
	if (at < 0) return null;
	const dot = numberToken.indexOf('.');
	const end = dot === -1 ? at + numberToken.length : at + dot;
	return displayWidth(body.slice(0, end));
}

/**
 * An indented line inside a transaction. Metadata and comments contribute
 * nothing. Anything that is not an account plus an optional plain amount
 * taints the transaction.
 */
function classifyPosting(line: string): Classified {
	const raw = stripCarriage(line);
	if (raw.charAt(0) !== ' ' && raw.charAt(0) !== '\t') return { kind: 'skip' };
	const body = stripComment(raw);
	const trimmed = body.trim();
	if (trimmed === '' || META_RE.test(trimmed)) return { kind: 'skip' };
	const tokens = trimmed.split(/[ \t]+/);
	let at = 0;
	if (FLAG_EXACT.test(tokens[0]) && tokens.length > 1) at = 1;
	const account = tokens[at];
	if (account === undefined || !ACCOUNT_EXACT.test(account)) return { kind: 'complex' };
	at++;
	if (at < tokens.length && FLAG_EXACT.test(tokens[at])) at++;
	const rest = tokens.slice(at);
	if (rest.every((token) => TAG_OR_LINK_RE.test(token))) return { kind: 'missing' };
	if (rest.length >= 2 && rest.slice(2).every((token) => TAG_OR_LINK_RE.test(token))) {
		const qty = toQty(rest[0]);
		const commodity = commodityOf(rest[1]);
		if (qty !== null && commodity !== null) {
			const dotColumn = numberDotColumn(body, rest[0]);
			if (dotColumn === null) return { kind: 'complex' };
			return { kind: 'simple', qty, commodity: commodity.id, display: rest[1], dotColumn };
		}
	}
	return { kind: 'complex' };
}

/**
 * One pass, same entry boundaries as the syntax mode: a blank line or a
 * comment at column 0 closes the transaction. Indented lines outside one
 * are not postings.
 */
function collectTransactions(lines: readonly string[]): Txn[] {
	const txns: Txn[] = [];
	let current: Txn | null = null;
	for (let i = 0; i < lines.length; i++) {
		const raw = stripCarriage(lines[i]);
		if (raw.trim() === '' || raw.charAt(0) === ';') {
			current = null;
			continue;
		}
		if (raw.charAt(0) !== ' ' && raw.charAt(0) !== '\t') {
			current = null;
			if (TXN_RE.test(raw)) {
				current = { header: i, postings: [], complex: false };
				txns.push(current);
			}
			continue;
		}
		if (current === null) continue;
		const parsed = classifyPosting(raw);
		if (parsed.kind === 'skip') continue;
		if (parsed.kind === 'complex') {
			current.complex = true;
			continue;
		}
		current.postings.push({ line: i, parsed });
	}
	return txns;
}

function negate(qty: Qty): Qty | null {
	if (qty.units === 0) return { units: 0, scale: qty.scale };
	const units = -qty.units;
	if (!Number.isSafeInteger(units)) return null;
	return { units, scale: qty.scale };
}

/** No leading `+`. Zero is unsigned. `null` only if the scaled integer is unsafe. */
function formatPlain(qty: Qty, commodity: string): string | null {
	if (!Number.isSafeInteger(qty.units) || qty.scale < 0) return null;
	const negative = qty.units < 0;
	const abs = negative ? -qty.units : qty.units;
	if (!Number.isSafeInteger(abs)) return null;
	let digits = String(abs);
	if (qty.scale > 0) {
		while (digits.length <= qty.scale) digits = '0' + digits;
		digits = digits.slice(0, digits.length - qty.scale) + '.' + digits.slice(digits.length - qty.scale);
	}
	return (negative ? '-' : '') + digits + ' ' + commodity;
}

interface Bucket {
	qty: Qty;
	display: string;
	/**
	 * Fewest fractional digits among this commodity's fractional amounts
	 * (0 when all are integers): beancount's inferred tolerance is half a
	 * unit of the coarsest written precision.
	 */
	coarsestScale: number;
}

function coarser(current: number, scale: number): number {
	if (scale <= 0) return current;
	return current === 0 ? scale : Math.min(current, scale);
}

/** `null` when exact addition overflows. Insertion order is first appearance. */
function bucketsOf(amounts: readonly Seen[]): Map<string, Bucket> | null {
	const buckets = new Map<string, Bucket>();
	for (let i = 0; i < amounts.length; i++) {
		const parsed = amounts[i].parsed;
		if (parsed.kind !== 'simple') continue;
		const prev = buckets.get(parsed.commodity);
		if (prev === undefined) {
			buckets.set(parsed.commodity, {
				qty: parsed.qty,
				display: parsed.display,
				coarsestScale: coarser(0, parsed.qty.scale),
			});
			continue;
		}
		const sum = add(prev.qty, parsed.qty);
		if (sum === null) return null;
		buckets.set(parsed.commodity, {
			qty: sum,
			display: prev.display,
			coarsestScale: coarser(prev.coarsestScale, parsed.qty.scale),
		});
	}
	return buckets;
}

/**
 * Beancount's default check: the residual balances when its magnitude is at
 * most half a unit of the coarsest fractional precision written for the
 * commodity (`0.005` for `.00` amounts); integer-only commodities need an
 * exact zero.
 */
function withinTolerance(bucket: Bucket): boolean {
	const { units, scale } = bucket.qty;
	if (units === 0) return true;
	if (bucket.coarsestScale === 0 || scale < bucket.coarsestScale) return false;
	const bound = 10 ** (scale - bucket.coarsestScale);
	if (!Number.isSafeInteger(bound)) return false;
	return 2 * Math.abs(units) <= bound;
}

/** Index of the first amount's decimal inside `amountText`, ignoring a pad. */
function unitsDotIndex(amountText: string): number {
	const number = amountText.split(/[\s,]/)[0];
	const dot = number.indexOf('.');
	return dot === -1 ? number.length : dot;
}

function alignLabel(
	amountText: string,
	line: number,
	amounts: readonly Seen[],
	lines: readonly string[],
	options: PostingHintOptions | undefined
): { label: string; aligned: boolean } {
	let dotColumn: number | null = null;
	for (let i = amounts.length - 1; i >= 0; i--) {
		const parsed = amounts[i].parsed;
		if (amounts[i].line < line && parsed.kind === 'simple') {
			dotColumn = parsed.dotColumn;
			break;
		}
	}
	if (dotColumn === null) {
		const column = options?.separatorColumn;
		if (column !== undefined && Number.isFinite(column) && column >= 1) dotColumn = column - 1;
	}
	if (dotColumn === null) return { label: amountText, aligned: false };
	const pad = Math.max(dotColumn - displayWidth(stripCarriage(lines[line])) - unitsDotIndex(amountText), 1);
	return { label: ' '.repeat(pad) + amountText, aligned: true };
}

function inferredHint(
	txn: Txn,
	missing: Seen,
	amounts: readonly Seen[],
	lines: readonly string[],
	options: PostingHintOptions | undefined
): PostingHint | null {
	const commodities = new Set<string>();
	for (let i = 0; i < amounts.length; i++) {
		const parsed = amounts[i].parsed;
		if (parsed.kind === 'simple') commodities.add(parsed.commodity);
	}
	// Two legs of one commodity are obvious; do not annotate them.
	if (txn.postings.length <= 2 && commodities.size <= 1) return null;
	const buckets = bucketsOf(amounts);
	if (buckets === null || buckets.size === 0) return null;
	// Beancount's residual drops positions that already cancel; the lone
	// zero of a fully cancelled transaction is still shown.
	const parts: string[] = [];
	const zeros: string[] = [];
	for (const bucket of buckets.values()) {
		const negated = negate(bucket.qty);
		if (negated === null) return null;
		const text = formatPlain(negated, bucket.display);
		if (text === null) return null;
		(negated.units === 0 ? zeros : parts).push(text);
	}
	if (parts.length === 0) parts.push(...zeros);
	const aligned = alignLabel(parts.join(', '), missing.line, amounts, lines, options);
	return { line: missing.line, kind: 'inferred', label: aligned.label, aligned: aligned.aligned };
}

function unbalancedHint(txn: Txn, amounts: readonly Seen[]): PostingHint | null {
	const buckets = bucketsOf(amounts);
	if (buckets === null) return null;
	const parts: string[] = [];
	for (const bucket of buckets.values()) {
		if (withinTolerance(bucket)) continue;
		const text = formatPlain(bucket.qty, bucket.display);
		if (text === null) return null;
		parts.push(text);
	}
	if (parts.length === 0) return null;
	return { line: txn.header, kind: 'unbalanced', label: '≠ 0: ' + parts.join(', '), aligned: false };
}

function hintFor(
	txn: Txn,
	lines: readonly string[],
	options: PostingHintOptions | undefined
): PostingHint | null {
	if (txn.complex || txn.postings.length === 0) return null;
	const missing = txn.postings.filter((posting) => posting.parsed.kind === 'missing');
	const amounts = txn.postings.filter((posting) => posting.parsed.kind === 'simple');
	if (missing.length === 1 && amounts.length === txn.postings.length - 1) {
		return inferredHint(txn, missing[0], amounts, lines, options);
	}
	if (missing.length === 0 && amounts.length === txn.postings.length) {
		return unbalancedHint(txn, amounts);
	}
	return null;
}

export function postingHints(lines: readonly string[], options?: PostingHintOptions): PostingHint[] {
	const hints: PostingHint[] = [];
	const txns = collectTransactions(lines);
	for (let i = 0; i < txns.length; i++) {
		const hint = hintFor(txns[i], lines, options);
		if (hint !== null) hints.push(hint);
	}
	return hints;
}
