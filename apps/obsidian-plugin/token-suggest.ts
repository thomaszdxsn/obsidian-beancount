/**
 * Completion popovers for commodity, tag, link and narration fields: one
 * `IndexSuggest` subclass each, fed by `LedgerIndex` token facts.
 * Each subclass only decides when the line and cursor
 * open its field (`onTrigger`); matching and picking come from the shared
 * base.
 *
 * Tags, links, commodities, accounts, payees and narrations only offer
 * completions inside ledger text — a `.bean`/`.beancount` file, or a
 * ```beancount / ```bean fence in a markdown note — because their triggers
 * are ordinary prose elsewhere (headings, "Meeting with The", "10 US dollars").
 */
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { editorLedger } from './fences';
import { completionSlot, type SlotKind } from './slot';
import type { CompletionIndex } from './suggest';
import { IndexSuggest } from './suggest';

function ownSlot(
	kind: SlotKind,
	cursor: EditorPosition,
	editor: Editor,
	file: TFile | null,
	completeNarration: boolean
) {
	const slot = completionSlot({
		line: editor.getLine(cursor.line),
		ch: cursor.ch,
		lineIsLedger: editorLedger(editor, file).lineIsLedger(cursor.line),
		completeNarration,
	});
	return slot?.kind === kind ? slot : null;
}

/**
 * Tag completion: typing `#` (plus a partial name) inside ledger text
 * triggers a prefix-match popup over every tag cached from the vault;
 * picking one replaces the typed `#na` with `#name` — the sigil is part of
 * the cached strings.
 */
export class TagSuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const slot = ownSlot('tag', cursor, editor, file, true);
		if (!slot) return null;
		return this.triggerInfo(cursor, slot.query);
	}
}

/** Link completion: the same as tags, triggered by `^`. */
export class LinkSuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const slot = ownSlot('link', cursor, editor, file, true);
		if (!slot) return null;
		return this.triggerInfo(cursor, slot.query);
	}
}

/**
 * Commodity completion: typing a partial commodity where one carries an
 * amount — after an amount's number (posting units, costs, prices,
 * `balance`), or after the `price` / `commodity` keyword of its directive —
 * triggers a prefix-match popup over every commodity cached from the vault.
 */
export class CommoditySuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const slot = ownSlot('commodity', cursor, editor, file, true);
		if (!slot) return null;
		return this.triggerInfo(cursor, slot.query);
	}
}

/**
 * Narration completion: typing inside a transaction's second quoted field
 * (`2026-09-30 * "Payee" "na…`) triggers a prefix-match popup over every
 * narration cached from the vault. Off unless the plugin's
 * `completeNarration` setting turns it on (`enabled`).
 *
 * A pick closes the field when its closing quote is not typed yet: the
 * vscode-beancount `completePayeeNarration` behaviour inserts
 * `narration" ` in one step. Before an existing closing quote the text is
 * only replaced.
 */
export class NarrationSuggest extends IndexSuggest {
	constructor(
		app: App,
		index: CompletionIndex,
		private readonly enabled: () => boolean
	) {
		super(app, index);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const slot = ownSlot('narration', cursor, editor, file, this.enabled());
		if (!slot) return null;
		return this.triggerInfo(cursor, slot.query);
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		const after = context.editor.getLine(context.end.line).charAt(context.end.ch);
		const insert = after === '"' ? value : `${value}" `;
		context.editor.replaceRange(insert, context.start, context.end);
		this.index.remember?.(value);
		this.close();
	}
}
