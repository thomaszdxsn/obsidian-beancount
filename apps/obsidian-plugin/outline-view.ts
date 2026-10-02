/**
 * Sidebar outline for the active beancount ledger. Obsidian's built-in
 * Outline pane only reads markdown headings, so `.bean` files need their
 * own view: a tree of `parseBeancountOutline` rows that jump via
 * `jumpToOutlineLine`. This is not an `EditorSuggest` — that channel is
 * completion; this is an `ItemView` plus a command that reveals it.
 */
import { ItemView } from 'obsidian';
import type { App, Editor } from 'obsidian';
import { flattenOutline, jumpToOutlineLine, parseBeancountOutline } from './outline';
import { isLedgerFile } from './vault-index';

export const VIEW_TYPE_OUTLINE = 'beancount-outline';

/** The DOM surface `drawOutline` writes; real `HTMLElement` or a test double. */
export interface OutlineMount {
	empty(): void;
	createDiv(opts?: { cls?: string; text?: string }): OutlineItemEl;
}

export interface OutlineItemEl {
	addEventListener(type: 'click', listener: () => void): void;
	style: { paddingLeft: string };
}

const EMPTY_LEDGER = 'Open a Beancount file to see its outline.';
const EMPTY_ITEMS = 'No outline items.';

/**
 * Replace `mount`'s children with one clickable row per flattened outline
 * node. Empty buffers get a single muted placeholder.
 */
export function drawOutline(mount: OutlineMount, text: string, onJump: (line: number) => void): void {
	mount.empty();
	const rows = flattenOutline(parseBeancountOutline(text));
	if (rows.length === 0) {
		mount.createDiv({ cls: 'beancount-outline-empty', text: EMPTY_ITEMS });
		return;
	}
	for (const row of rows) {
		const el = mount.createDiv({
			cls: `beancount-outline-item beancount-outline-${row.kind} beancount-outline-depth-${row.depth}`,
			text: row.title,
		});
		el.style.paddingLeft = `${8 + row.depth * 12}px`;
		el.addEventListener('click', () => onJump(row.line));
	}
}

/** Open the outline in the right sidebar, or reveal it when it already exists. */
export async function revealOutlineView(app: App): Promise<void> {
	const { workspace } = app;
	const existing = workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)[0];
	if (existing) {
		workspace.revealLeaf(existing);
		return;
	}
	const leaf = workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: VIEW_TYPE_OUTLINE, active: true });
	workspace.revealLeaf(leaf);
}

export class BeancountOutlineView extends ItemView {
	/** Last ledger editor: kept when the outline leaf itself is focused. */
	private ledger: Editor | null = null;

	getViewType(): string {
		return VIEW_TYPE_OUTLINE;
	}

	getDisplayText(): string {
		return 'Beancount Outline';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf.view === this) return;
				this.sync();
			})
		);
		this.registerEvent(this.app.workspace.on('editor-change', () => this.sync()));
		this.sync();
	}

	/** Rebuild the tree from the active ledger, or the last one if the outline has focus. */
	sync(): void {
		const editor = this.ledgerEditor();
		if (!editor) {
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: 'beancount-outline-empty', text: EMPTY_LEDGER });
			return;
		}
		drawOutline(this.contentEl, editor.getValue(), (line) => jumpToOutlineLine(editor, line));
	}

	private ledgerEditor(): Editor | null {
		const file = this.app.workspace.getActiveFile();
		const editor = this.app.workspace.activeEditor?.editor;
		if (file && isLedgerFile(file) && editor) {
			this.ledger = editor;
			return editor;
		}
		if (file && !isLedgerFile(file)) {
			this.ledger = null;
			return null;
		}
		return this.ledger;
	}
}


