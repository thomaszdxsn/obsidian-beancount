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
 */

/** Minimum whitespace between the account (and its flag) and the amount. */
const MIN_GAP = 1;

/**
 * Postings are indented; directives (`2026-01-01 balance …`, `include`)
 * start at column 0 and are out of scope.
 */
const INDENT_RE = /^[ \t]+/y;
const TOKEN_RE = /[^\s]+/y;
const WS_RE = /\s+/y;

/**
 * An account as the syntax mode highlights it: a capitalized root plus
 * `:segment` parts. Segments may hold non-ASCII characters (`Expenses:餐饮`),
 * which is exactly why nothing prose-shaped leaks in: URLs start lowercase,
 * wikilinks start with a bracket, and metadata keys (`note:`) have no segment.
 */
const ACCOUNT_RE = /^[A-Z][a-z]+(?::[^\s:]+)+$/;

/**
 * A posting flag (`*!&#?%` or a single capital) followed by whitespace, for
 * the form that precedes the account: `  * Assets:Cash -1.00 USD`.
 */
const LEADING_FLAG_RE = /[*!&#?%A-Z][ \t]+/y;

/** A posting flag between account and amount: `  Assets:Cash * 12.50 USD`. */
const TRAILING_FLAG_RE = /[*!&#?%A-Z](?=\s|$)/y;

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
	gapText: string;
	/** Display width of the line before the gap (indent + flags + account). */
	prefixWidth: number;
	/** Characters of the amount before its decimal point (sign + integer). */
	beforeDot: number;
}

interface Match {
	text: string;
	/** Offset just past the match. */
	end: number;
}

function matchAt(re: RegExp, text: string, at: number): Match | null {
	re.lastIndex = at;
	const match = re.exec(text);
	if (match === null) return null;
	return { text: match[0], end: re.lastIndex };
}

/** Where the decimal point sits inside a number token; integers end there. */
function dotOffset(number: string): number {
	const dot = number.indexOf('.');
	return dot === -1 ? number.length : dot;
}

/** What may follow the amount: nothing, a commodity, or annotation syntax. */
function amountTailOk(line: string, at: number): boolean {
	const ws = matchAt(WS_RE, line, at);
	const next = ws ? ws.end : at;
	if (next >= line.length) return true;
	if (ANNOTATION_STARTS[line[next]] === true) return true;
	return matchAt(COMMODITY_RE, line, next) !== null;
}

function parsePosting(line: string): Posting | null {
	const indent = matchAt(INDENT_RE, line, 0);
	if (indent === null) return null;

	// The flag may precede the account (`  * Assets:Cash …`).
	let at = indent.end;
	const leadingFlag = matchAt(LEADING_FLAG_RE, line, at);
	if (leadingFlag !== null) at = leadingFlag.end;

	const account = matchAt(TOKEN_RE, line, at);
	if (account === null || !ACCOUNT_RE.test(account.text)) return null;

	// …or sit between account and amount (`  Assets:Cash * 12.50 USD`);
	// it stays with the account, so the gap after it is what gets rewritten.
	let gapStart = account.end;
	const wsBeforeFlag = matchAt(WS_RE, line, gapStart);
	if (wsBeforeFlag !== null) {
		const trailingFlag = matchAt(TRAILING_FLAG_RE, line, wsBeforeFlag.end);
		if (trailingFlag !== null) gapStart = trailingFlag.end;
	}

	const gap = matchAt(WS_RE, line, gapStart);
	if (gap === null) return null;

	const number = matchAt(NUMBER_RE, line, gap.end);
	if (number === null || !amountTailOk(line, number.end)) return null;

	return {
		gapStart,
		gapEnd: gap.end,
		gapText: gap.text,
		prefixWidth: displayWidth(line.slice(0, gapStart)),
		beforeDot: dotOffset(number.text),
	};
}

/**
 * The transaction block each line belongs to (`-1` on lines that close a
 * block: blank lines and comments at column 0). A line at column 0 opens a
 * block of its own; indented lines join the open one, or open a run of loose
 * postings when none is open.
 */
function scanBlocks(lines: readonly string[]): number[] {
	const blockOfLine: number[] = [];
	let block = -1;
	let next = 0;
	for (const line of lines) {
		const head = line.charAt(0);
		if (line.trim() === '' || head === ';') {
			block = -1;
		} else if (head !== ' ' && head !== '\t') {
			block = next++;
		} else if (block === -1) {
			block = next++;
		}
		blockOfLine.push(block);
	}
	return blockOfLine;
}

/** The block of lines containing `line`; a lone line when there is none. */
export function blockRangeAt(lines: readonly string[], line: number): LineRange {
	const blockOfLine = scanBlocks(lines);
	const block = blockOfLine[line];
	if (block === -1) return { from: line, to: line };
	let from = line;
	let to = line;
	while (from > 0 && blockOfLine[from - 1] === block) from -= 1;
	while (to + 1 < lines.length && blockOfLine[to + 1] === block) to += 1;
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
	const blockOfLine = scanBlocks(lines);
	const postings: Array<Posting & { line: number; block: number }> = [];
	for (let line = 0; line < lines.length; line += 1) {
		if (range && (line < range.from || line > range.to)) continue;
		const posting = parsePosting(lines[line]);
		if (posting !== null) postings.push({ ...posting, line, block: blockOfLine[line] });
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
		const gap = ' '.repeat(columnOfBlock[posting.block] - posting.prefixWidth - posting.beforeDot);
		if (gap !== posting.gapText) {
			edits.push({ line: posting.line, from: posting.gapStart, to: posting.gapEnd, text: gap });
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
export function alignText(text: string): string {
	const lines = text.split('\n');
	const edits = computeAlignment(lines);
	if (edits.length === 0) return text;
	for (const edit of edits) {
		const line = lines[edit.line];
		lines[edit.line] = line.slice(0, edit.from) + edit.text + line.slice(edit.to);
	}
	return lines.join('\n');
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
	for (const char of text) {
		if (isZeroWidth(char)) continue;
		width += WIDE_CHAR_RE.test(char) ? 2 : 1;
	}
	return width;
}
