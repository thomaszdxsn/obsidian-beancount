/**
 * Sidebar list of the latest bean-check report. Obsidian's editor markers
 * cannot show an error in a file that is not open; this view can. Rows are
 * `file:line  message`, grouped by file, with the count in the header.
 * Clicking a vault row opens that file and puts the cursor on the line.
 * `<load>` and outside-vault paths stay visible and do not click.
 */
import { ItemView } from 'obsidian';
import type { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { problemCountLabel, problemRowText } from './problems';
import type { ProblemGroup, ProblemRow, ProblemStore } from './problems';

export const VIEW_TYPE_PROBLEMS = 'beancount-problems';

/** The DOM surface `drawProblems` writes; real `HTMLElement` or a test double. */
export interface ProblemsMount {
	empty(): void;
	createDiv(opts?: { cls?: string; text?: string }): ProblemsItemEl;
}

export interface ProblemsItemEl {
	addEventListener(type: 'click', listener: () => void): void;
}

/**
 * Replace `mount`'s children with the header and one row per problem.
 * A row with no vault path — missing or `''` — is drawn but not clickable.
 */
export function drawProblems(
	mount: ProblemsMount,
	groups: readonly ProblemGroup[],
	onOpen: (row: ProblemRow) => void,
): void {
	mount.empty();
	const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
	mount.createDiv({ cls: 'beancount-problems-header', text: problemCountLabel(count) });
	for (const group of groups) {
		mount.createDiv({ cls: 'beancount-problems-file', text: group.file });
		for (const row of group.rows) {
			const clickable = Boolean(row.vaultPath);
			const el = mount.createDiv({
				cls: clickable
					? 'beancount-problems-row'
					: 'beancount-problems-row beancount-problems-unmapped',
				text: problemRowText(row),
			});
			if (clickable) el.addEventListener('click', () => onOpen(row));
		}
	}
}

/** Open the Problems view in the right sidebar, or reveal it when it already exists. */
export async function revealProblemsView(app: App): Promise<void> {
	const { workspace } = app;
	const existing = workspace.getLeavesOfType(VIEW_TYPE_PROBLEMS)[0];
	if (existing) {
		workspace.revealLeaf(existing);
		return;
	}
	const leaf = workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: VIEW_TYPE_PROBLEMS, active: true });
	workspace.revealLeaf(leaf);
}

/**
 * Open the vault file a problem names and put the caret on its line.
 * `row.line` is 1-based, as bean-check prints it; the editor is 0-based.
 * A missing file does nothing — the row should not have been clickable.
 */
export async function revealProblem(app: App, row: { vaultPath: string; line: number }): Promise<void> {
	const file = app.vault.getAbstractFileByPath(row.vaultPath);
	if (!isVaultFile(file)) return;
	const leaves = app.workspace.getLeavesOfType('markdown');
	const existing = leaves.find((leaf) => {
		const view = leaf.view as MarkdownView | null;
		return view?.file?.path === row.vaultPath;
	});
	const leaf = existing ?? app.workspace.getLeaf(false);
	if (!leaf) return;
	if (!existing) await leaf.openFile(file);
	app.workspace.setActiveLeaf(leaf, { focus: true });
	const view = leaf.view as MarkdownView | null;
	const editor = view?.editor ?? app.workspace.activeEditor?.editor ?? null;
	if (!editor) return;
	const line = Math.max(0, row.line - 1);
	const pos = { line, ch: 0 };
	editor.setCursor(pos);
	editor.scrollIntoView({ from: pos, to: pos }, true);
}

/** A vault file, not a folder: folders have no extension to open in an editor. */
function isVaultFile(file: unknown): file is TFile {
	return typeof file === 'object' && file !== null && 'extension' in file && typeof file.extension === 'string';
}

export class BeancountProblemsView extends ItemView {
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly store: ProblemStore,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PROBLEMS;
	}

	getDisplayText(): string {
		return 'Beancount Problems';
	}

	getIcon(): string {
		return 'alert-triangle';
	}

	async onOpen(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = this.store.subscribe(() => this.sync());
		this.sync();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/** Rebuild the list from the store. A store replace while the view is open calls this. */
	sync(): void {
		drawProblems(this.contentEl, this.store.groups(), (row) => {
			if (!row.vaultPath) return;
			void revealProblem(this.app, { vaultPath: row.vaultPath, line: row.line });
		});
	}
}
