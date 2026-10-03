/**
 * vscode-beancount's language-configuration.json for the markdown fence
 * path, where Obsidian never installs a CM6 inner language.
 *
 * Fence highlighting goes through the bundled CM5 `getMode` overlay
 * (`main.ts`). `beancountMode.languageData` is what `StreamLanguage.define`
 * reads, so Cmd+/ and closeBrackets only see it in a whole-document CM6
 * editor. The markdown editor's `languageDataAt` at a fence cursor is still
 * markdown's. This overlay answers first (`Prec.high`) when the cursor sits
 * in a `beancount`/`bean` fence body:
 *
 * - `commentTokens: { line: ';' }` — Cmd+/ inserts/strips `; ` comments.
 * - `closeBrackets` — auto-close `{}[]()` and `'`, not `"`, matching
 *   vscode-beancount's autoClosingPairs (narration uses `"`).
 * - `wordChars: ':'` — CM6 has no `wordPattern`; `:` keeps `Assets:Cash`
 *   a single word. The vscode regex (`[A-Za-z:]+\\S+|...`) cannot be
 *   expressed as extra word characters.
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
import { EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { BEANCOUNT_LANGUAGE_DATA } from './beancount-mode';
import { extractBeancountFences } from './fences';

export { BEANCOUNT_LANGUAGE_DATA };

/** Indent, one or more `;`, optional space, then `#region` / `#endregion`. */
const REGION_START = /^[ \t]*;+[ \t]*#region\b/;
const REGION_END = /^[ \t]*;+[ \t]*#endregion\b/;

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
export function fenceLanguageData(text: string, pos: number): readonly [typeof BEANCOUNT_LANGUAGE_DATA] | readonly [] {
	return posInBeancountFence(text, pos) ? [BEANCOUNT_LANGUAGE_DATA] : [];
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
	const to = endLine === -1 ? lineTo(text, starts, lastHidden) : starts[endLine];
	if (to <= from) return null;
	return { from, to };
}

/**
 * Overlay for the markdown editor: beancount `languageData` inside fence
 * bodies, plus `;#region` folding. `Prec.high` so Cmd+/ sees `;` before
 * markdown's comment tokens.
 */
export function fenceLanguageExtension(): Extension {
	return [
		Prec.high(
			EditorState.languageData.of((state, pos) => fenceLanguageData(state.doc.toString(), pos))
		),
		foldService.of((state, lineStart, lineEnd) =>
			regionFoldAt(state.doc.toString(), lineStart, lineEnd)
		),
	];
}
