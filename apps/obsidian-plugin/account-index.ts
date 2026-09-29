/**
 * Account extraction and cache for the vault.
 *
 * The index is a per-file map of extracted account names plus a cached,
 * sorted union so that suggestion queries never re-scan file contents.
 * File events (create/modify/delete/rename) invalidate exactly the entries
 * they touch; nothing else is re-read.
 */

/**
 * A complete account name: a capitalized root segment plus one or more
 * `:segment` parts, e.g. `Assets:Cash:Wallet`. The shape matches the one the
 * syntax mode highlights (`A-Z` first character, segments of letters,
 * digits, `-` and `_`), so anything the editor treats as an account is also
 * completable — and prose words, dates (`2026-09-30`), times (`12:30`) and
 * URLs never leak in because they lack the capitalized-root-plus-colon
 * shape. A trailing empty segment (`Meeting:`) is not a name. The lookbehind
 * keeps a name from leaking out of a longer token or URL path
 * (`pre-Assets:Cash`, `github.com/User:Repo`), mirroring the prefix regex.
 */
const ACCOUNT_RE = /(?<![A-Za-z0-9\-_:/])[A-Z][A-Za-z0-9\-_]*(?::[A-Za-z0-9\-_]+)+\b/g;

/** The same shape while typing, where the last segment may be partial. */
export const ACCOUNT_PREFIX_RE = /(?:^|[^A-Za-z0-9\-_:/])([A-Z][A-Za-z0-9\-_]*(?::[A-Za-z0-9\-_]*)*)$/;

export function extractAccounts(content: string): ReadonlySet<string> {
	const accounts = new Set<string>();
	for (const match of content.matchAll(ACCOUNT_RE)) accounts.add(match[0]);
	return accounts;
}

export class AccountIndex {
	/** Account names by vault path; folders may hold re-keyed children on rename. */
	private readonly accountsByPath = new Map<string, ReadonlySet<string>>();
	/** Cached sorted union of `accountsByPath`, recomputed after each change. */
	private sorted: readonly string[] | null = null;

	setFileContent(path: string, content: string): void {
		const accounts = extractAccounts(content);
		// Only account-carrying files are tracked: `renameFile`'s "tracked"
		// answer then means "re-keyed cached names", which is exactly when a
		// rename can skip its re-read. An account-less file stays untracked.
		if (accounts.size === 0) this.accountsByPath.delete(path);
		else this.accountsByPath.set(path, accounts);
		this.sorted = null;
	}

	removeFile(path: string): void {
		if (this.accountsByPath.delete(path)) this.sorted = null;
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
		for (const [path, accounts] of [...this.accountsByPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			this.accountsByPath.delete(path);
			this.accountsByPath.set(newPath + path.slice(oldPath.length), accounts);
			moved = true;
			this.sorted = null;
		}
		return moved;
	}

	accounts(): readonly string[] {
		if (!this.sorted) {
			const union = new Set<string>();
			for (const fileAccounts of this.accountsByPath.values()) {
				for (const account of fileAccounts) union.add(account);
			}
			this.sorted = [...union].sort();
		}
		return this.sorted;
	}

	/** Case-insensitive prefix match over every cached account. */
	match(query: string): string[] {
		const needle = query.toLowerCase();
		return this.accounts().filter((account) => account.toLowerCase().startsWith(needle));
	}
}
