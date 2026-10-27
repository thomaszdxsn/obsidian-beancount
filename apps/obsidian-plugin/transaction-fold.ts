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
import { isLedgerFile, ledgerDoc } from './fences';

/** A transaction header at column 0: a date, then `txn` or a flag, space optional as in the grammar. */
const DATED_HEADER = /^\d{4}[-/]\d{2}[-/]\d{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;
/** A header, possibly under a fence opener's 0–3 space indent: the cheap pre-check. */
const MAYBE_HEADER = /^ {0,3}\d{4}[-/]\d{2}[-/]\d{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;
/** A line the grammar can attach to the directive above: indent, then content. */
const ATTACHED_LINE = /^[ \t]+\S/;

/** Entries cached; oldest dropped first. Enough for a large ledger's visible span and edits. */
const CACHE_LIMIT = 5000;
/**
 * Longer entries get no fold: parsing one costs ~0.1 ms per line on every
 * edit while its header is visible, and each cached key holds the whole text.
 */
const MAX_ENTRY_LINES = 300;

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
	while (end < lastLine) {
		const text = textOf(end + 1);
		// A multi-line string carries on through blank and column-0 lines.
		if (!inString && !ATTACHED_LINE.test(text)) break;
		// Too long to parse on every edit; a truncated parse would fold a wrong extent.
		if (entry.length === MAX_ENTRY_LINES) return null;
		entry.push(text);
		inString = stringOpenAfter(text, inString);
		end += 1;
	}
	if (end === lineNumber || inString) return null;
	const hidden = hiddenLines(entry.join('\n') + '\n');
	if (hidden === null) return null;
	return { from: doc.line(lineNumber).to, to: doc.line(lineNumber + hidden).to };
}

/**
 * The fold for the line starting at `lineStart`: whole document in a ledger
 * file, fence bodies in any other buffer.
 */
export function transactionFoldInState(state: EditorState, lineStart: number): { from: number; to: number } | null {
	const file = state.field(editorInfoField, false)?.file;
	const doc = state.doc;
	const line = doc.lineAt(lineStart);
	// Cheap reject before the fence scan: most lines are no header.
	if (!MAYBE_HEADER.test(line.text)) return null;
	if (file && isLedgerFile(file)) return transactionFoldAt(doc, line.number);
	const region = ledgerDoc('fenced', doc).regionAt(line.number - 1);
	return region ? transactionFoldAt(doc, line.number, { first: region.hostStartLine + 1, lines: region.lines }) : null;
}

export function transactionFoldExtension(): Extension {
	return foldService.of((state, lineStart) => transactionFoldInState(state, lineStart));
}
