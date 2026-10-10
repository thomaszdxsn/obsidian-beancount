/**
 * Latest bean-check report, per validation target, for the Problems view.
 *
 * Editor markers only exist for files that are open. The include chain is
 * usually not: a child ledger's error has nowhere to land except a one-shot
 * notice. This store keeps every row the last run for a target reported,
 * including `<load>` and paths outside the vault, so the view can list them
 * after the editors have moved on.
 *
 * A new run for a target replaces that target's rows and leaves every other
 * target alone. Flag-warning markers are not rows — only bean-check errors.
 */
import type { BeanCheckError } from './bean-check';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';

/** One bean-check complaint, ready to render. `line` is 1-based, as printed. */
export interface ProblemRow {
	/** Vault path when the report maps into the vault; otherwise the path bean-check printed. */
	file: string;
	line: number;
	message: string;
	/** Set only when `file` is a vault file the click handler can open. */
	vaultPath?: string;
}

/** Rows sharing a display path, in line order. */
export interface ProblemGroup {
	file: string;
	/** Present when every clickable row in the group opens this vault file. */
	vaultPath?: string;
	rows: ProblemRow[];
}

/**
 * Map bean-check errors onto view rows. `vaultPathFor` returns the vault
 * path a reported file names, or undefined for `<load>` and outside files.
 * Those stay in the list — they are the errors no editor can mark — but
 * without `vaultPath`, so the view cannot pretend they are openable.
 */
export function toProblemRows(
	errors: readonly BeanCheckError[],
	vaultPathFor: (reportedFile: string) => string | undefined,
): ProblemRow[] {
	const rows: ProblemRow[] = [];
	for (const error of errors) {
		const vaultPath = vaultPathFor(error.file);
		const row: ProblemRow = {
			file: vaultPath ?? error.file,
			line: error.line,
			message: error.message,
		};
		if (vaultPath) row.vaultPath = vaultPath;
		rows.push(row);
	}
	return rows;
}

/** `TFile.stat.mtime` when the host stamped it; missing means "not proven unchanged". */
export function fileMtime(file: { stat?: { mtime?: number } } | null | undefined): number | undefined {
	const mtime = file?.stat?.mtime;
	return typeof mtime === 'number' && Number.isFinite(mtime) ? mtime : undefined;
}

/** What an open needs in order to decide whether bean-check should run. */
export interface OpenValidationInput {
	path: string;
	extension: string;
	/** Markdown body, read only to detect beancount fences. Ignored for ledgers. */
	text: string;
	/** Configured entry ledger; blank means a ledger file is its own target. */
	entryLedger: string;
	/** mtime of the run target. Undefined when that file has no stat. */
	targetMtime: number | undefined;
	/** mtime recorded when that target last reported. Undefined if it never has. */
	lastValidatedMtime: number | undefined;
}

/**
 * The bean-check target an open should schedule, or null when it should not.
 *
 * Ledger files always qualify. A markdown note qualifies only when it holds
 * a beancount fence — prose must not start a run. The target is the entry
 * ledger for a ledger file (same as a save) and the note itself for fences.
 * A target already validated at this mtime is a tab switch, not a change:
 * scheduling it would re-run bean-check for nothing. A missing mtime cannot
 * prove that, so it still schedules.
 */
export function openValidationTarget(input: OpenValidationInput): string | null {
	const file = { path: input.path, extension: input.extension };
	const ledger = isLedgerFile(file);
	if (!ledger && input.extension !== 'md') return null;
	if (!ledger && extractBeancountFences(input.text).length === 0) return null;
	const entry = input.entryLedger.trim();
	const target = ledger ? entry || input.path : input.path;
	if (
		input.targetMtime !== undefined &&
		input.lastValidatedMtime !== undefined &&
		input.targetMtime === input.lastValidatedMtime
	) {
		return null;
	}
	return target;
}

/** Header text for `count` bean-check rows. Zero is the empty-state sentence. */
export function problemCountLabel(count: number): string {
	if (count === 0) return 'No problems.';
	return count === 1 ? '1 problem' : `${count} problems`;
}

/** `file:line  message` — two spaces, 1-based line, as the Problems view prints a row. */
export function problemRowText(row: Pick<ProblemRow, 'file' | 'line' | 'message'>): string {
	return `${row.file}:${row.line}  ${row.message}`;
}

/**
 * Per-target bean-check rows. A run that reports (including a clean report)
 * replaces that target's rows and leaves every other target alone. `clear`
 * drops every target — an entry-ledger change makes the old keys stale.
 */
export class ProblemStore {
	private readonly byTarget = new Map<string, ProblemRow[]>();
	private readonly listeners = new Set<() => void>();

	/** Replace `target`'s rows. An empty list clears it. Other targets stay. */
	replace(target: string, rows: readonly ProblemRow[]): void {
		if (rows.length === 0) {
			if (!this.byTarget.delete(target)) return;
		} else {
			this.byTarget.set(
				target,
				rows.map((row) => ({ ...row })),
			);
		}
		this.emit();
	}

	/** Rows from the last report for `target`. Empty when it has not reported. */
	rowsFor(target: string): readonly ProblemRow[] {
		return this.byTarget.get(target) ?? [];
	}

	/**
	 * Drop every target. No-op, and no notify, when the store is already empty
	 * — a settings save that did not change the entry ledger must not redraw.
	 */
	clear(): void {
		if (this.byTarget.size === 0) return;
		this.byTarget.clear();
		this.emit();
	}

	/**
	 * Every current row, grouped by display path. Groups and rows are sorted.
	 * Targets overlap (a child file checked alone and through the entry
	 * ledger's include chain report the same error), so a row with the same
	 * file, line and message appears once.
	 */
	groups(): ProblemGroup[] {
		const byFile = new Map<string, ProblemRow[]>();
		const seen = new Set<string>();
		for (const rows of this.byTarget.values()) {
			for (const row of rows) {
				const key = `${row.file}\n${row.line}\n${row.message}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const list = byFile.get(row.file) ?? [];
				list.push(row);
				byFile.set(row.file, list);
			}
		}
		return [...byFile.entries()]
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
			.map(([file, rows]) => {
				const sorted = [...rows].sort(
					(a, b) => a.line - b.line || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
				);
				const vaultPath = sorted.find((row) => row.vaultPath)?.vaultPath;
				return vaultPath ? { file, vaultPath, rows: sorted } : { file, rows: sorted };
			});
	}

	/** Distinct row count across every target, including unmapped rows. */
	count(): number {
		return this.groups().reduce((sum, group) => sum + group.rows.length, 0);
	}

	/** Notify `listener` after each reporting replace. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
