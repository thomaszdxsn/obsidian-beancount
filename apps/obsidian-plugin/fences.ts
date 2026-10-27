/**
 * Where a buffer's ledger text is. A `.bean` / `.beancount` file is ledger
 * text throughout; any other buffer (a markdown note, another extension, or
 * no file) only inside its `beancount`/`bean` fenced code blocks.
 *
 * bean-check cannot parse markdown, so the plugin copies each fence body into
 * a temporary `.bean` file, then maps the tool's 1-based temp lines back onto
 * the host document so markers land on the fence, not the temp file.
 */
import type { TFile } from 'obsidian';

/**
 * Every opening fence, including non-ledger languages. Walking those bodies
 * too prevents a literal ```bean example inside another fence becoming a ledger.
 */
const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/**
 * `text.split(/\r?\n/)`; text without `\r` takes the much faster plain
 * string split, with the same result.
 */
export function splitLines(text: string): string[] {
	return text.includes('\r') ? text.split(/\r?\n/) : text.split('\n');
}

/** Whether `line` can be a fence marker: ` or ~ after at most three spaces. */
function mayBeFence(line: string): boolean {
	let i = 0;
	while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;
	const c = line.charCodeAt(i);
	return c === 0x60 || c === 0x7e;
}

function fencesOfLines(lines: readonly string[]): LedgerRegion[] {
	const fences: LedgerRegion[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = mayBeFence(lines[i]) ? OPEN_FENCE.exec(lines[i]) : null;
		if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
			i += 1;
			continue;
		}
		const marker = open[1][0];
		const minLen = open[1].length;
		const ledger = /^(beancount|bean)(?:[ \t]|$)/i.test(open[2]);
		// CommonMark strips the opener's indent (0–3 spaces) from each body line.
		const indent = (/^ */.exec(lines[i]) ?? [''])[0].length;
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length; j += 1) {
			if (mayBeFence(lines[j]) && isClosingFence(lines[j], marker, minLen)) break;
			const line = lines[j];
			let start = 0;
			while (start < indent && line[start] === ' ') start += 1;
			if (ledger) body.push(line.slice(start));
		}
		if (ledger) fences.push({ hostStartLine: i + 1, lines: body, hostIndent: indent });
		i = j + 1;
	}
	return fences;
}

/** An editor document: its text, and its lines when it can iterate them (CodeMirror's `Text`). */
export interface FenceDoc {
	toString(): string;
	iterLines?(): { next(): { done?: boolean }; value: string };
	line?(n: number): { from: number; to: number; text: string };
	lineAt?(pos: number): { number: number; from: number; to: number; text: string };
	readonly length?: number;
	sliceString?(from: number, to?: number): string;
}

const ledgerByDoc = new WeakMap<object, Partial<Record<LedgerKind, LedgerDoc>>>();

/** `splitLines(doc.toString())`, read from the document's own lines when it has them. */
function docLines(doc: FenceDoc): string[] {
	if (doc.iterLines === undefined) return splitLines(doc.toString());
	const lines: string[] = [];
	for (const iter = doc.iterLines(); !iter.next().done; ) lines.push(iter.value);
	// Joined with `\n` and split on `\r?\n`, a line's trailing `\r` would go
	// (the last line's stays). CodeMirror's default lines never hold one.
	for (let i = 0; i < lines.length - 1; i += 1) {
		if (lines[i].endsWith('\r')) lines[i] = lines[i].slice(0, -1);
	}
	return lines;
}

function isClosingFence(line: string, marker: string, minLen: number): boolean {
	const close = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
	return close !== null && close[2][0] === marker && close[2].length >= minLen;
}

/** File extensions bean-check parses: the ledger files validation checks. */
const LEDGER_EXTENSIONS: Record<string, true> = { beancount: true, bean: true };

/**
 * Whether a vault entry is one of the ledger files `bean-check` parses —
 * ledger text throughout, and the only files whose saves are worth
 * validating. A folder has no `extension`.
 */
export function isLedgerFile(file: { extension?: string }): file is TFile {
	// `=== true`, not truthiness: inherited keys such as `constructor` or
	// `toString` resolve to functions on the prototype chain.
	return typeof file.extension === 'string' && LEDGER_EXTENSIONS[file.extension] === true;
}

/** Buffer classification: a ledger file throughout, or fenced everywhere else. */
export type LedgerKind = 'ledger-file' | 'fenced';

/**
 * Ledger kind of a buffer: `bean` / `beancount` is a ledger file; a note,
 * another extension, a folder, or no file is fenced.
 */
export function ledgerKind(file: { extension?: string } | null | undefined): LedgerKind {
	return file && isLedgerFile(file) ? 'ledger-file' : 'fenced';
}

/** Ledger kind of a vault path's basename extension, including Windows separators. */
export function ledgerKindFromPath(path: string): LedgerKind {
	const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	const base = path.slice(slash + 1);
	const dot = base.lastIndexOf('.');
	return ledgerKind({ extension: dot >= 0 ? base.slice(dot + 1) : undefined });
}

/** One contiguous stretch of ledger text in the host buffer. */
export interface LedgerRegion {
	/** Host line, 0-based, of the first body line; 0 for a ledger file. */
	hostStartLine: number;
	/** Body lines with the opener's 0–3 spaces stripped; the whole buffer for a ledger file. */
	lines: readonly string[];
	/** Opener indent in spaces; 0 for a ledger file. */
	hostIndent: number;
}

/** Text + 1-based host mapping for bean-check / balance reports. */
export interface TempLedger {
	text: string;
	/** 1-based temp → 1-based host; include preamble and inter-fence blanks are undefined. */
	hostLine(tempLine1: number): number | undefined;
}

/** A buffer's ledger regions and the queries every feature asks. */
export interface LedgerDoc {
	readonly kind: LedgerKind;
	readonly regions: readonly LedgerRegion[];
	lineIsLedger(hostLine0: number): boolean;
	regionAt(hostLine0: number): LedgerRegion | undefined;
	containsPos(pos: number): boolean;
	masked(): readonly string[] | null;
	ledgerSource(): string;
	tempLedger(includePath?: string): TempLedger;
}

function regionAtLine(kind: LedgerKind, regions: readonly LedgerRegion[], hostLine0: number): LedgerRegion | undefined {
	if (kind === 'ledger-file') return regions[0];
	for (const region of regions) {
		if (hostLine0 >= region.hostStartLine && hostLine0 < region.hostStartLine + region.lines.length) return region;
	}
}

function lineIndexAt(lines: readonly string[], pos: number): number {
	let offset = 0;
	for (let i = 0; i < lines.length; i += 1) {
		const end = offset + lines[i].length;
		if (i + 1 < lines.length) {
			if (pos <= end) return i;
			offset = end + 1;
		} else {
			return i;
		}
	}
	return 0;
}

function tempLedgerOf(regions: readonly LedgerRegion[], includePath?: string): TempLedger {
	const hostByTemp = new Map<number, number>();
	const chunks: string[] = [];
	let tempLine = 1;

	if (includePath !== undefined) {
		const posix = includePath.replace(/\\/g, '/');
		if (isSafeIncludePath(posix)) {
			chunks.push(`include "${posix}"`, '');
			tempLine += 2;
		}
	}

	for (let i = 0; i < regions.length; i += 1) {
		if (i > 0) {
			chunks.push('');
			tempLine += 1;
		}
		const region = regions[i];
		for (let j = 0; j < region.lines.length; j += 1) {
			chunks.push(region.lines[j]);
			hostByTemp.set(tempLine, region.hostStartLine + j + 1);
			tempLine += 1;
		}
	}

	const body = chunks.join('\n');
	return {
		text: body === '' ? '' : body + '\n',
		hostLine: (line) => hostByTemp.get(line),
	};
}

function createLedgerDoc(kind: LedgerKind, hostLines: readonly string[]): LedgerDoc {
	const regions: readonly LedgerRegion[] =
		kind === 'ledger-file'
			? [{ hostStartLine: 0, hostIndent: 0, lines: hostLines }]
			: fencesOfLines(hostLines);
	let mask: readonly string[] | null | undefined;
	let length: number | undefined;
	const regionAt = (hostLine0: number): LedgerRegion | undefined => regionAtLine(kind, regions, hostLine0);
	const lineIsLedger = (hostLine0: number): boolean =>
		kind === 'ledger-file' || regionAt(hostLine0) !== undefined;

	return {
		kind,
		regions,
		lineIsLedger,
		regionAt,
		containsPos(pos: number): boolean {
			if (pos < 0) return false;
			if (kind === 'ledger-file') return true;
			if (length === undefined) {
				length = 0;
				for (let i = 0; i < hostLines.length; i += 1) {
					length += hostLines[i].length;
					if (i + 1 < hostLines.length) length += 1;
				}
			}
			const clamped = pos > length ? length : pos;
			return lineIsLedger(lineIndexAt(hostLines, clamped));
		},
		masked(): readonly string[] | null {
			if (mask !== undefined) return mask;
			if (regions.length === 0) {
				mask = null;
				return mask;
			}
			const next = new Array<string>(hostLines.length).fill('');
			for (const region of regions) {
				for (let i = 0; i < region.lines.length; i += 1) {
					next[region.hostStartLine + i] = region.lines[i];
				}
			}
			mask = next;
			return mask;
		},
		ledgerSource(): string {
			return regions.map((region) => region.lines.join('\n')).join('\n');
		},
		tempLedger(includePath?: string): TempLedger {
			return tempLedgerOf(regions, includePath);
		},
	};
}

function lazyLedgerFileDoc(source: FenceDoc): LedgerDoc {
	let inner: LedgerDoc | undefined;
	const materialize = (): LedgerDoc => {
		inner ??= createLedgerDoc('ledger-file', docLines(source));
		return inner;
	};
	return {
		kind: 'ledger-file',
		get regions() {
			return materialize().regions;
		},
		lineIsLedger() {
			return true;
		},
		regionAt(hostLine0: number) {
			return materialize().regionAt(hostLine0);
		},
		containsPos(pos: number) {
			return pos >= 0;
		},
		masked() {
			return materialize().masked();
		},
		ledgerSource() {
			return materialize().ledgerSource();
		},
		tempLedger(includePath?: string) {
			return materialize().tempLedger(includePath);
		},
	};
}

/**
 * Regions and queries for a buffer. A CodeMirror `Text` is scanned once and
 * reused; a vault string is not cached. A ledger file does not copy lines
 * until a query needs the region text.
 */
export function ledgerDoc(kind: LedgerKind, source: string | FenceDoc): LedgerDoc {
	if (typeof source === 'string') return createLedgerDoc(kind, splitLines(source));
	let slots = ledgerByDoc.get(source);
	if (slots === undefined) {
		slots = {};
		ledgerByDoc.set(source, slots);
	}
	let doc = slots[kind];
	if (doc === undefined) {
		doc = kind === 'ledger-file' ? lazyLedgerFileDoc(source) : createLedgerDoc(kind, docLines(source));
		slots[kind] = doc;
	}
	return doc;
}

/** What `editorLedger` reads from an Obsidian `Editor`. */
interface LedgerEditor {
	getValue(): string;
	/** The live CodeMirror view Obsidian puts on its editors; not in the public typings. */
	cm?: { state?: { doc?: FenceDoc } };
}

/**
 * The live editor buffer as a `LedgerDoc`: a ledger file is one region;
 * otherwise fenced, preferring the CodeMirror document for the WeakMap.
 */
export function editorLedger(
	editor: LedgerEditor,
	file: { extension?: string } | null | undefined
): LedgerDoc {
	const kind = ledgerKind(file);
	const doc = editor.cm?.state?.doc;
	return doc ? ledgerDoc(kind, doc) : ledgerDoc(kind, editor.getValue());
}

/**
 * Whether `path` can be interpolated into one `include "..."` line: no CR/LF,
 * NUL, or quotes that would break out of the string.
 */
export function isSafeIncludePath(path: string): boolean {
	return path.length > 0 && !/[\r\n\0"]/.test(path);
}
