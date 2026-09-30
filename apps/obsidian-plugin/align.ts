/**
 * Decimal-point alignment for beancount postings.
 *
 * `computeAlignment` turns the posting lines of a document into gap rewrites
 * that put every amount's decimal point on one shared column: the amount's
 * `sign + integer` block right-aligns at the column, the fraction follows the
 * dot. An amount without a decimal point (`10 AAPL`) aligns its integer block
 * the same way, so it sits on the same units column as `10.5 AAPL`.
 *
 * Only the *units* amount of a posting is aligned. Cost (`{150.00 USD}`) and
 * price (`@ 7.2 CNY`) annotations keep their numbers where the syntax puts
 * them — those numbers are only reachable by padding *inside* the annotation,
 * and their column would be dictated by whatever precedes them. Arithmetic
 * amounts (`2 * 3.00 USD`) are left out too: they have no single decimal
 * point to align. One column is shared by every commodity in the document:
 * per-commodity columns would leave a mixed-currency transaction visibly
 * staggered — the opposite of what "align the decimal points" promises. The
 * commodity is still part of what qualifies a number as an amount, so a stray
 * number in prose (` TODO: fix 12 bugs`) is never touched.
 *
 * Only posting-shaped lines are rewritten: an indented account (`Assets:Cash`,
 * optionally preceded by a posting flag) followed by the amount. Metadata
 * (` note: …`), comments, directives and prose keep their original spacing.
 * Everything else on a line — indent, flag, account, text after the amount —
 * is preserved verbatim and only the whitespace between account and amount
 * changes, so applying the edits is idempotent and never disturbs text the
 * feature does not own. What precedes the gap is always ASCII (indent,
 * account, flag), so column widths count characters.
 */

/** Minimum whitespace between the account and the amount. */
const MIN_GAP = 1;

/**
 * Postings are indented; directives (`2026-01-01 balance …`, `include`)
 * start at column 0 and are out of scope.
 */
const INDENT_RE = /^[ \t]+/y;
const TOKEN_RE = /[^\s]+/y;
const WS_RE = /\s+/y;

/**
 * A token that can open a posting: the account-name shape the completion
 * index counts (`Assets:Cash`, `Assets:US:BofA:Checking`) — so prose tokens,
 * URLs (`https://example.com:8080`) and wikilinks never set the column.
 */
const ACCOUNT_RE = /^[A-Z][A-Za-z0-9\-_]*(?::[A-Za-z0-9\-_]+)+$/;

/**
 * The posting flag, which precedes the account (`  * Assets:Cash …`): any of
 * `*!&#?%` or a single capital letter, as `bean-check` accepts them.
 */
const FLAG_RE = /[*!&#?%A-Z](?=\s|$)/y;

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
	/** Column where the whitespace between account and amount starts. */
	from: number;
	/** Column where that whitespace ends (the amount starts). */
	to: number;
	/** Replacement whitespace: `to - from` may change, the text is the gap. */
	text: string;
}

interface Posting {
	gapStart: number;
	gapEnd: number;
	gapText: string;
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

	// The posting flag comes before the account: `  * Assets:Cash -1.00 USD`.
	let at = indent.end;
	const flag = matchAt(FLAG_RE, line, at);
	if (flag !== null) {
		const ws = matchAt(WS_RE, line, flag.end);
		at = ws ? ws.end : flag.end;
	}

	const account = matchAt(TOKEN_RE, line, at);
	if (account === null || !ACCOUNT_RE.test(account.text)) return null;

	const gap = matchAt(WS_RE, line, account.end);
	if (gap === null) return null;

	const number = matchAt(NUMBER_RE, line, gap.end);
	if (number === null || !amountTailOk(line, number.end)) return null;

	return {
		gapStart: account.end,
		gapEnd: gap.end,
		gapText: gap.text,
		beforeDot: dotOffset(number.text),
	};
}

/**
 * Gap rewrites that align the decimal points of every posting amount in
 * `lines` to one shared column. Lines that are not postings are ignored;
 * a line whose gap already lands on the column produces no edit, so the
 * result of one pass is a fixed point of the next.
 */
export function computeAlignment(lines: readonly string[]): LineEdit[] {
	const postings: Array<Posting & { line: number }> = [];
	for (let line = 0; line < lines.length; line += 1) {
		const posting = parsePosting(lines[line]);
		if (posting !== null) postings.push({ ...posting, line });
	}
	if (postings.length === 0) return [];

	// The column is set by the widest `sign + integer` block in the document;
	// every gap is rewritten to exactly the run of spaces that lands its
	// amount on it — growing or shrinking — never shorter than `MIN_GAP`.
	let dotColumn = 0;
	for (const posting of postings) {
		dotColumn = Math.max(dotColumn, posting.gapStart + MIN_GAP + posting.beforeDot);
	}

	const edits: LineEdit[] = [];
	for (const posting of postings) {
		const gap = ' '.repeat(dotColumn - posting.gapStart - posting.beforeDot);
		if (gap !== posting.gapText) {
			edits.push({ line: posting.line, from: posting.gapStart, to: posting.gapEnd, text: gap });
		}
	}
	return edits;
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
