/**
 * Tolerant line scan over Ledger text: classify each line, cut Scanned
 * entries, and parse posting fields. Never throws; a damaged entry still
 * has bounds (`damaged` is true when a string is left open or a posting
 * amount is followed by a token that is not a commodity, cost, price, tag,
 * or link). Account names follow the editor `ACCOUNT_SHAPE`, not g4.
 */
export const ACCOUNT_SEGMENT_CHARS = String.raw`\p{L}\p{N}\p{M}_\-·・`;
const SEGMENT = `[${ACCOUNT_SEGMENT_CHARS}]`;
const NAME_END = String.raw`(?<=[\p{L}\p{N}\p{M}_])`;

/**
 * A complete account name: a capitalized root plus one or more `:segment`
 * parts (`Assets:Cash:Wallet`, `Expenses:餐饮:午饭`). Segment characters are
 * Unicode letters, digits and marks, `-`, `_` and the middle dots `·` / `・`.
 */
export const ACCOUNT_SHAPE = String.raw`[A-Z]${SEGMENT}*(?::${SEGMENT}+)+${NAME_END}`;

const ACCOUNT_UNI_EXACT = new RegExp(`^${ACCOUNT_SHAPE}$`, 'u');
export const META_RE = /^[a-z][A-Za-z0-9\-_]+:/;
export const COMMODITY_EXACT = /^(?:[A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")$/;

const DATED_KEYWORDS: Record<string, true> = {
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

export type LineKind =
	| 'txn-header'
	| 'directive'
	| 'posting'
	| 'metadata'
	| 'comment'
	| 'blank'
	| 'string-continue'
	| 'org'
	| 'other';

export interface LineSpan {
	from: number;
	to: number;
}

export interface ScannedHeader {
	kind: 'txn-header' | 'directive';
	date: string;
	flag?: string;
	flagSpan?: LineSpan;
	keyword?: string;
	keywordSpan?: LineSpan;
	payee?: LineSpan;
	narration?: LineSpan;
}

export interface ScannedPosting {
	account: { text: string; span: LineSpan };
	flag?: string;
	leadingFlag?: string;
	trailingFlag?: string;
	/** Column where the rewritten amount gap starts (after account / trailing flag). */
	gapStart: number;
	number?: LineSpan;
	commodity?: LineSpan;
	hasCost: boolean;
	hasPrice: boolean;
}

export interface ScannedEntry {
	startLine: number;
	endLine: number;
	damaged: boolean;
	header?: ScannedHeader;
	postings: ScannedPosting[];
}

export interface ScanResult {
	lines: readonly LineKind[];
	entries: readonly ScannedEntry[];
}

function stripCR(line: string): string {
	return line.charAt(line.length - 1) === '\r' ? line.slice(0, -1) : line;
}

function skipBlank(line: string, at: number): number {
	while (at < line.length && (line.charCodeAt(at) === 0x20 || line.charCodeAt(at) === 0x09)) at += 1;
	return at;
}

function isRareSpace(c: number): boolean {
	return (
		c === 0xa0 ||
		c === 0x1680 ||
		(c >= 0x2000 && c <= 0x200a) ||
		c === 0x2028 ||
		c === 0x2029 ||
		c === 0x202f ||
		c === 0x205f ||
		c === 0x3000 ||
		c === 0xfeff
	);
}

export function isSpace(c: number): boolean {
	if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return true;
	return c >= 0xa0 && isRareSpace(c);
}

export function skipSpace(line: string, at: number): number {
	const n = line.length;
	while (at < n) {
		const c = line.charCodeAt(at);
		if (c === 0x20 || c === 0x09) {
			at += 1;
			continue;
		}
		if (c < 0xa0 || !isRareSpace(c)) return at;
		at += 1;
	}
	return at;
}

/** True for g4 txn flags: `*!&#?%` and a single capital. */
export function isFlagChar(c: number): boolean {
	return (c >= 0x41 && c <= 0x5a) || c === 0x2a || c === 0x21 || c === 0x26 || c === 0x23 || c === 0x3f || c === 0x25;
}

function isBlank(line: string): boolean {
	return skipBlank(line, 0) === line.length;
}

function isCommentLine(line: string): boolean {
	const at = skipBlank(line, 0);
	return at < line.length && line.charCodeAt(at) === 0x3b;
}

function isOrgLine(line: string): boolean {
	return line.charCodeAt(0) === 0x2a;
}

function isIndented(line: string): boolean {
	const head = line.charCodeAt(0);
	return head === 0x20 || head === 0x09;
}

function isIdentContinue(c: number): boolean {
	return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
}

function isKeywordChar(c: number): boolean {
	return (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
}

/**
 * One step of the quote / `;` comment machine. Mutates `state`. A trailing
 * `\` inside a string does not escape the next line (returned skip is 0).
 * Returns extra characters consumed (1 for an escape pair).
 */
export interface QuoteCommentState {
	inString: boolean;
	inComment: boolean;
}

export function stepQuoteComment(line: string, i: number, state: QuoteCommentState): number {
	if (state.inComment) return 0;
	const ch = line.charCodeAt(i);
	if (state.inString) {
		if (ch === 0x5c && i + 1 < line.length) return 1;
		if (ch === 0x22) state.inString = false;
		return 0;
	}
	if (ch === 0x22) {
		state.inString = true;
		return 0;
	}
	if (ch === 0x3b) {
		state.inComment = true;
		return 0;
	}
	return 0;
}

const quoteState: QuoteCommentState = { inString: false, inComment: false };

function scanQuoteComment(line: string, inStringStart: boolean): { inString: boolean; commentAt: number } {
	if (!inStringStart && line.indexOf('"') < 0 && line.indexOf(';') < 0) {
		return { inString: false, commentAt: -1 };
	}
	quoteState.inString = inStringStart;
	quoteState.inComment = false;
	for (let i = 0; i < line.length; i += 1) {
		const wasComment = quoteState.inComment;
		i += stepQuoteComment(line, i, quoteState);
		if (!wasComment && quoteState.inComment) return { inString: false, commentAt: i };
	}
	return { inString: quoteState.inString, commentAt: -1 };
}

export function endsInString(line: string, inStringStart: boolean): boolean {
	if (!inStringStart && line.indexOf('"') < 0) return false;
	quoteState.inString = inStringStart;
	quoteState.inComment = false;
	for (let i = 0; i < line.length; i += 1) i += stepQuoteComment(line, i, quoteState);
	return quoteState.inString;
}

export function inStringOrComment(prefix: string): boolean {
	const { inString, commentAt } = scanQuoteComment(prefix, false);
	return inString || commentAt >= 0;
}

export function stripComment(line: string): string {
	const { commentAt } = scanQuoteComment(line, false);
	return commentAt < 0 ? line : line.slice(0, commentAt);
}

/** Line with quoted strings and `;` comments removed, for amount/token scans. */
export function stripStringsAndComments(line: string): string {
	if (!line.includes('"')) return stripComment(line);
	const state: QuoteCommentState = { inString: false, inComment: false };
	let out = '';
	for (let i = 0; i < line.length; i += 1) {
		const wasString = state.inString;
		const skip = stepQuoteComment(line, i, state);
		if (state.inComment) break;
		if (!wasString && !state.inString) out += line.charAt(i);
		i += skip;
	}
	return out;
}

/** Decode `\\` / `\"` in a quoted field body (payee / narration as written). */
export function unescapeQuoted(text: string): string {
	return text.includes('\\') ? text.replace(/\\(.)/g, '$1') : text;
}

/** First quoted field body, or undefined when missing or empty. */
export function headerPayee(line: string, header: ScannedHeader): string | undefined {
	if (header.payee === undefined || header.payee.from >= header.payee.to) return undefined;
	return line.slice(header.payee.from, header.payee.to);
}

export function isPlainNumber(token: string): boolean {
	return /^(?:[-+]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]*)?)$/.test(token);
}

export function commodityOf(token: string): { id: string } | null {
	if (!COMMODITY_EXACT.test(token)) return null;
	if (token.charCodeAt(0) === 0x22) return { id: token.slice(1, -1) };
	return { id: token };
}

function quotedSpan(line: string, from: number): { span: LineSpan; end: number } | null {
	const start = skipBlank(line, from);
	if (line.charCodeAt(start) !== 0x22) return null;
	let i = start + 1;
	const innerFrom = i;
	quoteState.inString = true;
	quoteState.inComment = false;
	while (i < line.length) {
		const skip = stepQuoteComment(line, i, quoteState);
		if (!quoteState.inString) return { span: { from: innerFrom, to: i }, end: i + 1 };
		i += 1 + skip;
	}
	return null;
}

function txnHeader(line: string, date: string, flag: string, flagFrom: number, restAt: number): ScannedHeader {
	const flagSpan = { from: flagFrom, to: restAt };
	const first = quotedSpan(line, restAt);
	if (first === null) return { kind: 'txn-header', date, flag, flagSpan };
	const second = quotedSpan(line, first.end);
	if (second === null) return { kind: 'txn-header', date, flag, flagSpan, payee: first.span };
	return { kind: 'txn-header', date, flag, flagSpan, payee: first.span, narration: second.span };
}

/** YYYY-MM-DD or YYYY/MM/DD at column 0, plus the first non-blank after it. */
export function datedPrefix(line: string): { text: string; date: string; afterDate: number } | null {
	const text = stripCR(line);
	if (text.length < 10) return null;
	const y0 = text.charCodeAt(0);
	if (y0 < 0x30 || y0 > 0x39) return null;
	const sep = text.charCodeAt(4);
	if (sep !== 0x2d && sep !== 0x2f) return null;
	if (
		text.charCodeAt(1) < 0x30 ||
		text.charCodeAt(1) > 0x39 ||
		text.charCodeAt(2) < 0x30 ||
		text.charCodeAt(2) > 0x39 ||
		text.charCodeAt(3) < 0x30 ||
		text.charCodeAt(3) > 0x39 ||
		text.charCodeAt(5) < 0x30 ||
		text.charCodeAt(5) > 0x39 ||
		text.charCodeAt(6) < 0x30 ||
		text.charCodeAt(6) > 0x39 ||
		text.charCodeAt(7) !== sep ||
		text.charCodeAt(8) < 0x30 ||
		text.charCodeAt(8) > 0x39 ||
		text.charCodeAt(9) < 0x30 ||
		text.charCodeAt(9) > 0x39
	) {
		return null;
	}
	return { text, date: text.slice(0, 10), afterDate: skipBlank(text, 10) };
}

function txnFlagAt(
	text: string,
	afterDate: number
): { flag: string; flagFrom: number; restAt: number } | undefined {
	if (afterDate >= text.length) return undefined;
	if (text.startsWith('txn', afterDate) && !isIdentContinue(text.charCodeAt(afterDate + 3))) {
		return { flag: 'txn', flagFrom: afterDate, restAt: afterDate + 3 };
	}
	const flagCode = text.charCodeAt(afterDate);
	if (isFlagChar(flagCode) && !isIdentContinue(text.charCodeAt(afterDate + 1))) {
		return { flag: text.charAt(afterDate), flagFrom: afterDate, restAt: afterDate + 1 };
	}
	return undefined;
}

/** Flag token of a txn-header, or undefined. Skips payee/narration. */
export function parseTxnFlag(line: string): string | undefined {
	const head = datedPrefix(line);
	if (head === null) return undefined;
	return txnFlagAt(head.text, head.afterDate)?.flag;
}

/** Parse a column-0 dated header. Does not scan the rest of the file. */
export function parseHeaderLine(line: string): ScannedHeader | null {
	const head = datedPrefix(line);
	if (head === null) return null;
	const { text, date, afterDate } = head;
	const flag = txnFlagAt(text, afterDate);
	if (flag !== undefined) return txnHeader(text, date, flag.flag, flag.flagFrom, flag.restAt);
	if (afterDate === 10 || afterDate >= text.length) return null;
	let keyEnd = afterDate;
	while (keyEnd < text.length && isKeywordChar(text.charCodeAt(keyEnd))) keyEnd += 1;
	if (keyEnd === afterDate) return null;
	if (isIdentContinue(text.charCodeAt(keyEnd))) return null;
	const keyword = text.slice(afterDate, keyEnd);
	if (DATED_KEYWORDS[keyword] !== true) return null;
	return { kind: 'directive', date, keyword, keywordSpan: { from: afterDate, to: keyEnd } };
}

function postingBroken(line: string, parsed: ScannedPosting): boolean {
	if (parsed.number !== undefined) {
		if (parsed.commodity !== undefined) return false;
		const rest = stripComment(line.slice(parsed.number.to)).trim();
		if (rest === '') return false;
		const head = rest[0];
		return head !== '{' && head !== '@' && head !== '#' && head !== '^' && head !== ';' && head !== '*';
	}
	const rest = stripComment(line.slice(parsed.gapStart)).trim();
	const tokens = rest.split(/[ \t]+/);
	if (tokens.length < 2 || !isPlainNumber(tokens[0])) return false;
	const second = tokens[1];
	return second !== '*' && second[0] !== '{' && second[0] !== '@' && commodityOf(second) === null;
}

function isAsciiAccountChar(c: number): boolean {
	return (
		(c >= 0x41 && c <= 0x5a) ||
		(c >= 0x61 && c <= 0x7a) ||
		(c >= 0x30 && c <= 0x39) ||
		c === 0x5f ||
		c === 0x2d
	);
}

function isNameEndAscii(c: number): boolean {
	return (
		(c >= 0x41 && c <= 0x5a) ||
		(c >= 0x61 && c <= 0x7a) ||
		(c >= 0x30 && c <= 0x39) ||
		c === 0x5f
	);
}

function accountEndAt(text: string, at: number): number {
	const n = text.length;
	if (at >= n) return -1;
	const c0 = text.charCodeAt(at);
	if (c0 < 0x41 || c0 > 0x5a) return -1;
	let i = at + 1;
	let colons = 0;
	let segLen = 1;
	while (i < n) {
		const c = text.charCodeAt(i);
		if (c === 0x3a) {
			if (segLen === 0) return -1;
			colons += 1;
			segLen = 0;
			i += 1;
			continue;
		}
		if (isAsciiAccountChar(c)) {
			segLen += 1;
			i += 1;
			continue;
		}
		if (c > 0x7f) {
			if (isSpace(c)) break;
			let end = i + 1;
			while (end < n && !isSpace(text.charCodeAt(end)) && text.charCodeAt(end) !== 0x3b) end += 1;
			return ACCOUNT_UNI_EXACT.test(text.slice(at, end)) ? end : -1;
		}
		break;
	}
	if (colons === 0 || segLen === 0 || !isNameEndAscii(text.charCodeAt(i - 1))) return -1;
	if (i < n) {
		const stop = text.charCodeAt(i);
		if (!isSpace(stop) && stop !== 0x3b) return -1;
	}
	return i;
}

function numberEndAt(text: string, at: number): number {
	const n = text.length;
	let i = at;
	const sign = text.charCodeAt(i);
	if (sign === 0x2b || sign === 0x2d) i += 1;
	if (i >= n) return -1;
	const d0 = text.charCodeAt(i);
	if (d0 < 0x30 || d0 > 0x39) return -1;
	i += 1;
	while (i < n) {
		const c = text.charCodeAt(i);
		if ((c >= 0x30 && c <= 0x39) || c === 0x2c) {
			i += 1;
			continue;
		}
		break;
	}
	if (i < n && text.charCodeAt(i) === 0x2e) {
		i += 1;
		while (i < n) {
			const c = text.charCodeAt(i);
			if (c < 0x30 || c > 0x39) break;
			i += 1;
		}
	}
	if (i < n) {
		const next = text.charCodeAt(i);
		if (next !== 0x20 && next !== 0x09 && next !== 0x7b && next !== 0x40 && next !== 0x3b && !isSpace(next)) return -1;
	}
	return i;
}

export function commodityEndAt(text: string, at: number): number {
	const n = text.length;
	if (at >= n) return -1;
	if (text.charCodeAt(at) === 0x22) {
		let i = at + 1;
		while (i < n) {
			const c = text.charCodeAt(i);
			if (c === 0x20 || c === 0x09) return -1;
			if (c === 0x22) {
				i += 1;
				if (i >= n || isSpace(text.charCodeAt(i))) return i;
				return -1;
			}
			i += 1;
		}
		return -1;
	}
	if (text.charCodeAt(at) < 0x41 || text.charCodeAt(at) > 0x5a) return -1;
	let i = at + 1;
	let last = text.charCodeAt(at);
	while (i < n) {
		const c = text.charCodeAt(i);
		if (
			(c >= 0x41 && c <= 0x5a) ||
			(c >= 0x30 && c <= 0x39) ||
			c === 0x27 ||
			c === 0x2d ||
			c === 0x2e ||
			c === 0x5f
		) {
			if (i - at > 23) return -1;
			last = c;
			i += 1;
			continue;
		}
		break;
	}
	if (i - at < 2) return -1;
	if (!((last >= 0x41 && last <= 0x5a) || (last >= 0x30 && last <= 0x39))) return -1;
	if (i < n && !isSpace(text.charCodeAt(i))) return -1;
	return i;
}

function amountTailOk(line: string, at: number): boolean {
	const next = skipSpace(line, at);
	if (next >= line.length) return true;
	const c = line.charCodeAt(next);
	if (c === 0x7b || c === 0x40 || c === 0x3b) return true;
	return commodityEndAt(line, next) >= 0;
}

function annotationsFrom(line: string, from: number): { hasCost: boolean; hasPrice: boolean } {
	if (line.indexOf('{', from) < 0 && line.indexOf('@', from) < 0) return { hasCost: false, hasPrice: false };
	let hasCost = false;
	let hasPrice = false;
	quoteState.inString = false;
	quoteState.inComment = false;
	for (let i = from; i < line.length; i += 1) {
		i += stepQuoteComment(line, i, quoteState);
		if (quoteState.inComment) break;
		if (!quoteState.inString) {
			const ch = line.charCodeAt(i);
			if (ch === 0x7b) hasCost = true;
			else if (ch === 0x40) hasPrice = true;
		}
	}
	return { hasCost, hasPrice };
}

const amountCols = { gapStart: 0, numberFrom: 0, numberTo: 0 };

/**
 * Gap and units-amount columns of an indented posting. Reuses one object;
 * copy the fields before the next call. Same rules as `parsePostingLine`.
 */
export function postingAmountCols(line: string): { gapStart: number; numberFrom: number; numberTo: number } | null {
	if (line.length > 0 && line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1);
	let at = skipBlank(line, 0);
	if (at === 0 || line.charCodeAt(at) === 0x3b) return null;
	if (isFlagChar(line.charCodeAt(at))) {
		const afterFlag = skipBlank(line, at + 1);
		if (afterFlag > at + 1) at = afterFlag;
	}
	const accountTo = accountEndAt(line, at);
	if (accountTo < 0) return null;
	let cursor = accountTo;
	const flagAt = skipSpace(line, cursor);
	if (flagAt > cursor && isFlagChar(line.charCodeAt(flagAt))) {
		const next = flagAt + 1;
		if (next >= line.length || isSpace(line.charCodeAt(next))) cursor = next;
	}
	const gapEnd = skipSpace(line, cursor);
	if (gapEnd === cursor || line.charCodeAt(gapEnd) === 0x3b) return null;
	const numTo = numberEndAt(line, gapEnd);
	if (numTo < 0 || !amountTailOk(line, numTo)) return null;
	amountCols.gapStart = cursor;
	amountCols.numberFrom = gapEnd;
	amountCols.numberTo = numTo;
	return amountCols;
}

/**
 * An indented posting: optional leading flag, ACCOUNT_SHAPE, optional trailing
 * flag, optional units amount and commodity, plus cost/price markers.
 */
export function parsePostingLine(line: string): ScannedPosting | null {
	if (line.length > 0 && line.charCodeAt(line.length - 1) === 0x0d) line = line.slice(0, -1);
	let at = skipBlank(line, 0);
	if (at === 0 || line.charCodeAt(at) === 0x3b) return null;
	let leadingFlag: string | undefined;
	if (isFlagChar(line.charCodeAt(at))) {
		const afterFlag = skipBlank(line, at + 1);
		if (afterFlag > at + 1) {
			leadingFlag = line.charAt(at);
			at = afterFlag;
		}
	}
	const accountTo = accountEndAt(line, at);
	if (accountTo < 0) return null;
	const account = { text: line.slice(at, accountTo), span: { from: at, to: accountTo } };
	let cursor = accountTo;
	let trailingFlag: string | undefined;
	const flagAt = skipSpace(line, cursor);
	if (flagAt > cursor && isFlagChar(line.charCodeAt(flagAt))) {
		const next = flagAt + 1;
		if (next >= line.length || isSpace(line.charCodeAt(next))) {
			trailingFlag = line.charAt(flagAt);
			cursor = next;
		}
	}
	const gapStart = cursor;
	const flag = leadingFlag ?? trailingFlag;
	const gapEnd = skipSpace(line, cursor);
	if (gapEnd === cursor || line.charCodeAt(gapEnd) === 0x3b) {
		return { account, flag, leadingFlag, trailingFlag, gapStart, hasCost: false, hasPrice: false };
	}
	const numTo = numberEndAt(line, gapEnd);
	if (numTo < 0 || !amountTailOk(line, numTo)) {
		return { account, flag, leadingFlag, trailingFlag, gapStart, ...annotationsFrom(line, cursor) };
	}
	const commodityAt = skipSpace(line, numTo);
	let commodity: LineSpan | undefined;
	let after = numTo;
	if (commodityAt < line.length) {
		const cEnd = commodityEndAt(line, commodityAt);
		if (cEnd >= 0) {
			commodity = { from: commodityAt, to: cEnd };
			after = cEnd;
		}
	}
	return {
		account,
		flag,
		leadingFlag,
		trailingFlag,
		gapStart,
		number: { from: gapEnd, to: numTo },
		commodity,
		...annotationsFrom(line, after),
	};
}

function indentedKind(line: string): LineKind {
	if (isCommentLine(line)) return 'comment';
	if (parsePostingLine(line) !== null) return 'posting';
	if (META_RE.test(line.slice(skipBlank(line, 0)))) return 'metadata';
	return 'other';
}

export function classifyLine(line: string, inStringStart = false): LineKind {
	const text = stripCR(line);
	if (inStringStart) return 'string-continue';
	if (isBlank(text)) return 'blank';
	if (isOrgLine(text)) return 'org';
	if (isCommentLine(text)) return 'comment';
	if (isIndented(text)) return indentedKind(text);
	const header = parseHeaderLine(text);
	if (header !== null) return header.kind;
	return 'other';
}

export function canonicalTxnFlag(token: string): string {
	return token === 'txn' ? '*' : token;
}

function closesEntry(kind: LineKind, line: string): boolean {
	if (kind === 'blank' || kind === 'org') return true;
	if (kind === 'comment' && !isIndented(line)) return true;
	if (kind === 'txn-header' || kind === 'directive') return true;
	if (kind === 'other' && !isIndented(line)) return true;
	return false;
}

/**
 * Walk forward from a header at `start` using `readLine`. Stops at the first
 * line that ends the entry, or returns null when more than `maxLines` would
 * attach (fold uses this so a truncated parse cannot hide the wrong range).
 */
export function entryExtent(
	readLine: (index: number) => string | undefined,
	start: number,
	maxLines = Number.POSITIVE_INFINITY
): { from: number; to: number } | null {
	const header = readLine(start);
	if (header === undefined) return null;
	const headerKind = classifyLine(header);
	if (headerKind !== 'txn-header' && headerKind !== 'directive') return null;
	let inString = endsInString(header, false);
	let end = start;
	let n = 1;
	while (n < maxLines) {
		const text = readLine(start + n);
		if (text === undefined) break;
		const kind = classifyLine(text, inString);
		if (!inString && closesEntry(kind, text)) break;
		end = start + n;
		inString = endsInString(text, inString);
		n += 1;
	}
	if (n >= maxLines && Number.isFinite(maxLines)) {
		const extra = readLine(start + n);
		if (extra !== undefined) {
			const kind = classifyLine(extra, inString);
			if (inString || !closesEntry(kind, extra)) return null;
		}
	}
	return { from: start, to: end };
}

export function entryAt(
	lines: readonly string[],
	line: number,
	maxLines?: number
): { from: number; to: number } | null {
	if (line < 0 || line >= lines.length) return null;
	let start = line;
	while (start > 0) {
		const kind = classifyLine(lines[start] ?? '');
		if (kind === 'txn-header' || kind === 'directive') break;
		if (start < line && closesEntry(kind, lines[start] ?? '')) return null;
		start -= 1;
	}
	const range = entryExtent((i) => lines[i], start, maxLines);
	if (range === null || line < range.from || line > range.to) return null;
	return range;
}

export function scanLedger(text: string): ScanResult {
	if (text === '') return { lines: [], entries: [] };
	const rawLines = text.split('\n');
	const lines: LineKind[] = [];
	const entries: ScannedEntry[] = [];
	let inString = false;
	let current: ScannedEntry | null = null;

	const closeCurrent = (endLine: number): void => {
		if (current === null) return;
		current.endLine = endLine;
		entries.push(current);
		current = null;
	};

	for (let i = 0; i < rawLines.length; i += 1) {
		const line = stripCR(rawLines[i]);
		const stringOpenAtStart = inString;
		const kind = classifyLine(line, inString);
		lines.push(kind);
		inString = endsInString(line, inString);

		if (!stringOpenAtStart && (kind === 'txn-header' || kind === 'directive')) {
			closeCurrent(i - 1);
			current = {
				startLine: i,
				endLine: i,
				damaged: false,
				header: parseHeaderLine(line) ?? undefined,
				postings: [],
			};
			continue;
		}

		if (current === null) continue;
		if (!stringOpenAtStart && closesEntry(kind, line)) {
			closeCurrent(i - 1);
			continue;
		}
		current.endLine = i;
		if (kind === 'posting') {
			const parsed = parsePostingLine(line);
			if (parsed !== null) {
				current.postings.push(parsed);
				if (postingBroken(line, parsed)) current.damaged = true;
			}
		} else if (kind === 'other' && isIndented(line)) {
			current.damaged = true;
		}
	}
	if (current !== null) {
		if (inString) current.damaged = true;
		entries.push(current);
	}
	return { lines, entries };
}
