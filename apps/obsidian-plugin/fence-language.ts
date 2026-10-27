/**
 * vscode-beancount's language-configuration.json for the markdown fence
 * path, where Obsidian never installs a CM6 inner language.
 *
 * Fence highlighting goes through the bundled CM5 `getMode` overlay
 * (`main.ts`). `beancountMode.languageData` is what `StreamLanguage.define`
 * reads, so Cmd+/ and closeBrackets only see it in a whole-document CM6
 * editor. The markdown editor's `languageDataAt` at a fence cursor is still
 * markdown's — and Obsidian's own `editor:toggle-comment` wraps `%%`, which
 * would break a ledger fence. The overlay therefore:
 *
 * - Binds `Mod-/` (`Prec.high`) to toggle `; ` on fence-body lines, and
 *   returns false everywhere else so markdown comments still work in prose.
 * - Answers `languageData` first inside a fence body for closeBrackets
 *   (`{}[]()` and `'`, not `"`) and `wordChars: ':'`. CM6 has no
 *   `wordPattern`; `:` keeps `Assets:Cash` a single word.
 *
 * Bracket *matching* (highlighting the pair) walks the CM6 syntax tree.
 * A fence is one markdown code-block node, so inner `{}`/`()` have no
 * tree nodes. A nested parser would be needed; Obsidian's fence highlighter
 * does not install one, so matching is not available.
 *
 * Folding uses `foldService`, which composes with markdown's own folds and
 * does not need the tree. `;#region` / `;#endregion` (also `;;#region`,
 * optional space after the semicolons) fold inside a fence the way
 * vscode-beancount's folding.markers do.
 */
import { foldService } from '@codemirror/language';
import { EditorSelection, EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { BEANCOUNT_LANGUAGE_DATA } from './beancount-mode';
import { ledgerDoc } from './fences';
import type { FenceDoc } from './fences';

/** Indent, one or more `;`, optional space, then `#region` / `#endregion`. */
const REGION_START = /^[ \t]*;+[ \t]*#region\b/;
const REGION_END = /^[ \t]*;+[ \t]*#endregion\b/;

/** A caret as whole-text offsets; `head` is the active end. */
export interface Caret {
	anchor: number;
	head: number;
}

/** A text replacement in whole-text offsets. */
export interface CommentChange {
	from: number;
	to: number;
	insert: string;
}

export interface CommentPlan {
	changes: CommentChange[];
	carets: number[];
}

function lineStartsOf(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '\n') starts.push(i + 1);
	}
	return starts;
}

function lineIndexOf(starts: number[], pos: number): number {
	let index = 0;
	while (index + 1 < starts.length && starts[index + 1] <= pos) index += 1;
	return index;
}

function lineContent(text: string, starts: number[], index: number): string {
	const from = starts[index];
	if (index + 1 < starts.length) return text.slice(from, starts[index + 1] - 1);
	return text.slice(from);
}

function lineTo(text: string, starts: number[], index: number): number {
	if (index + 1 < starts.length) return starts[index + 1] - 1;
	return text.length;
}

function hasLines(
	source: string | FenceDoc
): source is FenceDoc & {
	line: NonNullable<FenceDoc['line']>;
	lineAt: NonNullable<FenceDoc['lineAt']>;
} {
	return typeof source !== 'string' && typeof source.line === 'function' && typeof source.lineAt === 'function';
}

interface HostLines {
	indexAt(pos: number): number;
	text(index0: number): string;
	from(index0: number): number;
	to(index0: number): number;
	length: number;
	char(pos: number): string;
	slice(from: number, to: number): string;
}

function hostOf(source: string | FenceDoc): HostLines {
	if (hasLines(source)) {
		const doc = source;
		const length = typeof doc.length === 'number' ? doc.length : 0;
		return {
			length,
			indexAt(pos) {
				const clamped = pos < 0 ? 0 : pos > length ? length : pos;
				return doc.lineAt(clamped).number - 1;
			},
			text(index0) {
				return doc.line(index0 + 1).text;
			},
			from(index0) {
				return doc.line(index0 + 1).from;
			},
			to(index0) {
				return doc.line(index0 + 1).to;
			},
			char(pos) {
				return doc.sliceString ? doc.sliceString(pos, pos + 1) : '';
			},
			slice(from, to) {
				return doc.sliceString ? doc.sliceString(from, to) : '';
			},
		};
	}
	const text = typeof source === 'string' ? source : source.toString();
	const starts = lineStartsOf(text);
	return {
		length: text.length,
		indexAt(pos) {
			const clamped = pos < 0 ? 0 : pos > text.length ? text.length : pos;
			return lineIndexOf(starts, clamped);
		},
		text(index0) {
			return lineContent(text, starts, index0);
		},
		from(index0) {
			return starts[index0];
		},
		to(index0) {
			return lineTo(text, starts, index0);
		},
		char(pos) {
			return text[pos] ?? '';
		},
		slice(from, to) {
			return text.slice(from, to);
		},
	};
}

function mapPos(pos: number, changes: readonly CommentChange[]): number {
	let next = pos;
	for (const change of changes) {
		if (pos >= change.to) next += change.insert.length - (change.to - change.from);
		else if (pos > change.from) next = change.from + change.insert.length;
	}
	return next;
}

/**
 * Whether `pos` sits on a `beancount`/`bean` fence body line — not the
 * opening or closing marker, and not prose or a different language.
 */
export function posInBeancountFence(source: string | FenceDoc, pos: number): boolean {
	if (pos < 0) return false;
	return ledgerDoc('fenced', source).containsPos(pos);
}

/**
 * CM6 `languageData` at `pos`: beancount's tokens inside a fence body,
 * nothing outside so markdown's own comments/brackets stay in charge.
 */
export function fenceLanguageData(
	source: string | FenceDoc,
	pos: number
): readonly [typeof BEANCOUNT_LANGUAGE_DATA] | readonly [] {
	return posInBeancountFence(source, pos) ? [BEANCOUNT_LANGUAGE_DATA] : [];
}

/**
 * Cmd+/ handling for `text` and its ranges, or null when any part of the
 * selection sits outside a beancount/bean fence body. When every selected
 * line already starts with `;`, the `;` and one following space come off;
 * otherwise `; ` is inserted after each line's indent.
 */
export function fenceCommentPlan(source: string | FenceDoc, ranges: readonly Caret[]): CommentPlan | null {
	if (ranges.length === 0) return null;
	const host = hostOf(source);
	const ledger = ledgerDoc('fenced', source);
	const lineOf = (pos: number): number => host.indexAt(pos);

	const lineSet = new Set<number>();
	for (const range of ranges) {
		const from = Math.min(range.anchor, range.head);
		const to = Math.max(range.anchor, range.head);
		const fromLine = lineOf(from);
		const last = from !== to && to > 0 && host.char(to - 1) === '\n' ? lineOf(to - 1) : lineOf(to);
		for (let line = fromLine; line <= last; line += 1) {
			if (!ledger.lineIsLedger(line)) return null;
			lineSet.add(line);
		}
	}

	const lines = [...lineSet].sort((a, b) => a - b);
	const contents = lines.map((line) => host.text(line));
	const uncomment = contents.every((content) => /^[ \t]*;/.test(content));
	const changes: CommentChange[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const content = contents[i];
		const from = host.from(line);
		if (uncomment) {
			const match = /^([ \t]*); ?/.exec(content);
			if (!match) continue;
			changes.push({ from: from + match[1].length, to: from + match[0].length, insert: '' });
			continue;
		}
		if (/^[ \t]*;/.test(content)) continue;
		const indent = (/^[ \t]*/.exec(content) ?? [''])[0];
		changes.push({ from: from + indent.length, to: from + indent.length, insert: '; ' });
	}
	if (changes.length === 0) return null;
	return {
		changes,
		carets: ranges.map((range) => mapPos(Math.max(range.anchor, range.head), changes)),
	};
}

/**
 * Fold range for a `;#region` line, or null when this line is not a
 * region start inside a fence, has no body to hide, or the matching
 * `;#endregion` is the next line. Nested regions pair like a stack.
 * A start with no end folds through the last body line of its fence.
 */
export function regionFoldAt(
	source: string | FenceDoc,
	lineStart: number,
	lineEnd: number
): { from: number; to: number } | null {
	const host = hostOf(source);
	if (!REGION_START.test(host.slice(lineStart, lineEnd))) return null;
	const line = host.indexAt(lineStart);
	const region = ledgerDoc('fenced', source).regionAt(line);
	if (!region) return null;
	const bodyEnd = region.hostStartLine + region.lines.length;

	let depth = 1;
	let endLine = -1;
	for (let i = line + 1; i < bodyEnd; i += 1) {
		const content = host.text(i);
		if (REGION_START.test(content)) {
			depth += 1;
			continue;
		}
		if (REGION_END.test(content)) {
			depth -= 1;
			if (depth === 0) {
				endLine = i;
				break;
			}
		}
	}

	const lastHidden = endLine === -1 ? bodyEnd - 1 : endLine - 1;
	if (lastHidden <= line) return null;
	const from = host.to(line);
	const to = host.to(lastHidden);
	if (to <= from) return null;
	return { from, to };
}

function commentRun(view: EditorView): boolean {
	const plan = fenceCommentPlan(
		view.state.doc,
		view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head }))
	);
	if (plan === null) return false;
	view.dispatch({
		changes: plan.changes,
		selection: EditorSelection.create(plan.carets.map((head) => EditorSelection.cursor(head))),
	});
	return true;
}

/**
 * Overlay for the markdown editor: `; ` comment toggle on `Mod-/`,
 * beancount `languageData` inside fence bodies, and `;#region` folding.
 * `Prec.high` so the comment binding and closeBrackets data win over
 * markdown's `%%` comments and default pairs.
 */
export function fenceLanguageExtension(): Extension {
	return [
		Prec.high(keymap.of([{ key: 'Mod-/', run: commentRun }])),
		Prec.high(EditorState.languageData.of((state, pos) => fenceLanguageData(state.doc, pos))),
		foldService.of((state, lineStart, lineEnd) => {
			if (!REGION_START.test(state.doc.sliceString(lineStart, lineEnd))) return null;
			return regionFoldAt(state.doc, lineStart, lineEnd);
		}),
	];
}
