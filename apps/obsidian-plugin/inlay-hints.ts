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
 * each, so they stay on when an entry ledger is configured. Markdown notes
 * contribute only `beancount`/`bean` fence bodies, written back onto the
 * host lines (everything else blank) so every fence in the note is one
 * ledger and the hint stays on the line the user sees. Prose never reaches
 * the parser.
 *
 * The decorations are their own view plugin, not the diagnostics field.
 * They rebuild synchronously when the document or the file in this editor
 * changes. Selection changes and diagnostic effects do not. A widget compares
 * equal by its label and class and can rewrite its own element, so an edit
 * that leaves a hint unchanged does not replace the DOM.
 */
import { StateEffect } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { balanceHints } from './balance-hints';
import { extractBeancountFences } from './fences';
import { postingHints } from './posting-hints';
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
		const span = document.createElement('span');
		span.className = BALANCE_HINT_CLASS;
		span.textContent = this.label;
		return span;
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
		const span = document.createElement('span');
		span.className = this.className;
		span.textContent = this.label;
		return span;
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

function balanceDecorations(view: EditorView, host: BalanceInlayHost): DecorationSet {
	if (!host.settings.inlayHints) return Decoration.none;
	const file = view.state.field(editorInfoField, false)?.file;
	if (!file) return Decoration.none;
	const text = view.state.doc.toString();
	let lines: readonly string[] | null = null;
	if (file.extension === 'md') lines = fenceMaskedLines(text);
	else if (isLedgerFile(file)) lines = text.split(/\r?\n/);
	if (!lines) return Decoration.none;
	const doc = view.state.doc;
	const ranges: Array<Range<Decoration>> = [];
	if (host.settings.entryLedger.trim() === '') {
		const hints = balanceHints(lines);
		for (let i = 0; i < hints.length; i += 1) {
			const hint = hints[i];
			if (hint.line < 0 || hint.line >= doc.lines) continue;
			const line = doc.line(hint.line + 1);
			ranges.push(Decoration.widget({ widget: new BalanceHintWidget(hint.label), side: 1 }).range(line.to));
		}
	}
	const column = host.settings.separatorColumn;
	const postings = postingHints(lines, column === undefined ? undefined : { separatorColumn: column });
	for (let i = 0; i < postings.length; i += 1) {
		const hint = postings[i];
		if (hint.line < 0 || hint.line >= doc.lines) continue;
		const line = doc.line(hint.line + 1);
		const className =
			hint.kind === 'unbalanced'
				? UNBALANCED_HINT_CLASS
				: hint.aligned
					? INFERRED_HINT_CLASS
					: INFERRED_HINT_CLASS + ' ' + HINT_GAP_CLASS;
		ranges.push(Decoration.widget({ widget: new PostingHintWidget(hint.label, className), side: 1 }).range(line.to));
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
			if (!update.docChanged && !fileChanged && !forced) return;
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
