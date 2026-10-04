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

/** Anything `IndexSuggest` can rank against. */
export interface CompletionIndex {
	match(query: string): string[];
	remember?(value: string): void;
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

	/** Trigger info for `query` typed at `cursor`, or null when nothing matches. */
	protected triggerInfo(cursor: EditorPosition, query: string): EditorSuggestTriggerInfo | null {
		// Stay quiet unless the query prefixes a cached string; a bare token
		// or the just-typed string itself has nothing to offer.
		if (this.candidates(query).length === 0) return null;
		return {
			start: { line: cursor.line, ch: cursor.ch - query.length },
			end: cursor,
			query,
		};
	}

	/** Completions for `query`, never the typed string itself. */
	private candidates(query: string): string[] {
		// The typed string is in the live buffer and therefore in the index;
		// offering it back would make Enter accept a no-op.
		return this.index.match(query).filter((value) => value !== query);
	}
}
