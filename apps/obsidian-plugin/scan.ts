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

const ACCOUNT_ASCII_EXACT = /^[A-Z][A-Za-z0-9_]*(?::[A-Za-z0-9_]+)+$/;
const ACCOUNT_UNI_EXACT = new RegExp(`^${ACCOUNT_SHAPE}$`, 'u');
const META_RE = /^[a-z][A-Za-z0-9\-_]+:/;
const NUMBER_BODY = '[-+]?[0-9][0-9,]*(?:\\.[0-9]*)?';
const NUMBER_RE = new RegExp(NUMBER_BODY + '(?=\\s|$|[{@;])', 'y');
const NUMBER_EXACT = new RegExp('^' + NUMBER_BODY + '$');
const COMMODITY_BODY = String.raw`(?:[A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")`;
const COMMODITY_RE = new RegExp(COMMODITY_BODY + '(?=\\s|$)', 'y');
const COMMODITY_EXACT = new RegExp('^' + COMMODITY_BODY + '$');
const ANNOTATION_STARTS: Record<string, true> = { '{': true, '@': true, ';': true };

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

function isSpace(c: number): boolean {
	if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return true;
	if (c < 0xa0) return false;
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

function skipSpace(line: string, at: number): number {
	while (at < line.length && isSpace(line.charCodeAt(at))) at += 1;
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
 * One step of the quote / `;` comment machine. A trailing `\` inside a
 * string does not escape the next line (`skip` is 0 at end of line).
 */
export function stepQuoteComment(
	line: string,
	i: number,
	inString: boolean,
	inComment: boolean
): { inString: boolean; inComment: boolean; skip: number } {
	if (inComment) return { inString: false, inComment: true, skip: 0 };
	const ch = line[i];
	if (inString) {
		if (ch === '\\' && i + 1 < line.length) return { inString: true, inComment: false, skip: 1 };
		if (ch === '"') return { inString: false, inComment: false, skip: 0 };
		return { inString: true, inComment: false, skip: 0 };
	}
	if (ch === '"') return { inString: true, inComment: false, skip: 0 };
	if (ch === ';') return { inString: false, inComment: true, skip: 0 };
	return { inString: false, inComment: false, skip: 0 };
}

function scanQuoteComment(line: string, inStringStart: boolean): { inString: boolean; commentAt: number } {
	if (!inStringStart && !line.includes('"') && !line.includes(';')) {
		return { inString: false, commentAt: -1 };
	}
	let inString = inStringStart;
	let inComment = false;
	for (let i = 0; i < line.length; i += 1) {
		const step = stepQuoteComment(line, i, inString, inComment);
		if (!inComment && step.inComment) return { inString: false, commentAt: i };
		inString = step.inString;
		inComment = step.inComment;
		i += step.skip;
	}
	return { inString, commentAt: -1 };
}

export function endsInString(line: string, inStringStart: boolean): boolean {
	return scanQuoteComment(line, inStringStart).inString;
}

export function inStringOrComment(prefix: string): boolean {
	const { inString, commentAt } = scanQuoteComment(prefix, false);
	return inString || commentAt >= 0;
}

export function stripComment(line: string): string {
	const { commentAt } = scanQuoteComment(line, false);
	return commentAt < 0 ? line : line.slice(0, commentAt);
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
	return NUMBER_EXACT.test(token);
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
	while (i < line.length) {
		const step = stepQuoteComment(line, i, true, false);
		if (!step.inString) return { span: { from: innerFrom, to: i }, end: i + 1 };
		i += 1 + step.skip;
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

/** Parse a column-0 dated header. Does not scan the rest of the file. */
export function parseHeaderLine(line: string): ScannedHeader | null {
	const text = stripCR(line);
	if (text.length < 10) return null;
	const y0 = text.charCodeAt(0);
	if (y0 < 0x30 || y0 > 0x39) return null;
	const sep = text.charCodeAt(4);
	if (sep !== 0x2d && sep !== 0x2f) return null;
	if (
		!(
			text.charCodeAt(1) >= 0x30 &&
			text.charCodeAt(1) <= 0x39 &&
			text.charCodeAt(2) >= 0x30 &&
			text.charCodeAt(2) <= 0x39 &&
			text.charCodeAt(3) >= 0x30 &&
			text.charCodeAt(3) <= 0x39 &&
			text.charCodeAt(5) >= 0x30 &&
			text.charCodeAt(5) <= 0x39 &&
			text.charCodeAt(6) >= 0x30 &&
			text.charCodeAt(6) <= 0x39 &&
			text.charCodeAt(7) === sep &&
			text.charCodeAt(8) >= 0x30 &&
			text.charCodeAt(8) <= 0x39 &&
			text.charCodeAt(9) >= 0x30 &&
			text.charCodeAt(9) <= 0x39
		)
	) {
		return null;
	}
	const date = text.slice(0, 10);
	const afterDate = skipBlank(text, 10);
	if (afterDate >= text.length) return null;
	if (text.startsWith('txn', afterDate) && !isIdentContinue(text.charCodeAt(afterDate + 3))) {
		return txnHeader(text, date, 'txn', afterDate, afterDate + 3);
	}
	const flagCode = text.charCodeAt(afterDate);
	if (isFlagChar(flagCode) && !isIdentContinue(text.charCodeAt(afterDate + 1))) {
		return txnHeader(text, date, text.charAt(afterDate), afterDate, afterDate + 1);
	}
	if (afterDate === 10) return null;
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

function amountTailOk(line: string, at: number): boolean {
	const next = skipSpace(line, at);
	if (next >= line.length) return true;
	if (ANNOTATION_STARTS[line[next]] === true) return true;
	COMMODITY_RE.lastIndex = next;
	return COMMODITY_RE.test(line);
}

function annotationsFrom(line: string, from: number): { hasCost: boolean; hasPrice: boolean } {
	if (line.indexOf('{', from) < 0 && line.indexOf('@', from) < 0) return { hasCost: false, hasPrice: false };
	
	let hasCost = false;
	let hasPrice = false;
	let inString = false;
	let inComment = false;
	for (let i = from; i < line.length; i += 1) {
		const step = stepQuoteComment(line, i, inString, inComment);
		if (step.inComment) break;
		if (!step.inString) {
			const ch = line[i];
			if (ch === '{') hasCost = true;
			else if (ch === '@') hasPrice = true;
		}
		inString = step.inString;
		inComment = step.inComment;
		i += step.skip;
	}
	return { hasCost, hasPrice };
}


/**
 * An indented posting: optional leading flag, ACCOUNT_SHAPE, optional trailing
 * flag, optional units amount and commodity, plus cost/price markers.
 */
export function parsePostingLine(line: string): ScannedPosting | null {
	const text = stripCR(line);
	let at = skipBlank(text, 0);
	if (at === 0) return null;
	if (text.charCodeAt(at) === 0x3b) return null;

	let leadingFlag: string | undefined;
	if (isFlagChar(text.charCodeAt(at))) {
		const afterFlag = skipBlank(text, at + 1);
		if (afterFlag > at + 1) {
			leadingFlag = text.charAt(at);
			at = afterFlag;
		}
	}

	let accountEnd = at;
	while (accountEnd < text.length && !isSpace(text.charCodeAt(accountEnd)) && text.charCodeAt(accountEnd) !== 0x3b) {
		accountEnd += 1;
	}
	if (accountEnd === at) return null;
	const token = text.slice(at, accountEnd);
	if (!ACCOUNT_ASCII_EXACT.test(token) && !ACCOUNT_UNI_EXACT.test(token)) {
		return null;
	}
	const account = { text: token, span: { from: at, to: accountEnd } };

	let cursor = accountEnd;
	let trailingFlag: string | undefined;
	const flagAt = skipSpace(text, cursor);
	if (
		flagAt > cursor &&
		isFlagChar(text.charCodeAt(flagAt)) &&
		(flagAt + 1 >= text.length || isSpace(text.charCodeAt(flagAt + 1)))
	) {
		trailingFlag = text.charAt(flagAt);
		cursor = flagAt + 1;
	}
	const gapStart = cursor;
	const flag = leadingFlag ?? trailingFlag;

	const gapEnd = skipSpace(text, cursor);
	if (gapEnd === cursor || text.charCodeAt(gapEnd) === 0x3b) {
		return { account, flag, leadingFlag, trailingFlag, gapStart, ...annotationsFrom(text, cursor) };
	}

	NUMBER_RE.lastIndex = gapEnd;
	if (!NUMBER_RE.test(text) || !amountTailOk(text, NUMBER_RE.lastIndex)) {
		return { account, flag, leadingFlag, trailingFlag, gapStart, ...annotationsFrom(text, cursor) };
	}
	const number: LineSpan = { from: gapEnd, to: NUMBER_RE.lastIndex };
	let afterNumber = NUMBER_RE.lastIndex;
	let commodity: LineSpan | undefined;
	if (amountTailOk(text, afterNumber)) {
		const commodityAt = skipSpace(text, afterNumber);
		COMMODITY_RE.lastIndex = commodityAt;
		if (commodityAt < text.length && COMMODITY_RE.test(text)) {
			commodity = { from: commodityAt, to: COMMODITY_RE.lastIndex };
			afterNumber = COMMODITY_RE.lastIndex;
		}
	}
	return {
		account,
		flag,
		leadingFlag,
		trailingFlag,
		gapStart,
		number,
		commodity,
		...annotationsFrom(text, afterNumber),
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
