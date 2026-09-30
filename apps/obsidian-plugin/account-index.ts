/**
 * Account names: what counts as one (`extractAccounts`) and how to recognize
 * one while typing (`ACCOUNT_PREFIX_RE`). The vault-wide cache lives in
 * `VaultIndex`, fed by the extractor.
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
