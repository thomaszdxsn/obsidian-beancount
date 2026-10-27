/**
 * Decimal-point alignment for beancount postings.
 *
 * `computeAlignment` turns the posting lines of a *transaction block* into gap
 * rewrites that put the block's amounts on one shared decimal-point column:
 * the amount's `sign + integer` block right-aligns at the column, the fraction
 * follows the dot. An amount without a decimal point (`10 AAPL`) aligns its
 * integer block the same way, so it sits on the same units column as
 * `10.5 AAPL`. Every block computes its own column: aligning one transaction
 * never moves another, and a wide amount elsewhere cannot pad a narrow one
 * here.
 *
 * A block is a transaction header with the indented lines under it —
 * postings, metadata — or a run of loose indented lines. A blank line or a
 * comment at column 0 ends a block, matching how the syntax mode ends an
 * entry.
 *
 * Only the *units* amount of a posting is aligned. Cost (`{150.00 USD}`) and
 * price (`@ 7.2 CNY`) annotations keep their numbers where the syntax puts
 * them — those numbers are only reachable by padding *inside* the annotation,
 * and their column would be dictated by whatever precedes them. Arithmetic
 * amounts (`2 * 3.00 USD`) are left out too: they have no single decimal
 * point to align.
 *
 * Only posting-shaped lines are rewritten: an indented account, optionally
 * flagged (`  * Assets:Cash …` or `  Assets:Cash * …`), followed by the
 * amount. The account is recognized by the shape the syntax mode highlights
 * (`Assets:Cash`, `Expenses:餐饮`), so prose tokens, URLs (`https://…`) and
 * wikilinks never set a column. Metadata (` note: …`), comments, directives
 * and prose keep their original spacing. Everything else on a line — indent,
 * flags, account, text after the amount — is preserved verbatim and only the
 * whitespace before the amount changes, so applying the edits is idempotent
 * and never disturbs text the feature does not own.
 * A line that continues an open `"` string is not a posting, even when the
 * text looks like one. A `"` inside a `;` comment does not open a string.

 */

import { extractBeancountFences } from './fences';

/** Minimum whitespace between the account (and its flag) and the amount. */
const MIN_GAP = 1;

/**
 * JS `\s` (WhiteSpace and LineTerminator), as one UTF-16 code unit: what
 * separates the tokens of a posting line.
 */
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

/** Offset past the `\s` run at `at`. */
function skipSpace(line: string, at: number): number {
	while (at < line.length && isSpace(line.charCodeAt(at))) at += 1;
	return at;
}

/** Offset past the `[ \t]` run at `at`. */
function skipBlank(line: string, at: number): number {
	while (at < line.length && (line.charCodeAt(at) === 0x20 || line.charCodeAt(at) === 0x09)) at += 1;
	return at;
}

/**
 * An account as the syntax mode highlights it: a capitalized root plus
 * `:segment` parts. Segments may hold non-ASCII characters (`Expenses:餐饮`),
 * which is exactly why nothing prose-shaped leaks in: URLs start lowercase,
 * wikilinks start with a bracket, and metadata keys (`note:`) have no segment.
 */
const ACCOUNT_RE = /^[A-Z][a-z]+(?::[^\s:]+)+$/;

/** A posting flag: `*!&#?%` or a single capital. */
function isFlag(c: number): boolean {
	return (c >= 0x41 && c <= 0x5a) || c === 0x2a || c === 0x21 || c === 0x26 || c === 0x23 || c === 0x3f || c === 0x25;
}

/**
 * The units amount: optional sign, integer (thousands separators allowed),
 * optional fraction. The lookahead keeps the match a whole token, so
 * `12.34.56` and `12.5USD` are not amounts.
 */
const NUMBER_RE = /[-+]?[0-9][0-9,]*(?:\.[0-9]*)?(?=\s|$)/y;

/** A commodity: uppercase word or quoted word, as the syntax mode sees them. */
const COMMODITY_RE = /(?:[A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")(?=\s|$)/y;

/** Syntax that may follow an amount still being typed without its commodity. */
const ANNOTATION_STARTS: Record<string, true> = { '{': true, '@': true, ';': true };

/** The whitespace rewrite that moves one amount's decimal point. */
export interface LineEdit {
	line: number;
	/** Column where the whitespace before the amount starts. */
	from: number;
	/** Column where that whitespace ends (the amount starts). */
	to: number;
	/** Replacement whitespace: a run of spaces landing the amount. */
	text: string;
}

/** A contiguous span of lines, inclusive. */
export interface LineRange {
	from: number;
	to: number;
}

interface Posting {
	gapStart: number;
	gapEnd: number;
	/** Display width of the line before the gap (indent + flags + account). */
	prefixWidth: number;
	/** Characters of the amount before its decimal point (sign + integer). */
	beforeDot: number;
	/** Line index and transaction block, set by `computeAlignment`. */
	line: number;
	block: number;
}

/**
 * Whether `line` ends inside a `"` string. A `;` outside a string starts a
 * comment and is not scanned, so a quote there cannot open a string that
 * swallows the next line. Inside a string, a backslash escapes the next
 * character on this line only: a trailing backslash does not swallow the
 * newline. Alignment and formatting share this scan.
 */
export function endsInString(line: string, inStringStart: boolean): boolean {
	// Most lines hold no quote at all: nothing can open a string.
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

/** Where the decimal point sits inside a number token; integers end there. */
function dotOffset(number: string): number {
	const dot = number.indexOf('.');
	return dot === -1 ? number.length : dot;
}

/** What may follow the amount: nothing, a commodity, or annotation syntax. */
function amountTailOk(line: string, at: number): boolean {
	const next = skipSpace(line, at);
	if (next >= line.length) return true;
	if (ANNOTATION_STARTS[line[next]] === true) return true;
	COMMODITY_RE.lastIndex = next;
	return COMMODITY_RE.test(line);
}

function parsePosting(line: string): Posting | null {
	// Postings are indented; directives (`2026-01-01 balance …`, `include`)
	// start at column 0 and are out of scope.
	let at = skipBlank(line, 0);
	if (at === 0) return null;

	// The flag may precede the account (`  * Assets:Cash …`).
	if (isFlag(line.charCodeAt(at))) {
		const afterFlag = skipBlank(line, at + 1);
		if (afterFlag > at + 1) at = afterFlag;
	}

	let accountEnd = at;
	while (accountEnd < line.length && !isSpace(line.charCodeAt(accountEnd))) accountEnd += 1;
	if (accountEnd === at || !ACCOUNT_RE.test(line.slice(at, accountEnd))) return null;

	// …or sit between account and amount (`  Assets:Cash * 12.50 USD`);
	// it stays with the account, so the gap after it is what gets rewritten.
	let gapStart = accountEnd;
	const flagAt = skipSpace(line, gapStart);
	if (
		flagAt > gapStart &&
		isFlag(line.charCodeAt(flagAt)) &&
		(flagAt + 1 >= line.length || isSpace(line.charCodeAt(flagAt + 1)))
	) {
		gapStart = flagAt + 1;
	}

	const gapEnd = skipSpace(line, gapStart);
	if (gapEnd === gapStart) return null;

	NUMBER_RE.lastIndex = gapEnd;
	const number = NUMBER_RE.exec(line);
	if (number === null || !amountTailOk(line, NUMBER_RE.lastIndex)) return null;

	return {
		gapStart,
		gapEnd,
		prefixWidth: displayWidth(line.slice(0, gapStart)),
		beforeDot: dotOffset(number[0]),
		line: 0,
		block: -1,
	};
}

/** How a line takes part in a transaction block; see `scanBlocks`. */
const enum BlockRole {
	/** Blank, or a comment at column 0: belongs to no block and ends the open one. */
	Close,
	/** Content at column 0: opens a block of its own. */
	Open,
	/** Indented content: joins the open block, or opens a loose run. */
	Join,
}

function blockRole(line: string): BlockRole {
	const head = line.charAt(0);
	// `skipSpace` over the whole line: blank as `line.trim() === ''`.
	if (head === ';' || skipSpace(line, 0) === line.length) return BlockRole.Close;
	return head !== ' ' && head !== '\t' ? BlockRole.Open : BlockRole.Join;
}

/**
 * The transaction block each line in `[from, to]` belongs to (`-1` on lines
 * that close a block: blank lines and comments at column 0). A line at
 * column 0 opens a block of its own; indented lines join the open one, or
 * open a run of loose postings when none is open. Ids are only compared, so
 * a scan starting mid-file groups the lines of its range exactly as a scan
 * from line 0 would.
 */
function scanBlocks(lines: readonly string[], from = 0, to = lines.length - 1): number[] {
	const blockOfLine: number[] = [];
	let block = -1;
	let next = 0;
	for (let i = Math.max(0, from); i <= to && i < lines.length; i += 1) {
		const role = blockRole(lines[i]);
		if (role === BlockRole.Close) {
			block = -1;
		} else if (role === BlockRole.Open || block === -1) {
			block = next++;
		}
		blockOfLine[i] = block;
	}
	return blockOfLine;
}

/**
 * The block of lines containing `line`; a lone line when there is none.
 * Same blocks as `scanBlocks`, found from the neighbouring lines alone: a
 * block is an opening line or a run of joining lines, plus the joining
 * lines after it, so callers may ask once per line without rescanning.
 */
export function blockRangeAt(lines: readonly string[], line: number): LineRange {
	if (line < 0 || line >= lines.length) return { from: line, to: line };
	const role = blockRole(lines[line]);
	if (role === BlockRole.Close) return { from: line, to: line };
	let from = line;
	if (role === BlockRole.Join) {
		while (from > 0 && blockRole(lines[from - 1]) === BlockRole.Join) from -= 1;
		if (from > 0 && blockRole(lines[from - 1]) === BlockRole.Open) from -= 1;
	}
	let to = line;
	while (to + 1 < lines.length && blockRole(lines[to + 1]) === BlockRole.Join) to += 1;
	return { from, to };
}

/**
 * Gap rewrites that align the decimal points of the posting amounts in
 * `lines` — one column per transaction block, or per block inside `range`
 * when given (a selection). `targetColumn` is a floor on that column: the
 * 0-based display width at which the decimal point should sit, so a
 * 1-based separator column of 50 is `49`. Lines that are not postings are
 * ignored; a line whose gap already lands on its block's column produces no
 * edit, so the result of one pass is a fixed point of the next.
 */
export function computeAlignment(
	lines: readonly string[],
	range?: LineRange,
	targetColumn?: number
): LineEdit[] {
	const blockOfLine = range ? scanBlocks(lines, range.from, range.to) : scanBlocks(lines);
	const postings: Posting[] = [];
	let inString = false;
	// String state is carried from line 0; past the range nothing reads it.
	const last = range ? Math.min(lines.length - 1, range.to) : lines.length - 1;
	for (let line = 0; line <= last; line += 1) {
		const continuation = inString;
		inString = endsInString(lines[line], inString);
		if (range && line < range.from) continue;
		if (continuation) continue;
		const posting = parsePosting(lines[line]);
		if (posting !== null) {
			posting.line = line;
			posting.block = blockOfLine[line];
			postings.push(posting);
		}
	}
	if (postings.length === 0) return [];

	// Each block's column is set by its widest `sign + integer` block, then
	// raised to `targetColumn` when given; every gap of the block is
	// rewritten to exactly the run of spaces that lands its amount on it —
	// growing or shrinking — never shorter than `MIN_GAP`.
	const columnOfBlock: number[] = [];
	const floor = targetColumn ?? 0;
	for (const posting of postings) {
		const column = posting.prefixWidth + MIN_GAP + posting.beforeDot;
		columnOfBlock[posting.block] = Math.max(columnOfBlock[posting.block] ?? 0, column, floor);
	}

	const edits: LineEdit[] = [];
	for (const posting of postings) {
		const width = columnOfBlock[posting.block] - posting.prefixWidth - posting.beforeDot;
		// The gap already is `width` spaces: no edit.
		const text = lines[posting.line];
		let same = posting.gapEnd - posting.gapStart === width;
		for (let i = posting.gapStart; same && i < posting.gapEnd; i += 1) same = text.charCodeAt(i) === 0x20;
		if (!same) {
			edits.push({ line: posting.line, from: posting.gapStart, to: posting.gapEnd, text: ' '.repeat(width) });
		}
	}
	return edits;
}

/**
 * Whether inserting `.` at `ch` would become the units amount's decimal
 * point on this posting line. Integers (`12|`) qualify; a second dot
 * (`12.|5`) and non-posting text do not.
 */
export function isAmountDotInsert(line: string, ch: number): boolean {
	if (ch < 0 || ch > line.length) return false;
	const posting = parsePosting(line.slice(0, ch) + '.' + line.slice(ch));
	return posting !== null && posting.gapEnd + posting.beforeDot === ch;
}

/** `computeAlignment` applied to a whole document's text. */
export function alignText(text: string, targetColumn?: number): string {
	const lines = text.split('\n');
	return alignLines(lines, targetColumn) ? lines.join('\n') : text;
}

/**
 * Align each ```beancount / ```bean fence body on the host lines. Prose and
 * fence markers stay as written. A note with no ledger fence is unchanged,
 * so a save must not rewrite it. Indented openers keep the indent they
 * still carry on the host line.
 */
export function alignFencedDocument(text: string, targetColumn?: number): string {
	const fences = extractBeancountFences(text);
	if (fences.length === 0) return text;
	const lines = text.split('\n');
	let changed = false;
	for (const fence of fences) {
		if (fence.lines.length === 0) continue;
		const from = fence.startLine;
		const to = Math.min(lines.length - 1, from + fence.lines.length - 1);
		if (from > to) continue;
		if (applyAlignment(lines, { from, to }, targetColumn)) changed = true;
	}
	return changed ? lines.join('\n') : text;
}

/** `computeAlignment` applied in place to every line; false when nothing changed. */
export function alignLines(lines: string[], targetColumn?: number): boolean {
	return applyAlignment(lines, undefined, targetColumn);
}

function applyAlignment(lines: string[], range?: LineRange, targetColumn?: number): boolean {
	const edits = computeAlignment(lines, range, targetColumn);
	for (const edit of edits) {
		const line = lines[edit.line];
		lines[edit.line] = line.slice(0, edit.from) + edit.text + line.slice(edit.to);
	}
	return edits.length > 0;
}

/**
 * One character occupies two cells when it falls in a UAX #11 wide or
 * fullwidth range — East Asian accounts (`Expenses:餐饮`) are measured the
 * way fixed-pitch fonts render them — and nothing at all when it is a
 * combining mark or zero-width character. Tabs count as one: indents stay
 * verbatim, only measured.
 */
const WIDE_CHAR_RE =
	/[\u{1100}-\u{115f}\u{2e80}-\u{303e}\u{3041}-\u{33ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{a000}-\u{a4cf}\u{ac00}-\u{d7a3}\u{f900}-\u{faff}\u{fe10}-\u{fe19}\u{fe30}-\u{fe6f}\u{ff00}-\u{ff60}\u{ffe0}-\u{ffe6}\u{1f300}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{1f900}-\u{1f9ff}\u{1fa70}-\u{1faff}\u{20000}-\u{3fffd}]/u;
// Code point ranges, not a regex character class: a class of combining
// marks is ambiguous to read (and lint) because the marks join neighbours.
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x0300, 0x036f],
	[0x1ab0, 0x1aff],
	[0x1dc0, 0x1dff],
	[0x200b, 0x200f],
	[0x20d0, 0x20ff],
	[0xfe00, 0xfe0f],
	[0xfe20, 0xfe2f],
];

function isZeroWidth(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return ZERO_WIDTH_RANGES.some(([from, to]) => code >= from && code <= to);
}

export function displayWidth(text: string): number {
	let width = 0;
	for (let i = 0; i < text.length; i += 1) {
		// Nothing below U+0300 is zero-width or wide: the common ASCII path.
		if (text.charCodeAt(i) < 0x300) {
			width += 1;
			continue;
		}
		const char = String.fromCodePoint(text.codePointAt(i) as number);
		i += char.length - 1;
		if (isZeroWidth(char)) continue;
		width += WIDE_CHAR_RE.test(char) ? 2 : 1;
	}
	return width;
}
