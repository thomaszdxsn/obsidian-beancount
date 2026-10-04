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
import { extractBeancountFences } from './fences';

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

/** 0-based body line range of one fence; `endLine` is exclusive. */
interface FenceBodyLines {
	startLine: number;
	endLine: number;
}

function fenceBodies(text: string): FenceBodyLines[] {
	return extractBeancountFences(text).map((fence) => ({
		startLine: fence.startLine,
		endLine: fence.startLine + fence.lines.length,
	}));
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

function bodyContaining(bodies: readonly FenceBodyLines[], line: number): FenceBodyLines | undefined {
	return bodies.find((body) => line >= body.startLine && line < body.endLine);
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
export function posInBeancountFence(text: string, pos: number): boolean {
	if (pos < 0) return false;
	const clamped = pos > text.length ? text.length : pos;
	const starts = lineStartsOf(text);
	const line = lineIndexOf(starts, clamped);
	return bodyContaining(fenceBodies(text), line) !== undefined;
}

/**
 * CM6 `languageData` at `pos`: beancount's tokens inside a fence body,
 * nothing outside so markdown's own comments/brackets stay in charge.
 */
export function fenceLanguageData(
	text: string,
	pos: number
): readonly [typeof BEANCOUNT_LANGUAGE_DATA] | readonly [] {
	return posInBeancountFence(text, pos) ? [BEANCOUNT_LANGUAGE_DATA] : [];
}

/**
 * Cmd+/ handling for `text` and its ranges, or null when any part of the
 * selection sits outside a beancount/bean fence body. When every selected
 * line already starts with `;`, the `;` and one following space come off;
 * otherwise `; ` is inserted after each line's indent.
 */
export function fenceCommentPlan(text: string, ranges: readonly Caret[]): CommentPlan | null {
	if (ranges.length === 0) return null;
	const starts = lineStartsOf(text);
	const bodies = fenceBodies(text);
	const lineOf = (pos: number): number =>
		lineIndexOf(starts, pos > text.length ? text.length : pos < 0 ? 0 : pos);

	const lineSet = new Set<number>();
	for (const range of ranges) {
		const from = Math.min(range.anchor, range.head);
		const to = Math.max(range.anchor, range.head);
		const fromLine = lineOf(from);
		const last =
			from !== to && to > 0 && text[to - 1] === '\n' ? lineOf(to - 1) : lineOf(to);
		for (let line = fromLine; line <= last; line += 1) {
			if (!bodyContaining(bodies, line)) return null;
			lineSet.add(line);
		}
	}

	const lines = [...lineSet].sort((a, b) => a - b);
	const contents = lines.map((line) => lineContent(text, starts, line));
	const uncomment = contents.every((content) => /^[ \t]*;/.test(content));
	const changes: CommentChange[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const content = contents[i];
		const from = starts[line];
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
	text: string,
	lineStart: number,
	lineEnd: number
): { from: number; to: number } | null {
	if (!REGION_START.test(text.slice(lineStart, lineEnd))) return null;
	const starts = lineStartsOf(text);
	const line = lineIndexOf(starts, lineStart);
	const body = bodyContaining(fenceBodies(text), line);
	if (!body) return null;

	let depth = 1;
	let endLine = -1;
	for (let i = line + 1; i < body.endLine; i += 1) {
		const content = lineContent(text, starts, i);
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

	const lastHidden = endLine === -1 ? body.endLine - 1 : endLine - 1;
	if (lastHidden <= line) return null;
	const from = lineTo(text, starts, line);
	const to = lineTo(text, starts, lastHidden);
	if (to <= from) return null;
	return { from, to };
}

function commentRun(view: EditorView): boolean {
	const plan = fenceCommentPlan(
		view.state.doc.toString(),
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
		Prec.high(
			EditorState.languageData.of((state, pos) => fenceLanguageData(state.doc.toString(), pos))
		),
		foldService.of((state, lineStart, lineEnd) => {
			if (!REGION_START.test(state.doc.sliceString(lineStart, lineEnd))) return null;
			return regionFoldAt(state.doc.toString(), lineStart, lineEnd);
		}),
	];
}
