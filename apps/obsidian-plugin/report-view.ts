/**
 * Sidebar table of per-account unit balances. The configured entry ledger
 * wins; otherwise the active `.bean` / `.beancount` file, or the active note's
 * beancount fences concatenated. Includes are followed from that text. A parse
 * or interpolation error replaces the numbers — the table is never a partial
 * sum. Refresh follows the active leaf immediately and debounces vault
 * modifies of the files the last report read.
 */
import { ItemView } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { loadAccountBalances } from './balances';
import type { BalanceIssue, BalanceReport, BalanceRow } from './balances';
import { buildFenceLedger, extractBeancountFences } from './fences';

export const VIEW_TYPE_BALANCES = 'beancount-balances';

/** Delay before a burst of edits to an included file rebuilds the table. */
export const BALANCE_REFRESH_MS = 300;

const EMPTY_LEDGER = 'Open a Beancount file to see account balances.';
const EMPTY_FENCES = 'This note has no Beancount fences.';
const EMPTY_ROWS = 'No balances.';

export interface BalanceReportHost {
	settings: { entryLedger: string };
}

/** The DOM surface `drawBalances` writes; real `HTMLElement` or a test double. */
export interface BalanceMount {
	empty(): void;
	createDiv(opts?: { cls?: string; text?: string }): BalanceEl;
}

export interface BalanceEl {
	createDiv(opts?: { cls?: string; text?: string }): BalanceEl;
}

export type BalanceDraw =
	| { kind: 'empty'; message: string }
	| { kind: 'errors'; errors: readonly BalanceIssue[] }
	| { kind: 'table'; rows: readonly BalanceRow[] };

/**
 * Replace `mount`'s children with the balance table, the error list, or one
 * placeholder. Amounts sit in `.beancount-balances-amount` so CSS can
 * right-align them; the account name is only on the first currency line.
 */
export function drawBalances(mount: BalanceMount, draw: BalanceDraw): void {
	mount.empty();
	if (draw.kind === 'empty') {
		mount.createDiv({ cls: 'beancount-balances-empty', text: draw.message });
		return;
	}
	if (draw.kind === 'errors') {
		for (const error of draw.errors) {
			mount.createDiv({ cls: 'beancount-balances-error', text: `${error.file}:${error.line}  ${error.message}` });
		}
		return;
	}
	const table = mount.createDiv({ cls: 'beancount-balances' });
	const head = table.createDiv({ cls: 'beancount-balances-row beancount-balances-head' });
	head.createDiv({ cls: 'beancount-balances-account', text: 'Account' });
	head.createDiv({ cls: 'beancount-balances-amount', text: 'Balance' });
	if (draw.rows.length === 0) {
		mount.createDiv({ cls: 'beancount-balances-empty', text: EMPTY_ROWS });
		return;
	}
	for (const row of draw.rows) {
		for (let i = 0; i < row.amounts.length; i += 1) {
			const amount = row.amounts[i];
			const line = table.createDiv({ cls: 'beancount-balances-row' });
			line.createDiv({ cls: 'beancount-balances-account', text: i === 0 ? row.account : '' });
			line.createDiv({ cls: 'beancount-balances-amount', text: `${amount.text} ${amount.currency}` });
		}
	}
}

/** Open the balance report in the right sidebar, or reveal it when it already exists. */
export async function revealBalancesView(app: App): Promise<void> {
	const { workspace } = app;
	const existing = workspace.getLeavesOfType(VIEW_TYPE_BALANCES)[0];
	if (existing) {
		await workspace.revealLeaf(existing);
		return;
	}
	const leaf = workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: VIEW_TYPE_BALANCES, active: true });
	await workspace.revealLeaf(leaf);
}

interface Source {
	path: string;
	/** Markdown notes contribute fence bodies, not the prose around them. */
	fences: boolean;
}

export class BeancountBalancesView extends ItemView {
	private source: Source | null = null;
	private involved = new Set<string>();
	private seq = 0;
	private timer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: BalanceReportHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_BALANCES;
	}

	getDisplayText(): string {
		return 'Account balances';
	}

	getIcon(): string {
		return 'table';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf.view === this) return;
				void this.sync();
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!this.involved.has(file.path)) return;
				this.schedule();
			}),
		);
		await this.sync();
	}

	async onClose(): Promise<void> {
		this.seq += 1;
		this.clearTimer();
	}

	/** Rebuild now. Cancels a pending debounced rebuild so it cannot overwrite this one. */
	async sync(): Promise<void> {
		this.clearTimer();
		const seq = ++this.seq;
		const draw = await this.gather();
		if (seq !== this.seq) return;
		drawBalances(this.contentEl, draw.draw);
		this.involved = new Set(draw.files);
	}

	private schedule(): void {
		this.clearTimer();
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.sync();
		}, BALANCE_REFRESH_MS);
	}

	private clearTimer(): void {
		if (this.timer === null) return;
		window.clearTimeout(this.timer);
		this.timer = null;
	}

	private async gather(): Promise<{ draw: BalanceDraw; files: readonly string[] }> {
		const source = this.pickSource();
		if (!source) return { draw: { kind: 'empty', message: EMPTY_LEDGER }, files: [] };
		this.source = source;
		const file = this.app.vault.getAbstractFileByPath(source.path);
		if (source.fences) {
			if (!isVaultFile(file)) return { draw: { kind: 'empty', message: EMPTY_FENCES }, files: [] };
			const text = await this.app.vault.read(file);
			const fences = extractBeancountFences(text);
			if (fences.length === 0) return { draw: { kind: 'empty', message: EMPTY_FENCES }, files: [source.path] };
			// A blank line between fences keeps one fence's entry from absorbing the
			// next fence's indented lines; errors report the note's own line.
			const ledger = buildFenceLedger(fences);
			const report = await this.report(source.path, ledger.text);
			const errors = report.errors.map((issue) =>
				issue.file === source.path ? { ...issue, line: ledger.hostLine(issue.line) ?? issue.line } : issue
			);
			return { draw: drawOf({ ...report, errors }), files: report.files };
		}
		if (!isVaultFile(file)) {
			return {
				draw: {
					kind: 'errors',
					errors: [{ file: source.path, line: 1, message: `Entry ledger not found: ${source.path}` }],
				},
				files: [],
			};
		}
		const report = await this.report(source.path, null);
		return { draw: drawOf(report), files: report.files };
	}

	private async report(entryPath: string, override: string | null): Promise<BalanceReport> {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		const vaultRoot = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
		const vaultFiles = this.app.vault.getFiles().map((entry) => entry.path);
		return loadAccountBalances(entryPath, {
			vaultRoot,
			vaultFiles,
			read: async (path) => {
				if (override !== null && path === entryPath) return override;
				const entry = this.app.vault.getAbstractFileByPath(path);
				if (!isVaultFile(entry)) return null;
				return this.app.vault.read(entry);
			},
		});
	}

	/**
	 * Entry ledger when configured. Otherwise the active ledger or note.
	 * A missing active file — the report pane itself took focus — keeps the
	 * last source. A non-ledger file clears it.
	 */
	private pickSource(): Source | null {
		const entry = this.host.settings.entryLedger.trim();
		if (entry) return { path: entry, fences: entry.endsWith('.md') };
		const file = this.app.workspace.getActiveFile();
		if (!file) return this.source;
		if (file.extension === 'bean' || file.extension === 'beancount') return { path: file.path, fences: false };
		if (file.extension === 'md') return { path: file.path, fences: true };
		this.source = null;
		return null;
	}
}

function drawOf(report: BalanceReport): BalanceDraw {
	if (report.errors.length > 0) return { kind: 'errors', errors: report.errors };
	return { kind: 'table', rows: report.rows };
}

function isVaultFile(file: unknown): file is TFile {
	return typeof file === 'object' && file !== null && 'extension' in file && typeof file.extension === 'string';
}
