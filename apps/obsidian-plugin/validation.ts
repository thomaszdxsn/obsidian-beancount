/**
 * Ledger validation: save/open/rename/delete/settings/unload in, Problems
 * rows and bean-check markers out. Callers report events; this module owns
 * run target, debounce, seq, temp ledger mapping, notices, and marker owners.
 */
import type { Clock } from './clock';
import type { BeanCheckError, BeanCheckRunner, LineDiagnostic } from './bean-check';
import {
	clipText,
	isBeanCheckBinary,
	matchesVaultFile,
	parseBeanCheckErrors,
	toLineDiagnostics,
} from './bean-check';
import { isLedgerFile, isSafeIncludePath, ledgerDoc } from './fences';
import { fileMtime, ProblemStore, toProblemRows } from './problems';

/** Delay before on-save validation, so a burst of saves checks once. */
export const VALIDATE_DEBOUNCE_MS = 500;

export const MISSING_BEAN_CHECK_REASON =
	'not found — install beancount (pip install beancount) or set the bean-check path in the plugin settings.';
export const MISSING_BEAN_CHECK_NOTICE = `bean-check ${MISSING_BEAN_CHECK_REASON}`;
export const TEMP_LEDGER_NOTICE = 'bean-check could not write the temporary ledger';
export const TEMP_LEDGER_REASON = 'could not write the temporary ledger';

export interface FileRef {
	path: string;
	extension: string;
	mtime?: number;
}

export type ValidationEvent =
	| { kind: 'saved'; file: FileRef }
	| { kind: 'opened'; file: FileRef; text: string }
	| { kind: 'renamed'; oldPath: string }
	| { kind: 'deleted'; path: string }
	| { kind: 'entryLedgerChanged'; entryLedger: string }
	| { kind: 'beanCheckPathChanged' }
	| { kind: 'unload' };

export interface VaultPort {
	read(path: string): Promise<string>;
	files(): Iterable<FileRef>;
	resolveInVault(vaultRel: string): { ok: true; absPath: string } | { ok: false; reason: 'escape' };
	vaultRoot(): string;
}

/** Disk only. Text and host mapping come from `ledgerDoc().tempLedger`. */
export interface TempFilePort {
	write(text: string): { checkPath: string; dispose(): void };
}

export interface MarkerSink {
	/** Empty array clears this module's bean-check marks on `path`. */
	setBean(path: string, diagnostics: readonly LineDiagnostic[]): void;
}

export interface Notifier {
	show(text: string): void;
}

export interface OpenValidationInput {
	path: string;
	extension: string;
	text: string;
	entryLedger: string;
	targetMtime: number | undefined;
	lastValidatedMtime: number | undefined;
}

/**
 * Run target for a ledger file or markdown note, or null when the open should
 * not start bean-check (prose, or a same-mtime tab switch).
 */
export function openValidationTarget(input: OpenValidationInput): string | null {
	const target = runTarget(input, input.entryLedger);
	if (target === null) return null;
	if (input.extension === 'md' && ledgerDoc('fenced', input.text).regions.length === 0) return null;
	if (
		input.targetMtime !== undefined &&
		input.lastValidatedMtime !== undefined &&
		input.targetMtime === input.lastValidatedMtime
	) {
		return null;
	}
	return target;
}

/** Markdown notes are their own target; ledger files share the entry ledger. */
function runTarget(file: { path: string; extension: string }, entryLedger: string): string | null {
	if (file.extension === 'md') return file.path;
	if (isLedgerFile(file)) return entryLedger.trim() || file.path;
	return null;
}

function matchesTempFile(reported: string, absPath: string): boolean {
	const normalized = reported.replace(/\\/g, '/');
	return normalized === absPath.replace(/\\/g, '/') || normalized === 'fences.bean';
}

function vaultPathForReported(
	reported: string,
	root: string,
	filesByPath: ReadonlyMap<string, FileRef>,
	order: readonly FileRef[],
): string | undefined {
	const normalized = reported.replace(/\\/g, '/');
	const rooted = normalized.startsWith(root) ? normalized.slice(root.length) : undefined;
	const rootedHit = rooted !== undefined && filesByPath.has(rooted) ? rooted : undefined;
	const bareHit = filesByPath.has(normalized) ? normalized : undefined;
	if (rootedHit !== undefined && bareHit !== undefined && rootedHit !== bareHit) {
		for (const entry of order) {
			if (matchesVaultFile(reported, entry.path, root)) return entry.path;
		}
	}
	return rootedHit ?? bareHit;
}

export class LedgerValidation {
	readonly problems = new ProblemStore();
	private readonly clock: Clock;
	private readonly runner: BeanCheckRunner;
	private readonly vault: VaultPort;
	private readonly tempFile: TempFilePort;
	private readonly markers: MarkerSink;
	private readonly notifier: Notifier;
	private readonly entryLedger: () => string;
	private readonly beanCheckPath: () => string;

	private readonly validateTimers = new Map<string, number>();
	private readonly validateInFlight = new Map<string, number>();
	private readonly validateSeq = new Map<string, number>();
	private readonly pendingFile = new Map<string, FileRef>();
	private validateLive = true;
	private readonly lastValidatedMtime = new Map<string, number>();
	private readonly markOwners = new Map<string, string>();
	private readonly noticesShown = new Map<string, Set<string>>();
	/** Host-mapped bean-check markers per target, keyed by vault path. */
	private readonly replayByTarget = new Map<string, Map<string, LineDiagnostic[]>>();

	constructor(
		ports: {
			clock: Clock;
			runner: BeanCheckRunner;
			vault: VaultPort;
			tempFile: TempFilePort;
			markers: MarkerSink;
			notifier: Notifier;
		},
		settings: { entryLedger(): string; beanCheckPath(): string },
	) {
		this.clock = ports.clock;
		this.runner = ports.runner;
		this.vault = ports.vault;
		this.tempFile = ports.tempFile;
		this.markers = ports.markers;
		this.notifier = ports.notifier;
		this.entryLedger = settings.entryLedger;
		this.beanCheckPath = settings.beanCheckPath;
	}

	handle(event: ValidationEvent): void {
		switch (event.kind) {
			case 'saved':
				this.scheduleValidate(event.file);
				return;
			case 'opened':
				this.onOpened(event.file, event.text);
				return;
			case 'renamed':
				this.dropValidation(event.oldPath);
				return;
			case 'deleted':
				this.dropValidation(event.path);
				return;
			case 'entryLedgerChanged':
				this.onEntryLedgerChanged();
				return;
			case 'beanCheckPathChanged':
				this.noticesShown.clear();
				return;
			case 'unload':
				this.onUnload();
		}
	}

	private onUnload(): void {
		this.validateLive = false;
		this.validateSeq.clear();
		for (const id of this.validateTimers.values()) this.clock.clearTimeout(id);
		this.validateTimers.clear();
		this.pendingFile.clear();
	}

	private onEntryLedgerChanged(): void {
		this.noticesShown.clear();
		this.problems.clear();
		this.lastValidatedMtime.clear();
		this.replayByTarget.clear();
		const owned = [...this.markOwners.keys()];
		this.markOwners.clear();
		for (const path of owned) this.markers.setBean(path, []);
		for (const [target, seq] of this.validateSeq) {
			if (target.endsWith('.md')) continue;
			this.validateSeq.set(target, seq + 1);
		}
	}

	private onOpened(file: FileRef, text: string): void {
		if (!this.validateLive) return;
		const entryLedger = this.entryLedger().trim();
		const target = runTarget(file, entryLedger);
		if (target === null) return;
		const targetFile = this.fileByPath(target);
		const input = {
			path: file.path,
			extension: file.extension,
			text,
			entryLedger,
			targetMtime: fileMtime(targetFile ? { stat: { mtime: targetFile.mtime } } : undefined),
			lastValidatedMtime: this.lastValidatedMtime.get(target),
		};
		const recheck = this.validateTimers.has(target) || this.validateInFlight.has(target);
		if (openValidationTarget({ ...input, lastValidatedMtime: undefined }) === null) return;
		if (!recheck && openValidationTarget(input) === null) {
			this.replayStoredMarkers(file, target);
			return;
		}
		this.scheduleValidate(file);
	}

	private replayStoredMarkers(file: FileRef, target: string): void {
		const bean = this.replayByTarget.get(target)?.get(file.path) ?? [];
		this.markers.setBean(file.path, bean);
	}

	private dropValidation(path: string): void {
		this.problems.replace(path, []);
		this.lastValidatedMtime.delete(path);
		this.replayByTarget.delete(path);
		const pending = this.validateTimers.get(path);
		if (pending !== undefined) {
			this.clock.clearTimeout(pending);
			this.validateTimers.delete(path);
		}
		this.pendingFile.delete(path);
		const seq = this.validateSeq.get(path);
		if (seq !== undefined) this.validateSeq.set(path, seq + 1);
	}

	private scheduleValidate(file: FileRef): void {
		const target = runTarget(file, this.entryLedger());
		if (target === null) return;
		this.pendingFile.set(target, file);
		const existing = this.validateTimers.get(target);
		if (existing !== undefined) this.clock.clearTimeout(existing);
		this.validateTimers.set(
			target,
			this.clock.setTimeout(() => {
				this.validateTimers.delete(target);
				const next = this.pendingFile.get(target) ?? file;
				this.pendingFile.delete(target);
				void this.validateFile(next).catch(() => undefined);
			}, VALIDATE_DEBOUNCE_MS),
		);
	}

	private async validateFile(file: FileRef): Promise<void> {
		if (!this.validateLive) return;
		const target = runTarget(file, this.entryLedger());
		if (target === null) return;
		const markdown = file.extension === 'md';
		this.validateInFlight.set(target, (this.validateInFlight.get(target) ?? 0) + 1);
		try {
			const root = this.vault.vaultRoot();
			const seq = (this.validateSeq.get(target) ?? 0) + 1;
			this.validateSeq.set(target, seq);

			let note = markdown ? ledgerDoc('fenced', await this.vault.read(file.path)) : undefined;
			if (!this.validateLive || this.validateSeq.get(target) !== seq) return;
			if (markdown && note && note.regions.length === 0) {
				if (!this.markErrors(target, [], root)) this.noticesShown.delete(target);
				return;
			}

			const command = this.beanCheckPath().trim() || 'bean-check';
			if (!isBeanCheckBinary(command)) {
				this.recordRunFailure(target, MISSING_BEAN_CHECK_NOTICE, MISSING_BEAN_CHECK_REASON);
				return;
			}
			const entry = this.entryLedger().trim();
			if (entry && !isSafeIncludePath(entry)) {
				this.recordRunFailure(
					target,
					`bean-check: entry ledger must be a vault file, not "${clipText(entry)}"`,
					`entry ledger must be a vault file, not "${clipText(entry)}"`,
				);
				return;
			}
			const resolved = this.vault.resolveInVault(entry || file.path);
			if (!resolved.ok) {
				this.recordRunFailure(
					target,
					`bean-check: entry ledger must be a vault file, not "${clipText(entry || file.path)}"`,
					`entry ledger must be a vault file, not "${clipText(entry || file.path)}"`,
				);
				return;
			}

			let includePath: string | undefined;
			if (markdown && entry) includePath = resolved.absPath;

			let checkPath = resolved.absPath;
			let cleanup: (() => void) | undefined;
			let hostLine: ((tempLine: number) => number | undefined) | undefined;
			try {
				if (markdown && note) {
					try {
						const ledger = note.tempLedger(includePath);
						const written = this.tempFile.write(ledger.text);
						cleanup = written.dispose;
						checkPath = written.checkPath;
						hostLine = (line) => ledger.hostLine(line);
					} catch {
						if (!this.validateLive || this.validateSeq.get(target) !== seq) return;
						this.recordRunFailure(target, TEMP_LEDGER_NOTICE, TEMP_LEDGER_REASON);
						return;
					}
				}

				const run = await this.runner(command, [checkPath]);
				if (!this.validateLive || this.validateSeq.get(target) !== seq) return;
				if (run.missing) {
					this.recordRunFailure(target, MISSING_BEAN_CHECK_NOTICE, MISSING_BEAN_CHECK_REASON);
					return;
				}
				let errors = parseBeanCheckErrors(run.stderr);
				if (errors.length === 0 && (run.stderr.trim() !== '' || run.failure)) {
					const reason = run.failure ?? `failed: ${clipText(run.stderr.trim().split('\n')[0])}`;
					this.recordRunFailure(target, `bean-check ${reason}`, reason);
					return;
				}
				if (hostLine) {
					const mapHost = hostLine;
					errors = errors.flatMap((error) => {
						if (error.file.startsWith('<')) return [error];
						if (!matchesTempFile(error.file, checkPath)) return [];
						const line = mapHost(error.line);
						if (line === undefined) return [];
						return [{ ...error, file: root + file.path, line }];
					});
				}
				if (!this.markErrors(target, errors, root)) this.noticesShown.delete(target);
			} finally {
				cleanup?.();
			}
		} finally {
			const left = (this.validateInFlight.get(target) ?? 1) - 1;
			if (left > 0) this.validateInFlight.set(target, left);
			else this.validateInFlight.delete(target);
		}
	}

	private markErrors(target: string, errors: readonly BeanCheckError[], root: string): boolean {
		if (!this.validateLive) return false;
		const vaultFiles = [...this.vault.files()];
		const filesByPath = new Map<string, FileRef>();
		for (const entry of vaultFiles) {
			if (!filesByPath.has(entry.path)) filesByPath.set(entry.path, entry);
		}
		const vaultPathByReported = new Map<string, string | undefined>();
		const vaultPathFor = (reported: string): string | undefined => {
			if (vaultPathByReported.has(reported)) return vaultPathByReported.get(reported);
			const vaultPath = vaultPathForReported(reported, root, filesByPath, vaultFiles);
			vaultPathByReported.set(reported, vaultPath);
			return vaultPath;
		};
		this.problems.replace(target, toProblemRows(errors, vaultPathFor));
		const targetFile = filesByPath.get(target);
		const mtime = fileMtime(targetFile ? { stat: { mtime: targetFile.mtime } } : undefined);
		if (mtime === undefined) this.lastValidatedMtime.delete(target);
		else this.lastValidatedMtime.set(target, mtime);

		const errorsByPath = new Map<string, BeanCheckError[]>();
		const unmapped: BeanCheckError[] = [];
		for (const error of errors) {
			const match = vaultPathFor(error.file);
			if (!match) {
				unmapped.push(error);
				continue;
			}
			const list = errorsByPath.get(match) ?? [];
			list.push(error);
			errorsByPath.set(match, list);
		}
		if (unmapped.length > 0) {
			this.notify(
				target,
				`bean-check: ${clipText(unmapped[0].file)}: ${clipText(unmapped[0].message)}`,
			);
		}

		const reported = new Set(errorsByPath.keys());
		const previouslyOwned = [...this.markOwners.entries()]
			.filter(([, owner]) => owner === target)
			.map(([path]) => path);
		const replay = new Map<string, LineDiagnostic[]>();
		for (const path of new Set([...reported, ...previouslyOwned, target])) {
			if (reported.has(path)) this.markOwners.set(path, target);
			else this.markOwners.delete(path);
			const bean = toLineDiagnostics(errorsByPath.get(path) ?? []);
			replay.set(path, bean);
			this.markers.setBean(path, bean);
		}
		this.replayByTarget.set(target, replay);
		return unmapped.length > 0;
	}

	private recordRunFailure(target: string, notice: string, reason: string): void {
		if (!this.validateLive) return;
		this.problems.fail(target, reason);
		this.notify(target, notice);
	}

	private notify(target: string, text: string): void {
		if (!this.validateLive) return;
		const shown = this.noticesShown.get(target) ?? new Set<string>();
		if (shown.has(text)) return;
		shown.add(text);
		this.noticesShown.set(target, shown);
		this.notifier.show(text);
	}

	private fileByPath(path: string): FileRef | undefined {
		for (const entry of this.vault.files()) {
			if (entry.path === path) return entry;
		}
		return undefined;
	}
}
