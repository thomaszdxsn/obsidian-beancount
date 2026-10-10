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
 * up to the first blank or column-0 line that is not inside a multi-line
 * string — the same lines the grammar can attach to one directive. A syntax
 * error then costs only the fold of the entry that holds it; every other
 * entry keeps its fold, and nothing is folded from stale offsets. Results
 * are cached by entry text, so the fold gutter re-asks cheaply on every
 * viewport change.
 *
 * Fence bodies are read the way bean-check sees them: with the opener's
 * CommonMark indent (a fence inside a list item) stripped.
 */
import { foldService } from '@codemirror/language';
import type { EditorState, Extension, Text } from '@codemirror/state';
import { BeancountParser, BeancountSyntaxError, Transaction } from '@repo/beancount-parser';
import { editorInfoField } from 'obsidian';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';

/** A dated directive at column 0; the parser decides whether it is a transaction. */
const DATED_HEADER = /^\d{4}[-/]\d{2}[-/]\d{2}[ \t]/;
/** A header, possibly under a fence opener's 0–3 space indent: the cheap pre-check. */
const MAYBE_HEADER = /^ {0,3}\d{4}[-/]\d{2}[-/]\d{2}[ \t]/;
/** A line the grammar can attach to the directive above: indent, then content. */
const ATTACHED_LINE = /^[ \t]+\S/;

/** Entries cached; oldest dropped first. Enough for a large ledger's visible span and edits. */
const CACHE_LIMIT = 5000;
/** An entry is never longer; an unclosed string stops scanning here instead of reading the whole file. */
const MAX_ENTRY_LINES = 1000;

/**
 * Entry text → how many lines after the header the fold hides, or null when
 * the entry is no transaction, has nothing under its header, or does not
 * parse.
 */
const hiddenLinesCache = new Map<string, number | null>();

/** The CM6 `Text` surface the fold reads: 1-based lines. */
export type FoldDoc = Pick<Text, 'lines' | 'line'>;

/** A fence body: its 1-based document lines and their text with the opener indent stripped. */
export interface FoldBody {
	first: number;
	lines: readonly string[];
}

/**
 * Whether a `"…"` string is still open after `text`, given whether one was
 * open at its start. Outside a string, `;` starts a comment to end of line.
 */
function stringOpenAfter(text: string, open: boolean): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (open) {
			if (ch === '\\') i += 1;
			else if (ch === '"') open = false;
		} else if (ch === '"') open = true;
		else if (ch === ';') return false;
	}
	return open;
}

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
		// Map iterates in insertion order: the first key is the least recently used.
		for (const oldest of hiddenLinesCache.keys()) {
			hiddenLinesCache.delete(oldest);
			break;
		}
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
 * (1-based), or null. Inside a fence, `body` bounds the entry to the fence
 * and supplies its indent-stripped lines.
 */
export function transactionFoldAt(
	doc: FoldDoc,
	lineNumber: number,
	body?: FoldBody
): { from: number; to: number } | null {
	const lastLine = body ? body.first + body.lines.length - 1 : doc.lines;
	const textOf = (n: number) => (body ? body.lines[n - body.first] : doc.line(n).text);
	const header = textOf(lineNumber);
	if (!DATED_HEADER.test(header)) return null;
	const entry = [header];
	let inString = stringOpenAfter(header, false);
	let end = lineNumber;
	while (end < lastLine && entry.length < MAX_ENTRY_LINES) {
		const text = textOf(end + 1);
		// A multi-line string carries on through blank and column-0 lines.
		if (!inString && !ATTACHED_LINE.test(text)) break;
		entry.push(text);
		inString = stringOpenAfter(text, inString);
		end += 1;
	}
	if (end === lineNumber || inString) return null;
	const hidden = hiddenLines(entry.join('\n') + '\n');
	if (hidden === null) return null;
	return { from: doc.line(lineNumber).to, to: doc.line(lineNumber + hidden).to };
}

/** A note's ledger fence bodies, computed once per doc. */
const fenceBodiesCache = new WeakMap<Text, FoldBody[]>();

function fenceBodies(doc: Text): FoldBody[] {
	let bodies = fenceBodiesCache.get(doc);
	if (!bodies) {
		bodies = extractBeancountFences(doc.toString()).map((fence) => ({
			first: fence.startLine + 1,
			lines: fence.lines,
		}));
		fenceBodiesCache.set(doc, bodies);
	}
	return bodies;
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
	if (!MAYBE_HEADER.test(line.text)) return null;
	// `isLedgerFile` narrows a `TFile` to `never` on its false branch; read the extension first.
	const { extension } = file;
	if (isLedgerFile(file)) return transactionFoldAt(doc, line.number);
	if (extension !== 'md') return null;
	const body = fenceBodies(doc).find((b) => line.number >= b.first && line.number < b.first + b.lines.length);
	return body ? transactionFoldAt(doc, line.number, body) : null;
}

export function transactionFoldExtension(): Extension {
	return foldService.of((state, lineStart) => transactionFoldInState(state, lineStart));
}
