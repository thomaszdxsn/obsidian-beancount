/**
 * Completion popovers for commodity, tag, link and narration fields: one
 * `IndexSuggest` subclass each, fed by the `VaultIndex` extractors in
 * `token-index.ts`. Each subclass only decides when the line and cursor
 * open its field (`onTrigger`); matching and picking come from the shared
 * base.
 *
 * Tags, links and commodities only offer completions inside ledger text —
 * a `.bean`/`.beancount` file, or a ```beancount / ```bean fence in a
 * markdown note — because their trigger characters are ordinary prose
 * elsewhere (headings, markdown tags, "10 US dollars"). The line-shape
 * regexes already keep the account and payee popovers out of prose; the
 * sigil and amount triggers need this context check instead.
 */
import type { App, Editor, EditorPosition, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';
import { COMMODITY_PREFIX_RE, LINK_PREFIX_RE, NARRATION_PREFIX_RE, TAG_PREFIX_RE } from './token-index';
import type { CompletionIndex } from './suggest';
import { IndexSuggest } from './suggest';

/**
 * Whether the cursor edits ledger text: a ledger file, or a line inside a
 * `beancount`/`bean` fence. An unclosed fence owns the rest of its file,
 * exactly as `extractBeancountFences` reads it.
 */
function inLedgerContext(editor: Editor, cursor: EditorPosition, file: TFile | null): boolean {
	if (file && isLedgerFile(file)) return true;
	const line = cursor.line;
	return extractBeancountFences(editor.getValue()).some(
		(fence) => fence.startLine <= line && line < fence.startLine + fence.lines.length
	);
}

/** Whether a token character follows the cursor: a pick would garble it. */
function tokenAfter(line: string, cursor: EditorPosition, tokenChars: RegExp): boolean {
	const after = line.charAt(cursor.ch);
	return after !== '' && tokenChars.test(after);
}

/**
 * Whether the cursor sits in free text a token popup must not interrupt: an
 * unclosed quoted string (a payee, a narration, a quoted metadata value) or
 * a `;` comment, which owns the rest of its line. Quotes outside strings
 * are field delimiters; escapes are respected inside.
 */
function inStringOrComment(prefix: string): boolean {
	let inString = false;
	for (let i = 0; i < prefix.length; i += 1) {
		const ch = prefix[i];
		if (inString && ch === '\\') {
			i += 1;
		} else if (ch === '"') {
			inString = !inString;
		} else if (ch === ';' && !inString) {
			return true;
		}
	}
	return inString;
}

/**
 * Tag completion: typing `#` (plus a partial name) inside ledger text
 * triggers a prefix-match popup over every tag cached from the vault;
 * picking one replaces the typed `#na` with `#name` — the sigil is part of
 * the cached strings.
 */
export class TagSuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		if (tokenAfter(line, cursor, /[A-Za-z0-9\-_/.]/)) return null;
		const prefix = line.slice(0, cursor.ch);
		const match = TAG_PREFIX_RE.exec(prefix);
		if (!match) return null;
		// The `#` transaction flag: `2026-09-30 #` is a date and flag, not a
		// tag with an empty name.
		if (match[1] === '' && new RegExp(`^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \\t]*#$`).test(prefix)) return null;
		// The context scan reads the whole buffer, so it runs only for a line
		// that has already matched its trigger shape.
		if (inStringOrComment(prefix) || !inLedgerContext(editor, cursor, file)) return null;
		return this.triggerInfo(cursor, `#${match[1]}`);
	}
}

/** Link completion: the same as tags, triggered by `^`. */
export class LinkSuggest extends IndexSuggest {
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		if (tokenAfter(line, cursor, /[A-Za-z0-9\-_/.]/)) return null;
		const prefix = line.slice(0, cursor.ch);
		const match = LINK_PREFIX_RE.exec(prefix);
		if (!match) return null;
		if (inStringOrComment(prefix) || !inLedgerContext(editor, cursor, file)) return null;
		return this.triggerInfo(cursor, `^${match[1]}`);
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
		const line = editor.getLine(cursor.line);
		if (tokenAfter(line, cursor, /[A-Za-z0-9._'-]/)) return null;
		const prefix = line.slice(0, cursor.ch);
		const match = COMMODITY_PREFIX_RE.exec(prefix);
		if (!match) return null;
		if (inStringOrComment(prefix) || !inLedgerContext(editor, cursor, file)) return null;
		return this.triggerInfo(cursor, match[1]);
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

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.enabled()) return null;
		const line = editor.getLine(cursor.line);
		// Mid-field edits (any character but the closing quote right after the
		// cursor) would make selection replace only the typed prefix and garble
		// the rest of the field.
		const after = line.charAt(cursor.ch);
		if (after !== '' && after !== '"') return null;
		const match = NARRATION_PREFIX_RE.exec(line.slice(0, cursor.ch));
		if (!match) return null;
		return this.triggerInfo(cursor, match[1]);
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
