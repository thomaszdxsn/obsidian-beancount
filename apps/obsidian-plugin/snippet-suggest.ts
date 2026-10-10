/**
 * Snippet completion: an `EditorSuggest` over `SNIPPETS`.
 *
 * A prefix at column 0 that starts a snippet name (`txn`, `open`, …)
 * opens the popup in a ledger file or a `beancount`/`bean` fence; picking
 * one replaces the prefix with the expanded body, parks the caret on `$1`,
 * and starts a Tab session so later stops are reachable. While another of
 * the plugin's popovers is open (payee completion after `txn`), Tab stays
 * with that popover. The session is bound to the editor that expanded it.
 */
import { EditorSelection, Prec, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap, ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { EditorSuggest } from 'obsidian';
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { extractBeancountFences } from './fences';
import { expandSnippet, matchSnippets, SNIPPETS } from './snippets';
import type { Expansion, Snippet, TabStop } from './snippets';

/** A completion popover whose open state decides who owns Tab. */
interface SuggestState {
	context: unknown;
}

/**
 * Tab-stop session for one in-progress expansion.
 *
 * Stops are absolute document offsets, mapped through every edit the owning
 * editor makes (`map`): typing in a stop grows it, and edits elsewhere —
 * instant alignment rewriting a gap, another posting line — shift the stops
 * after them. Undo and redo end the session: history restores a document
 * the stops were not built for.
 */
export class SnippetSession {
	private stops: Array<{ from: number; to: number }> = [];
	private index = 0;
	private owner: unknown = null;

	/** True while a stop is still waiting for Tab. */
	get active(): boolean {
		return this.index < this.stops.length;
	}

	start(origin: number, expansion: Expansion, owner: unknown = null): void {
		this.stops = expansion.stops.map((stop) => ({ from: origin + stop.from, to: origin + stop.to }));
		this.index = 0;
		this.owner = owner;
	}

	clear(): void {
		this.stops = [];
		this.index = 0;
		this.owner = null;
	}

	/**
	 * Next stop after the one the cursor is finishing. A cursor that moved
	 * before the current stop ends the session. Tab in a different editor
	 * is ignored and leaves this session intact.
	 */
	advance(cursorOffset: number, owner: unknown = null): { from: number; to: number } | null {
		if (this.index >= this.stops.length) return null;
		if (this.owner != null && owner != null && owner !== this.owner) return null;
		if (cursorOffset < this.stops[this.index].from) {
			this.clear();
			return null;
		}
		this.index += 1;
		if (this.index >= this.stops.length) {
			this.clear();
			return null;
		}
		const next = this.stops[this.index];
		return { from: next.from, to: next.to };
	}

	/**
	 * Follow one transaction of `editor`. `mapPos` is the transaction's
	 * `ChangeDesc.mapPos`: a stop's start sticks before inserted text and
	 * its end after it, so text typed at a zero-width stop lands inside.
	 * Edits in a different editor are ignored, matching Tab.
	 */
	map(editor: unknown, userEvent: string | undefined, mapPos: (pos: number, assoc: number) => number): void {
		if (!this.active) return;
		if (this.owner != null && editor != null && editor !== this.owner) return;
		if (userEvent === 'undo' || userEvent === 'redo') {
			this.clear();
			return;
		}
		for (let i = this.index; i < this.stops.length; i += 1) {
			const stop = this.stops[i];
			stop.from = mapPos(stop.from, -1);
			stop.to = Math.max(stop.from, mapPos(stop.to, 1));
		}
	}
}

export class SnippetSuggest extends EditorSuggest<Snippet> {
	constructor(
		app: App,
		private readonly session: SnippetSession
	) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!inSnippetContext(editor, cursor.line, file)) return null;
		const line = editor.getLine(cursor.line);
		const after = line.charAt(cursor.ch);
		if (after !== '' && after !== ' ' && after !== '\t') return null;
		const query = line.slice(0, cursor.ch);
		if (query.length === 0) return null;
		// Directives live at column 0 of the ledger (or fence) line.
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
		// Obsidian's Editor wraps the CodeMirror view as undeclared `cm`.
		const host = context.editor as Editor & { cm?: unknown };
		this.session.start(origin, expansion, host.cm ?? host);
		this.close();
	}
}

/**
 * Tab walks the active snippet's remaining stops. `Prec.high` so it is
 * asked first; returning false leaves Tab to completion popovers and indent.
 * The same extension maps the stops through every transaction of the
 * editor that owns the session, and ends it on undo/redo.
 */
export function snippetTabExtension(session: SnippetSession, suggests: readonly SuggestState[]): Extension {
	const run = (view: EditorView): boolean => {
		if (suggests.some((suggest) => suggest.context !== null)) return false;
		if (!session.active) return false;
		const cursor = view.state.selection.ranges[0].head;
		if (cursor > view.state.doc.toString().length) {
			session.clear();
			return false;
		}
		const next = session.advance(cursor, view);
		if (next === null) return false;
		if (next.from > view.state.doc.toString().length || next.to > view.state.doc.toString().length) {
			session.clear();
			return false;
		}
		view.dispatch({
			selection: EditorSelection.create([
				next.from === next.to ? EditorSelection.cursor(next.from) : EditorSelection.range(next.from, next.to),
			]),
		});
		return true;
	};
	return [
		Prec.high(keymap.of([{ key: 'Tab', run }])),
		sessionGuard(session),
	];
}

/**
 * Feed the session every transaction of each editor; the session itself
 * ignores editors it does not own. Registered with the Tab binding so the
 * plugin does not install a second extension.
 */
function sessionGuard(session: SnippetSession): Extension {
	return ViewPlugin.fromClass(
		class {
			update(update: ViewUpdate): void {
				if (!session.active) return;
				for (const tr of update.transactions) {
					if (!tr.docChanged) continue;
					const event = tr.annotation(Transaction.userEvent);
					session.map(update.view, typeof event === 'string' ? event : undefined, (pos, assoc) =>
						tr.changes.mapPos(pos, assoc)
					);
				}
			}
		}
	);
}

/** Ledger files, or the body of a `beancount`/`bean` fence in markdown. */
function inSnippetContext(editor: Editor, line: number, file: TFile | null): boolean {
	if (!file) return false;
	if (file.extension === 'bean' || file.extension === 'beancount') return true;
	if (file.extension !== 'md') return false;
	return extractBeancountFences(editor.getValue()).some(
		(fence) => line >= fence.startLine && line < fence.startLine + fence.lines.length
	);
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
