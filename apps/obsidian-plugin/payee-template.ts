/**
 * Posting templates for payee completion, Fava's "fill the last transaction
 * for this payee" behaviour.
 *
 * For each payee (the same first quoted field `extractPayees` indexes) the
 * cache keeps the postings of its most recent transaction: latest date wins,
 * and a date tie goes to the later vault path, then the later line in that
 * file. Both comparisons are plain string order, so the winner is
 * deterministic. Dates written with `/` are normalized to `-` before the
 * comparison. A transaction with no posting lines — only metadata, comments,
 * or a bare header — is not a template and does not displace an older one
 * that has postings.
 *
 * Stored lines are account, posting flags, and amount text. Metadata lines,
 * comment lines, and inline `;` comments are dropped. Indentation is not
 * stored: the inserted lines always use the two-space entry indent.
 *
 * Amounts become snippet tab stops (`SnippetSession`) rather than `$`
 * placeholders interpolated into the amount text, so a `$` in a commodity
 * cannot become a stop. Only the leading number token of a kept amount is
 * the stop (the old number, selected); the commodity, cost, and price stay
 * literal. The common two-leg transaction collapses to one stop: the first
 * posting keeps its amount and the second is account-only when the history
 * had one implicit leg, or two opposite simple amounts (`NUMBER COMMODITY`,
 * same commodity, numeric sum zero). An amount is not moved onto a different
 * account — if the only explicit amount sits on the second leg, the stop
 * stays there. Three or more postings keep every amount. Two amounts that
 * are not a simple opposite pair (a cost, a price, a second commodity) keep
 * both numbers.
 */
import { transactionPayee } from './payee-index';
import type { TabStop } from './snippets';
import type { VaultCache } from './vault-index';

/** One posting of a payee's latest transaction. */
export interface TemplatePosting {
	/** Flag before the account (`!`), or empty. */
	leadingFlag: string;
	account: string;
	/** Flag after the account (`*`), or empty. */
	trailingFlag: string;
	/**
	 * Amount as written after the account and flags, inline comment stripped.
	 * Absent when the posting lets beancount balance it.
	 */
	amount?: string;
}

/** The winning transaction for one payee in one file, or after a vault merge. */
export interface PayeeTemplate {
	/** `YYYY-MM-DD`, slashes already normalized. */
	date: string;
	/** Vault path of the file that held the transaction. */
	path: string;
	/** 0-based header line. Later line wins a date tie in the same file. */
	line: number;
	postings: readonly TemplatePosting[];
}

/** Text inserted under a transaction header, plus stops into that text. */
export interface PayeeAutofillBody {
	/** Starts with a newline; each posting line is indented with two spaces. */
	text: string;
	/** Offsets into `text`. Visit order is array order. */
	stops: TabStop[];
}

const HEADER_RE =
	/^([0-9]{4})[-/]([0-9]{2})[-/]([0-9]{2})[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;
const INDENT_RE = /^[ \t]+/;
const LEADING_FLAG_RE = /^[*!&#?%A-Z](?=[ \t])/;
const ACCOUNT_RE = /^[A-Z][a-z]+(?::[^\s:]+)+/;
const TRAILING_FLAG_RE = /^[*!&#?%A-Z](?=\s|$)/;
const NUMBER_TOKEN = /^[-+]?[0-9][0-9,]*(?:\.[0-9]*)?(?=\s|$)/;
const SIMPLE_AMOUNT =
	/^([-+]?[0-9][0-9,]*(?:\.[0-9]*)?)[ \t]+([A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]|"[^"\s]+")$/;

/**
 * Latest posting template per payee in `content`. `path` is stored on each
 * template so a later file can win a date tie without re-reading.
 */
export function extractLatestPayeeTemplates(content: string, path: string): Map<string, PayeeTemplate> {
	const lines = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
	const found = new Map<string, PayeeTemplate>();
	let line = 0;
	while (line < lines.length) {
		const header = HEADER_RE.exec(lines[line]);
		if (header === null) {
			line += 1;
			continue;
		}
		const to = blockEndAt(lines, line);
		const payee = transactionPayee(lines[line]);
		if (payee !== null) {
			const postings = parsePostings(lines, line + 1, to);
			if (postings.length > 0) {
				const template: PayeeTemplate = {
					date: `${header[1]}-${header[2]}-${header[3]}`,
					path,
					line,
					postings,
				};
				const prev = found.get(payee);
				if (prev === undefined || isNewer(template, prev)) found.set(payee, template);
			}
		}
		line = to + 1;
	}
	return found;
}

/**
 * Render `postings` as the lines inserted under an empty transaction.
 * Returns null when there is nothing to insert.
 */
export function buildPayeeAutofill(postings: readonly TemplatePosting[]): PayeeAutofillBody | null {
	if (postings.length === 0) return null;
	const keep = amountsToKeep(postings);
	let text = '';
	const stops: TabStop[] = [];
	let index = 1;
	for (let i = 0; i < postings.length; i += 1) {
		const posting = postings[i];
		text += '\n  ';
		if (posting.leadingFlag !== '') text += `${posting.leadingFlag} `;
		text += posting.account;
		if (posting.trailingFlag !== '') text += ` ${posting.trailingFlag}`;
		const amount = keep[i] ? posting.amount : undefined;
		if (amount === undefined) continue;
		text += '  ';
		const number = NUMBER_TOKEN.exec(amount);
		if (number === null) {
			text += amount;
			continue;
		}
		const from = text.length;
		text += number[0];
		stops.push({ index, from, to: text.length });
		index += 1;
		text += amount.slice(number[0].length);
	}
	return { text, stops };
}

/** Vault-wide latest-transaction templates, fed by `registerVaultIndex`. */
export class PayeeTemplateIndex implements VaultCache {
	private readonly byPath = new Map<string, ReadonlyMap<string, PayeeTemplate>>();
	private cached: ReadonlyMap<string, PayeeTemplate> | null = null;

	setFileContent(path: string, content: string): void {
		const templates = extractLatestPayeeTemplates(content, path);
		if (templates.size === 0) this.byPath.delete(path);
		else this.byPath.set(path, templates);
		this.cached = null;
	}

	removeFile(path: string): void {
		if (this.byPath.delete(path)) this.cached = null;
	}

	/**
	 * Re-key cached files on rename, including a folder rename's children.
	 * Each template's `path` is rewritten too, so a date tie still compares
	 * the path the file has now.
	 */
	renameFile(oldPath: string, newPath: string): boolean {
		const oldPrefix = oldPath + '/';
		let moved = false;
		for (const [path, templates] of [...this.byPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			const dest = newPath + path.slice(oldPath.length);
			this.byPath.delete(path);
			const rewritten = new Map<string, PayeeTemplate>();
			for (const [payee, template] of templates) {
				rewritten.set(payee, { ...template, path: dest });
			}
			this.byPath.set(dest, rewritten);
			moved = true;
			this.cached = null;
		}
		return moved;
	}

	/** The latest template for `payee`, or null when none has postings. */
	get(payee: string): PayeeTemplate | null {
		return this.all().get(payee) ?? null;
	}

	private all(): ReadonlyMap<string, PayeeTemplate> {
		if (this.cached === null) {
			const merged = new Map<string, PayeeTemplate>();
			for (const templates of this.byPath.values()) {
				for (const [payee, template] of templates) {
					const prev = merged.get(payee);
					if (prev === undefined || isNewer(template, prev)) merged.set(payee, template);
				}
			}
			this.cached = merged;
		}
		return this.cached;
	}
}

/**
 * Inclusive end of the block opened by a column-0 header at `line`.
 *
 * Same close rule as `scanBlocks` / `blockRangeAt`: indented lines belong
 * to the header; a blank line (whitespace-only included), a `;` comment at
 * column 0, or any other column-0 line starts a different block and is not
 * included. Walking forward from the header — and resuming at `to + 1` —
 * covers each line once. Calling `blockRangeAt` per header rescans the
 * whole file, which stalls a large ledger on every vault modify.
 */
function blockEndAt(lines: readonly string[], line: number): number {
	let to = line;
	for (let i = line + 1; i < lines.length; i += 1) {
		const text = lines[i];
		const head = text.charAt(0);
		if (text.trim() === '' || head === ';' || (head !== ' ' && head !== '\t')) break;
		to = i;
	}
	return to;
}

function isNewer(candidate: PayeeTemplate, incumbent: PayeeTemplate): boolean {
	if (candidate.date !== incumbent.date) return candidate.date > incumbent.date;
	if (candidate.path !== incumbent.path) return candidate.path > incumbent.path;
	return candidate.line > incumbent.line;
}

function parsePostings(lines: readonly string[], from: number, to: number): TemplatePosting[] {
	const postings: TemplatePosting[] = [];
	for (let i = from; i <= to; i += 1) {
		const posting = parsePosting(lines[i] ?? '');
		if (posting !== null) postings.push(posting);
	}
	return postings;
}

function parsePosting(line: string): TemplatePosting | null {
	const indent = INDENT_RE.exec(line);
	if (indent === null || indent.index !== 0) return null;
	let rest = line.slice(indent[0].length);
	let leadingFlag = '';
	const leading = LEADING_FLAG_RE.exec(rest);
	if (leading !== null && leading.index === 0) {
		leadingFlag = leading[0];
		rest = rest.slice(leading[0].length).replace(/^[ \t]+/, '');
	}
	const account = ACCOUNT_RE.exec(rest);
	if (account === null || account.index !== 0) return null;
	rest = rest.slice(account[0].length).replace(/^[ \t]+/, '');
	let trailingFlag = '';
	const trailing = TRAILING_FLAG_RE.exec(rest);
	if (trailing !== null && trailing.index === 0) {
		trailingFlag = trailing[0];
		rest = rest.slice(trailing[0].length).replace(/^[ \t]+/, '');
	}
	const comment = rest.indexOf(';');
	if (comment !== -1) rest = rest.slice(0, comment);
	const amount = rest.trim();
	const posting: TemplatePosting = {
		leadingFlag,
		account: account[0],
		trailingFlag,
	};
	if (amount !== '') posting.amount = amount;
	return posting;
}

/**
 * Which postings keep an amount stop. Two legs collapse to a single amount
 * when one leg is implicit, or when both amounts are a simple opposite pair
 * in one commodity — the second amount is then dropped so beancount balances
 * it. Every other shape keeps each amount where it was written.
 */
function amountsToKeep(postings: readonly TemplatePosting[]): boolean[] {
	const keep = postings.map((posting) => posting.amount !== undefined);
	if (postings.length !== 2) return keep;
	const [first, second] = postings;
	if (first.amount !== undefined && second.amount === undefined) return [true, false];
	if (first.amount === undefined && second.amount !== undefined) return [false, true];
	if (
		first.amount !== undefined &&
		second.amount !== undefined &&
		oppositeAmounts(first.amount, second.amount)
	) {
		return [true, false];
	}
	return keep;
}

function oppositeAmounts(left: string, right: string): boolean {
	const a = SIMPLE_AMOUNT.exec(left);
	const b = SIMPLE_AMOUNT.exec(right);
	if (a === null || b === null || a[2] !== b[2]) return false;
	const x = Number(a[1].replace(/,/g, ''));
	const y = Number(b[1].replace(/,/g, ''));
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	const scale = Math.max(Math.abs(x), Math.abs(y), 1);
	return Math.abs(x + y) <= scale * 1e-9;
}
