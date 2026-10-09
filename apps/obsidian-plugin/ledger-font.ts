/**
 * Ledger files render in the monospace font.
 *
 * Alignment pads with spaces to a character column (`align.ts`), which only
 * lines up on screen when every character has the same advance width.
 * Obsidian opens `.bean` / `.beancount` files as notes in the text font —
 * often proportional — so the editor of a ledger file gets a class that
 * `styles.css` switches to `--font-monospace`. Beancount fences in notes are
 * already code blocks, set in the monospace font by Obsidian itself.
 */
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { isLedgerFile } from './vault-index';

/** The CSS contract between this extension and `styles.css`. */
export const LEDGER_EDITOR_CLASS = 'beancount-ledger-editor';

/**
 * Re-read on every view update: Obsidian reuses one editor across files, and
 * loading a file is itself an update, so the class follows the open file.
 */
export function ledgerFontExtension(): Extension {
	return EditorView.editorAttributes.of((view: EditorView) => {
		const file = view.state.field(editorInfoField, false)?.file;
		return file && isLedgerFile(file) ? { class: LEDGER_EDITOR_CLASS } : null;
	});
}
