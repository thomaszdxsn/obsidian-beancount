/**
 * Snippet completion: an `EditorSuggest` over `SNIPPETS`.
 *
 * A prefix at column 0 that starts a snippet name (`txn`, `open`, …)
 * opens the popup; picking one replaces the prefix with the expanded
 * body, parks the caret on `$1`, and starts a Tab session so later
 * stops are reachable. While another of the plugin's popovers is open
 * (payee completion after `txn`), Tab stays with that popover.
 */
import { EditorSelection, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { EditorSuggest } from 'obsidian';
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { expandSnippet, matchSnippets, SNIPPETS } from './snippets';
import type { Expansion, Snippet, TabStop } from './snippets';

/** A completion popover whose open state decides who owns Tab. */
interface SuggestState {
	context: unknown;
}

/** Tab-stop session for one in-progress expansion. */
export class SnippetSession {
	private origin = 0;
	private stops: TabStop[] = [];
	private index = 0;

	/** True while a stop is still waiting for Tab. */
	get active(): boolean {
		return this.index < this.stops.length;
	}

	start(origin: number, expansion: Expansion): void {
		this.origin = origin;
		this.stops = expansion.stops.map((stop) => ({ ...stop }));
		this.index = 0;
	}

	clear(): void {
		this.stops = [];
		this.index = 0;
	}

	/**
	 * Next stop after the one the cursor is finishing. Typing in the
	 * current stop shifts later ranges by the extra (or missing) length.
	 * A cursor that moved before the current stop ends the session.
	 */
	advance(cursorOffset: number): { from: number; to: number } | null {
		if (this.index >= this.stops.length) return null;
		const current = this.stops[this.index];
		const currentFrom = this.origin + current.from;
		const currentTo = this.origin + current.to;
		if (cursorOffset < currentFrom) {
			this.clear();
			return null;
		}
		const delta = cursorOffset - currentTo;
		for (let i = this.index + 1; i < this.stops.length; i++) {
			this.stops[i].from += delta;
			this.stops[i].to += delta;
		}
		this.index += 1;
		if (this.index >= this.stops.length) {
			this.clear();
			return null;
		}
		const next = this.stops[this.index];
		return { from: this.origin + next.from, to: this.origin + next.to };
	}
}

export class SnippetSuggest extends EditorSuggest<Snippet> {
	constructor(
		app: App,
		private readonly session: SnippetSession
	) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const after = line.charAt(cursor.ch);
		if (after !== '' && after !== ' ' && after !== '\t') return null;
		const query = line.slice(0, cursor.ch);
		if (query.length === 0) return null;
		// Directives live at column 0; indented text is a posting, not a prefix.
		if (query.includes(' ') || query.includes('\t')) return null;
		if (!SNIPPETS.some((snippet) => snippet.prefix.startsWith(query))) return null;
		return {
			start: { line: cursor.line, ch: 0 },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: { query: string }): Snippet[] {
		return matchSnippets(context.query);
	}

	renderSuggestion(value: Snippet, el: HTMLElement): void {
		el.setText(value.prefix);
		el.createDiv({ text: value.description, cls: 'beancount-snippet-suggest-meta' });
	}

	selectSuggestion(value: Snippet, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		const expansion = expandSnippet(value.body);
		const origin = offsetFrom(context.editor, context.start);
		context.editor.replaceRange(expansion.text, context.start, context.end);
		const first = expansion.stops[0];
		context.editor.setSelection(
			positionFrom(context.start, expansion.text, first.from),
			positionFrom(context.start, expansion.text, first.to)
		);
		this.session.start(origin, expansion);
		this.close();
	}
}

/**
 * Tab walks the active snippet's remaining stops. `Prec.high` so it is
 * asked first; returning false leaves Tab to completion popovers and indent.
 */
export function snippetTabExtension(session: SnippetSession, suggests: readonly SuggestState[]): Extension {
	const run = (view: EditorView): boolean => {
		if (suggests.some((suggest) => suggest.context !== null)) return false;
		if (!session.active) return false;
		const cursor = view.state.selection.ranges[0].head;
		const next = session.advance(cursor);
		if (next === null) return false;
		view.dispatch({
			selection: EditorSelection.create([
				next.from === next.to ? EditorSelection.cursor(next.from) : EditorSelection.range(next.from, next.to),
			]),
		});
		return true;
	};
	return Prec.high(keymap.of([{ key: 'Tab', run }]));
}

/** Flat-buffer offset of `pos`, counting the newline before each line. */
function offsetFrom(editor: Editor, pos: EditorPosition): number {
	let offset = 0;
	for (let i = 0; i < pos.line; i++) offset += editor.getLine(i).length + 1;
	return offset + pos.ch;
}

/** Editor position of `offset` inside text inserted at `start`. */
function positionFrom(start: EditorPosition, text: string, offset: number): EditorPosition {
	const before = text.slice(0, offset);
	const newline = before.lastIndexOf('\n');
	if (newline === -1) return { line: start.line, ch: start.ch + offset };
	return {
		line: start.line + before.split('\n').length - 1,
		ch: before.length - newline - 1,
	};
}
