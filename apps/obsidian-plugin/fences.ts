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
 * Opening fence: 0–3 spaces, 3+ backticks or tildes, then `beancount` or
 * `bean` as the info-string language (an extra suffix like `linenums` is
 * ignored). A different language is not a ledger fence.
 */
const OPEN_FENCE = /^ {0,3}([`~]{3,})[ \t]*(beancount|bean)(?:[ \t]|$)/i;

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
 * Every `beancount`/`bean` fence in `text`, in document order. An unclosed
 * fence takes the rest of the file as its body.
 */
export function extractBeancountFences(text: string): BeancountFence[] {
	const lines = text.split(/\r?\n/);
	const fences: BeancountFence[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = OPEN_FENCE.exec(lines[i]);
		if (!open) {
			i += 1;
			continue;
		}
		const marker = open[1][0];
		const minLen = open[1].length;
		// CommonMark strips the opener's indent (0–3 spaces) from each body line.
		const indent = (/^ */.exec(lines[i]) ?? [''])[0].length;
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length; j += 1) {
			if (isClosingFence(lines[j], marker, minLen)) break;
			const line = lines[j];
			let start = 0;
			while (start < indent && line[start] === ' ') start += 1;
			body.push(line.slice(start));
		}
		fences.push({ startLine: i + 1, lines: body });
		i = j + 1;
	}
	return fences;
}

function isClosingFence(line: string, marker: string, minLen: number): boolean {
	const close = /^( {0,3})([`~]{3,})[ \t]*$/.exec(line);
	return close !== null && close[2][0] === marker && close[2].length >= minLen;
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
