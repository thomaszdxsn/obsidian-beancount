/**
 * Markdown `beancount`/`bean` fenced code blocks are the notes' ledger.
 * bean-check cannot parse markdown, so the plugin copies each fence body into
 * a temporary `.bean` file, then maps the tool's 1-based temp lines back onto
 * the host document so markers land on the fence, not the temp file.
 */

/** One fenced ledger in a markdown document. */
export interface BeancountFence {
	/** 0-based line of the first body line in the host document. */
	startLine: number;
	/** Fence body lines, excluding the opening and closing markers. */
	lines: readonly string[];
}

/**
 * Every opening fence, including non-ledger languages. Walking those bodies
 * too prevents a literal ```bean example inside another fence becoming a ledger.
 */
const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/** A temp ledger built from one note's fences, ready to hand bean-check. */
export interface FenceLedger {
	/** The file bean-check should parse, ending in a newline when non-empty. */
	text: string;
	/**
	 * The 1-based host line for a 1-based temp-file line, or `undefined` for
	 * preamble / separator lines that are not fence body.
	 */
	hostLine(tempLine: number): number | undefined;
}

/**
 * `text.split(/\r?\n/)`; text without `\r` takes the much faster plain
 * string split, with the same result.
 */
export function splitLines(text: string): string[] {
	return text.includes('\r') ? text.split(/\r?\n/) : text.split('\n');
}

/**
 * Every `beancount`/`bean` fence in `text`, in document order. An unclosed
 * fence takes the rest of the file as its body.
 */
export function extractBeancountFences(text: string): BeancountFence[] {
	return fencesOfLines(splitLines(text));
}

/** Whether `line` can be a fence marker: ` or ~ after at most three spaces. */
function mayBeFence(line: string): boolean {
	let i = 0;
	while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;
	const c = line.charCodeAt(i);
	return c === 0x60 || c === 0x7e;
}

function fencesOfLines(lines: readonly string[]): BeancountFence[] {
	const fences: BeancountFence[] = [];
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
		if (ledger) fences.push({ startLine: i + 1, lines: body });
		i = j + 1;
	}
	return fences;
}

/** A note's ledger fences and its lines with everything but fence bodies blanked. */
export interface DocFences {
	fences: readonly BeancountFence[];
	/**
	 * Host lines with fence bodies in place and every other line blank, so
	 * ledger scans see fence text at host line numbers; null without a fence.
	 */
	masked: readonly string[] | null;
}

/** An editor document: its text, and its lines when it can iterate them (CodeMirror's `Text`). */
interface FenceDoc {
	toString(): string;
	iterLines?(): { next(): { done?: boolean }; value: string };
}

const fencesByDoc = new WeakMap<object, DocFences>();

/**
 * `extractBeancountFences(doc.toString())` and its mask, once per document.
 * Editor documents are immutable, so the inlay hints, flag warnings and
 * include links of one note share a single scan per edit. A CodeMirror
 * document is read line by line: no joined copy, and its line strings stay
 * the same objects from edit to edit, which keeps the per-line caches of
 * the hint scans cheap.
 */
export function docFences(doc: FenceDoc): DocFences {
	let entry = fencesByDoc.get(doc);
	if (entry === undefined) {
		const lines = docLines(doc);
		const fences = fencesOfLines(lines);
		let masked: string[] | null = null;
		if (fences.length > 0) {
			masked = new Array<string>(lines.length).fill('');
			for (const fence of fences) {
				for (let i = 0; i < fence.lines.length; i += 1) masked[fence.startLine + i] = fence.lines[i];
			}
		}
		entry = { fences, masked };
		fencesByDoc.set(doc, entry);
	}
	return entry;
}

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

/**
 * The ledger text of a vault file: a markdown note contributes only its
 * `beancount`/`bean` fence bodies, a `.bean`/`.beancount` file all of it.
 * Prose shapes (`#project`, `^block-id`, `- 10 GB`, `PG_DATA_DIR:-x`) would
 * otherwise pass for ledger tokens.
 */
export function ledgerSource(path: string, content: string): string {
	if (!path.endsWith('.md')) return content;
	return extractBeancountFences(content)
		.map((fence) => fence.lines.join('\n'))
		.join('\n');
}

/**
 * Whether `path` can be interpolated into one `include "..."` line: no CR/LF,
 * NUL, or quotes that would break out of the string.
 */
export function isSafeIncludePath(path: string): boolean {
	return path.length > 0 && !/[\r\n\0"]/.test(path);
}

/**
 * Concatenate `fences` into one ledger. When `includePath` is set, an
 * `include` of that file (forward-slash path) is prepended so the fences are
 * checked against the entry ledger's opens and accounts. An unsafe path is
 * omitted rather than written into the temp file.
 */
export function buildFenceLedger(fences: readonly BeancountFence[], includePath?: string): FenceLedger {
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

	for (let i = 0; i < fences.length; i += 1) {
		if (i > 0) {
			chunks.push('');
			tempLine += 1;
		}
		const fence = fences[i];
		for (let j = 0; j < fence.lines.length; j += 1) {
			chunks.push(fence.lines[j]);
			hostByTemp.set(tempLine, fence.startLine + j + 1);
			tempLine += 1;
		}
	}

	const body = chunks.join('\n');
	return {
		text: body === '' ? '' : body + '\n',
		hostLine: (line) => hostByTemp.get(line),
	};
}
