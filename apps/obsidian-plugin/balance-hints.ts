/**
 * Local-document balance assertion deltas — a fallback, not a booking engine.
 *
 * Beancount's real balance is inventory, cost booking, prices, pad synthesis
 * and plugins. None of that is reproduced here. Each hint is asserted units
 * minus the explicit single-commodity total accumulated before that date
 * (balance checks the start of the day, so same-day transactions are
 * excluded). A previous assertion does not reset the running total.
 *
 * A hint is omitted, never invented, when the number is incomplete, the
 * scaled integer would overflow `Number.MAX_SAFE_INTEGER`, or the account's
 * subtree is no longer a simple total: an omitted, expression, cost or price
 * posting, a second commodity, or a `pad` that touches the subtree. `include`
 * and `plugin` make the whole buffer depend on another ledger, so the result
 * is empty. An unrecognized dated directive is the same: ignoring it would
 * claim it contributed zero. `open` / `close` / `note` / `document` / `event`
 * / `query` / `price` / `commodity` / `custom` / `option` / tag directives do
 * not add units; `custom` only inserts postings through a plugin, which this
 * module already refuses. Org headings, comments and metadata are not
 * postings. Automatic legs (`__automatic__`) are not inferred.
 */
export interface BalanceHint {
	/** Zero-based line of the `balance` directive in `lines`. */
	line: number;
	/** Asserted minus accumulated, e.g. `Δ +2.50 USD`. Zero has no sign. */
	label: string;
}

export interface Qty {
	/** Signed integer, scaled by `10 ** scale`. Always a safe integer. */
	units: number;
	scale: number;
}

interface AmountPosting {
	date: string;
	account: string;
	qty: Qty;
	commodity: string;
}

interface TaintPosting {
	date: string;
	account: string;
}

interface Pad {
	date: string;
	accounts: readonly string[];
}

interface Balance {
	line: number;
	date: string;
	account: string;
	qty: Qty;
	/** Commodity token as written on the assertion, quotes included. */
	display: string;
	commodity: string;
}

const MAX_SAFE = 9007199254740991;
const FLAG_CHARS = '*!&#?%A-Z';
const ACCOUNT_SRC = '[A-Z][a-z]+(?::[^\\s:]+)+';
const NUMBER_SRC = '[-+]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]*)?';
export const TXN_RE = new RegExp(
	'^([0-9]{4})[-/]([0-9]{2})[-/]([0-9]{2})[ \\t]*(?:txn|[' + FLAG_CHARS + '])(?![A-Za-z0-9])'
);
const DATED_RE = /^([0-9]{4})[-/]([0-9]{2})[-/]([0-9]{2})[ \t]+([a-z][a-z0-9]*)(?![A-Za-z0-9])(.*)$/;
export const ACCOUNT_EXACT = new RegExp('^' + ACCOUNT_SRC + '$');
const NUMBER_EXACT = new RegExp('^' + NUMBER_SRC + '$');
const ACCOUNT_START = new RegExp('^' + ACCOUNT_SRC);
const NUMBER_START = new RegExp('^' + NUMBER_SRC);
export const FLAG_EXACT = new RegExp('^[' + FLAG_CHARS + ']$');
export const META_RE = /^[a-z][A-Za-z0-9\-_]+:/;

/**
 * Dated keywords this module knows. Anything else dated is unsupported:
 * treating it as a no-op would publish a delta that pretends it added nothing.
 */
const KNOWN_DATED: Record<string, true> = {
	open: true,
	close: true,
	pad: true,
	custom: true,
	event: true,
	commodity: true,
	note: true,
	document: true,
	query: true,
	price: true,
	balance: true,
};

/** Directives that do not themselves post units. `pad` and `balance` are handled. */
const NO_UNIT: Record<string, true> = {
	open: true,
	close: true,
	custom: true,
	event: true,
	commodity: true,
	note: true,
	document: true,
	query: true,
	price: true,
};

interface Inventory {
	qty: Qty;
	commodity: string;
}

export function balanceHints(lines: readonly string[]): BalanceHint[] {
	if (sourceDependent(lines) || unknownDirective(lines)) return [];
	const parsed = collect(lines);
	if (parsed === null) return [];
	// One chronological sweep instead of rescanning all postings per assertion.
	// Posting amounts enter after that day's balances; pad taints enter before.
	const postings: Array<AmountPosting | TaintPosting> = [...parsed.postings, ...parsed.taints];
	postings.sort((a, b) => a.date.localeCompare(b.date));
	parsed.pads.sort((a, b) => a.date.localeCompare(b.date));
	parsed.balances.sort((a, b) => a.date.localeCompare(b.date));
	const inventory = new Map<string, Inventory | null>();
	const hints: BalanceHint[] = [];
	let postingIndex = 0;
	let padIndex = 0;
	for (const balance of parsed.balances) {
		while (postingIndex < postings.length && postings[postingIndex].date < balance.date) {
			accumulate(inventory, postings[postingIndex++]);
		}
		while (padIndex < parsed.pads.length && parsed.pads[padIndex].date <= balance.date) {
			const pad = parsed.pads[padIndex++];
			for (const account of pad.accounts) accumulate(inventory, { account, date: pad.date });
		}
		const hint = hintFor(balance, inventory.get(balance.account));
		if (hint !== null) hints.push(hint);
	}
	hints.sort((a, b) => a.line - b.line);
	return hints;
}

function sourceDependent(lines: readonly string[]): boolean {
	for (let i = 0; i < lines.length; i++) {
		const line = stripCarriage(lines[i]);
		if (isComment(line) || isOrgHeading(line)) continue;
		// A metadata key (`include:`) is not the directive. Indented forms
		// still count: the syntax mode accepts leading whitespace.
		if (/^[ \t]*(include|plugin)(?![A-Za-z0-9_])(?:[ \t]|"|$)/.test(line)) return true;
	}
	return false;
}

function unknownDirective(lines: readonly string[]): boolean {
	for (let i = 0; i < lines.length; i++) {
		const line = stripCarriage(lines[i]);
		if (isComment(line) || isOrgHeading(line) || TXN_RE.test(line)) continue;
		const dated = DATED_RE.exec(line);
		if (dated !== null && KNOWN_DATED[dated[4]] !== true) return true;
	}
	return false;
}

interface Ledger {
	postings: AmountPosting[];
	taints: TaintPosting[];
	pads: Pad[];
	balances: Balance[];
}

/** `null` when a `pad` names accounts we cannot see — its effect is not zero. */
function collect(lines: readonly string[]): Ledger | null {
	const postings: AmountPosting[] = [];
	const taints: TaintPosting[] = [];
	const pads: Pad[] = [];
	const balances: Balance[] = [];
	let inTxn = false;
	let txnDate = '';

	for (let i = 0; i < lines.length; i++) {
		const line = stripCarriage(lines[i]);
		if (/^[ \t]*$/.test(line) || isComment(line)) continue;
		if (isOrgHeading(line)) {
			inTxn = false;
			continue;
		}
		if (line.charAt(0) !== ' ' && line.charAt(0) !== '\t') {
			inTxn = false;
			const txn = TXN_RE.exec(line);
			if (txn !== null) {
				inTxn = true;
				txnDate = txn[1] + '-' + txn[2] + '-' + txn[3];
				continue;
			}
			const dated = DATED_RE.exec(line);
			if (dated === null) continue;
			const date = dated[1] + '-' + dated[2] + '-' + dated[3];
			const keyword = dated[4];
			const rest = stripComment(dated[5]).trim();
			if (keyword === 'balance') {
				const balance = parseBalance(rest);
				if (balance !== null) {
					balances.push({
						line: i,
						date,
						account: balance.account,
						qty: balance.qty,
						display: balance.display,
						commodity: balance.commodity,
					});
				}
				continue;
			}
			if (keyword === 'pad') {
				const accounts = parsePad(rest);
				if (accounts === null) return null;
				pads.push({ date, accounts });
				continue;
			}
			// A dated keyword we recognized but do not classify must not be
			// treated as a zero posting. `open`/`price`/`custom` and the rest
			// of NO_UNIT are the only dated directives that add nothing.
			if (NO_UNIT[keyword] !== true) return null;
			continue;
		} else if (inTxn) {
			const posting = parsePosting(line);
			if (posting.kind === 'amount') {
				postings.push({ date: txnDate, account: posting.account, qty: posting.qty, commodity: posting.commodity });
			} else if (posting.kind === 'taint') {
				taints.push({ date: txnDate, account: posting.account });
			}
		}
	}
	return { postings, taints, pads, balances };
}

/** Update the account and all ancestors once; null means inventory is unknown. */
function accumulate(inventory: Map<string, Inventory | null>, posting: AmountPosting | TaintPosting): void {
	for (let account = posting.account; account.includes(':'); account = account.slice(0, account.lastIndexOf(':'))) {
		const current = inventory.get(account);
		if (current === null) continue;
		if (!('qty' in posting) || (current !== undefined && current.commodity !== posting.commodity)) {
			inventory.set(account, null);
			continue;
		}
		const qty = current === undefined ? posting.qty : add(current.qty, posting.qty);
		inventory.set(account, qty === null ? null : { qty, commodity: posting.commodity });
	}
}

function hintFor(balance: Balance, inventory: Inventory | null | undefined): BalanceHint | null {
	if (inventory === null || (inventory !== undefined && inventory.commodity !== balance.commodity)) return null;
	const sum = inventory?.qty ?? { units: 0, scale: 0 };
	const delta = add(balance.qty, { units: -sum.units, scale: sum.scale });
	if (delta === null) return null;
	const body = formatQty(delta, delta.scale);
	if (body === null) return null;
	return { line: balance.line, label: 'Δ ' + body + ' ' + balance.display };
}

function parseBalance(rest: string): { account: string; qty: Qty; display: string; commodity: string } | null {
	const account = readAccount(rest, 0);
	if (account === null) return null;
	let i = skipWs(rest, account.end);
	const amount = readNumber(rest, i);
	if (amount === null) return null;
	i = skipWs(rest, amount.end);
	// Tolerance is not a pass/fail verdict — the label stays the numeric delta.
	// Both beancount spellings are accepted; a second `~` is an invalid line.
	let sawTolerance = false;
	if (rest.charAt(i) === '~') {
		const tolerance = readNumberSpan(rest, skipWs(rest, i + 1));
		if (tolerance === null) return null;
		i = skipWs(rest, tolerance);
		sawTolerance = true;
	}
	const commodity = readCommodity(rest, i);
	if (commodity === null) return null;
	i = skipWs(rest, commodity.end);
	if (rest.charAt(i) === '~') {
		if (sawTolerance) return null;
		const tolerance = readNumberSpan(rest, skipWs(rest, i + 1));
		if (tolerance === null) return null;
		i = skipWs(rest, tolerance);
	}
	if (i !== rest.length) return null;
	return { account: account.account, qty: amount.qty, display: commodity.display, commodity: commodity.id };
}

function parsePad(rest: string): readonly string[] | null {
	const first = readAccount(rest, 0);
	if (first === null) return null;
	const second = readAccount(rest, skipWs(rest, first.end));
	if (second === null) return null;
	if (skipWs(rest, second.end) !== rest.length) return null;
	return [first.account, second.account];
}

type PostingParse =
	| { kind: 'skip' }
	| { kind: 'taint'; account: string }
	| { kind: 'amount'; account: string; qty: Qty; commodity: string };

/**
 * An indented transaction line. Metadata and comments contribute nothing.
 * An account line whose units are not a plain number plus commodity taints
 * that account — including a missing amount, which beancount would fill in.
 */
function parsePosting(line: string): PostingParse {
	const body = stripComment(line).trim();
	if (body === '' || META_RE.test(body)) return { kind: 'skip' };
	const tokens = body.split(/[ \t]+/);
	let at = 0;
	if (FLAG_EXACT.test(tokens[0]) && tokens.length > 1) at = 1;
	const account = tokens[at];
	if (account === undefined || !ACCOUNT_EXACT.test(account)) return { kind: 'skip' };
	at++;
	if (at < tokens.length && FLAG_EXACT.test(tokens[at])) at++;
	const rest = tokens.slice(at);
	if (rest.length === 2) {
		const qty = toQty(rest[0]);
		const commodity = commodityOf(rest[1]);
		if (qty !== null && commodity !== null) {
			return { kind: 'amount', account, qty, commodity: commodity.id };
		}
	}
	return { kind: 'taint', account };
}

function readAccount(text: string, i: number): { account: string; end: number } | null {
	const match = ACCOUNT_START.exec(text.slice(i));
	if (match === null) return null;
	const end = i + match[0].length;
	if (end < text.length && text.charAt(end) !== ' ' && text.charAt(end) !== '\t') return null;
	return { account: match[0], end };
}

function readNumber(text: string, i: number): { qty: Qty; end: number } | null {
	const end = readNumberSpan(text, i);
	if (end === null) return null;
	const qty = toQty(text.slice(i, end));
	if (qty === null) return null;
	return { qty, end };
}

/** End index of a number token. A discarded tolerance may exceed the safe range. */
function readNumberSpan(text: string, i: number): number | null {
	const match = NUMBER_START.exec(text.slice(i));
	if (match === null) return null;
	const end = i + match[0].length;
	const next = text.charAt(end);
	if (next !== '' && next !== ' ' && next !== '\t' && next !== '~') return null;
	return end;
}

function readCommodity(text: string, i: number): { id: string; display: string; end: number } | null {
	const token = readToken(text, i);
	if (token === null) return null;
	const commodity = commodityOf(token.token);
	if (commodity === null) return null;
	return { id: commodity.id, display: token.token, end: token.end };
}

function readToken(text: string, i: number): { token: string; end: number } | null {
	if (i >= text.length || text.charAt(i) === ' ' || text.charAt(i) === '\t') return null;
	let end = i;
	while (end < text.length) {
		const ch = text.charAt(end);
		if (ch === ' ' || ch === '\t') break;
		end++;
	}
	return { token: text.slice(i, end), end };
}

export function commodityOf(token: string): { id: string } | null {
	if (/^[A-Z][A-Z0-9'._-]*$/.test(token)) return { id: token };
	if (/^"[^"\s]+"$/.test(token)) return { id: token.slice(1, -1) };
	return null;
}

/** `null` when the token is not a plain decimal or the scaled integer overflows. */
export function toQty(token: string): Qty | null {
	if (!NUMBER_EXACT.test(token)) return null;
	let sign = 1;
	let body = token;
	if (body.charAt(0) === '+' || body.charAt(0) === '-') {
		if (body.charAt(0) === '-') sign = -1;
		body = body.slice(1);
	}
	const dot = body.indexOf('.');
	const intPart = (dot === -1 ? body : body.slice(0, dot)).replace(/,/g, '');
	const frac = dot === -1 ? '' : body.slice(dot + 1);
	let units = 0;
	const digits = intPart + frac;
	for (let i = 0; i < digits.length; i++) {
		const d = digits.charCodeAt(i) - 48;
		if (units > Math.floor(MAX_SAFE / 10)) return null;
		units *= 10;
		if (units > MAX_SAFE - d) return null;
		units += d;
	}
	units *= sign;
	if (units === 0) units = 0;
	return { units, scale: frac.length };
}

export function add(a: Qty, b: Qty): Qty | null {
	const scale = a.scale > b.scale ? a.scale : b.scale;
	const left = rescale(a, scale);
	const right = rescale(b, scale);
	if (left === null || right === null) return null;
	const units = left.units + right.units;
	if (!Number.isSafeInteger(units)) return null;
	return { units: units === 0 ? 0 : units, scale };
}


function rescale(qty: Qty, scale: number): Qty | null {
	if (scale < qty.scale) return null;
	let units = qty.units;
	for (let i = qty.scale; i < scale; i++) {
		if (units > Math.floor(MAX_SAFE / 10) || units < -Math.floor(MAX_SAFE / 10)) return null;
		units *= 10;
	}
	if (!Number.isSafeInteger(units)) return null;
	return { units, scale };
}

function formatQty(qty: Qty, scale: number): string | null {
	const scaled = rescale(qty, scale);
	if (scaled === null) return null;
	const negative = scaled.units < 0;
	let abs = negative ? -scaled.units : scaled.units;
	if (!Number.isSafeInteger(abs)) return null;
	let digits = String(abs);
	if (scale > 0) {
		while (digits.length <= scale) digits = '0' + digits;
		digits = digits.slice(0, digits.length - scale) + '.' + digits.slice(digits.length - scale);
	}
	const sign = negative ? '-' : scaled.units > 0 ? '+' : '';
	return sign + digits;
}


function skipWs(text: string, i: number): number {
	while (i < text.length && (text.charAt(i) === ' ' || text.charAt(i) === '\t')) i++;
	return i;
}

function stripCarriage(line: string): string {
	return line.charAt(line.length - 1) === '\r' ? line.slice(0, -1) : line;
}

export function stripComment(line: string): string {
	let quote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line.charAt(i);
		if (ch === '\\' && quote) {
			i++;
			continue;
		}
		if (ch === '"') quote = !quote;
		else if (ch === ';' && !quote) return line.slice(0, i);
	}
	return line;
}


function isComment(line: string): boolean {
	return /^[ \t]*;/.test(line);
}

function isOrgHeading(line: string): boolean {
	return /^\*+/.test(line);
}

