/**
 * End-of-line widgets for the single-commodity balance-assertion delta.
 *
 * There is no booking engine here. `balanceHints` reads only the text in
 * this editor, so a configured entry ledger disables the fallback — postings
 * outside the file are unknown, and a local delta would pretend otherwise.
 * Markdown notes contribute only `beancount`/`bean` fence bodies, written
 * back onto the host lines (everything else blank) so every fence in the
 * note is one ledger and the hint stays on the line the user sees. Prose
 * never reaches the parser.
 *
 * The decorations are their own view plugin, not the diagnostics field.
 * They rebuild synchronously when the document or the file in this editor
 * changes. Selection changes and diagnostic effects do not. A widget compares
 * equal by its label and can rewrite its own element, so an edit that leaves
 * a hint unchanged does not replace the DOM.
 */
import { StateEffect } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { balanceHints } from './balance-hints';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';

/** The CSS contract between the widget and `styles.css`. */
export const BALANCE_HINT_CLASS = 'cm-beancount-balance-hint';

/** Live settings the widgets read when they rebuild. */
export interface BalanceInlayHost {
	settings: { inlayHints: boolean; entryLedger: string };
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

function balanceDecorations(view: EditorView, host: BalanceInlayHost): DecorationSet {
	if (!host.settings.inlayHints || host.settings.entryLedger.trim() !== '') return Decoration.none;
	const file = view.state.field(editorInfoField, false)?.file;
	if (!file) return Decoration.none;
	const text = view.state.doc.toString();
	let lines: readonly string[] | null = null;
	if (file.extension === 'md') lines = fenceMaskedLines(text);
	else if (isLedgerFile(file)) lines = text.split(/\r?\n/);
	if (!lines) return Decoration.none;
	const hints = balanceHints(lines);
	if (hints.length === 0) return Decoration.none;
	const doc = view.state.doc;
	const ranges: Array<Range<Decoration>> = [];
	for (let i = 0; i < hints.length; i += 1) {
		const hint = hints[i];
		if (hint.line < 0 || hint.line >= doc.lines) continue;
		const line = doc.line(hint.line + 1);
		ranges.push(Decoration.widget({ widget: new BalanceHintWidget(hint.label), side: 1 }).range(line.to));
	}
	return ranges.length === 0 ? Decoration.none : Decoration.set(ranges, true);
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
