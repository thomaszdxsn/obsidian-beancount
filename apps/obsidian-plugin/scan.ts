/**
 * Tolerant line scan over Ledger text: classify each line, cut Scanned
 * entries, and parse posting fields. Never throws; a damaged entry still
 * has bounds. Account names follow the editor `ACCOUNT_SHAPE`, not g4.
 */
const SEGMENT_CHARS = String.raw`\p{L}\p{N}\p{M}_\-·・`;
const SEGMENT = `[${SEGMENT_CHARS}]`;
const NAME_END = String.raw`(?<=[\p{L}\p{N}\p{M}_])`;

/**
 * A complete account name: a capitalized root plus one or more `:segment`
 * parts (`Assets:Cash:Wallet`, `Expenses:餐饮:午饭`). Segment characters are
 * Unicode letters, digits and marks, `-`, `_` and the middle dots `·` / `・`.
 */
export const ACCOUNT_SHAPE = String.raw`[A-Z]${SEGMENT}*(?::${SEGMENT}+)+${NAME_END}`;

const ACCOUNT_EXACT = new RegExp(`^${ACCOUNT_SHAPE}$`, 'u');
const ACCOUNT_AT = new RegExp(ACCOUNT_SHAPE, 'uy');
const META_RE = /^[a-z][A-Za-z0-9\-_]+:/;
const NUMBER_RE = /[-+]?[0-9][0-9,]*(?:\.[0-9]*)?(?=\s|$)/y;
const COMMODITY_RE = /(?:[A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")(?=\s|$)/y;
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

export interface ScannedPosting {
	flag?: string;
	account?: { text: string; span: LineSpan };
	number?: LineSpan;
	commodity?: LineSpan;
	hasCost: boolean;
	hasPrice: boolean;
}

export interface ScannedEntry {
	startLine: number;
	endLine: number;
	damaged: boolean;
	header?: {
		date: string;
		flag?: string;
		keyword?: string;
		payee?: LineSpan;
		narration?: LineSpan;
	};
	postings: ScannedPosting[];
}

export interface ScanResult {
	lines: readonly LineKind[];
	entries: readonly ScannedEntry[];
}

interface HeaderFields {
	kind: 'txn-header' | 'directive';
	date: string;
	flag?: string;
	keyword?: string;
	payee?: LineSpan;
	narration?: LineSpan;
}

function stripCR(line: string): string {
	return line.charAt(line.length - 1) === '\r' ? line.slice(0, -1) : line;
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

function skipBlank(line: string, at: number): number {
	while (at < line.length && (line.charCodeAt(at) === 0x20 || line.charCodeAt(at) === 0x09)) at += 1;
	return at;
}

function isFlagCode(c: number): boolean {
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

function amountTailOk(line: string, at: number): boolean {
	const next = skipSpace(line, at);
	if (next >= line.length) return true;
	if (ANNOTATION_STARTS[line[next]] === true) return true;
	COMMODITY_RE.lastIndex = next;
	return COMMODITY_RE.test(line);
}

function quotedSpan(line: string, from: number): { span: LineSpan; end: number } | null {
	const start = skipBlank(line, from);
	if (line.charCodeAt(start) !== 0x22) return null;
	let i = start + 1;
	const innerFrom = i;
	while (i < line.length) {
		const ch = line.charCodeAt(i);
		if (ch === 0x5c && i + 1 < line.length) {
			i += 2;
			continue;
		}
		if (ch === 0x22) return { span: { from: innerFrom, to: i }, end: i + 1 };
		i += 1;
	}
	return null;
}

function parseHeader(line: string): HeaderFields | null {
	if (line.length < 10) return null;
	const y0 = line.charCodeAt(0);
	if (y0 < 0x30 || y0 > 0x39) return null;
	const sep = line.charCodeAt(4);
	if (sep !== 0x2d && sep !== 0x2f) return null;
	if (
		!(
			line.charCodeAt(1) >= 0x30 &&
			line.charCodeAt(1) <= 0x39 &&
			line.charCodeAt(2) >= 0x30 &&
			line.charCodeAt(2) <= 0x39 &&
			line.charCodeAt(3) >= 0x30 &&
			line.charCodeAt(3) <= 0x39 &&
			line.charCodeAt(5) >= 0x30 &&
			line.charCodeAt(5) <= 0x39 &&
			line.charCodeAt(6) >= 0x30 &&
			line.charCodeAt(6) <= 0x39 &&
			line.charCodeAt(7) === sep &&
			line.charCodeAt(8) >= 0x30 &&
			line.charCodeAt(8) <= 0x39 &&
			line.charCodeAt(9) >= 0x30 &&
			line.charCodeAt(9) <= 0x39
		)
	) {
		return null;
	}
	const date = line.slice(0, 10);
	let at = 10;
	const afterDate = skipBlank(line, at);
	if (afterDate >= line.length) return null;

	if (line.startsWith('txn', afterDate) && !isIdentContinue(line.charCodeAt(afterDate + 3))) {
		return txnHeader(line, date, 'txn', afterDate + 3);
	}
	const flagCode = line.charCodeAt(afterDate);
	if (isFlagCode(flagCode) && !isIdentContinue(line.charCodeAt(afterDate + 1))) {
		return txnHeader(line, date, line.charAt(afterDate), afterDate + 1);
	}
	if (afterDate === at) return null;
	at = afterDate;
	let keyEnd = at;
	while (keyEnd < line.length && isKeywordChar(line.charCodeAt(keyEnd))) keyEnd += 1;
	if (keyEnd === at) return null;
	if (isIdentContinue(line.charCodeAt(keyEnd))) return null;
	const keyword = line.slice(at, keyEnd);
	if (DATED_KEYWORDS[keyword] !== true) return null;
	return { kind: 'directive', date, keyword };
}

function txnHeader(line: string, date: string, flag: string, restAt: number): HeaderFields {
	const first = quotedSpan(line, restAt);
	if (first === null) return { kind: 'txn-header', date, flag };
	const second = quotedSpan(line, first.end);
	if (second === null) return { kind: 'txn-header', date, flag, payee: first.span };
	return { kind: 'txn-header', date, flag, payee: first.span, narration: second.span };
}

function isIdentContinue(c: number): boolean {
	return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
}

function isKeywordChar(c: number): boolean {
	return (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
}

function indentedKind(line: string): LineKind {
	if (isCommentLine(line)) return 'comment';
	if (parsePostingLine(line) !== null) return 'posting';
	const body = line.slice(skipBlank(line, 0));
	if (META_RE.test(body)) return 'metadata';
	return 'other';
}

/**
 * Classify one line. `inStringStart` means a `"` string is still open from
 * the previous line: the whole line is `string-continue`.
 */
export function classifyLine(line: string, inStringStart = false): LineKind {
	const text = stripCR(line);
	if (inStringStart) return 'string-continue';
	if (isBlank(text)) return 'blank';
	if (isOrgLine(text)) return 'org';
	if (isCommentLine(text)) return 'comment';
	const head = text.charCodeAt(0);
	if (head === 0x20 || head === 0x09) return indentedKind(text);
	const header = parseHeader(text);
	if (header !== null) return header.kind;
	return 'other';
}

/** `txn` → `*`; every other flag token is returned as written. */
export function canonicalTxnFlag(token: string): string {
	return token === 'txn' ? '*' : token;
}

/**
 * Whether `line` ends inside a `"` string. A `;` outside a string starts a
 * comment and is not scanned. A backslash escapes the next character on this
 * line only.
 */
export function endsInString(line: string, inStringStart: boolean): boolean {
	if (!inStringStart && !line.includes('"')) return false;
	let inString = inStringStart;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (inString) {
			if (ch === '\\' && i + 1 < line.length) {
				i += 1;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === ';') break;
	}
	return inString;
}

/**
 * Whether the cursor prefix sits in an unclosed quoted string or a `;`
 * comment. Quotes outside strings are field delimiters; escapes inside a
 * string are respected.
 */
export function inStringOrComment(prefix: string): boolean {
	let inString = false;
	for (let i = 0; i < prefix.length; i += 1) {
		const ch = prefix[i];
		if (inString && ch === '\\') {
			i += 1;
		} else if (ch === '"') {
			inString = !inString;
		} else if (ch === ';' && !inString) {
			return true;
		}
	}
	return inString;
}

/** Text before the first `;` that is not inside a `"` string. */
export function stripComment(line: string): string {
	let quote = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line.charAt(i);
		if (ch === '\\' && quote) {
			i += 1;
			continue;
		}
		if (ch === '"') quote = !quote;
		else if (ch === ';' && !quote) return line.slice(0, i);
	}
	return line;
}

function annotationFlags(line: string, from: number): { hasCost: boolean; hasPrice: boolean } {
	const rest = stripComment(line.slice(from));
	return { hasCost: rest.includes('{'), hasPrice: rest.includes('@') };
}

/**
 * An indented posting: optional flag, ACCOUNT_SHAPE, optional trailing flag,
 * optional units amount and commodity, plus cost/price markers. Null when
 * the line is not a posting.
 */
export function parsePostingLine(line: string): ScannedPosting | null {
	const text = stripCR(line);
	let at = skipBlank(text, 0);
	if (at === 0) return null;
	if (text.charCodeAt(at) === 0x3b) return null;

	let flag: string | undefined;
	if (isFlagCode(text.charCodeAt(at))) {
		const afterFlag = skipBlank(text, at + 1);
		if (afterFlag > at + 1) {
			flag = text.charAt(at);
			at = afterFlag;
		}
	}

	ACCOUNT_AT.lastIndex = at;
	const accountMatch = ACCOUNT_AT.exec(text);
	if (accountMatch === null || accountMatch.index !== at) return null;
	const accountEnd = at + accountMatch[0].length;
	const afterAccount = text.charCodeAt(accountEnd);
	if (accountEnd < text.length && !isSpace(afterAccount) && afterAccount !== 0x3b) return null;
	if (!ACCOUNT_EXACT.test(accountMatch[0])) return null;
	const account = { text: accountMatch[0], span: { from: at, to: accountEnd } };

	let cursor = accountEnd;
	const flagAt = skipSpace(text, cursor);
	if (
		flagAt > cursor &&
		isFlagCode(text.charCodeAt(flagAt)) &&
		(flagAt + 1 >= text.length || isSpace(text.charCodeAt(flagAt + 1)))
	) {
		flag = text.charAt(flagAt);
		cursor = flagAt + 1;
	}

	const gapEnd = skipSpace(text, cursor);
	if (gapEnd === cursor || text.charCodeAt(gapEnd) === 0x3b) {
		return { flag, account, ...annotationFlags(text, cursor) };
	}

	NUMBER_RE.lastIndex = gapEnd;
	const number = NUMBER_RE.exec(text);
	if (number === null || !amountTailOk(text, NUMBER_RE.lastIndex)) {
		return { flag, account, ...annotationFlags(text, cursor) };
	}
	const numberSpan: LineSpan = { from: gapEnd, to: NUMBER_RE.lastIndex };
	let afterNumber = NUMBER_RE.lastIndex;
	const commodityAt = skipSpace(text, afterNumber);
	COMMODITY_RE.lastIndex = commodityAt;
	let commodity: LineSpan | undefined;
	if (commodityAt < text.length && COMMODITY_RE.test(text)) {
		commodity = { from: commodityAt, to: COMMODITY_RE.lastIndex };
		afterNumber = COMMODITY_RE.lastIndex;
	}
	return {
		flag,
		account,
		number: numberSpan,
		commodity,
		...annotationFlags(text, afterNumber),
	};
}

function headerFromLine(line: string): ScannedEntry['header'] | undefined {
	const parsed = parseHeader(line);
	if (parsed === null) return undefined;
	return {
		date: parsed.date,
		flag: parsed.flag,
		keyword: parsed.keyword,
		payee: parsed.payee,
		narration: parsed.narration,
	};
}

function isIndented(line: string): boolean {
	const head = line.charCodeAt(0);
	return head === 0x20 || head === 0x09;
}

function closesEntry(kind: LineKind, line: string): boolean {
	if (kind === 'blank' || kind === 'org') return true;
	if (kind === 'comment' && !isIndented(line)) return true;
	if (kind === 'txn-header' || kind === 'directive') return true;
	if (kind === 'other' && !isIndented(line)) return true;
	return false;
}

/**
 * Classify every line of `text` and cut Scanned entries. Empty text yields
 * no lines and no entries — not a single blank line.
 */
export function scanLedger(text: string): ScanResult {
	if (text === '') return { lines: [], entries: [] };
	const rawLines = text.split('\n');
	const lines: LineKind[] = [];
	const entries: ScannedEntry[] = [];
	let inString = false;
	let current: ScannedEntry | null = null;
	let stringOpenAtStart = false;

	const closeCurrent = (endLine: number, damaged: boolean): void => {
		if (current === null) return;
		current.endLine = endLine;
		if (damaged) current.damaged = true;
		entries.push(current);
		current = null;
	};

	for (let i = 0; i < rawLines.length; i += 1) {
		const line = stripCR(rawLines[i]);
		stringOpenAtStart = inString;
		if (inString && !isIndented(line) && parseHeader(line) !== null) {
			closeCurrent(i - 1, true);
			inString = false;
			stringOpenAtStart = false;
		}
		const kind = classifyLine(line, inString);
		lines.push(kind);
		inString = endsInString(line, inString);

		if (kind === 'txn-header' || kind === 'directive') {
			closeCurrent(i - 1, false);
			
			current = {
				startLine: i,
				endLine: i,
				damaged: false,
				header: headerFromLine(line),
				postings: [],
			};
			continue;
		}

		if (current === null) continue;

		if (!stringOpenAtStart && closesEntry(kind, line)) {
			closeCurrent(i - 1, false);
			continue;
		}

		current.endLine = i;
		if (kind === 'posting') {
			const parsed = parsePostingLine(line);
			if (parsed !== null) current.postings.push(parsed);
		}
		
	}

	if (current !== null) {
		if (inString) current.damaged = true;
		entries.push(current);
	}
	return { lines, entries };
}

/**
 * Inclusive `[from, to]` of the Scanned entry that holds `line`, or null.
 * Line numbers are 0-based in `lines`.
 */
export function entryAt(lines: readonly string[], line: number): { from: number; to: number } | null {
	if (line < 0 || line >= lines.length) return null;
	const { entries } = scanLedger(lines.join('\n'));
	for (const entry of entries) {
		if (line >= entry.startLine && line <= entry.endLine) {
			return { from: entry.startLine, to: entry.endLine };
		}
	}
	return null;
}
