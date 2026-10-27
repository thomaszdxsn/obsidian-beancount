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
 *
 * A run that cannot produce a report (missing binary, traceback, timeout,
 * oversized output, temp-ledger I/O) does not replace those rows. It records
 * a failure line for the target until a later run reports.
 */
import type { BeanCheckError } from './bean-check';

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


/** Header text for `count` bean-check rows. Zero is the empty-state sentence. */
export function problemCountLabel(count: number): string {
	if (count === 0) return 'No problems.';
	return count === 1 ? '1 problem' : `${count} problems`;
}

/** `file:line  message` — two spaces, 1-based line. Line 0 (`<load>`, run failures) omits `:0`. */
export function problemRowText(row: Pick<ProblemRow, 'file' | 'line' | 'message'>): string {
	return row.line === 0 ? `${row.file}  ${row.message}` : `${row.file}:${row.line}  ${row.message}`;
}

/** Prefix on a Problems row that is a run failure, not a bean-check error. */
export const VALIDATION_FAILURE_PREFIX = 'bean-check could not run: ';

/** Status row for a target whose last run produced no report. Not clickable. */
export function validationFailureRow(target: string, reason: string): ProblemRow {
	return { file: target, line: 0, message: `${VALIDATION_FAILURE_PREFIX}${reason}` };
}

/**
 * Per-target bean-check rows. A run that reports (including a clean report)
 * replaces that target's rows and leaves every other target alone. `clear`
 * drops every target — an entry-ledger change makes the old keys stale.
 */
export class ProblemStore {
	private readonly byTarget = new Map<string, ProblemRow[]>();
	/** Run-failure status per target; cleared when that target next reports. */
	private readonly failures = new Map<string, ProblemRow>();
	private readonly listeners = new Set<() => void>();

	/** Replace `target`'s rows. An empty list clears it. Other targets stay. */
	replace(target: string, rows: readonly ProblemRow[]): void {
		const hadFailure = this.failures.delete(target);
		if (rows.length === 0) {
			if (!this.byTarget.delete(target) && !hadFailure) return;
		} else {
			this.byTarget.set(
				target,
				rows.map((row) => ({ ...row })),
			);
		}
		this.emit();
	}

	/**
	 * Record that `target`'s last run could not produce a report. Existing
	 * error rows stay. A later `replace` for the same target clears this.
	 */
	fail(target: string, reason: string): void {
		const row = validationFailureRow(target, reason);
		const prev = this.failures.get(target);
		if (prev && prev.file === row.file && prev.message === row.message) return;
		this.failures.set(target, row);
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
		if (this.byTarget.size === 0 && this.failures.size === 0) return;
		this.byTarget.clear();
		this.failures.clear();
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
			this.collectGroupRows(rows, byFile, seen);
		}
		this.collectGroupRows(this.failures.values(), byFile, seen);
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

	private collectGroupRows(
		rows: Iterable<ProblemRow>,
		byFile: Map<string, ProblemRow[]>,
		seen: Set<string>,
	): void {
		for (const row of rows) {
			const key = `${row.file}\n${row.line}\n${row.message}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const list = byFile.get(row.file) ?? [];
			list.push(row);
			byFile.set(row.file, list);
		}
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
