/**
 * Document outline for a beancount buffer: org-mode `*` section titles
 * (vscode-beancount DocumentSymbolProvider semantics) plus dated
 * transactions / open / close / balance entries, grouped by consecutive
 * dates so the outline is a jumpable tree rather than a flat line list.
 *
 * Headings are column-0 lines of one or more `*` whose remainder is the
 * title; a `;` ends the title so `;#region` comments never leak in. Empty
 * titles are skipped. Skipped heading levels are filled with a dummy `_`,
 * matching vscode-beancount's outline tree (VS Code cannot render a jump
 * in heading level natively).
 *
 * Dated entries nest under the innermost heading that precedes them (or
 * the root). Consecutive entries sharing a date share a date-group parent
 * whose title is the date as written; the group's children are the
 * transactions and directives. Other dated directives (pad, price, …) are
 * not outline items — the issue names txn/open/close/balance only.
 */
import type { Editor } from 'obsidian';

/** Dummy heading title inserted for a skipped org-mode level. */
export const DUMMY_HEADING = '_';

export type OutlineKind = 'heading' | 'date' | 'transaction' | 'open' | 'close' | 'balance';

/** One outline node; `line` is 0-based, the jump target. */
export interface OutlineNode {
	kind: OutlineKind;
	title: string;
	line: number;
	children: OutlineNode[];
}

/** A flattened row for rendering; `depth` is 0 at the root. */
export interface OutlineRow {
	kind: OutlineKind;
	title: string;
	line: number;
	depth: number;
}

const TXN_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]*(txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])(.*)$/;
const DIRECTIVE_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]+(open|close|balance)(?![A-Za-z0-9])[ \t]*(\S+)?/;
const QUOTED_FIELD_RE = /^[ \t]*"((?:[^"\\\n]|\\.)*)"/;

interface HeadingLine {
	level: number;
	name: string;
}

/**
 * vscode-beancount `parseLine`: count leading `*`, stop the title at `;`,
 * ignore everything else. The line must already start with `*`.
 */
function parseHeading(text: string): HeadingLine {
	let level = 0;
	let name = '';
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === ';') break;
		if (ch === '*') level++;
		else name += ch;
	}
	return { level, name: name.trim() };
}

function quotedFields(rest: string): string[] {
	const fields: string[] = [];
	let leftover = rest;
	while (fields.length < 2) {
		const match = QUOTED_FIELD_RE.exec(leftover);
		if (!match) break;
		fields.push(match[1].replace(/\\(.)/g, '$1'));
		leftover = leftover.slice(match[0].length);
	}
	return fields;
}

function transactionTitle(flag: string, rest: string): string {
	const [payee, narration] = quotedFields(rest);
	if (payee && narration) return `${payee} — ${narration}`;
	if (payee) return payee;
	if (narration) return narration;
	return flag;
}


/**
 * Attach `entry` under a date-group child of `siblings`, opening a new
 * group when the date differs from the last group's title.
 */
function pushDated(siblings: OutlineNode[], date: string, line: number, entry: OutlineNode): void {
	const last = siblings[siblings.length - 1];
	let group = last && last.kind === 'date' && last.title === date ? last : null;
	if (!group) {
		group = { kind: 'date', title: date, line, children: [] };
		siblings.push(group);
	}
	group.children.push(entry);
}

/**
 * The outline tree for `text`. Headings form the spine; dated txn/open/
 * close/balance entries hang off the current heading in consecutive date
 * groups. Line numbers are 0-based.
 */
export function parseBeancountOutline(text: string): OutlineNode[] {
	const roots: OutlineNode[] = [];
	/** Innermost heading at each org-mode level (index 0 = level 1). */
	const stack: OutlineNode[] = [];

	const currentSiblings = (): OutlineNode[] =>
		stack.length > 0 ? stack[stack.length - 1].children : roots;

	const attachHeading = (level: number, name: string, line: number): void => {
		while (stack.length < level - 1) {
			attachHeading(stack.length + 1, DUMMY_HEADING, line);
		}
		stack.length = level - 1;
		const node: OutlineNode = { kind: 'heading', title: name, line, children: [] };
		currentSiblings().push(node);
		stack.push(node);
	};

	const lines = text.split('\n');
	for (let line = 0; line < lines.length; line++) {
		const raw = lines[line];
		if (raw.startsWith('*')) {
			const heading = parseHeading(raw);
			if (heading.level < 1 || !heading.name) continue;
			attachHeading(heading.level, heading.name, line);
			continue;
		}
		const txn = TXN_RE.exec(raw);
		if (txn) {
			pushDated(currentSiblings(), txn[1], line, {
				kind: 'transaction',
				title: transactionTitle(txn[2], txn[3]),
				line,
				children: [],
			});
			continue;
		}
		const directive = DIRECTIVE_RE.exec(raw);
		if (directive) {
			const kind = directive[2] as 'open' | 'close' | 'balance';
			const account = directive[3];
			pushDated(currentSiblings(), directive[1], line, {
				kind,
				title: account ? `${kind} ${account}` : kind,
				line,
				children: [],
			});
		}
	}

	return roots;
}

/** Depth-first rows of `nodes`, root depth 0. */
export function flattenOutline(nodes: readonly OutlineNode[]): OutlineRow[] {
	const rows: OutlineRow[] = [];
	const walk = (items: readonly OutlineNode[], depth: number): void => {
		for (const node of items) {
			rows.push({ kind: node.kind, title: node.title, line: node.line, depth });
			walk(node.children, depth + 1);
		}
	};
	walk(nodes, 0);
	return rows;
}

/**
 * Jump the editor to `line` (0-based) and bring it on screen. The caret
 * lands at column 0 — outline items address a header line, not a column.
 */
export function jumpToOutlineLine(editor: Editor, line: number): void {
	const pos = { line, ch: 0 };
	editor.setCursor(pos);
	editor.scrollIntoView({ from: pos, to: pos }, true);
}
