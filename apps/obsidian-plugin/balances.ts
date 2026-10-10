/**
 * Per-account unit balances for the sidebar report.
 *
 * Numbers are summed with `Decimal`, not JS floats. A transaction with exactly
 * one posting whose amount is omitted (or is an `IncompleteAmount` that names
 * only a currency) is filled with the negated weight residual of the others.
 * Weight is the units, unless a cost or price converts them: `{x C}` is
 * units × x in C, `{{t C}}` is sign(units) × t, `@ p` is units × p, `@@ t` is
 * sign(units) × t. Cost wins over price. Several residual currencies expand
 * the omitted posting into one position per currency. A currency-only posting
 * is filled only in that currency; leftover currencies are an error. Two
 * incomplete postings, a number without a currency, or a cost/price that
 * itself must be interpolated are errors — the report shows those instead of
 * a partial table.
 *
 * `pad A B` plus a later `balance A` inserts the difference between the
 * asserted amount and A's units in that currency at the start of the balance
 * date (entries strictly before it, including child accounts). Only the first
 * balance per currency after a pad consumes it. A same-day balance sorts
 * before the pad, so it does not consume it. Directives are ordered by date,
 * then beancount's same-day order (open, balance, other, document, close),
 * then source line, then include order. Line number is per file, matching
 * `entry_sortkey`, so a later include with a smaller line number sorts first.
 *
 * The table sums units, not cost lots. Accounts whose units are all zero are
 * omitted — bean-query drops empty positions the same way. Display scale is
 * the maximum fractional digits in the shortest round-trip of each parsed
 * number of that currency. The model does not keep the original `10.00` text,
 * so that amount displays as an integer unless some other number of the
 * currency had a fraction. Arithmetic expressions are already JS numbers.
 */
import {
	Amount,
	Balance,
	BeancountParser,
	BeancountSyntaxError,
	Include,
	IncompleteAmount,
	Pad,
	Transaction,
} from '@repo/beancount-parser';
import type { Cost, Directive, Posting, PriceAnnotation } from '@repo/beancount-parser';
import { Decimal } from './decimal';
import { resolveIncludePath } from './include-links';

export interface BalanceAmount {
	currency: string;
	text: string;
}

export interface BalanceRow {
	account: string;
	amounts: BalanceAmount[];
}

export interface BalanceIssue {
	file: string;
	line: number;
	message: string;
}

export interface BalanceReport {
	rows: BalanceRow[];
	errors: BalanceIssue[];
	/** Vault paths that were read. The view refreshes when one of these changes. */
	files: readonly string[];
}

export interface LedgerVault {
	vaultRoot: string;
	vaultFiles: readonly string[];
	read(path: string): Promise<string | null>;
}

const TOO_MANY = 'Too many postings with missing amounts';
const NUMBER_ONLY = 'Cannot interpolate a posting that specifies only a number';
const HAS_COST = 'Cannot interpolate a posting that has a cost or a price';
const COST_INTERPOLATION = 'Cannot interpolate a cost or a price on this transaction';
const OTHER_CURRENCIES = 'Residual has currencies other than the posting currency';
const INVALID_NUMBER = 'Amount is not a finite number';

interface Sourced {
	file: string;
	directive: Directive;
	line: number;
	seq: number;
}

interface UnitLeg {
	account: string;
	currency: string;
	units: Decimal;
}

interface EventKey {
	dateKey: number;
	typeOrder: number;
	line: number;
	seq: number;
}

interface PostingEvent extends EventKey {
	kind: 'posting';
	account: string;
	currency: string;
	units: Decimal;
}

interface PadEvent extends EventKey {
	kind: 'pad';
	account: string;
	source: string;
}

interface BalanceEvent extends EventKey {
	kind: 'balance';
	account: string;
	currency: string;
	amount: Decimal;
}

type LedgerEvent = PostingEvent | PadEvent | BalanceEvent;

/**
 * Balances of `entryPath` and the `include` chain found in `files`.
 * A missing, outside, unmatched, or unparsable file yields errors and no rows.
 */
export function accountBalances(
	entryPath: string,
	files: ReadonlyMap<string, string>,
	vaultRoot: string,
	vaultFiles: readonly string[],
): BalanceReport {
	const loaded = loadSources(entryPath, files, vaultRoot, vaultFiles);
	if (loaded.errors.length > 0) return { rows: [], errors: loaded.errors, files: loaded.files };
	const computed = compute(loaded.sources);
	return { rows: computed.rows, errors: computed.errors, files: loaded.files };
}

/** Read `entryPath` and every included file, then compute balances. */
export async function loadAccountBalances(entryPath: string, vault: LedgerVault): Promise<BalanceReport> {
	const files = new Map<string, string>();
	const readErrors: BalanceIssue[] = [];
	const seen = new Set<string>();
	const queue = [entryPath];
	while (queue.length > 0) {
		const path = queue.shift() as string;
		if (seen.has(path)) continue;
		seen.add(path);
		let text: string | null;
		try {
			text = await vault.read(path);
		} catch {
			text = null;
		}
		if (text === null) {
			readErrors.push({
				file: path,
				line: 1,
				message: path === entryPath ? `Entry ledger not found: ${path}` : `Included file not found: ${path}`,
			});
			continue;
		}
		files.set(path, text);
		for (const next of includePaths(text, path, vault.vaultRoot, vault.vaultFiles)) queue.push(next);
	}
	if (readErrors.length > 0) return { rows: [], errors: readErrors, files: [...files.keys()] };
	return accountBalances(entryPath, files, vault.vaultRoot, vault.vaultFiles);
}

function includePaths(text: string, sourcePath: string, vaultRoot: string, vaultFiles: readonly string[]): string[] {
	let directives: Directive[];
	try {
		directives = BeancountParser.parse(text).directives;
	} catch {
		return [];
	}
	const paths: string[] = [];
	for (const directive of directives) {
		if (!(directive instanceof Include)) continue;
		const resolved = resolveIncludePath(directive.filename, sourcePath, vaultRoot, vaultFiles);
		if (resolved.kind === 'file') paths.push(resolved.vaultPath);
		else if (resolved.kind === 'glob') for (const match of resolved.matches) paths.push(match);
	}
	return paths;
}

function loadSources(
	entryPath: string,
	files: ReadonlyMap<string, string>,
	vaultRoot: string,
	vaultFiles: readonly string[],
): { sources: Sourced[]; errors: BalanceIssue[]; files: string[] } {
	const sources: Sourced[] = [];
	const errors: BalanceIssue[] = [];
	const visited: string[] = [];
	const seen = new Set<string>();
	const queue = [entryPath];
	let seq = 0;
	while (queue.length > 0) {
		const path = queue.shift() as string;
		if (seen.has(path)) continue;
		seen.add(path);
		const text = files.get(path);
		if (text === undefined) {
			errors.push({
				file: path,
				line: 1,
				message: path === entryPath ? `Entry ledger not found: ${path}` : `Included file not found: ${path}`,
			});
			continue;
		}
		visited.push(path);
		let directives: Directive[];
		try {
			directives = BeancountParser.parse(text).directives;
		} catch (err) {
			if (err instanceof BeancountSyntaxError) {
				for (const item of err.errors) errors.push({ file: path, line: item.line, message: item.message });
			} else {
				errors.push({ file: path, line: 1, message: err instanceof Error ? err.message : 'Parse failed' });
			}
			continue;
		}
		for (const directive of directives) {
			const line = directive.location?.start.line ?? 1;
			sources.push({ file: path, directive, line, seq });
			seq += 1;
			if (!(directive instanceof Include)) continue;
			const resolved = resolveIncludePath(directive.filename, path, vaultRoot, vaultFiles);
			if (resolved.kind === 'file') {
				queue.push(resolved.vaultPath);
			} else if (resolved.kind === 'glob') {
				if (resolved.matches.length === 0) {
					errors.push({ file: path, line, message: `No files match include "${directive.filename}"` });
				} else {
					for (const match of resolved.matches) queue.push(match);
				}
			} else if (resolved.kind === 'missing') {
				errors.push({ file: path, line, message: `Included file not found: ${directive.filename}` });
			} else {
				errors.push({ file: path, line, message: `Include is outside the vault: ${directive.filename}` });
			}
		}
	}
	return { sources, errors, files: visited };
}

function compute(sources: readonly Sourced[]): { rows: BalanceRow[]; errors: BalanceIssue[] } {
	const scales = new Map<string, number>();
	const events: LedgerEvent[] = [];
	const errors: BalanceIssue[] = [];
	for (const source of sources) {
		const directive = source.directive;
		if (directive instanceof Transaction) {
			noteTransaction(directive, scales);
			const filled = interpolate(directive);
			if (typeof filled === 'string') {
				errors.push({ file: source.file, line: source.line, message: filled });
				continue;
			}
			for (const leg of filled) {
				events.push({
					kind: 'posting',
					account: leg.account,
					currency: leg.currency,
					units: leg.units,
					dateKey: dateKey(directive.date),
					typeOrder: 0,
					line: source.line,
					seq: source.seq,
				});
			}
		} else if (directive instanceof Pad) {
			events.push({
				kind: 'pad',
				account: directive.account,
				source: directive.sourceAccount,
				dateKey: dateKey(directive.date),
				typeOrder: 0,
				line: source.line,
				seq: source.seq,
			});
		} else if (directive instanceof Balance) {
			const amount = Decimal.fromNumber(directive.amount.number);
			if (!amount) {
				errors.push({ file: source.file, line: source.line, message: INVALID_NUMBER });
				continue;
			}
			noteDecimal(scales, directive.amount.currency, amount);
			events.push({
				kind: 'balance',
				account: directive.account,
				currency: directive.amount.currency,
				amount,
				dateKey: dateKey(directive.date),
				typeOrder: -1,
				line: source.line,
				seq: source.seq,
			});
		}
	}
	if (errors.length > 0) return { rows: [], errors };
	events.sort(compareEvent);
	for (const synthetic of padPostings(events)) events.push(synthetic);
	return { rows: rowsOf(events, scales), errors: [] };
}

function interpolate(txn: Transaction): UnitLeg[] | string {
	const missing = txn.postings.filter((posting) => !(posting.amount instanceof Amount));
	if (missing.length > 1) return TOO_MANY;
	if (missing.length === 0) return unitLegs(txn.postings);
	const posting = missing[0] as Posting;
	if (posting.cost || posting.priceAnnotation) return HAS_COST;
	const residual = new Map<string, Decimal>();
	for (const other of txn.postings) {
		if (other === posting) continue;
		const weight = postingWeight(other);
		if (typeof weight === 'string') return weight;
		addCurrency(residual, weight.currency, weight.units);
	}
	dropZeros(residual);
	const known = unitLegs(txn.postings.filter((other) => other !== posting));
	if (typeof known === 'string') return known;
	if (posting.amount === undefined) {
		for (const currency of sortedKeys(residual)) {
			const units = residual.get(currency) as Decimal;
			known.push({ account: posting.account, currency, units: units.neg() });
		}
		return known;
	}
	if (posting.amount.number !== null && posting.amount.currency === null) return NUMBER_ONLY;
	if (posting.amount.number === null && posting.amount.currency !== null) {
		const currency = posting.amount.currency;
		for (const other of residual.keys()) if (other !== currency) return OTHER_CURRENCIES;
		const have = residual.get(currency);
		if (have && !have.isZero()) known.push({ account: posting.account, currency, units: have.neg() });
		return known;
	}
	return NUMBER_ONLY;
}

function unitLegs(postings: readonly Posting[]): UnitLeg[] | string {
	const legs: UnitLeg[] = [];
	for (const posting of postings) {
		if (!(posting.amount instanceof Amount)) continue;
		const units = Decimal.fromNumber(posting.amount.number);
		if (!units) return INVALID_NUMBER;
		if (units.isZero()) continue;
		legs.push({ account: posting.account, currency: posting.amount.currency, units });
	}
	return legs;
}

function postingWeight(posting: Posting): { currency: string; units: Decimal } | string {
	if (!(posting.amount instanceof Amount)) return COST_INTERPOLATION;
	const units = Decimal.fromNumber(posting.amount.number);
	if (!units) return INVALID_NUMBER;
	if (posting.cost) {
		const weighted = costWeight(units, posting.cost);
		return weighted ?? COST_INTERPOLATION;
	}
	if (posting.priceAnnotation) return priceWeight(units, posting.priceAnnotation);
	return { currency: posting.amount.currency, units };
}

function costWeight(units: Decimal, cost: Cost): { currency: string; units: Decimal } | null {
	if (cost.amount instanceof IncompleteAmount || cost.total instanceof IncompleteAmount) return null;
	if (cost.amount instanceof Amount) {
		const per = Decimal.fromNumber(cost.amount.number);
		if (!per) return null;
		return { currency: cost.amount.currency, units: units.mul(per) };
	}
	if (cost.total instanceof Amount) {
		const total = Decimal.fromNumber(cost.total.number);
		if (!total) return null;
		return { currency: cost.total.currency, units: signed(units, total) };
	}
	// `{}`, a date, or a label: the cost number is what interpolation would fill.
	return null;
}

function priceWeight(units: Decimal, price: PriceAnnotation): { currency: string; units: Decimal } | string {
	if (!(price.amount instanceof Amount)) return COST_INTERPOLATION;
	const number = Decimal.fromNumber(price.amount.number);
	if (!number) return INVALID_NUMBER;
	return { currency: price.amount.currency, units: price.isTotal ? signed(units, number) : units.mul(number) };
}

/** `sign(units) * total`, so `{{t}}` and `@@ t` keep the units' direction. */
function signed(units: Decimal, total: Decimal): Decimal {
	const sign = units.sign();
	if (sign < 0) return total.neg();
	if (sign > 0) return total;
	return Decimal.zero();
}

function padPostings(events: readonly LedgerEvent[]): PostingEvent[] {
	const accounts: string[] = [];
	for (const event of events) {
		if (event.kind === 'pad' && accounts.indexOf(event.account) === -1) accounts.push(event.account);
	}
	accounts.sort(compareText);
	const synthetic: PostingEvent[] = [];
	for (const account of accounts) {
		let active: PadEvent | null = null;
		const consumed = new Set<string>();
		const running = new Map<string, Decimal>();
		for (const event of events) {
			if (event.kind === 'posting' && isUnder(account, event.account)) {
				addCurrency(running, event.currency, event.units);
			} else if (event.kind === 'pad' && event.account === account) {
				active = event;
				consumed.clear();
			} else if (event.kind === 'balance' && event.account === account && active && !consumed.has(event.currency)) {
				consumed.add(event.currency);
				const have = running.get(event.currency) ?? Decimal.zero();
				const diff = event.amount.sub(have);
				if (diff.isZero()) continue;
				synthetic.push(copyPosting(active, active.account, event.currency, diff));
				synthetic.push(copyPosting(active, active.source, event.currency, diff.neg()));
				addCurrency(running, event.currency, diff);
			}
		}
	}
	return synthetic;
}

function copyPosting(pad: PadEvent, account: string, currency: string, units: Decimal): PostingEvent {
	return {
		kind: 'posting',
		account,
		currency,
		units,
		dateKey: pad.dateKey,
		typeOrder: pad.typeOrder,
		line: pad.line,
		seq: pad.seq,
	};
}

function rowsOf(events: readonly LedgerEvent[], scales: ReadonlyMap<string, number>): BalanceRow[] {
	const totals = new Map<string, Map<string, Decimal>>();
	for (const event of events) {
		if (event.kind !== 'posting' || event.units.isZero()) continue;
		let currencies = totals.get(event.account);
		if (!currencies) {
			currencies = new Map();
			totals.set(event.account, currencies);
		}
		addCurrency(currencies, event.currency, event.units);
	}
	const rows: BalanceRow[] = [];
	for (const account of sortedKeys(totals)) {
		const currencies = totals.get(account) as Map<string, Decimal>;
		dropZeros(currencies);
		if (currencies.size === 0) continue;
		const amounts: BalanceAmount[] = [];
		for (const currency of sortedKeys(currencies)) {
			const units = currencies.get(currency) as Decimal;
			amounts.push({ currency, text: units.format(scales.get(currency) ?? 0) });
		}
		rows.push({ account, amounts });
	}
	return rows;
}

function noteTransaction(txn: Transaction, scales: Map<string, number>): void {
	for (const posting of txn.postings) {
		noteMaybe(scales, posting.amount);
		if (posting.cost) {
			noteMaybe(scales, posting.cost.amount);
			noteMaybe(scales, posting.cost.total);
		}
		if (posting.priceAnnotation) noteMaybe(scales, posting.priceAnnotation.amount);
	}
}

function noteMaybe(scales: Map<string, number>, amount: Amount | IncompleteAmount | undefined): void {
	if (!(amount instanceof Amount)) return;
	const decimal = Decimal.fromNumber(amount.number);
	if (decimal) noteDecimal(scales, amount.currency, decimal);
}

function noteDecimal(scales: Map<string, number>, currency: string, decimal: Decimal): void {
	const prev = scales.get(currency) ?? 0;
	if (decimal.scale > prev) scales.set(currency, decimal.scale);
}

/** A child account's units count toward a pad of its parent; `Cashier` is not under `Cash`. */
function isUnder(parent: string, account: string): boolean {
	return account === parent || account.startsWith(parent + ':');
}

function addCurrency(map: Map<string, Decimal>, currency: string, units: Decimal): void {
	map.set(currency, (map.get(currency) ?? Decimal.zero()).add(units));
}

function dropZeros(map: Map<string, Decimal>): void {
	for (const currency of [...map.keys()]) {
		if ((map.get(currency) as Decimal).isZero()) map.delete(currency);
	}
}

function dateKey(date: Date): number {
	return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function compareEvent(a: LedgerEvent, b: LedgerEvent): number {
	if (a.dateKey !== b.dateKey) return a.dateKey - b.dateKey;
	if (a.typeOrder !== b.typeOrder) return a.typeOrder - b.typeOrder;
	if (a.line !== b.line) return a.line - b.line;
	return a.seq - b.seq;
}

function sortedKeys(map: ReadonlyMap<string, unknown>): string[] {
	return [...map.keys()].sort(compareText);
}

function compareText(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}
