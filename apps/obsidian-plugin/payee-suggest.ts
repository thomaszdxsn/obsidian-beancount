/**
 * Payee completion: an `IndexSuggest` popup fed by the vault payee index
 * (`VaultIndex` over `extractPayees`).
 *
 * Typing the first quoted field of a transaction line (`2026-09-30 * "Am…`)
 * triggers a prefix-match popup over every payee cached from the vault;
 * picking one replaces the typed prefix. An unclosed field (no `"` at the
 * cursor) is closed in that replacement, so autofill postings on the next
 * lines are not swallowed by a string that spans lines.
 *
 * When `payeeAutofill` is on and the entry has no continuation yet (the next
 * line is blank, missing, or not indented), the pick also inserts the
 * postings of that payee's latest transaction (`PayeeTemplateIndex`) under
 * the header. Narration text is never rewritten. The caret lands at the
 * start of the narration body when the header has a second quoted field
 * (including `""`), otherwise on the first amount stop, with that number
 * selected so typing replaces it. The payee replacement and the posting
 * insert are one `editor.transaction`, so undo restores both. Tab walks
 * the rest via `SnippetSession`: stops are absolute document offsets
 * (origin 0) so the narration stop in the header and the amount stops in
 * the inserted lines share one session. A narration stop is zero-width,
 * so the existing narration is not selected. The session is not mapped
 * through later edits; undo/redo or a change outside its stops ends it.
 */
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { PAYEE_PREFIX_RE } from './payee-index';
import { buildPayeeAutofill } from './payee-template';
import type { TemplatePosting } from './payee-template';
import { SnippetSession } from './snippet-suggest';
import type { TabStop } from './snippets';
import { IndexSuggest } from './suggest';
import type { CompletionIndex } from './suggest';

/** What payee completion needs to fill postings after a pick. */
export interface PayeeAutofill {
	/** The `payeeAutofill` setting. */
	enabled(): boolean;
	/** Postings of the payee's latest transaction, or null when unknown. */
	templateFor(payee: string): readonly TemplatePosting[] | null;
	session: SnippetSession;
}

/** A caret or range in the document after the payee replacement and the insert. */
export interface AutofillSelection {
	anchor: EditorPosition;
	head: EditorPosition;
}

/**
 * The posting insert for one payee pick, in coordinates of the document
 * *after* the payee text has replaced `[startCh, endCh)`. When `endCh` is
 * not a `"`, that replacement also closes the field, and `atCh` / `stops`
 * count the inserted quote.
 */
export interface PayeeAutofillPlan {
	/** Header line the payee was completed on. */
	line: number;
	/** Column at the end of that line, where `insert` is placed. */
	atCh: number;
	/** Newline plus indented posting lines. */
	insert: string;
	/** Where the user continues. Null when there is no narration and no amount. */
	selection: AutofillSelection | null;
	/** Absolute offsets for `SnippetSession.start(0, …)`. */
	stops: TabStop[];
}

export interface PayeeAutofillInput {
	lines: readonly string[];
	line: number;
	startCh: number;
	endCh: number;
	payee: string;
	/** False skips the insert even when `postings` is set. */
	enabled: boolean;
	postings: readonly TemplatePosting[] | null;
}

const NARRATION_RE = /^[ \t]*"((?:[^"\\\n]|\\.)*)"/;

/**
 * Payee text written over `[start, end)`. A `"` already at `endCh` is the
 * field's closer and is left alone. Otherwise the closer is part of the
 * replacement: beancount strings span lines, so an open payee would swallow
 * postings inserted on the following lines.
 */
function payeeReplacement(payee: string, line: string, endCh: number): string {
	return line.charAt(endCh) === '"' ? payee : `${payee}"`;
}

/**
 * Posting insert for a payee pick, or null when autofill must not run:
 * the setting is off, there is no template, or the entry already continues
 * on an indented next line. A blank, missing, or column-0 next line is empty.
 */
export function planPayeeAutofill(input: PayeeAutofillInput): PayeeAutofillPlan | null {
	if (!input.enabled || input.postings === null || input.postings.length === 0) return null;
	const next = input.lines[input.line + 1];
	if (next !== undefined && next.trim() !== '' && (next.startsWith(' ') || next.startsWith('\t'))) return null;
	const body = buildPayeeAutofill(input.postings);
	if (body === null) return null;
	const original = input.lines[input.line] ?? '';
	const inserted = payeeReplacement(input.payee, original, input.endCh);
	const newLine = original.slice(0, input.startCh) + inserted + original.slice(input.endCh);
	const narrationCh = narrationCaret(original, newLine, input.startCh, input.endCh, input.payee);
	let headerStart = 0;
	for (let i = 0; i < input.line; i += 1) headerStart += (input.lines[i] ?? '').length + 1;
	const insertOrigin = headerStart + newLine.length;
	const stops: TabStop[] = [];
	if (narrationCh !== null) {
		const at = headerStart + narrationCh;
		stops.push({ index: 1, from: at, to: at });
	}
	for (const stop of body.stops) {
		stops.push({
			index: stops.length + 1,
			from: insertOrigin + stop.from,
			to: insertOrigin + stop.to,
		});
	}
	return {
		line: input.line,
		atCh: newLine.length,
		insert: body.text,
		selection: autofillSelection(input.line, newLine.length, body.text, narrationCh, body.stops),
		stops,
	};
}

export class PayeeSuggest extends IndexSuggest {
	constructor(
		app: App,
		index: CompletionIndex,
		private readonly enabled: () => boolean = () => true,
		private readonly autofill?: PayeeAutofill
	) {
		super(app, index);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.enabled()) return null;
		const line = editor.getLine(cursor.line);
		// Mid-field edits (any character but the closing quote right after the
		// cursor) would make selection replace only the typed prefix and garble
		// the rest of the field.
		const after = line.charAt(cursor.ch);
		if (after !== '' && after !== '"') return null;
		const match = PAYEE_PREFIX_RE.exec(line.slice(0, cursor.ch));
		if (!match) return null;
		return this.triggerInfo(cursor, match[1]);
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		const editor = context.editor;
		const line = context.start.line;
		const lines: string[] = [];
		for (let i = 0; i < editor.lineCount(); i += 1) lines.push(editor.getLine(i));
		const enabled = this.autofill?.enabled() ?? false;
		const plan =
			line === context.end.line
				? planPayeeAutofill({
						lines,
						line,
						startCh: context.start.ch,
						endCh: context.end.ch,
						payee: value,
						enabled,
						postings: enabled ? (this.autofill?.templateFor(value) ?? null) : null,
					})
				: null;
		const atEnd = editor.getLine(context.end.line);
		const payeeText = payeeReplacement(value, atEnd, context.end.ch);
		if (plan && this.autofill) {
			// One history event. Both ranges are pre-edit coordinates: the
			// insert is the end of the header as it is now, not `plan.atCh`
			// (that column is after this replacement). Selection is the
			// post-edit caret. `session.start` follows the transaction so a
			// synchronous dispatch does not see an active session and treat
			// the pick itself as an outside edit.
			const endCh = atEnd.length;
			editor.transaction({
				changes: [
					{ from: context.start, to: context.end, text: payeeText },
					{ from: { line, ch: endCh }, to: { line, ch: endCh }, text: plan.insert },
				],
				...(plan.selection ? { selection: { from: plan.selection.anchor, to: plan.selection.head } } : {}),
			});
			const host = editor as Editor & { cm?: unknown };
			if (plan.stops.length > 0) {
				this.autofill.session.start(0, { text: '', stops: plan.stops }, host.cm ?? host);
			} else {
				this.autofill.session.clear();
			}
		} else {
			editor.replaceRange(payeeText, context.start, context.end);
		}
		this.index.remember?.(value);
		this.close();
	}

}

/**
 * Column of a collapsed caret at the start of the narration body, or null
 * when the payee field was not closed or no second quoted field follows it.
 */
function narrationCaret(
	original: string,
	newLine: string,
	startCh: number,
	endCh: number,
	payee: string
): number | null {
	if (original.charAt(endCh) !== '"') return null;
	const closeCh = startCh + payee.length;
	if (newLine.charAt(closeCh) !== '"') return null;
	const rest = newLine.slice(closeCh + 1);
	const narration = NARRATION_RE.exec(rest);
	if (narration === null) return null;
	const gap = rest.length - rest.replace(/^[ \t]*/, '').length;
	return closeCh + 1 + gap + 1;
}

function autofillSelection(
	line: number,
	atCh: number,
	insert: string,
	narrationCh: number | null,
	stops: readonly TabStop[]
): AutofillSelection | null {
	if (narrationCh !== null) {
		const caret = { line, ch: narrationCh };
		return { anchor: caret, head: caret };
	}
	const first = stops[0];
	if (first === undefined) return null;
	return { anchor: positionInInsert(line, atCh, insert, first.from), head: positionInInsert(line, atCh, insert, first.to) };
}

/** Editor position of `offset` inside text inserted at the end of `line`. */
function positionInInsert(line: number, atCh: number, insert: string, offset: number): EditorPosition {
	const before = insert.slice(0, offset);
	const parts = before.split('\n');
	if (parts.length === 1) return { line, ch: atCh + offset };
	return { line: line + parts.length - 1, ch: parts[parts.length - 1].length };
}
