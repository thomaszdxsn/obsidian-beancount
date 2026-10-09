/**
 * A per-file index of the strings an extractor finds in the vault, plus the
 * event wiring that keeps every index in sync.
 *
 * Each index is a per-file map of extracted strings plus a cached, sorted
 * union so that suggestion queries never re-scan file contents. File events
 * (create/modify/delete/rename) invalidate exactly the entries they touch;
 * nothing else is re-read. One wiring pass feeds all registered indexes from
 * a single read per event, so adding an extractor never doubles vault I/O.
 *
 * Two bounds keep a pathological file from costing keystrokes: a value
 * longer than `MAX_VALUE_LENGTH` is junk (a whole line captured as a "name",
 * not a real one) and is not cached, and `match` returns at most
 * `MAX_SUGGESTIONS` — the popup window Obsidian renders (its `limit` is 50).
 * Matches are prefix-first, then subsequence, then frecency.
 * Per-file count and read-size budgets are deliberately not imposed: the
 * union is bounded by the user's own vault, which the host already read.
 */
import type { Plugin, TAbstractFile, TFile } from 'obsidian';
import { rankCompletions } from './completion-rank';
import type { CompletionUsage } from './completion-rank';

export { MAX_SUGGESTIONS } from './completion-rank';

/** Longest cached string; longer ones are noise, not names. */
const MAX_VALUE_LENGTH = 256;
/** File extensions whose text is read: scanned for names, rewritten on align. */
export const TEXT_EXTENSIONS: Record<string, true> = { md: true, beancount: true, bean: true };

/** File extensions bean-check parses: the ledger files validation checks. */
export const LEDGER_EXTENSIONS: Record<string, true> = { beancount: true, bean: true };

/** The shape `isTextFile` needs: a folder has no `extension`. */
interface VaultEntry {
	path: string;
	extension?: string;
}

/**
 * Whether a vault entry is one of the text files the plugin works in:
 * completion scans them for names, alignment rewrites their postings.
 */
export function isTextFile(file: VaultEntry): file is TFile {
	// Own-property check: `in` would treat `constructor`/`toString` file
	// extensions as text via the prototype chain.
	return (
		typeof file.extension === 'string' &&
		Object.prototype.hasOwnProperty.call(TEXT_EXTENSIONS, file.extension)
	);
}

/**
 * Whether a vault entry is one of the ledger files `bean-check` parses — the
 * only files whose saves are worth validating.
 */
export function isLedgerFile(file: VaultEntry): file is TFile {
	return (
		typeof file.extension === 'string' &&
		Object.prototype.hasOwnProperty.call(LEDGER_EXTENSIONS, file.extension)
	);
}

/** Per-file cache `registerVaultIndex` keeps in sync with vault events. */
export interface VaultCache {
	setFileContent(path: string, content: string): void;
	removeFile(path: string): void;
	renameFile(oldPath: string, newPath: string): boolean;
}

export class VaultIndex implements VaultCache {
	/** Extracted strings by vault path; folders may hold re-keyed children on rename. */
	private readonly stringsByPath = new Map<string, ReadonlySet<string>>();
	/** Cached sorted union of `stringsByPath`, recomputed after each change. */
	private sorted: readonly string[] | null = null;

	/**
	 * The extractor takes the file's path too: token shapes that also occur
	 * in markdown prose (tags, links, commodities) are extracted from
	 * beancount fence bodies only, which the caller decides by extension.
	 */
	constructor(
		private readonly extract: (content: string, path: string) => ReadonlySet<string>,
		private readonly usage?: CompletionUsage
	) {}

	setFileContent(path: string, content: string): void {
		const extracted = this.extract(content, path);
		const strings = new Set<string>();
		for (const value of extracted) {
			if (value.length <= MAX_VALUE_LENGTH) strings.add(value);
		}
		// Only string-carrying files are tracked: `renameFile`'s "tracked"
		// answer then means "re-keyed cached strings", which is exactly when a
		// rename can skip its re-read. A file without such strings stays untracked.
		if (strings.size === 0) this.stringsByPath.delete(path);
		else this.stringsByPath.set(path, strings);
		this.sorted = null;
	}

	removeFile(path: string): void {
		if (this.stringsByPath.delete(path)) this.sorted = null;
	}

	/**
	 * Re-key entries on rename. A folder rename moves every tracked path
	 * under `oldPath`, so children are re-keyed by prefix instead of being
	 * lost — their contents did not change, so no re-read is needed.
	 * Returns whether anything was tracked, so callers can tell a moved
	 * entry apart from a rename that needs a fresh read (e.g. `.txt` → `.md`).
	 */
	renameFile(oldPath: string, newPath: string): boolean {
		const oldPrefix = oldPath + '/';
		let moved = false;
		for (const [path, strings] of [...this.stringsByPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			this.stringsByPath.delete(path);
			this.stringsByPath.set(newPath + path.slice(oldPath.length), strings);
			moved = true;
			this.sorted = null;
		}
		return moved;
	}

	values(): readonly string[] {
		if (!this.sorted) {
			const union = new Set<string>();
			for (const fileStrings of this.stringsByPath.values()) {
				for (const value of fileStrings) union.add(value);
			}
			this.sorted = [...union].sort();
		}
		return this.sorted;
	}

	/** Prefix, then subsequence; frecency-ranked; bounded to the popup window. */
	match(query: string): string[] {
		return rankCompletions(this.values(), query, this.usage);
	}

	remember(value: string): void {
		this.usage?.remember(value);
	}
}

/**
 * Keep `indexes` in sync with the vault and return nothing: callers own the
 * indexes and hand them to their suggest popovers.
 *
 * The initial scan walks every indexed file once; afterwards only the file
 * named by a vault event is re-read. Out-of-order reads on rapid edits are
 * dropped by a per-path revision counter, and a read that fails (the file
 * vanished mid-scan) leaves the caches untouched.
 */
export function registerVaultIndex(plugin: Plugin, ...indexes: readonly VaultCache[]): void {
	const { vault } = plugin.app;

	const revisions = new Map<string, number>();
	let revision = 0;
	const refresh = (file: TAbstractFile): void => {
		if (!isTextFile(file)) return;
		const path = file.path;
		// Monotonic token: invalidation deletes the entry, so a read from a
		// previous life of the path can never match again — a per-path counter
		// would restart at 1 and let a stale read overwrite a recreated file.
		// The entry also marks the path as read-in-flight, so it is removed
		// once the read lands.
		const current = ++revision;
		revisions.set(path, current);
		vault
			.cachedRead(file)
			.then((content) => {
				if (revisions.get(path) !== current) return;
				for (const index of indexes) index.setFileContent(path, content);
				revisions.delete(path);
			})
			.catch(() => undefined);
	};

	for (const file of vault.getFiles()) refresh(file);

	plugin.registerEvent(vault.on('create', refresh));
	plugin.registerEvent(vault.on('modify', refresh));
	plugin.registerEvent(vault.on('delete', (file) => {
		revisions.delete(file.path);
		for (const index of indexes) index.removeFile(file.path);
	}));
	plugin.registerEvent(vault.on('rename', (file, oldPath) => {
		const oldPrefix = oldPath + '/';
		// Reads in flight for the old path or its children are stale once the
		// rename lands; drop their tokens so they cannot write back under old
		// paths, and remember where they were headed so they can be replaced.
		const dropped: string[] = [];
		if (revisions.delete(oldPath)) dropped.push(file.path);
		for (const path of [...revisions.keys()]) {
			if (!path.startsWith(oldPrefix)) continue;
			revisions.delete(path);
			dropped.push(file.path + path.slice(oldPath.length));
		}
		// A rename can skip its re-read when at least one index re-keyed the
		// path: the path was read before, so the other indexes already know it
		// holds none of their strings.
		let moved = false;
		for (const index of indexes) moved = index.renameFile(oldPath, file.path) || moved;
		if (isTextFile(file)) {
			// A dropped in-flight read must be replaced; an untracked
			// destination (`.txt` → `.md`, or a file edited to string-less
			// prose) needs a first read; and a note ↔ ledger rename
			// (`x.md` → `x.bean`) changes what is ledger text (`ledgerSource`).
			const kindChanged = oldPath.endsWith('.md') !== file.path.endsWith('.md');
			if (dropped.length > 0 || !moved || kindChanged) refresh(file);
		} else {
			for (const index of indexes) index.removeFile(file.path);
			// Folder rename: the re-keyed children keep their cached content,
			// so re-read only the ones whose in-flight reads were dropped.
			if (dropped.length > 0) {
				const filesByPath = new Map(vault.getFiles().map((entry) => [entry.path, entry]));
				for (const path of dropped) {
					const child = filesByPath.get(path);
					if (child) refresh(child);
				}
			}
		}
	}));
}
