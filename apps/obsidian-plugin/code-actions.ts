/**
 * Quick fixes for diagnostic markers: flag a `!` transaction okay, insert
 * the missing posting that zeros a one-leg transaction, and add an `open`
 * directive for an unknown account.
 *
 * Each fix is a surgical edit — one flag character, one posting line, or
 * one `open` line — computed from the marked line's text and bean-check
 * message. Account inference for a balancing posting reads two-leg history
 * (`PairingIndex`); the `open` lands in the vault file that already holds
 * the most `open` directives (`OpenFileIndex`).
 */
import { blockRangeAt } from './align';
import { clipText } from './bean-check';
import type { LineDiagnostic } from './bean-check';
import type { VaultCache } from './vault-index';

/** Tooltip on a `!` transaction that bean-check does not itself report. */
export const FLAGGED_MESSAGE = 'Transaction is flagged incomplete';

export const FLAG_OKAY_TITLE = 'Flag as okay';
export const PAD_TRANSACTION_TITLE = 'Insert balancing posting';

export function openAccountTitle(account: string): string {
	return `Open account ${account}`;
}

/** A replacement on one line; `text` may contain a newline to insert a line. */
export interface TextEdit {
	/** 0-based. */
	line: number;
	fromCh: number;
	toCh: number;
	text: string;
}

export interface Pairing {
	date: string;
	payee: string | undefined;
	accounts: readonly [string, string];
}

export type QuickFix =
	| { title: string; kind: 'flag-okay' }
	| { title: string; kind: 'pad' }
	| {
			title: string;
			kind: 'open-account';
			account: string;
			date: string;
			commodity: string | undefined;
			path: string;
	  };

export interface QuickFixContext {
	lines: readonly string[];
	/** 0-based marked line. */
	line: number;
	/** Diagnostic tooltip on that line (bean-check messages, newline-joined). */
	message: string;
	pairings: readonly Pairing[];
	/** Vault path that should receive new `open` directives. */
	openFile: string;
	currentPath: string;
	/** Accounts that already have an `open` in `openFile`. */
	openedAccounts: ReadonlySet<string>;
}

const TXN_HEADER_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]*(txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])(.*)$/;
const HEADER_BANG_RE = /^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \t]+(!)(?![A-Za-z0-9])/;
const POSTING_BANG_RE = /^([ \t]+)(!)([ \t]+)/;
const OPEN_LINE_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]+open(?![A-Za-z0-9])[ \t]+([A-Z][A-Za-z0-9\-_]*(?::[A-Za-z0-9\-_]+)+)\b/;
const UNKNOWN_ACCOUNT_RE = /Invalid reference to unknown account '([^']+)'/g;
const UNBALANCED_RE = /Transaction does not balance:\s*\(([^)]+)\)/;
const RESIDUAL_RE = /^([-+]?[0-9][0-9,]*(?:\.[0-9]*)?)\s+(\S+)$/;
const PAYEE_RE = /^[ \t]*"((?:[^"\\\n]|\\.)+)"/;
const INDENT_RE = /^[ \t]+/;
const LEADING_FLAG_RE = /^[*!&#?%A-Z][ \t]+/;
const ACCOUNT_RE = /^[A-Z][A-Za-z0-9\-_]*(?::[A-Za-z0-9\-_]+)+/;
const NUMBER_RE = /^[-+]?[0-9][0-9,]*(?:\.[0-9]*)?/;
const COMMODITY_RE = /^(?:[A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")/;
const TRAILING_FLAG_RE = /^[*!&#?%A-Z](?=\s|$)/;

interface AmountPosting {
	account: string;
	number: string;
	commodity?: string;
	line: number;
}

/**
 * Lines whose `!` is a transaction or posting flag, ready to mark. bean-check
 * does not report flags; these are the markers "Flag as okay" hangs off.
 */
export function flagDiagnostics(text: string): LineDiagnostic[] {
	const diagnostics: LineDiagnostic[] = [];
	const lines = text.split('\n');
	for (let line = 0; line < lines.length; line += 1) {
		if (flagOkayEdit(lines, line) !== null) {
			diagnostics.push({ line, message: FLAGGED_MESSAGE });
		}
	}
	return diagnostics;
}

/**
 * Combine bean-check's per-line report with flag markers. A line bean-check
 * already named keeps its message — the flag is still visible in the source,
 * so "Flag as okay" does not need a second tooltip.
 */
export function mergeDiagnostics(
	bean: readonly LineDiagnostic[],
	flags: readonly LineDiagnostic[]
): LineDiagnostic[] {
	const byLine = new Map<number, string>();
	for (const diagnostic of bean) byLine.set(diagnostic.line, diagnostic.message);
	for (const diagnostic of flags) {
		if (!byLine.has(diagnostic.line)) byLine.set(diagnostic.line, diagnostic.message);
	}
	return [...byLine.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([line, message]) => ({ line, message: clipText(message) }));
}

/** The quick fixes the marked `line` can offer. */
export function quickFixesForLine(context: QuickFixContext): QuickFix[] {
	const fixes: QuickFix[] = [];
	if (flagOkayEdit(context.lines, context.line) !== null) {
		fixes.push({ title: FLAG_OKAY_TITLE, kind: 'flag-okay' });
	}
	if (padEdit(context.lines, context.line, context.pairings, context.message) !== null) {
		fixes.push({ title: PAD_TRANSACTION_TITLE, kind: 'pad' });
	}
	const date = transactionDate(context.lines, context.line);
	if (date !== undefined) {
		const commodity = blockCommodity(context.lines, context.line);
		for (const account of unknownAccounts(context.message)) {
			if (context.openedAccounts.has(account)) continue;
			fixes.push({
				title: openAccountTitle(account),
				kind: 'open-account',
				account,
				date,
				commodity,
				path: context.openFile,
			});
		}
	}
	return fixes;
}

/**
 * Replace a header `!` with `*`, or delete a posting's leading flag (and the
 * space after it) — the same two edits vscode-beancount's Flag as okay does.
 */
export function flagOkayEdit(lines: readonly string[], line: number): TextEdit | null {
	const text = lines[line];
	if (text === undefined) return null;
	const header = HEADER_BANG_RE.exec(text);
	if (header !== null && header.index === 0) {
		const fromCh = header[0].length - 1;
		return { line, fromCh, toCh: fromCh + 1, text: '*' };
	}
	const posting = POSTING_BANG_RE.exec(text);
	if (posting !== null && posting.index === 0) {
		const fromCh = posting[1].length;
		return { line, fromCh, toCh: fromCh + 1 + posting[3].length, text: '' };
	}
	return null;
}

/**
 * Insert the posting that zeros a one-leg, one-commodity transaction. The
 * account is the historical counterpart of the existing leg (same payee
 * preferred); the amount is the negation of bean-check's residual, or of
 * the lone posting when the message has none.
 */
export function padEdit(
	lines: readonly string[],
	line: number,
	pairings: readonly Pairing[],
	message: string
): TextEdit | null {
	if (!message.includes('Transaction does not balance')) return null;
	if (line < 0 || line >= lines.length) return null;
	const residualMatch = UNBALANCED_RE.exec(message);
	if (residualMatch !== null && residualMatch[1].includes(',')) return null;
	const range = blockRangeAt(lines, line);
	const postings = amountPostings(lines, range.from, range.to);
	const accounts = postingAccounts(lines, range.from, range.to);
	if (accounts.length !== 1 || postings.length !== 1) return null;
	const posting = postings[0];
	const residual = parseResidual(message);
	if (residual && residual.commodity !== undefined && posting.commodity !== undefined) {
		if (residual.commodity !== posting.commodity) return null;
	}
	const commodity = residual?.commodity ?? posting.commodity;
	if (commodity === undefined) return null;
	const number = residual ? negateAmount(residual.number) : negateAmount(posting.number);
	const header = TXN_HEADER_RE.exec(lines[range.from] ?? '');
	const payeeField = header ? PAYEE_RE.exec(header[3]) : null;
	const account = inferBalancingAccount(posting.account, payeeField ? payeeField[1] : undefined, pairings);
	if (account === null || account === posting.account) return null;
	const insertAt = range.to;
	const lineText = lines[insertAt] ?? '';
	return {
		line: insertAt,
		fromCh: lineText.length,
		toCh: lineText.length,
		text: `\n  ${account}  ${number} ${commodity}`,
	};
}

/**
 * The `open` line to insert into a file of existing opens, in date order.
 * `commodity` is attached when the posting that named the account had one.
 */
export function insertOpenDirective(
	lines: readonly string[],
	date: string,
	account: string,
	commodity?: string
): TextEdit {
	const directive = commodity ? `${date} open ${account} ${commodity}` : `${date} open ${account}`;
	const needle = date.replace(/\//g, '-');
	let insertLine = 0;
	let afterLast = false;
	let lastOpen = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const match = OPEN_LINE_RE.exec(lines[i]);
		if (match === null) continue;
		lastOpen = i;
		const existing = match[1].replace(/\//g, '-');
		if (existing > needle) {
			insertLine = i;
			afterLast = false;
			break;
		}
		insertLine = i;
		afterLast = true;
	}
	if (lastOpen === -1) {
		if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
			return { line: 0, fromCh: 0, toCh: 0, text: directive };
		}
		return { line: 0, fromCh: 0, toCh: 0, text: `${directive}\n` };
	}
	if (afterLast) {
		const text = lines[insertLine] ?? '';
		return { line: insertLine, fromCh: text.length, toCh: text.length, text: `\n${directive}` };
	}
	return { line: insertLine, fromCh: 0, toCh: 0, text: `${directive}\n` };
}

/** Most frequent other account paired with `account`; same-payee pairs win. */
export function inferBalancingAccount(
	account: string,
	payee: string | undefined,
	pairings: readonly Pairing[]
): string | null {
	if (payee !== undefined) {
		const hit = pickOther(account, pairings.filter((pairing) => pairing.payee === payee));
		if (hit !== null) return hit;
	}
	return pickOther(account, pairings);
}

/**
 * Two-leg, single-commodity transactions in `content`. Each pairing is one
 * historical (payee, account ↔ account) used to infer a balancing account.
 */
export function extractPairings(content: string): readonly Pairing[] {
	const lines = content.split('\n');
	const pairings: Pairing[] = [];
	let line = 0;
	while (line < lines.length) {
		const header = TXN_HEADER_RE.exec(lines[line]);
		if (header === null) {
			line += 1;
			continue;
		}
		const range = blockRangeAt(lines, line);
		const postings = amountPostings(lines, range.from, range.to);
		const accounts = postingAccounts(lines, range.from, range.to);
		if (accounts.length === 2 && postings.length === 2) {
			const [first, second] = postings;
			if (
				first.account !== second.account &&
				first.commodity !== undefined &&
				first.commodity === second.commodity
			) {
				pairings.push({
					date: header[1].replace(/\//g, '-'),
					payee: PAYEE_RE.exec(header[3])?.[1],
					accounts: [first.account, second.account],
				});
			}
		}
		line = range.to + 1;
	}
	return pairings;
}

/** Vault-wide two-leg history feeding `inferBalancingAccount`. */
export class PairingIndex implements VaultCache {
	private readonly byPath = new Map<string, readonly Pairing[]>();
	private cached: readonly Pairing[] | null = null;

	setFileContent(path: string, content: string): void {
		const pairings = extractPairings(content);
		if (pairings.length === 0) this.byPath.delete(path);
		else this.byPath.set(path, pairings);
		this.cached = null;
	}

	removeFile(path: string): void {
		if (this.byPath.delete(path)) this.cached = null;
	}

	renameFile(oldPath: string, newPath: string): boolean {
		const oldPrefix = oldPath + '/';
		let moved = false;
		for (const [path, pairings] of [...this.byPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			this.byPath.delete(path);
			this.byPath.set(newPath + path.slice(oldPath.length), pairings);
			moved = true;
			this.cached = null;
		}
		return moved;
	}

	all(): readonly Pairing[] {
		if (this.cached === null) {
			const merged: Pairing[] = [];
			for (const pairings of this.byPath.values()) merged.push(...pairings);
			this.cached = merged;
		}
		return this.cached;
	}
}

/** Which vault file already holds `open` directives, and which accounts. */
export class OpenFileIndex implements VaultCache {
	private readonly accountsByPath = new Map<string, ReadonlySet<string>>();

	setFileContent(path: string, content: string): void {
		const accounts = openedAccountsIn(content);
		if (accounts.size === 0) this.accountsByPath.delete(path);
		else this.accountsByPath.set(path, accounts);
	}

	removeFile(path: string): void {
		this.accountsByPath.delete(path);
	}

	renameFile(oldPath: string, newPath: string): boolean {
		const oldPrefix = oldPath + '/';
		let moved = false;
		for (const [path, accounts] of [...this.accountsByPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			this.accountsByPath.delete(path);
			this.accountsByPath.set(newPath + path.slice(oldPath.length), accounts);
			moved = true;
		}
		return moved;
	}

	/**
	 * The ledger file with the most `open` names. Markdown notes lose to
	 * `.bean` / `.beancount` so a fenced scratch pad cannot steal the target.
	 */
	bestFile(): string | null {
		let best: string | null = null;
		let bestCount = 0;
		let bestLedger = false;
		for (const [path, accounts] of this.accountsByPath) {
			const count = accounts.size;
			const ledger = path.endsWith('.bean') || path.endsWith('.beancount');
			if (best === null || (ledger && !bestLedger) || (ledger === bestLedger && count > bestCount)) {
				best = path;
				bestCount = count;
				bestLedger = ledger;
			}
		}
		return best;
	}

	openedIn(path: string): ReadonlySet<string> {
		return this.accountsByPath.get(path) ?? new Set();
	}
}

function openedAccountsIn(content: string): Set<string> {
	const accounts = new Set<string>();
	for (const line of content.split('\n')) {
		const match = OPEN_LINE_RE.exec(line);
		if (match !== null) accounts.add(match[2]);
	}
	return accounts;
}


function unknownAccounts(message: string): string[] {
	const accounts: string[] = [];
	UNKNOWN_ACCOUNT_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = UNKNOWN_ACCOUNT_RE.exec(message)) !== null) {
		if (!accounts.includes(match[1])) accounts.push(match[1]);
	}
	return accounts;
}

function transactionDate(lines: readonly string[], line: number): string | undefined {
	if (line < 0 || line >= lines.length) return undefined;
	const range = blockRangeAt(lines, line);
	for (let i = range.from; i <= range.to; i += 1) {
		const match = TXN_HEADER_RE.exec(lines[i]);
		if (match !== null) return match[1];
	}
	return undefined;
}


function blockCommodity(lines: readonly string[], line: number): string | undefined {
	if (line < 0 || line >= lines.length) return undefined;
	const range = blockRangeAt(lines, line);
	const postings = amountPostings(lines, range.from, range.to);
	const commodities = new Set(postings.map((posting) => posting.commodity).filter((c): c is string => c !== undefined));
	return commodities.size === 1 ? [...commodities][0] : undefined;
}

function parseResidual(message: string): { number: string; commodity: string } | null {
	const match = UNBALANCED_RE.exec(message);
	if (match === null) return null;
	const inner = match[1].trim();
	if (inner.includes(',')) return null;
	const residual = RESIDUAL_RE.exec(inner);
	if (residual === null) return null;
	return { number: residual[1], commodity: residual[2] };
}

function negateAmount(number: string): string {
	if (number.startsWith('-')) return number.slice(1);
	if (number.startsWith('+')) return `-${number.slice(1)}`;
	return `-${number}`;
}

function pickOther(account: string, pairings: readonly Pairing[]): string | null {
	const counts = new Map<string, { n: number; date: string }>();
	for (const pairing of pairings) {
		const [left, right] = pairing.accounts;
		const other = left === account ? right : right === account ? left : null;
		if (other === null) continue;
		const prev = counts.get(other);
		if (prev === undefined || pairing.date >= prev.date) {
			counts.set(other, { n: (prev?.n ?? 0) + 1, date: pairing.date });
		} else {
			counts.set(other, { n: prev.n + 1, date: prev.date });
		}
	}
	let best: string | null = null;
	let bestN = 0;
	let bestDate = '';
	for (const [name, { n, date }] of counts) {
		if (n > bestN || (n === bestN && date > bestDate) || (n === bestN && date === bestDate && best !== null && name < best)) {
			best = name;
			bestN = n;
			bestDate = date;
		}
	}
	return best;
}

function postingAccounts(lines: readonly string[], from: number, to: number): string[] {
	const accounts: string[] = [];
	for (let i = from; i <= to; i += 1) {
		const parsed = parsePostingLine(lines[i]);
		if (parsed !== null) accounts.push(parsed.account);
	}
	return accounts;
}

function amountPostings(lines: readonly string[], from: number, to: number): AmountPosting[] {
	const postings: AmountPosting[] = [];
	for (let i = from; i <= to; i += 1) {
		const parsed = parsePostingLine(lines[i]);
		if (parsed === null || parsed.number === undefined) continue;
		postings.push({ ...parsed, number: parsed.number, line: i });
	}
	return postings;
}

function parsePostingLine(line: string): { account: string; number?: string; commodity?: string } | null {
	const indent = INDENT_RE.exec(line);
	if (indent === null || indent.index !== 0) return null;
	let rest = line.slice(indent[0].length);
	const leadingFlag = LEADING_FLAG_RE.exec(rest);
	if (leadingFlag !== null && leadingFlag.index === 0) rest = rest.slice(leadingFlag[0].length);
	const account = ACCOUNT_RE.exec(rest);
	if (account === null || account.index !== 0) return null;
	rest = rest.slice(account[0].length).replace(/^[ \t]+/, '');
	const trailingFlag = TRAILING_FLAG_RE.exec(rest);
	if (trailingFlag !== null && trailingFlag.index === 0) {
		rest = rest.slice(trailingFlag[0].length).replace(/^[ \t]+/, '');
	}
	if (rest === '' || rest.startsWith(';') || rest.startsWith('{') || rest.startsWith('@')) {
		return { account: account[0] };
	}
	const number = NUMBER_RE.exec(rest);
	if (number === null || number.index !== 0) return { account: account[0] };
	rest = rest.slice(number[0].length).replace(/^[ \t]+/, '');
	const commodity = COMMODITY_RE.exec(rest);
	return {
		account: account[0],
		number: number[0],
		commodity: commodity !== null && commodity.index === 0 ? commodity[0] : undefined,
	};
}
