/**
 * End-of-line widgets for local ledger hints: the single-commodity
 * balance-assertion delta, the amount beancount would infer for the one
 * posting that omits it, and a warning when every posting has an amount but
 * the transaction does not sum to zero.
 *
 * There is no booking engine here. `balanceHints` reads only the text in
 * this editor, so a configured entry ledger disables that fallback —
 * postings outside the file are unknown, and a local delta would pretend
 * otherwise. Inferred amounts and unbalanced warnings are one transaction
 * each, so they stay on when an entry ledger is configured. They are
 * computed only for transactions that intersect `view.visibleRanges`. Each
 * range grows to the enclosing transaction — the column-0 header above,
 * through the last indented line below — so a visible posting is still
 * balanced against its whole block. A missing or empty viewport means the
 * ranges are not known yet, and the whole file is hinted. Ledger lines are
 * read with `doc.line()`, not `doc.toString()`.
 *
 * Balance-assertion hints need a running total from the top of the file.
 * That scan is unchanged, and still runs only when no entry ledger is set;
 * those widgets are not clipped to the viewport.
 *
 * Markdown notes contribute only `beancount`/`bean` fence bodies, written
 * back onto the host lines (everything else blank) so every fence in the
 * note is one ledger and the hint stays on the line the user sees. Prose
 * never reaches the parser. Masking still reads the note once: a fence
 * opened above the viewport has to stay masked. Posting hints on the masked
 * lines are viewport-limited the same way as in a ledger file.
 *
 * The decorations are their own view plugin, not the diagnostics field.
 * They rebuild synchronously when the document, the viewport, or the file
 * in this editor changes. Selection changes and diagnostic effects do not.
 * A widget compares equal by its label and class and can rewrite its own
 * element, so an edit that leaves a hint unchanged does not replace the DOM.
 */
import { StateEffect } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { balanceHints } from './balance-hints';
import { extractBeancountFences } from './fences';
import { postingHints } from './posting-hints';
import type { PostingHint } from './posting-hints';
import { isLedgerFile } from './vault-index';

/** The CSS contract between the widgets and `styles.css`. */
export const BALANCE_HINT_CLASS = 'cm-beancount-balance-hint';
export const INFERRED_HINT_CLASS = 'cm-beancount-inferred-hint';
export const UNBALANCED_HINT_CLASS = 'cm-beancount-unbalanced-hint';
/** Extra gap when an inferred amount has no decimal column to pad toward. */
export const HINT_GAP_CLASS = 'cm-beancount-hint-gap';

/** Live settings the widgets read when they rebuild. */
export interface BalanceInlayHost {
	settings: { inlayHints: boolean; entryLedger: string; separatorColumn?: number };
}

/** Asks every tracked view to rebuild without touching the document. */
const refreshBalanceHints = StateEffect.define<null>();

/**
 * File identity for an editor that can change files in place. Path plus
 * extension: a rename or a swap to another note must rebuild even when the
 * text transaction is easy to miss, and a same-path rewrite does not.
 */
function editorFileKey(state: EditorState): string {
	const file = state.field(editorInfoField, false)?.file;
	if (!file) return '';
	return file.path + '\0' + file.extension;
}

/**
 * Host lines with fence bodies in place and every other line blank. Blank
 * lines do not split the ledger `balanceHints` walks, which is how one note's
 * fences stay one inventory while hint lines remain the note's lines.
 * `null` when the note has no ledger fence — prose is not a ledger.
 */
function fenceMaskedLines(text: string): string[] | null {
	const fences = extractBeancountFences(text);
	if (fences.length === 0) return null;
	const masked = text.split(/\r?\n/).map(() => '');
	for (const fence of fences) {
		for (let i = 0; i < fence.lines.length; i += 1) {
			masked[fence.startLine + i] = fence.lines[i];
		}
	}
	return masked;
}

/** Inline, after the line text, so the caret at EOL stays in the document. */
class BalanceHintWidget extends WidgetType {
	constructor(readonly label: string) {
		super();
	}

	eq(other: BalanceHintWidget): boolean {
		return other.label === this.label;
	}

	toDOM(): HTMLElement {
		return createSpan({ cls: BALANCE_HINT_CLASS, text: this.label });
	}

	updateDOM(dom: HTMLElement): boolean {
		if (dom.textContent !== this.label) dom.textContent = this.label;
		if (dom.className !== BALANCE_HINT_CLASS) dom.className = BALANCE_HINT_CLASS;
		return true;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/** Inline, after the line text, so the caret at EOL stays in the document. */
class PostingHintWidget extends WidgetType {
	constructor(
		readonly label: string,
		readonly className: string
	) {
		super();
	}

	eq(other: PostingHintWidget): boolean {
		return other.label === this.label && other.className === this.className;
	}

	toDOM(): HTMLElement {
		return createSpan({ cls: this.className, text: this.label });
	}

	updateDOM(dom: HTMLElement): boolean {
		if (dom.textContent !== this.label) dom.textContent = this.label;
		if (dom.className !== this.className) dom.className = this.className;
		return true;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/** Inclusive 0-based line span. */
interface LineSpan {
	from: number;
	to: number;
}

function collectLines(count: number, lineText: (index: number) => string): string[] {
	const lines = new Array<string>(count);
	for (let i = 0; i < count; i += 1) lines[i] = lineText(i);
	return lines;
}

/**
 * Visible ranges grown to whole transactions. `null` when the viewport is
 * unknown (missing or empty): the caller hints the whole file, matching a
 * live editor before the first measure. A column-0 line ends the block, so
 * the walk stops at the header above and the last indented line below —
 * the same entry boundary `postingHints` uses.
 */
function transactionSpans(
	lineCount: number,
	lineText: (index: number) => string,
	doc: { length: number; lineAt(pos: number): { number: number } },
	ranges: readonly { from: number; to: number }[] | undefined
): LineSpan[] | null {
	if (!ranges || ranges.length === 0) return null;
	if (lineCount <= 0) return [];
	const spans: LineSpan[] = [];
	for (let r = 0; r < ranges.length; r += 1) {
		const range = ranges[r];
		if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > range.to) continue;
		const fromPos = range.from < 0 ? 0 : range.from > doc.length ? doc.length : range.from;
		const endPos = range.to > range.from ? range.to - 1 : range.from;
		const toPos = endPos < 0 ? 0 : endPos > doc.length ? doc.length : endPos;
		let start = doc.lineAt(fromPos).number - 1;
		let end = doc.lineAt(toPos).number - 1;
		if (start < 0) start = 0;
		if (end >= lineCount) end = lineCount - 1;
		if (end < start) end = start;
		while (start > 0) {
			const head = lineText(start).charAt(0);
			if (head !== ' ' && head !== '\t') break;
			start -= 1;
		}
		while (end + 1 < lineCount) {
			const head = lineText(end + 1).charAt(0);
			if (head !== ' ' && head !== '\t') break;
			end += 1;
		}
		spans.push({ from: start, to: end });
	}
	if (spans.length === 0) return [];
	spans.sort((a, b) => a.from - b.from);
	const merged: LineSpan[] = [];
	let current = spans[0];
	for (let i = 1; i < spans.length; i += 1) {
		const next = spans[i];
		if (next.from <= current.to + 1) {
			if (next.to > current.to) current = { from: current.from, to: next.to };
		} else {
			merged.push(current);
			current = next;
		}
	}
	merged.push(current);
	return merged;
}

function postingHintsInSpans(
	lineCount: number,
	lineText: (index: number) => string,
	spans: readonly LineSpan[] | null,
	options: { separatorColumn: number } | undefined
): PostingHint[] {
	if (spans === null) return postingHints(collectLines(lineCount, lineText), options);
	const hints: PostingHint[] = [];
	for (let s = 0; s < spans.length; s += 1) {
		const span = spans[s];
		const count = span.to - span.from + 1;
		if (count <= 0) continue;
		const found = postingHints(collectLines(count, (i) => lineText(span.from + i)), options);
		for (let i = 0; i < found.length; i += 1) {
			const hint = found[i];
			hints.push(span.from === 0 ? hint : { ...hint, line: hint.line + span.from });
		}
	}
	return hints;
}

function appendBalanceHints(
	ranges: Array<Range<Decoration>>,
	doc: { lines: number; line(n: number): { to: number } },
	hints: readonly { line: number; label: string }[]
): void {
	for (let i = 0; i < hints.length; i += 1) {
		const hint = hints[i];
		if (hint.line < 0 || hint.line >= doc.lines) continue;
		ranges.push(
			Decoration.widget({ widget: new BalanceHintWidget(hint.label), side: 1 }).range(doc.line(hint.line + 1).to)
		);
	}
}

function appendPostingHints(
	ranges: Array<Range<Decoration>>,
	doc: { lines: number; line(n: number): { to: number } },
	hints: readonly PostingHint[]
): void {
	for (let i = 0; i < hints.length; i += 1) {
		const hint = hints[i];
		if (hint.line < 0 || hint.line >= doc.lines) continue;
		const className =
			hint.kind === 'unbalanced'
				? UNBALANCED_HINT_CLASS
				: hint.aligned
					? INFERRED_HINT_CLASS
					: INFERRED_HINT_CLASS + ' ' + HINT_GAP_CLASS;
		ranges.push(
			Decoration.widget({ widget: new PostingHintWidget(hint.label, className), side: 1 }).range(
				doc.line(hint.line + 1).to
			)
		);
	}
}

function balanceDecorations(view: EditorView, host: BalanceInlayHost): DecorationSet {
	if (!host.settings.inlayHints) return Decoration.none;
	const file = view.state.field(editorInfoField, false)?.file;
	if (!file) return Decoration.none;
	const doc = view.state.doc;
	const ranges: Array<Range<Decoration>> = [];
	const column = host.settings.separatorColumn;
	const options = column === undefined ? undefined : { separatorColumn: column };
	const localLedger = host.settings.entryLedger.trim() === '';
	const visible = view.visibleRanges;
	if (file.extension === 'md') {
		// Fence state above the viewport is part of the mask, so this still
		// reads the note. Posting hints below are limited to visible transactions.
		const masked = fenceMaskedLines(doc.toString());
		if (!masked) return Decoration.none;
		const lineText = (index: number) => (index >= 0 && index < masked.length ? masked[index] : '');
		if (localLedger) appendBalanceHints(ranges, doc, balanceHints(masked));
		const spans = transactionSpans(doc.lines, lineText, doc, visible);
		appendPostingHints(ranges, doc, postingHintsInSpans(doc.lines, lineText, spans, options));
	} else if (isLedgerFile(file)) {
		const lineText = (index: number) => doc.line(index + 1).text;
		if (localLedger) appendBalanceHints(ranges, doc, balanceHints(collectLines(doc.lines, lineText)));
		const spans = transactionSpans(doc.lines, lineText, doc, visible);
		appendPostingHints(ranges, doc, postingHintsInSpans(doc.lines, lineText, spans, options));
	} else {
		return Decoration.none;
	}
	if (ranges.length === 0) return Decoration.none;
	ranges.sort((a, b) => a.from - b.from);
	return Decoration.set(ranges, true);
}

function inlayPlugin(host: BalanceInlayHost, views: Set<EditorView>) {
	return class BalanceInlayPlugin {
		decorations: DecorationSet;
		private fileKey: string;

		constructor(private readonly view: EditorView) {
			views.add(view);
			this.fileKey = editorFileKey(view.state);
			this.decorations = balanceDecorations(view, host);
		}

		update(update: ViewUpdate): void {
			const nextKey = editorFileKey(update.state);
			const fileChanged = nextKey !== this.fileKey;
			this.fileKey = nextKey;
			const forced = update.transactions.some((tr) =>
				tr.effects.some((effect) => effect.is(refreshBalanceHints))
			);
			if (!update.docChanged && !fileChanged && !forced && !update.viewportChanged) return;
			this.decorations = balanceDecorations(update.view, host);
		}

		destroy(): void {
			views.delete(this.view);
		}
	};
}

/**
 * One controller per plugin. Register `extension` once; `refresh` reapplies
 * the current settings to every editor still showing them.
 */
export class BalanceInlayController {
	private readonly views = new Set<EditorView>();
	readonly extension: Extension;

	constructor(host: BalanceInlayHost) {
		const Plugin = inlayPlugin(host, this.views);
		this.extension = ViewPlugin.fromClass(Plugin, {
			decorations: (plugin) => plugin.decorations,
		});
	}

	/** Rebuild every open editor's hints without changing its document. */
	refresh(): void {
		for (const view of this.views) {
			view.dispatch({ effects: refreshBalanceHints.of(null) });
		}
	}

	/** Drop tracked views so a later refresh cannot dispatch into a dead editor. */
	destroy(): void {
		this.views.clear();
	}
}
