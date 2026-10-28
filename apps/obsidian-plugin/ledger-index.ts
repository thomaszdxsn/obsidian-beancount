/**
 * Vault-wide ledger facts: one read, one scan per Ledger region, one
 * FileFacts map. Completions, hover, payee templates and quick-fix history
 * all query this index. Rename and delete re-key a single map.
 */
import type { Plugin, TAbstractFile } from 'obsidian';
import { isAccountClosed } from './account-index';
import type { AccountRecord } from './account-index';
import type { Pairing } from './code-actions';
import { rankCompletions } from './completion-rank';
import type { CompletionUsage } from './completion-rank';
import { ledgerDoc, ledgerKind, ledgerKindFromPath } from './fences';
import type { LedgerRegion } from './fences';
import type { PayeeTemplate, TemplatePosting } from './payee-template';
import {
	ACCOUNT_SEGMENT_CHARS,
	ACCOUNT_SHAPE,
	headerPayee,
	parseHeaderLine,
	scanLedger,
	skipSpace,
	stripComment,
} from './scan';
import type { ScannedEntry, ScannedHeader, ScannedPosting } from './scan';
import type { CompletionIndex } from './suggest';
import { isTextFile } from './vault-index';

/** Longest cached string; longer ones are noise, not names. */
const MAX_VALUE_LENGTH = 256;

const ACCOUNT_RE = new RegExp(`(?<![${ACCOUNT_SEGMENT_CHARS}:/])${ACCOUNT_SHAPE}`, 'gu');
const ACCOUNT_AT_START = new RegExp(`^${ACCOUNT_SHAPE}`, 'u');
const COMMODITY_TOKEN = "[A-Z][A-Z0-9._'-]{0,22}[A-Z0-9]";
const AMOUNT_RE = new RegExp(`[0-9][ \\t]+(${COMMODITY_TOKEN})(?![A-Z0-9])`, 'g');
const COMMODITY_NAME_RE = new RegExp(`^(${COMMODITY_TOKEN})(?![A-Z0-9])`);
const OPEN_CURRENCY_RE = /^[A-Z][A-Z0-9._'-]*$/;
const TAG_RE = /(?:^|[ \t])#([A-Za-z0-9\-_/.]+)/g;
const LINK_RE = /(?:^|[ \t])\^([A-Za-z0-9\-_/.]+)/g;

interface FileDirective {
	kind: 'open' | 'close';
	account: string;
	date: string;
	currencies: readonly string[];
}

interface FileFacts {
	accounts: ReadonlySet<string>;
	directives: readonly FileDirective[];
	payees: ReadonlySet<string>;
	narrations: ReadonlySet<string>;
	commodities: ReadonlySet<string>;
	tags: ReadonlySet<string>;
	links: ReadonlySet<string>;
	pairings: readonly Pairing[];
	templates: ReadonlyMap<string, PayeeTemplate>;
	openCount: number;
}

export type AccountQuery = CompletionIndex & {
	record(name: string): AccountRecord | undefined;
	has(name: string): boolean;
};

export class LedgerIndex {
	private readonly factsByPath = new Map<string, FileFacts>();
	private sortedAccounts: readonly string[] | null = null;
	private sortedPayees: readonly string[] | null = null;
	private sortedCommodities: readonly string[] | null = null;
	private sortedTags: readonly string[] | null = null;
	private sortedLinks: readonly string[] | null = null;
	private sortedNarrations: readonly string[] | null = null;
	private mergedLifecycle: ReadonlyMap<string, AccountRecord> | null = null;
	private mergedPairings: readonly Pairing[] | null = null;
	private mergedTemplates: ReadonlyMap<string, PayeeTemplate> | null = null;

	readonly accounts: AccountQuery;
	readonly payees: CompletionIndex;
	readonly commodities: CompletionIndex;
	readonly tags: CompletionIndex;
	readonly links: CompletionIndex;
	readonly narrations: CompletionIndex;

	constructor(
		private readonly usage?: CompletionUsage,
		private readonly pinyin?: () => boolean
	) {
		this.accounts = {
			match: (query) => {
				const lifecycle = this.lifecycle();
				const open: string[] = [];
				for (const name of this.accountValues()) {
					if (isAccountClosed(lifecycle.get(name))) continue;
					open.push(name);
				}
				return rankCompletions(open, query, this.usage, this.pinyinOn());
			},
			remember: (value) => this.usage?.remember(value),
			record: (name) => this.lifecycle().get(name),
			has: (name) => this.accountValues().includes(name),
		};
		this.payees = this.stringIndex(() => this.payeeValues());
		this.commodities = this.stringIndex(() => this.commodityValues());
		this.tags = this.stringIndex(() => this.tagValues());
		this.links = this.stringIndex(() => this.linkValues());
		this.narrations = this.stringIndex(() => this.narrationValues());
	}

	applyVault(plugin: Plugin): void {
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
					this.setFile(path, content);
					revisions.delete(path);
				})
				.catch(() => undefined);
		};

		for (const file of vault.getFiles()) refresh(file);

		plugin.registerEvent(vault.on('create', refresh));
		plugin.registerEvent(vault.on('modify', refresh));
		plugin.registerEvent(
			vault.on('delete', (file) => {
				revisions.delete(file.path);
				this.removeFile(file.path);
			})
		);
		plugin.registerEvent(
			vault.on('rename', (file, oldPath) => {
				const oldPrefix = oldPath + '/';
				const dropped: string[] = [];
				if (revisions.delete(oldPath)) dropped.push(file.path);
				for (const path of [...revisions.keys()]) {
					if (!path.startsWith(oldPrefix)) continue;
					revisions.delete(path);
					dropped.push(file.path + path.slice(oldPath.length));
				}
				const moved = this.renameFile(oldPath, file.path);
				if (isTextFile(file)) {
					const kindChanged = ledgerKindFromPath(oldPath) !== ledgerKind(file);
					if (dropped.length > 0 || !moved || kindChanged) refresh(file);
				} else {
					this.removeFile(file.path);
					if (dropped.length > 0) {
						const filesByPath = new Map(vault.getFiles().map((entry) => [entry.path, entry]));
						for (const path of dropped) {
							const child = filesByPath.get(path);
							if (child) refresh(child);
						}
					}
				}
			})
		);
	}

	setFile(path: string, rawText: string): void {
		const facts = factsFromFile(path, rawText);
		if (isEmptyFacts(facts)) this.factsByPath.delete(path);
		else this.factsByPath.set(path, facts);
		this.invalidate();
	}

	removeFile(path: string): void {
		if (this.factsByPath.delete(path)) this.invalidate();
	}

	renameFile(oldPath: string, newPath: string): boolean {
		const oldPrefix = oldPath + '/';
		let moved = false;
		for (const [path, facts] of [...this.factsByPath]) {
			if (path !== oldPath && !path.startsWith(oldPrefix)) continue;
			this.factsByPath.delete(path);
			const dest = newPath + path.slice(oldPath.length);
			this.factsByPath.set(dest, rewriteTemplatePaths(facts, dest));
			moved = true;
		}
		if (moved) this.invalidate();
		return moved;
	}

	templateFor(payee: string): PayeeTemplate | null {
		return this.templates().get(payee) ?? null;
	}

	pairings(): readonly Pairing[] {
		if (this.mergedPairings === null) {
			const merged: Pairing[] = [];
			for (const facts of this.factsByPath.values()) merged.push(...facts.pairings);
			this.mergedPairings = merged;
		}
		return this.mergedPairings;
	}

	bestOpenFile(): string | null {
		let best: string | null = null;
		let bestCount = 0;
		let bestLedger = false;
		for (const [path, facts] of this.factsByPath) {
			const count = facts.openCount;
			if (count === 0) continue;
			const ledger = ledgerKindFromPath(path) === 'ledger-file';
			if (best === null || (ledger && !bestLedger) || (ledger === bestLedger && count > bestCount)) {
				best = path;
				bestCount = count;
				bestLedger = ledger;
			}
		}
		return best;
	}

	openedIn(path: string): ReadonlySet<string> {
		const facts = this.factsByPath.get(path);
		if (!facts) return new Set();
		const opened = new Set<string>();
		for (const directive of facts.directives) {
			if (directive.kind === 'open') opened.add(directive.account);
		}
		return opened;
	}

	private stringIndex(values: () => readonly string[]): CompletionIndex {
		return {
			match: (query) => rankCompletions(values(), query, this.usage, this.pinyinOn()),
			remember: (value) => this.usage?.remember(value),
		};
	}

	private pinyinOn(): boolean {
		return this.pinyin?.() ?? false;
	}

	private invalidate(): void {
		this.sortedAccounts = null;
		this.sortedPayees = null;
		this.sortedCommodities = null;
		this.sortedTags = null;
		this.sortedLinks = null;
		this.sortedNarrations = null;
		this.mergedLifecycle = null;
		this.mergedPairings = null;
		this.mergedTemplates = null;
	}

	private accountValues(): readonly string[] {
		if (!this.sortedAccounts) this.sortedAccounts = unionSorted(this.factsByPath, (facts) => facts.accounts);
		return this.sortedAccounts;
	}

	private payeeValues(): readonly string[] {
		if (!this.sortedPayees) this.sortedPayees = unionSorted(this.factsByPath, (facts) => facts.payees);
		return this.sortedPayees;
	}

	private commodityValues(): readonly string[] {
		if (!this.sortedCommodities) {
			this.sortedCommodities = unionSorted(this.factsByPath, (facts) => facts.commodities);
		}
		return this.sortedCommodities;
	}

	private tagValues(): readonly string[] {
		if (!this.sortedTags) this.sortedTags = unionSorted(this.factsByPath, (facts) => facts.tags);
		return this.sortedTags;
	}

	private linkValues(): readonly string[] {
		if (!this.sortedLinks) this.sortedLinks = unionSorted(this.factsByPath, (facts) => facts.links);
		return this.sortedLinks;
	}

	private narrationValues(): readonly string[] {
		if (!this.sortedNarrations) {
			this.sortedNarrations = unionSorted(this.factsByPath, (facts) => facts.narrations);
		}
		return this.sortedNarrations;
	}

	private lifecycle(): ReadonlyMap<string, AccountRecord> {
		if (!this.mergedLifecycle) this.mergedLifecycle = mergeDirectives(this.factsByPath);
		return this.mergedLifecycle;
	}

	private templates(): ReadonlyMap<string, PayeeTemplate> {
		if (this.mergedTemplates === null) {
			const merged = new Map<string, PayeeTemplate>();
			for (const facts of this.factsByPath.values()) {
				for (const [payee, template] of facts.templates) {
					const prev = merged.get(payee);
					if (prev === undefined || isNewer(template, prev)) merged.set(payee, template);
				}
			}
			this.mergedTemplates = merged;
		}
		return this.mergedTemplates;
	}
}

function factsFromFile(path: string, rawText: string): FileFacts {
	const kind = ledgerKindFromPath(path);
	const doc = ledgerDoc(kind, rawText);
	const accounts = new Set<string>();
	const payees = new Set<string>();
	const narrations = new Set<string>();
	const commodities = new Set<string>();
	const tags = new Set<string>();
	const links = new Set<string>();
	const pairings: Pairing[] = [];
	const templates = new Map<string, PayeeTemplate>();
	const byAccount = new Map<string, AccountRecord>();
	const opened = new Set<string>();

	for (const region of doc.regions) {
		collectFromRegion(region, path, {
			accounts,
			payees,
			narrations,
			commodities,
			tags,
			links,
			pairings,
			templates,
			byAccount,
			opened,
		});
	}

	const directives: FileDirective[] = [];
	for (const [account, record] of byAccount) {
		if (record.open !== undefined) {
			directives.push({ kind: 'open', account, date: record.open, currencies: record.currencies });
		}
		if (record.close !== undefined) {
			directives.push({ kind: 'close', account, date: record.close, currencies: [] });
		}
	}

	return {
		accounts,
		directives,
		payees,
		narrations,
		commodities,
		tags,
		links,
		pairings,
		templates,
		openCount: opened.size,
	};
}

interface RegionSink {
	accounts: Set<string>;
	payees: Set<string>;
	narrations: Set<string>;
	commodities: Set<string>;
	tags: Set<string>;
	links: Set<string>;
	pairings: Pairing[];
	templates: Map<string, PayeeTemplate>;
	byAccount: Map<string, AccountRecord>;
	opened: Set<string>;
}

function collectFromRegion(region: LedgerRegion, path: string, sink: RegionSink): void {
	const text = region.lines.length === 0 ? '' : region.lines.join('\n');
	collectAccounts(text, sink.accounts);
	collectTagsAndLinks(text, sink.tags, sink.links);
	const scan = text === '' ? { lines: [], entries: [] as const } : scanLedger(text);
	for (let i = 0; i < region.lines.length; i += 1) {
		collectCommoditiesFromLine(region.lines[i] ?? '', sink.commodities);
	}
	for (const entry of scan.entries) {
		collectEntry(region, path, entry, sink);
	}
}

function collectEntry(region: LedgerRegion, path: string, entry: ScannedEntry, sink: RegionSink): void {
	const headerLine = region.lines[entry.startLine] ?? '';
	const header = entry.header ?? parseHeaderLine(headerLine);
	if (header === undefined || header === null) return;
	if (header.kind === 'txn-header') {
		const payee = headerPayee(headerLine, header);
		if (payee !== undefined) addValue(sink.payees, payee);
		const narration = headerNarration(headerLine, header);
		if (narration !== undefined) addValue(sink.narrations, narration);
		const located = locatePostings(region.lines, entry);
		const pairing = pairingFromPostings(located, header, headerLine);
		if (pairing !== null) sink.pairings.push(pairing);
		if (payee !== undefined) {
			const postings = templateFromLocated(located);
			if (postings.length > 0) {
				const template: PayeeTemplate = {
					date: header.date.replace(/\//g, '-'),
					path,
					line: region.hostStartLine + entry.startLine,
					postings,
				};
				const prev = sink.templates.get(payee);
				if (prev === undefined || isNewer(template, prev)) sink.templates.set(payee, template);
			}
		}
		return;
	}
	if (header.keyword !== 'open' && header.keyword !== 'close') return;
	const account = directiveAccount(headerLine, header);
	if (account === null) return;
	const date = header.date.replace(/\//g, '-');
	const current = sink.byAccount.get(account) ?? { currencies: [] };
	if (header.keyword === 'open') {
		sink.opened.add(account);
		if (current.open === undefined || date >= current.open) {
			sink.byAccount.set(account, {
				...current,
				open: date,
				currencies: parseCurrencies(headerLine.slice(accountEndOnDirective(headerLine, header))),
			});
		}
	} else if (current.close === undefined || date >= current.close) {
		sink.byAccount.set(account, { ...current, close: date });
	}
}

function locatePostings(lines: readonly string[], entry: ScannedEntry): Array<{ line: string; posting: ScannedPosting }> {
	const located: Array<{ line: string; posting: ScannedPosting }> = [];
	let p = 0;
	for (let i = entry.startLine; i <= entry.endLine && p < entry.postings.length; i += 1) {
		const line = lines[i] ?? '';
		const posting = entry.postings[p];
		if (line.slice(posting.account.span.from, posting.account.span.to) !== posting.account.text) continue;
		located.push({ line, posting });
		p += 1;
	}
	return located;
}

function pairingFromPostings(
	located: ReadonlyArray<{ line: string; posting: ScannedPosting }>,
	header: ScannedHeader,
	headerLine: string
): Pairing | null {
	if (located.length !== 2) return null;
	const postings: Array<{ account: string; commodity?: string }> = [];
	for (const { line, posting } of located) {
		if (posting.number === undefined) return null;
		postings.push({
			account: posting.account.text,
			commodity: posting.commodity ? line.slice(posting.commodity.from, posting.commodity.to) : undefined,
		});
	}
	const [first, second] = postings;
	if (first.account === second.account) return null;
	if (first.commodity === undefined || first.commodity !== second.commodity) return null;
	return {
		date: header.date.replace(/\//g, '-'),
		payee: headerPayee(headerLine, header),
		accounts: [first.account, second.account],
	};
}

function templateFromLocated(located: ReadonlyArray<{ line: string; posting: ScannedPosting }>): TemplatePosting[] {
	const postings: TemplatePosting[] = [];
	for (const { line, posting } of located) {
		const amount = stripComment(line.slice(posting.gapStart)).trim();
		const row: TemplatePosting = {
			leadingFlag: posting.leadingFlag ?? '',
			account: posting.account.text,
			trailingFlag: posting.trailingFlag ?? '',
		};
		if (amount !== '') row.amount = amount;
		postings.push(row);
	}
	return postings;
}

function directiveAccount(line: string, header: ScannedHeader): string | null {
	const after = skipSpace(line, header.keywordSpan?.to ?? 0);
	const match = ACCOUNT_AT_START.exec(line.slice(after));
	return match === null ? null : match[0];
}

function accountEndOnDirective(line: string, header: ScannedHeader): number {
	const after = skipSpace(line, header.keywordSpan?.to ?? 0);
	const name = directiveAccount(line, header);
	return name === null ? after : after + name.length;
}

function headerNarration(line: string, header: ScannedHeader): string | undefined {
	if (header.narration === undefined || header.narration.from >= header.narration.to) return undefined;
	return line.slice(header.narration.from, header.narration.to);
}

function collectAccounts(content: string, into: Set<string>): void {
	const seenRuns = new Set<string>();
	let pos = 0;
	for (;;) {
		const colon = content.indexOf(':', pos);
		if (colon === -1) break;
		let from = colon;
		for (let c = content.charCodeAt(from - 1); from > pos && c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d; ) {
			from -= 1;
			c = content.charCodeAt(from - 1);
		}
		let to = colon + 1;
		for (let c = content.charCodeAt(to); to < content.length && c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d; ) {
			to += 1;
			c = content.charCodeAt(to);
		}
		const run = content.slice(from, to);
		if (!seenRuns.has(run)) {
			seenRuns.add(run);
			for (const match of run.matchAll(ACCOUNT_RE)) addValue(into, match[0]);
		}
		pos = to;
	}
}

function collectTagsAndLinks(content: string, tags: Set<string>, links: Set<string>): void {
	TAG_RE.lastIndex = 0;
	for (let match = TAG_RE.exec(content); match !== null; match = TAG_RE.exec(content)) {
		addValue(tags, `#${match[1]}`);
	}
	LINK_RE.lastIndex = 0;
	for (let match = LINK_RE.exec(content); match !== null; match = LINK_RE.exec(content)) {
		addValue(links, `^${match[1]}`);
	}
}

function collectCommoditiesFromLine(line: string, into: Set<string>): void {
	const first = line.charCodeAt(0);
	const indented = first === 0x20 || first === 0x09;
	const header = !indented ? parseHeaderLine(line) : null;
	if (indented) {
		addAmounts(line, into);
		return;
	}
	if (header?.kind !== 'directive') return;
	if (header.keyword === 'commodity') {
		const rest = line.slice(skipSpace(line, header.keywordSpan?.to ?? 0));
		const match = COMMODITY_NAME_RE.exec(rest);
		if (match !== null) addValue(into, match[1]);
		return;
	}
	if (header.keyword === 'price' || header.keyword === 'balance') {
		if (header.keyword === 'price') {
			const rest = line.slice(skipSpace(line, header.keywordSpan?.to ?? 0));
			const match = COMMODITY_NAME_RE.exec(rest);
			if (match !== null) addValue(into, match[1]);
		}
		addAmounts(line, into);
	}
}

function addAmounts(line: string, into: Set<string>): void {
	const text = stripComment(line);
	AMOUNT_RE.lastIndex = 0;
	for (let match = AMOUNT_RE.exec(text); match !== null; match = AMOUNT_RE.exec(text)) {
		addValue(into, match[1]);
	}
}

function parseCurrencies(rest: string): string[] {
	const body = rest.split(';')[0].replace(/"[^"]*"/g, ' ');
	const currencies: string[] = [];
	for (const token of body.split(/[\s,]+/)) {
		if (OPEN_CURRENCY_RE.test(token)) currencies.push(token);
	}
	return currencies;
}

function addValue(into: Set<string>, value: string): void {
	if (value.length > 0 && value.length <= MAX_VALUE_LENGTH) into.add(value);
}

function isEmptyFacts(facts: FileFacts): boolean {
	return (
		facts.accounts.size === 0 &&
		facts.directives.length === 0 &&
		facts.payees.size === 0 &&
		facts.narrations.size === 0 &&
		facts.commodities.size === 0 &&
		facts.tags.size === 0 &&
		facts.links.size === 0 &&
		facts.pairings.length === 0 &&
		facts.templates.size === 0 &&
		facts.openCount === 0
	);
}

function rewriteTemplatePaths(facts: FileFacts, dest: string): FileFacts {
	if (facts.templates.size === 0) return facts;
	const templates = new Map<string, PayeeTemplate>();
	for (const [payee, template] of facts.templates) {
		templates.set(payee, { ...template, path: dest });
	}
	return { ...facts, templates };
}

function isNewer(candidate: PayeeTemplate, incumbent: PayeeTemplate): boolean {
	if (candidate.date !== incumbent.date) return candidate.date > incumbent.date;
	if (candidate.path !== incumbent.path) return candidate.path > incumbent.path;
	return candidate.line > incumbent.line;
}

function unionSorted(
	byPath: ReadonlyMap<string, FileFacts>,
	pick: (facts: FileFacts) => ReadonlySet<string>
): readonly string[] {
	const union = new Set<string>();
	for (const facts of byPath.values()) {
		for (const value of pick(facts)) union.add(value);
	}
	return [...union].sort();
}

function mergeDirectives(byPath: ReadonlyMap<string, FileFacts>): ReadonlyMap<string, AccountRecord> {
	const merged = new Map<string, AccountRecord>();
	const files = [...byPath.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1));
	for (const [, facts] of files) {
		for (const directive of facts.directives) {
			const current = merged.get(directive.account) ?? { currencies: [] };
			const next: AccountRecord = { ...current };
			if (directive.kind === 'open') {
				if (current.open === undefined || directive.date >= current.open) {
					next.open = directive.date;
					next.currencies = directive.currencies;
				}
			} else if (current.close === undefined || directive.date >= current.close) {
				next.close = directive.date;
			}
			merged.set(directive.account, next);
		}
	}
	return merged;
}
