/**
 * Account names: what counts as one (`extractAccounts`), how to recognize
 * one while typing (`ACCOUNT_PREFIX_RE`), the token under a hover
 * (`accountTokenAt`), and the open/close lifecycle
 * (`extractAccountDirectives`) used to hide closed accounts from
 * completion and to fill the hover card. The vault-wide cache is `AccountIndex`.
 */
import { MAX_SUGGESTIONS, VaultIndex } from './vault-index';
import type { VaultCache } from './vault-index';

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

/** The complete account token covering `offset`, if any. */
export function accountTokenAt(
	text: string,
	offset: number
): { name: string; from: number; to: number } | null {
	for (const match of text.matchAll(ACCOUNT_RE)) {
		const from = match.index!;
		const to = from + match[0].length;
		if (offset >= from && offset <= to) return { name: match[0], from, to };
	}
	return null;
}

/**
 * Column-0 `open` / `close` directives. The account shape matches
 * `ACCOUNT_RE`; currencies (if any) sit in the remainder of the line.
 */
const DIRECTIVE_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]+(open|close)(?![A-Za-z0-9])[ \t]+([A-Z][A-Za-z0-9\-_]*(?::[A-Za-z0-9\-_]+)+)\b(.*)$/gm;

/** Beancount commodity tokens on an `open` line, after comments and `"booking"`. */
const COMMODITY_RE = /^[A-Z][A-Z0-9._'-]*$/;

export interface AccountRecord {
	open?: string;
	close?: string;
	currencies: readonly string[];
}

export function extractAccounts(content: string): ReadonlySet<string> {
	const accounts = new Set<string>();
	for (const match of content.matchAll(ACCOUNT_RE)) accounts.add(match[0]);
	return accounts;
}

/**
 * Latest `open` and `close` per account in `content`. Dates are normalized
 * to `YYYY-MM-DD`. Currencies come from the latest `open`.
 */
export function extractAccountDirectives(content: string): ReadonlyMap<string, AccountRecord> {
	const byName = new Map<string, AccountRecord>();
	for (const match of content.matchAll(DIRECTIVE_RE)) {
		const date = match[1].replace(/\//g, '-');
		const kind = match[2];
		const name = match[3];
		const current = byName.get(name) ?? { currencies: [] };
		if (kind === 'open') {
			if (current.open === undefined || date >= current.open) {
				byName.set(name, {
					...current,
					open: date,
					currencies: parseCurrencies(match[4]),
				});
			}
		} else if (current.close === undefined || date >= current.close) {
			byName.set(name, { ...current, close: date });
		}
	}
	return byName;
}

/** Closed when a `close` exists and no later `open` reopens the account. */
export function isAccountClosed(record: AccountRecord | undefined): boolean {
	if (record?.close === undefined) return false;
	return record.open === undefined || record.close >= record.open;
}

/** Popup subtitle: open date and constrained currencies, when known. */
export function describeAccount(record: AccountRecord | undefined): string {
	if (!record) return '';
	const lines: string[] = [];
	if (record.open !== undefined) lines.push(`opened on ${record.open}`);
	if (record.currencies.length > 0) lines.push(`currencies: ${record.currencies.join(', ')}`);
	return lines.join('\n');
}

/**
 * Hover card: the name, then open/close dates and constrained currencies.
 * A close is listed only while it still closes the account — a later open
 * hides the stale date. A posting-only name yields just the title.
 */
export function accountHoverCard(
	name: string,
	record: AccountRecord | undefined
): { name: string; lines: string[] } {
	const lines: string[] = [];
	if (record?.open !== undefined) lines.push(`opened on ${record.open}`);
	if (record?.close !== undefined && isAccountClosed(record)) lines.push(`closed on ${record.close}`);
	if (record !== undefined && record.currencies.length > 0) {
		lines.push(`currencies: ${record.currencies.join(', ')}`);
	}
	return { name, lines };
}

/**
 * Vault-wide account names plus their open/close lifecycle. `match` hides
 * closed accounts and caps the popup window after that filter, so a vault
 * of closed names cannot crowd out still-open ones.
 */
export class AccountIndex implements VaultCache {
	private readonly names = new VaultIndex(extractAccounts);
	private readonly directivesByPath = new Map<string, ReadonlyMap<string, AccountRecord>>();
	private merged: ReadonlyMap<string, AccountRecord> | null = null;

	setFileContent(path: string, content: string): void {
		this.names.setFileContent(path, content);
		const directives = extractAccountDirectives(content);
		if (directives.size === 0) this.directivesByPath.delete(path);
		else this.directivesByPath.set(path, directives);
		this.merged = null;
	}

	removeFile(path: string): void {
		this.names.removeFile(path);
		if (this.directivesByPath.delete(path)) this.merged = null;
	}

	renameFile(oldPath: string, newPath: string): boolean {
		const namesMoved = this.names.renameFile(oldPath, newPath);
		const oldPrefix = oldPath + '/';
		let moved = false;
		for (const [path, records] of [...this.directivesByPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			this.directivesByPath.delete(path);
			this.directivesByPath.set(newPath + path.slice(oldPath.length), records);
			moved = true;
		}
		if (moved) this.merged = null;
		return namesMoved || moved;
	}

	record(name: string): AccountRecord | undefined {
		return this.lifecycle().get(name);
	}

	/** Whether `name` has been seen in the vault, open or closed. */
	has(name: string): boolean {
		return this.names.values().includes(name);
	}

	/** Case-insensitive prefix match of still-open accounts. */
	match(query: string): string[] {
		const needle = query.toLowerCase();
		const matches: string[] = [];
		const lifecycle = this.lifecycle();
		for (const value of this.names.values()) {
			if (!value.toLowerCase().startsWith(needle)) continue;
			if (isAccountClosed(lifecycle.get(value))) continue;
			matches.push(value);
			if (matches.length >= MAX_SUGGESTIONS) break;
		}
		return matches;
	}

	private lifecycle(): ReadonlyMap<string, AccountRecord> {
		if (!this.merged) this.merged = mergeDirectives(this.directivesByPath);
		return this.merged;
	}
}

function parseCurrencies(rest: string): string[] {
	const body = rest.split(';')[0].replace(/"[^"]*"/g, ' ');
	const currencies: string[] = [];
	for (const token of body.split(/[\s,]+/)) {
		if (COMMODITY_RE.test(token)) currencies.push(token);
	}
	return currencies;
}

function mergeDirectives(
	byPath: ReadonlyMap<string, ReadonlyMap<string, AccountRecord>>
): ReadonlyMap<string, AccountRecord> {
	const merged = new Map<string, AccountRecord>();
	const files = [...byPath.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1));
	for (const [, fileRecords] of files) {
		for (const [name, record] of fileRecords) {
			const current = merged.get(name);
			if (!current) {
				merged.set(name, record);
				continue;
			}
			const next: AccountRecord = { ...current };
			if (record.open !== undefined && (current.open === undefined || record.open >= current.open)) {
				next.open = record.open;
				next.currencies = record.currencies;
			}
			if (record.close !== undefined && (current.close === undefined || record.close >= current.close)) {
				next.close = record.close;
			}
			merged.set(name, next);
		}
	}
	return merged;
}
