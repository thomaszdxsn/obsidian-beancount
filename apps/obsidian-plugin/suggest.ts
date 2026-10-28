/**
 * Shared behaviour for completion popovers over vault strings (accounts,
 * payees, …): rank candidates from an index with `match`, and picking one
 * replaces the typed query in place. Subclasses only decide when a line
 * and cursor open a completable field (`onTrigger`).
 */
import { EditorSuggest } from 'obsidian';
import type {
	App,
	Editor,
	EditorPosition,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { editorLedger } from './fences';
import { completionSlot } from './slot';
import type { CompletionSlot, SlotKind } from './slot';

/** Anything `IndexSuggest` can rank against. */
export interface CompletionIndex {
	match(query: string): string[];
	remember?(value: string): void;
}

type SlotCache = {
	doc: object;
	filePath: string | null;
	line: number;
	ch: number;
	lineText: string;
	completeNarration: boolean;
	slot: CompletionSlot | null;
};

let slotCache: SlotCache | null = null;

/** The live CodeMirror `Text`, or undefined when this editor has no CM doc. */
function cmDoc(editor: Editor): object | undefined {
	return (editor as { cm?: { state?: { doc?: object } } }).cm?.state?.doc;
}

/** Shared slot for this keystroke: one `completionSlot` per CM doc/line/ch. */
export function ownSlot(
	kind: SlotKind,
	cursor: EditorPosition,
	editor: Editor,
	file: TFile | null,
	completeNarration: boolean
): CompletionSlot | null {
	const slot = cachedSlot(cursor, editor, file, completeNarration);
	return slot?.kind === kind ? slot : null;
}

function cachedSlot(
	cursor: EditorPosition,
	editor: Editor,
	file: TFile | null,
	completeNarration: boolean
): CompletionSlot | null {
	const lineText = editor.getLine(cursor.line);
	const filePath = file?.path ?? null;
	const doc = cmDoc(editor);
	if (
		doc &&
		slotCache &&
		slotCache.doc === doc &&
		slotCache.filePath === filePath &&
		slotCache.line === cursor.line &&
		slotCache.ch === cursor.ch &&
		slotCache.lineText === lineText &&
		slotCache.completeNarration === completeNarration
	) {
		return slotCache.slot;
	}
	const slot = completionSlot({
		line: lineText,
		ch: cursor.ch,
		lineIsLedger: () => editorLedger(editor, file).lineIsLedger(cursor.line),
		completeNarration,
	});
	slotCache = doc
		? { doc, filePath, line: cursor.line, ch: cursor.ch, lineText, completeNarration, slot }
		: null;
	return slot;
}


export abstract class IndexSuggest extends EditorSuggest<string> {
	constructor(
		app: App,
		protected readonly index: CompletionIndex
	) {
		super(app);
	}

	abstract onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null;

	getSuggestions(context: EditorSuggestContext): string[] {
		return this.candidates(context.query);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		context.editor.replaceRange(value, context.start, context.end);
		this.index.remember?.(value);
		// The suggestion chooser does not dismiss the popover itself; left
		// open it would re-trigger on the replacement and reuse the stale
		// range on a second pick. `close()` nulls `context`, hence the copy.
		this.close();
	}

	/** Trigger info for `slot` at `cursor`, or null when nothing matches. */
	protected triggerInfo(cursor: EditorPosition, slot: CompletionSlot): EditorSuggestTriggerInfo | null {
		// Stay quiet unless the query prefixes a cached string; a bare token
		// or the just-typed string itself has nothing to offer.
		if (this.candidates(slot.query).length === 0) return null;
		return {
			start: { line: cursor.line, ch: slot.startCh },
			end: { line: cursor.line, ch: slot.endCh },
			query: slot.query,
		};
	}

	/** Completions for `query`, never the typed string itself. */
	private candidates(query: string): string[] {
		// The typed string is in the live buffer and therefore in the index;
		// offering it back would make Enter accept a no-op.
		return this.index.match(query).filter((value) => value !== query);
	}
}
