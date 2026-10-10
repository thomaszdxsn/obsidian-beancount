/**
 * Fold a transaction down to its header line, in `.bean` / `.beancount`
 * files and inside markdown ```beancount / ```bean fences.
 *
 * The extent comes from `@repo/beancount-parser`: the transaction's
 * `SourceLocation` ends on its last posting or metadata line, so a trailing
 * indented comment stays visible and an indented line the grammar would not
 * attach is never swallowed.
 *
 * `parse()` throws on any syntax error and never returns a partial file,
 * while a ledger being typed is often invalid somewhere. So each entry is
 * parsed on its own: the dated header line plus the indented lines under it,
 * up to the first blank or column-0 line — the same lines the grammar can
 * attach to one directive. A syntax error then costs only the fold of the
 * entry that holds it; every other entry keeps its fold, and nothing is
 * folded from stale offsets. Results are cached by entry text, so the fold
 * gutter re-asks cheaply on every viewport change.
 */
import { foldService } from '@codemirror/language';
import type { EditorState, Extension, Text } from '@codemirror/state';
import { BeancountParser, BeancountSyntaxError, Transaction } from '@repo/beancount-parser';
import { editorInfoField } from 'obsidian';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';

/** A dated directive at column 0; the parser decides whether it is a transaction. */
const DATED_HEADER = /^\d{4}[-/]\d{2}[-/]\d{2}[ \t]/;
/** A line the grammar can attach to the directive above: indent, then content. */
const ATTACHED_LINE = /^[ \t]+\S/;

/** Entries cached; oldest dropped first. Enough for a large ledger's visible span and edits. */
const CACHE_LIMIT = 5000;

/**
 * Entry text → how many lines after the header the fold hides, or null when
 * the entry is no transaction, has nothing under its header, or does not
 * parse.
 */
const hiddenLinesCache = new Map<string, number | null>();

/** The CM6 `Text` surface the fold reads: 1-based lines. */
export type FoldDoc = Pick<Text, 'lines' | 'line'>;

function hiddenLines(entry: string): number | null {
	const cached = hiddenLinesCache.get(entry);
	if (cached !== undefined) {
		// Re-insert so the entry counts as recently used.
		hiddenLinesCache.delete(entry);
		hiddenLinesCache.set(entry, cached);
		return cached;
	}
	const hidden = parseHiddenLines(entry);
	if (hiddenLinesCache.size >= CACHE_LIMIT) {
		const oldest = hiddenLinesCache.keys().next();
		if (!oldest.done) hiddenLinesCache.delete(oldest.value);
	}
	hiddenLinesCache.set(entry, hidden);
	return hidden;
}

function parseHiddenLines(entry: string): number | null {
	let directive;
	try {
		[directive] = BeancountParser.parse(entry).directives;
	} catch (e) {
		if (e instanceof BeancountSyntaxError) return null;
		throw e;
	}
	if (!(directive instanceof Transaction) || !directive.location) return null;
	const hidden = directive.location.end.line - directive.location.start.line;
	return hidden > 0 ? hidden : null;
}

/**
 * Fold range for the transaction whose header is line `lineNumber`
 * (1-based), or null. Lines past `lastLine` (a fence's last body line)
 * never join the entry.
 */
export function transactionFoldAt(
	doc: FoldDoc,
	lineNumber: number,
	lastLine: number = doc.lines
): { from: number; to: number } | null {
	const header = doc.line(lineNumber);
	if (!DATED_HEADER.test(header.text)) return null;
	const entry = [header.text];
	let end = lineNumber;
	while (end < lastLine) {
		const text = doc.line(end + 1).text;
		if (!ATTACHED_LINE.test(text)) break;
		entry.push(text);
		end += 1;
	}
	if (end === lineNumber) return null;
	const hidden = hiddenLines(entry.join('\n') + '\n');
	if (hidden === null) return null;
	return { from: header.to, to: doc.line(lineNumber + hidden).to };
}

/** 1-based body line spans of a note's ledger fences, computed once per doc. */
const fenceSpansCache = new WeakMap<Text, Array<{ first: number; last: number }>>();

function fenceSpans(doc: Text): Array<{ first: number; last: number }> {
	let spans = fenceSpansCache.get(doc);
	if (!spans) {
		spans = extractBeancountFences(doc.toString())
			.filter((fence) => fence.lines.length > 0)
			.map((fence) => ({ first: fence.startLine + 1, last: fence.startLine + fence.lines.length }));
		fenceSpansCache.set(doc, spans);
	}
	return spans;
}

/**
 * The fold for the line starting at `lineStart`: whole document in a ledger
 * file, fence bodies only in a markdown note, nothing elsewhere.
 */
export function transactionFoldInState(state: EditorState, lineStart: number): { from: number; to: number } | null {
	const file = state.field(editorInfoField, false)?.file;
	if (!file) return null;
	const doc = state.doc;
	const line = doc.lineAt(lineStart);
	// Cheap reject before the fence scan: most lines are no header.
	if (!DATED_HEADER.test(line.text)) return null;
	// `isLedgerFile` narrows a `TFile` to `never` on its false branch; read the extension first.
	const { extension } = file;
	if (isLedgerFile(file)) return transactionFoldAt(doc, line.number);
	if (extension !== 'md') return null;
	const span = fenceSpans(doc).find((s) => line.number >= s.first && line.number <= s.last);
	return span ? transactionFoldAt(doc, line.number, span.last) : null;
}

export function transactionFoldExtension(): Extension {
	return foldService.of((state, lineStart) => transactionFoldInState(state, lineStart));
}
