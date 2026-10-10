/**
 * Ledger formatting: indent, header spacing, trailing whitespace, then the
 * existing per-transaction decimal alignment.
 *
 * The rewrite stays on the original text. `BeancountParser` drops comments,
 * blank lines, and the original spelling of numbers, so a model dump would
 * destroy them. Source locations say which lines belong to a directive and
 * which of those are postings (a posting's span includes its metadata);
 * everything else in that span is directive metadata or a tag/link line.
 * Indented comments are skipped by the lexer, so they are recognized from
 * the text when they sit inside a transaction span.
 *
 * Posting indent is the two spaces `posting-indent.ts` already inserts
 * (bean-format's default). Posting metadata is one level deeper. Directive
 * headers collapse runs of spaces and tabs to a single space, but never
 * inside `"..."` strings (escaped quotes included) and never inside a
 * trailing `;` comment — a `"` there does not open a string. A logical line
 * whose string is still open continues past a short location, so a
 * continuation at EOF is not reformatted as its own directive. Column-0
 * comments, org headings, and blank lines keep their text; only trailing
 * whitespace is stripped, and not inside a string.
 */
import { BeancountParser, BeancountSyntaxError, Transaction } from '@repo/beancount-parser';
import type { Directive, Posting } from '@repo/beancount-parser';
import { alignText, endsInString } from './align';
import { extractBeancountFences } from './fences';
import type { BeancountFence } from './fences';

/** Two spaces, matching posting auto-indent. */
const POSTING_INDENT = '  ';
/** One level under a posting. */
const POSTING_META_INDENT = '    ';

/** A problem that blocked formatting. `line` is 1-based, `column` 0-based. */
export interface FormatError {
	line: number;
	column: number;
	message: string;
}

export type FormatResult = { ok: true; text: string } | { ok: false; error: FormatError };

/** One replacement in an editor transaction. Lines are 0-based. */
export interface LineChange {
	fromLine: number;
	fromCh: number;
	toLine: number;
	toCh: number;
	text: string;
}

/** Notice text for the first syntax error. `error.line` is already a document line. */
export function formatErrorNotice(error: FormatError): string {
	return `Line ${error.line}: ${error.message}`;
}

/**
 * Format one ledger. On a syntax error nothing is rewritten: the result is
 * the first error and no text. Any other exception propagates.
 */
export function formatLedger(text: string): FormatResult {
	let directives: Directive[];
	try {
		directives = BeancountParser.parse(text).directives;
	} catch (e) {
		if (!(e instanceof BeancountSyntaxError)) throw e;
		return { ok: false, error: firstError(e) };
	}
	const split = splitDocument(text);
	rewriteLines(split.lines, directives);
	const aligned = alignText(split.lines.join('\n'));
	const lines = aligned.length === 0 ? [] : aligned.split('\n');
	return { ok: true, text: joinDocument(lines, split.newline, split.trailing) };
}

/**
 * Format each ```beancount / ```bean fence on its own. Prose, other fences,
 * and the fence markers stay as written. An error's line (and column) is
 * mapped onto the host document; a failure in any fence yields no text, so
 * the caller changes nothing.
 */
export function formatFencedDocument(text: string): FormatResult {
	const fences = extractBeancountFences(text);
	if (fences.length === 0) return { ok: true, text };
	const split = splitDocument(text);
	const bodies: string[][] = [];
	for (const fence of fences) {
		const formatted = formatFenceBody(fence);
		if (!formatted.ok) {
			const bodyIndex = formatted.error.line - 1;
			return {
				ok: false,
				error: {
					line: fence.startLine + formatted.error.line,
					column: formatted.error.column + strippedPrefix(split.lines, fence, bodyIndex),
					message: formatted.error.message,
				},
			};
		}
		bodies.push(formatted.lines);
	}
	for (let f = 0; f < fences.length; f += 1) {
		const fence = fences[f];
		const body = bodies[f];
		const indent = openerIndent(split.lines, fence);
		for (let i = 0; i < fence.lines.length; i += 1) {
			const at = fence.startLine + i;
			// An unclosed fence's body includes the empty element `split(/\r?\n/)`
			// adds for a trailing newline; splitDocument already dropped that line.
			if (at >= split.lines.length) break;
			const original = split.lines[at];
			const prefix = countStripped(original, indent);
			split.lines[at] = original.slice(0, prefix) + body[i];
		}
	}
	return { ok: true, text: joinDocument(split.lines, split.newline, split.trailing) };
}

/**
 * Line replacements that turn `before` into `after`. Equal line counts become
 * one edit per differing whitespace run: the formatter only changes
 * whitespace, and a caret in an unchanged token between two runs must not
 * be swallowed by a span that covers both. A line-count change — the
 * formatter does not produce one — is a single whole-document edit.
 */
export function lineChanges(before: string, after: string): LineChange[] {
	if (before === after) return [];
	const oldLines = splitLoose(before);
	const newLines = splitLoose(after);
	if (oldLines.length !== newLines.length) {
		const last = Math.max(0, oldLines.length - 1);
		return [
			{
				fromLine: 0,
				fromCh: 0,
				toLine: last,
				toCh: oldLines[last].length,
				text: newLines.join('\n'),
			},
		];
	}
	const changes: LineChange[] = [];
	for (let i = 0; i < oldLines.length; i += 1) {
		pushWhitespaceRuns(changes, i, oldLines[i], newLines[i]);
	}
	return changes;
}

/** One edit per whitespace run that differs. A non-whitespace mismatch takes the rest of the line. */
function pushWhitespaceRuns(changes: LineChange[], line: number, oldLine: string, newLine: string): void {
	let oldAt = 0;
	let newAt = 0;
	while (oldAt < oldLine.length || newAt < newLine.length) {
		if (oldAt < oldLine.length && newAt < newLine.length && oldLine[oldAt] === newLine[newAt]) {
			oldAt += 1;
			newAt += 1;
			continue;
		}
		const oldFrom = oldAt;
		const newFrom = newAt;
		while (oldAt < oldLine.length && (oldLine[oldAt] === ' ' || oldLine[oldAt] === '\t')) oldAt += 1;
		while (newAt < newLine.length && (newLine[newAt] === ' ' || newLine[newAt] === '\t')) newAt += 1;
		if (oldAt === oldFrom && newAt === newFrom) {
			changes.push({
				fromLine: line,
				fromCh: oldFrom,
				toLine: line,
				toCh: oldLine.length,
				text: newLine.slice(newFrom),
			});
			return;
		}
		changes.push({
			fromLine: line,
			fromCh: oldFrom,
			toLine: line,
			toCh: oldAt,
			text: newLine.slice(newFrom, newAt),
		});
	}
}

function firstError(e: BeancountSyntaxError): FormatError {
	const err = e.errors[0];
	if (err) return { line: err.line, column: err.column, message: err.message };
	return { line: 1, column: 0, message: e.message };
}

interface SplitDoc {
	lines: string[];
	newline: '\n' | '\r\n';
	trailing: boolean;
}

function splitDocument(text: string): SplitDoc {
	const crlf = text.includes('\r\n') && !/(^|[^\r])\n/.test(text);
	const trailing = text.endsWith('\n');
	if (text.length === 0) return { lines: [], newline: '\n', trailing: false };
	const lines = text.split(/\r?\n/);
	if (trailing) lines.pop();
	return { lines, newline: crlf ? '\r\n' : '\n', trailing };
}

function joinDocument(lines: readonly string[], newline: '\n' | '\r\n', trailing: boolean): string {
	if (lines.length === 0) return trailing ? newline : '';
	const body = lines.join(newline);
	return trailing ? body + newline : body;
}

/** `split('\n')` shape, so a trailing newline is an extra empty element. */
function splitLoose(text: string): string[] {
	return text.split(/\r?\n/);
}

function formatFenceBody(fence: BeancountFence): { ok: true; lines: string[] } | { ok: false; error: FormatError } {
	if (fence.lines.length === 0) return { ok: true, lines: [] };
	// A trailing newline keeps a one-line body distinct from empty text and
	// matches how the parser counts the body's last line.
	const result = formatLedger(fence.lines.join('\n') + '\n');
	if (!result.ok) return result;
	const lines = result.text.split('\n');
	lines.pop();
	return { ok: true, lines };
}

function openerIndent(lines: readonly string[], fence: BeancountFence): number {
	const opener = lines[fence.startLine - 1];
	let n = 0;
	while (n < opener.length && opener[n] === ' ') n += 1;
	return n;
}

function countStripped(line: string, indent: number): number {
	let start = 0;
	while (start < indent && line[start] === ' ') start += 1;
	return start;
}

function strippedPrefix(lines: readonly string[], fence: BeancountFence, bodyIndex: number): number {
	if (bodyIndex < 0 || bodyIndex >= fence.lines.length) return 0;
	return countStripped(lines[fence.startLine + bodyIndex] ?? '', openerIndent(lines, fence));
}

function rewriteLines(lines: string[], directives: readonly Directive[]): void {
	const consumed = new Array<boolean>(lines.length);
	for (const directive of directives) {
		const loc = directive.location;
		if (!loc) continue;
		const start = loc.start.line - 1;
		const end = Math.min(loc.end.line - 1, lines.length - 1);
		if (start < 0 || start >= lines.length || end < start) continue;
		const txn = directive instanceof Transaction ? directive : null;
		const postingAt = new Map<number, Posting>();
		if (txn) {
			for (const posting of txn.postings) {
				if (posting.location) postingAt.set(posting.location.start.line - 1, posting);
			}
		}
		let i = rewriteHeader(lines, start, end);
		markConsumed(consumed, start, i - 1);
		while (i <= end) {
			const posting = postingAt.get(i);
			if (posting?.location) {
				const postingEnd = Math.min(posting.location.end.line - 1, end);
				let j = rewriteIndented(lines, i, postingEnd, POSTING_INDENT);
				while (j <= postingEnd) {
					if (isIndentedComment(lines[j])) {
						lines[j] = normalizeComment(lines[j], POSTING_INDENT);
						j += 1;
						continue;
					}
					j = rewriteIndented(lines, j, postingEnd, POSTING_META_INDENT);
				}
				// A string still open at the reported end consumes lines past it.
				const consumedTo = Math.max(postingEnd, j - 1);
				markConsumed(consumed, i, consumedTo);
				i = consumedTo + 1;
				continue;
			}
			if (isIndentedComment(lines[i])) {
				lines[i] = normalizeComment(lines[i], txn ? POSTING_INDENT : null);
				consumed[i] = true;
				i += 1;
				continue;
			}
			const next = rewriteIndented(lines, i, end, POSTING_INDENT);
			markConsumed(consumed, i, next - 1);
			i = next;
		}
	}
	for (let i = 0; i < lines.length; i += 1) {
		if (consumed[i]) continue;
		lines[i] = rewriteUncovered(lines[i]);
	}
}

function markConsumed(consumed: boolean[], from: number, to: number): void {
	for (let i = from; i <= to && i < consumed.length; i += 1) consumed[i] = true;
}

/**
 * Header logical line, which may span physical lines while a string is open.
 * Returns the 0-based index of the first line after it. A string still open
 * at `end` keeps going: the parser's end line can stop short of a multi-line
 * string at EOF, and those continuation lines are still this header.
 */
function rewriteHeader(lines: string[], start: number, end: number): number {
	let inString = false;
	let i = start;
	while (i < lines.length && (i <= end || inString)) {
		const collapsed = collapseHeaderLine(lines[i], inString);
		lines[i] = collapsed.text;
		inString = collapsed.inString;
		i += 1;
		if (!inString) break;
	}
	return i;
}

/**
 * An indented logical line (posting, metadata, tag/link). Only the first
 * physical line is reindented; later lines are inside a string. A string
 * still open at `end` keeps going, same as a header.
 */
function rewriteIndented(lines: string[], start: number, end: number, indent: string): number {
	let inString = false;
	let i = start;
	let first = true;
	while (i < lines.length && (i <= end || inString)) {
		let line = lines[i];
		if (first) line = withIndent(line, indent);
		const still = endsInString(line, inString);
		lines[i] = still ? line : stripTrailing(line);
		inString = still;
		i += 1;
		first = false;
		if (!inString) break;
	}
	return i;
}

function normalizeComment(line: string, indent: string | null): string {
	return stripTrailing(indent === null ? line : withIndent(line, indent));
}

function rewriteUncovered(line: string): string {
	if (line.trim() === '' || line.startsWith(';') || isOrgHeader(line) || isIndentedComment(line)) {
		return stripTrailing(line);
	}
	// pushtag / poptag / pushmeta / popmeta parse but are not in the model.
	// An indented non-comment line never reaches here: the parser rejects it.
	return collapseHeaderLine(line, false).text;
}

function isIndentedComment(line: string): boolean {
	return /^[ \t]+;/.test(line);
}

/** Column-0 lines the lexer ignores: org headings and flag-prefixed lines. */
function isOrgHeader(line: string): boolean {
	return line.length > 0 && '*#!&?%:'.includes(line[0]);
}

function withIndent(line: string, indent: string): string {
	return indent + line.slice(leadingWhitespace(line));
}

function leadingWhitespace(line: string): number {
	let i = 0;
	while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;
	return i;
}

function stripTrailing(line: string): string {
	let end = line.length;
	while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1;
	return end === line.length ? line : line.slice(0, end);
}

function collapseHeaderLine(line: string, inStringStart: boolean): { text: string; inString: boolean } {
	let inString = inStringStart;
	let inComment = false;
	let inWs = false;
	let out = '';
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (inComment) {
			out += ch;
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === '\\' && i + 1 < line.length) {
				out += line[i + 1];
				i += 1;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			inWs = false;
			out += ch;
			continue;
		}
		if (ch === ';') {
			inComment = true;
			inWs = false;
			out += ch;
			continue;
		}
		if (ch === ' ' || ch === '\t') {
			if (!inWs && out.length > 0) {
				out += ' ';
				inWs = true;
			}
			continue;
		}
		inWs = false;
		out += ch;
	}
	return { text: inString ? out : stripTrailing(out), inString };
}

