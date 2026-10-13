/**
 * Per-account unit balances for the sidebar report.
 *
 * Numbers are summed with `Decimal`, not JS floats. A plain literal uses its
 * source spelling (`numberText`) so `1.00` and amounts past 2^53 stay exact;
 * an arithmetic expression falls back to the float. A transaction with exactly
 * one posting whose amount is omitted (or is an `IncompleteAmount` that names
 * only a currency) is filled with the negated weight residual of the others,
 * then quantized the way beancount 2.3.5 interpolates: tolerance comes from
 * the other postings' exponents, `inferred_tolerance_multiplier` (default
 * 0.5), `inferred_tolerance_default`, and `infer_tolerance_from_cost`.
 *
 * Weight is the units, unless a cost or price converts them. `{per # total}`
 * is units × per + sign(units) × total. `{{t}}` and `@@ t` are sign(units) × t.
 * Cost wins over price. Several residual currencies expand the omitted posting
 * into one position per currency. A currency-only posting is filled only in
 * that currency; leftover currencies are an error. Two incomplete postings, a
 * number without a currency, or a cost/price that itself must be interpolated
 * are errors — the report shows those instead of a partial table.
 *
 * `pad A B` plus a later `balance` on A or a child inserts the difference
 * between the asserted amount and the subtree's units at the start of the
 * balance date. The insert is skipped when the difference is within the
 * balance tolerance (explicit `~ tol`, or twice the multiplier times the
 * balance number's last digit); that currency is still consumed. Only the
 * first balance per currency after a pad consumes it. A same-day balance
 * sorts before the pad, so it does not consume it. Directives are ordered by
 * date, then beancount's same-day order (open, balance, other, document,
 * close), then source line, then include order.
 *
 * The table sums units, not cost lots. Accounts whose units are all zero are
 * omitted. Each amount renders like Python's `str(Decimal)`, so the scale is
 * the sum's own exponent, not a currency-wide pad.
 */
import {
	Amount,
	Balance,
	BeancountParser,
	BeancountSyntaxError,
	Include,
	IncompleteAmount,
	Option,
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
	/**
	 * A newly created vault file may change the includes: a glob was used, or
	 * an include (or the entry itself) failed to resolve.
	 */
	watchCreates: boolean;
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
const MAX_TOLERANCE_DIGITS = 5;

const TWO = new Decimal(BigInt(2), 0);
const HALF = Decimal.fromLiteral('0.5') as Decimal;
const MAXIMUM_TOLERANCE = Decimal.fromLiteral('0.5') as Decimal;

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
	tolerance: Decimal;
}

type LedgerEvent = PostingEvent | PadEvent | BalanceEvent;

interface LedgerOptions {
	multiplier: Decimal;
	defaults: Map<string, Decimal>;
	useCost: boolean;
}

interface Tolerances {
	values: Map<string, Decimal>;
	fallback: Decimal;
}

interface ParsedLedger {
	text: string;
	directives: Directive[];
	errors: BalanceIssue[];
}

/** One entry per path, replaced when that file's text changes. */
const parsedByPath = new Map<string, ParsedLedger>();

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
	if (loaded.errors.length > 0) return { rows: [], errors: loaded.errors, files: loaded.files, watchCreates: loaded.watchCreates };
	const computed = compute(loaded.sources);
	return { rows: computed.rows, errors: computed.errors, files: loaded.files, watchCreates: loaded.watchCreates };
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
		// Parse once here; the compute walk reuses this result.
		const parsed = parseLedger(path, text);
		if (parsed.errors.length > 0) continue;
		for (const next of includePaths(parsed.directives, path, vault.vaultRoot, vault.vaultFiles)) queue.push(next);
	}
	if (readErrors.length > 0) return { rows: [], errors: readErrors, files: [...files.keys()], watchCreates: true };
	return accountBalances(entryPath, files, vault.vaultRoot, vault.vaultFiles);
}

function includePaths(
	directives: readonly Directive[],
	sourcePath: string,
	vaultRoot: string,
	vaultFiles: readonly string[],
): string[] {
	const paths: string[] = [];
	for (const directive of directives) {
		if (!(directive instanceof Include)) continue;
		const resolved = resolveIncludePath(directive.filename, sourcePath, vaultRoot, vaultFiles);
		if (resolved.kind === 'file') paths.push(resolved.vaultPath);
		else if (resolved.kind === 'glob') for (const match of resolved.matches) paths.push(match);
	}
	return paths;
}

function parseLedger(path: string, text: string): ParsedLedger {
	const hit = parsedByPath.get(path);
	if (hit && hit.text === text) return hit;
	const parsed: ParsedLedger = { text, directives: [], errors: [] };
	try {
		parsed.directives = BeancountParser.parse(text).directives;
	} catch (err) {
		if (err instanceof BeancountSyntaxError) {
			for (const item of err.errors) parsed.errors.push({ file: path, line: item.line, message: item.message });
		} else {
			parsed.errors.push({ file: path, line: 1, message: err instanceof Error ? err.message : 'Parse failed' });
		}
	}
	parsedByPath.set(path, parsed);
	return parsed;
}

function loadSources(
	entryPath: string,
	files: ReadonlyMap<string, string>,
	vaultRoot: string,
	vaultFiles: readonly string[],
): { sources: Sourced[]; errors: BalanceIssue[]; files: string[]; watchCreates: boolean } {
	const sources: Sourced[] = [];
	const errors: BalanceIssue[] = [];
	const visited: string[] = [];
	const seen = new Set<string>();
	const queue = [entryPath];
	let seq = 0;
	let watchCreates = false;
	while (queue.length > 0) {
		const path = queue.shift() as string;
		if (seen.has(path)) continue;
		seen.add(path);
		const text = files.get(path);
		if (text === undefined) {
			watchCreates = true;
			errors.push({
				file: path,
				line: 1,
				message: path === entryPath ? `Entry ledger not found: ${path}` : `Included file not found: ${path}`,
			});
			continue;
		}
		visited.push(path);
		const parsed = parseLedger(path, text);
		if (parsed.errors.length > 0) {
			for (const issue of parsed.errors) errors.push(issue);
			continue;
		}
		for (const directive of parsed.directives) {
			const line = directive.location?.start.line ?? 1;
			sources.push({ file: path, directive, line, seq });
			seq += 1;
			if (!(directive instanceof Include)) continue;
			const resolved = resolveIncludePath(directive.filename, path, vaultRoot, vaultFiles);
			if (resolved.kind === 'file') {
				queue.push(resolved.vaultPath);
			} else if (resolved.kind === 'glob') {
				watchCreates = true;
				if (resolved.matches.length === 0) {
					errors.push({ file: path, line, message: `No files match include "${directive.filename}"` });
				} else {
					for (const match of resolved.matches) queue.push(match);
				}
			} else if (resolved.kind === 'missing') {
				watchCreates = true;
				errors.push({ file: path, line, message: `Included file not found: ${directive.filename}` });
			} else {
				watchCreates = true;
				errors.push({ file: path, line, message: `Include is outside the vault: ${directive.filename}` });
			}
		}
	}
	return { sources, errors, files: visited, watchCreates };
}

function compute(sources: readonly Sourced[]): { rows: BalanceRow[]; errors: BalanceIssue[] } {
	const options = readOptions(sources);
	const events: LedgerEvent[] = [];
	const errors: BalanceIssue[] = [];
	for (const source of sources) {
		const directive = source.directive;
		if (directive instanceof Transaction) {
			const filled = interpolate(directive, options);
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
			const amount = decimalOf(directive.amount);
			events.push({
				kind: 'balance',
				account: directive.account,
				currency: directive.amount.currency,
				amount,
				tolerance: balanceTolerance(amount, explicitTolerance(directive), options.multiplier),
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
	return { rows: rowsOf(events), errors: [] };
}

function readOptions(sources: readonly Sourced[]): LedgerOptions {
	const options: LedgerOptions = { multiplier: HALF, defaults: new Map(), useCost: false };
	for (const source of sources) {
		const directive = source.directive;
		if (!(directive instanceof Option)) continue;
		if (directive.name === 'inferred_tolerance_multiplier') {
			const parsed = Decimal.fromLiteral(directive.value.trim());
			if (parsed) options.multiplier = parsed;
		} else if (directive.name === 'infer_tolerance_from_cost') {
			const lower = directive.value.trim().toLowerCase();
			options.useCost = lower === '1' || lower === 'true' || lower === 'yes';
		} else if (directive.name === 'inferred_tolerance_default') {
			const colon = directive.value.indexOf(':');
			if (colon <= 0) continue;
			const parsed = Decimal.fromLiteral(directive.value.slice(colon + 1).trim());
			if (parsed) options.defaults.set(directive.value.slice(0, colon), parsed);
		}
	}
	return options;
}

function interpolate(txn: Transaction, options: LedgerOptions): UnitLeg[] | string {
	const missing = txn.postings.filter((posting) => !(posting.amount instanceof Amount));
	if (missing.length > 1) return TOO_MANY;
	if (missing.length === 0) return unitLegs(txn.postings);
	const posting = missing[0];
	if (posting.cost || posting.priceAnnotation) return HAS_COST;
	const residual = new Map<string, Decimal>();
	for (const other of txn.postings) {
		if (other === posting) continue;
		const weight = postingWeight(other);
		if (typeof weight === 'string') return weight;
		addCurrency(residual, weight.currency, weight.units);
	}
	dropZeros(residual);
	const tolerances = inferTolerances(txn.postings, options);
	const known = unitLegs(txn.postings.filter((other) => other !== posting));
	if (posting.amount === undefined) {
		for (const currency of sortedKeys(residual)) {
			const units = residual.get(currency) as Decimal;
			const filled = quantizeWithTolerance(tolerances, currency, units.neg());
			if (filled.isZero()) continue;
			known.push({ account: posting.account, currency, units: filled });
		}
		return known;
	}
	// IncompleteAmount is exactly one of number or currency; both set is an Amount.
	if (posting.amount.currency === null || posting.amount.number !== null) return NUMBER_ONLY;
	const currency = posting.amount.currency;
	for (const other of residual.keys()) if (other !== currency) return OTHER_CURRENCIES;
	const have = residual.get(currency);
	if (have) {
		const filled = quantizeWithTolerance(tolerances, currency, have.neg());
		if (!filled.isZero()) known.push({ account: posting.account, currency, units: filled });
	}
	return known;
}

function unitLegs(postings: readonly Posting[]): UnitLeg[] {
	const legs: UnitLeg[] = [];
	for (const posting of postings) {
		// The omitted posting is removed before this call; every remaining amount is complete.
		if (!(posting.amount instanceof Amount)) continue;
		const units = decimalOf(posting.amount);
		if (units.isZero()) continue;
		legs.push({ account: posting.account, currency: posting.amount.currency, units });
	}
	return legs;
}

function postingWeight(posting: Posting): { currency: string; units: Decimal } | string {
	// The omitted posting is skipped by the caller; every other posting has an amount.
	if (!(posting.amount instanceof Amount)) return COST_INTERPOLATION;
	const units = decimalOf(posting.amount);
	if (posting.cost) {
		const weighted = costWeight(units, posting.cost);
		return weighted ?? COST_INTERPOLATION;
	}
	if (posting.priceAnnotation) return priceWeight(units, posting.priceAnnotation);
	return { currency: posting.amount.currency, units };
}

function costWeight(units: Decimal, cost: Cost): { currency: string; units: Decimal } | null {
	if (cost.amount instanceof IncompleteAmount || cost.total instanceof IncompleteAmount) return null;
	const per = cost.amount instanceof Amount ? cost.amount : null;
	const total = cost.total instanceof Amount ? cost.total : null;
	if (!per && !total) return null;
	if (per && total && per.currency !== total.currency) return null;
	const currency = per ? per.currency : total ? total.currency : '';
	if (!currency) return null;
	let weight = Decimal.zero();
	if (per) weight = weight.add(units.mul(decimalOf(per)));
	if (total) weight = weight.add(signed(units, decimalOf(total)));
	return { currency, units: weight };
}

function priceWeight(units: Decimal, price: PriceAnnotation): { currency: string; units: Decimal } | string {
	if (!(price.amount instanceof Amount)) return COST_INTERPOLATION;
	const number = decimalOf(price.amount);
	return { currency: price.amount.currency, units: price.isTotal ? signed(units, number) : units.mul(number) };
}

/** `sign(units) * total`, so `{{t}}` and `@@ t` keep the units' direction. */
function signed(units: Decimal, total: Decimal): Decimal {
	const sign = units.sign();
	if (sign < 0) return total.neg();
	if (sign > 0) return total;
	return Decimal.zero();
}

function inferTolerances(postings: readonly Posting[], options: LedgerOptions): Tolerances {
	const values = new Map(options.defaults);
	const fromCost = new Map<string, Decimal>();
	for (const posting of postings) {
		if (!(posting.amount instanceof Amount)) continue;
		const units = decimalOf(posting.amount);
		if (units.scale <= 0) continue;
		const tolerance = new Decimal(BigInt(1), units.scale).mul(options.multiplier);
		const prev = values.get(posting.amount.currency);
		values.set(posting.amount.currency, prev ? maxDecimal(tolerance, prev) : tolerance);
		if (!options.useCost) continue;
		noteCostTolerance(fromCost, tolerance, posting);
	}
	for (const [currency, extra] of fromCost) {
		const prev = values.get(currency);
		values.set(currency, prev ? maxDecimal(extra, prev) : extra);
	}
	const fallback = values.get('*') ?? Decimal.zero();
	values.delete('*');
	return { values, fallback };
}

function noteCostTolerance(into: Map<string, Decimal>, unitTolerance: Decimal, posting: Posting): void {
	if (posting.cost) {
		const per = posting.cost.amount instanceof Amount ? posting.cost.amount : null;
		const total = posting.cost.total instanceof Amount ? posting.cost.total : null;
		if (per || total) {
			const currency = per ? per.currency : total ? total.currency : '';
			if (currency) {
				let costTolerance = MAXIMUM_TOLERANCE;
				if (per) costTolerance = minDecimal(unitTolerance.mul(decimalOf(per)), costTolerance);
				if (total) costTolerance = minDecimal(unitTolerance.mul(decimalOf(total)), costTolerance);
				addCurrency(into, currency, costTolerance);
			}
		}
	}
	const price = posting.priceAnnotation?.amount;
	if (price instanceof Amount) {
		addCurrency(into, price.currency, minDecimal(unitTolerance.mul(decimalOf(price)), MAXIMUM_TOLERANCE));
	}
}

function quantizeWithTolerance(tolerances: Tolerances, currency: string, number: Decimal): Decimal {
	const tolerance = tolerances.values.get(currency) ?? tolerances.fallback;
	if (tolerance.isZero()) return number;
	const quantum = tolerance.mul(TWO).normalized();
	if (quantum.significantDigits() >= MAX_TOLERANCE_DIGITS) return number;
	return number.quantizeExponent(quantum.exponent());
}

function explicitTolerance(balance: Balance): Decimal | undefined {
	if (balance.tolerance === undefined) return undefined;
	if (balance.toleranceText !== undefined) {
		const parsed = Decimal.fromLiteral(balance.toleranceText);
		if (parsed) return parsed;
	}
	return Decimal.fromNumber(balance.tolerance) ?? Decimal.zero();
}

function balanceTolerance(amount: Decimal, explicit: Decimal | undefined, multiplier: Decimal): Decimal {
	if (explicit) return explicit;
	if (amount.scale <= 0) return Decimal.zero();
	return multiplier.mul(TWO).mul(new Decimal(BigInt(1), amount.scale));
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
			} else if (event.kind === 'balance' && isUnder(account, event.account) && active && !consumed.has(event.currency)) {
				consumed.add(event.currency);
				const have = running.get(event.currency) ?? Decimal.zero();
				const diff = event.amount.sub(have);
				if (!exceeds(diff, event.tolerance)) continue;
				synthetic.push(copyPosting(active, active.account, event.currency, diff));
				synthetic.push(copyPosting(active, active.source, event.currency, diff.neg()));
				addCurrency(running, event.currency, diff);
			}
		}
	}
	return synthetic;
}

function exceeds(diff: Decimal, tolerance: Decimal): boolean {
	const abs = diff.sign() < 0 ? diff.neg() : diff;
	return abs.compare(tolerance) > 0;
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

function rowsOf(events: readonly LedgerEvent[]): BalanceRow[] {
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
			amounts.push({ currency, text: units.render() });
		}
		rows.push({ account, amounts });
	}
	return rows;
}

function decimalOf(amount: Amount): Decimal {
	if (amount.numberText !== undefined) {
		const parsed = Decimal.fromLiteral(amount.numberText);
		if (parsed) return parsed;
	}
	return Decimal.fromNumber(amount.number) ?? Decimal.zero();
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

function maxDecimal(a: Decimal, b: Decimal): Decimal {
	return a.compare(b) >= 0 ? a : b;
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
	return a.compare(b) <= 0 ? a : b;
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
