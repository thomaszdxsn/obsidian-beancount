/**
 * Suggestion ranking shared by every vault string index: prefix matches
 * first, then case-insensitive subsequence matches, each group ordered by
 * frecency (pick count × recency) and finally by code-point order.
 *
 * Pick counts live in plugin `data.json` under `completionUsage`. Parsing
 * never throws: a missing, truncated, or nonsense bag is treated as empty
 * so a corrupt file cannot keep the plugin from loading.
 */

/** Most strings `match` returns — the suggestion popup window. */
export const MAX_SUGGESTIONS = 50;

const HOUR = 36e5;

/** Stored pick counts, keyed by the completed string. */
export interface UsageEntry {
	count: number;
	lastUsed: number;
}

/**
 * Recency buckets, heaviest first: 4h, 1d, 3d, 7d, 30d, older.
 * Unused strings score 0 and fall through to code-point order.
 */
function frecencyScore(count: number, lastUsed: number, now: number): number {
	if (count <= 0) return 0;
	const age = Math.max(0, now - lastUsed);
	const recency =
		age < 4 * HOUR
			? 100
			: age < 24 * HOUR
				? 80
				: age < 3 * 24 * HOUR
					? 60
					: age < 7 * 24 * HOUR
						? 40
						: age < 30 * 24 * HOUR
							? 20
							: 10;
	return count * recency;
}

function isSubsequence(hay: string, needle: string): boolean {
	let i = 0;
	for (let h = 0; h < hay.length && i < needle.length; h++) {
		if (hay[h] === needle[i]) i += 1;
	}
	return i === needle.length;
}

/** 0 = prefix, 1 = subsequence, 2 = no match. */
function matchQuality(value: string, needle: string): 0 | 1 | 2 {
	const hay = value.toLowerCase();
	if (hay.startsWith(needle)) return 0;
	if (needle.length > 0 && isSubsequence(hay, needle)) return 1;
	return 2;
}

/**
 * Per-vault pick history. `parse` reads `completionUsage` out of stored
 * plugin data; `remember` bumps a string and optionally persists.
 */
export class CompletionUsage {
	private readonly entries = new Map<string, UsageEntry>();

	constructor(
		private readonly clock: () => number = Date.now,
		private readonly onChange?: () => void
	) {}

	static parse(
		stored: unknown,
		clock: () => number = Date.now,
		onChange?: () => void
	): CompletionUsage {
		const usage = new CompletionUsage(clock, onChange);
		const bag = usageBag(stored);
		if (!bag) return usage;
		for (const [key, value] of Object.entries(bag)) {
			const entry = asUsageEntry(key, value);
			if (entry) usage.entries.set(key, entry);
		}
		return usage;
	}

	remember(value: string): void {
		if (value.length === 0) return;
		const prev = this.entries.get(value);
		this.entries.set(value, { count: (prev?.count ?? 0) + 1, lastUsed: this.clock() });
		this.onChange?.();
	}

	score(value: string, now: number = this.clock()): number {
		const entry = this.entries.get(value);
		if (!entry) return 0;
		return frecencyScore(entry.count, entry.lastUsed, now);
	}

	toJSON(): Record<string, UsageEntry> {
		const out: Record<string, UsageEntry> = {};
		for (const [key, entry] of this.entries) out[key] = { ...entry };
		return out;
	}
}

/** Prefix hits first, then subsequence hits; frecency, then code-point order. */
export function rankCompletions(
	values: readonly string[],
	query: string,
	usage?: CompletionUsage
): string[] {
	const needle = query.toLowerCase();
	const scored: Array<{ value: string; quality: 0 | 1; score: number }> = [];
	for (const value of values) {
		const quality = matchQuality(value, needle);
		if (quality === 2) continue;
		scored.push({ value, quality, score: usage?.score(value) ?? 0 });
	}
	scored.sort((a, b) => {
		if (a.quality !== b.quality) return a.quality - b.quality;
		if (a.score !== b.score) return b.score - a.score;
		return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
	});
	return scored.slice(0, MAX_SUGGESTIONS).map((row) => row.value);
}

function usageBag(stored: unknown): Record<string, unknown> | null {
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
	if (!('completionUsage' in stored)) return null;
	const bag = stored.completionUsage;
	if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return null;
	return bag as Record<string, unknown>;
}

function asUsageEntry(key: string, value: unknown): UsageEntry | null {
	if (key.length === 0) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	if (!('count' in value) || !('lastUsed' in value)) return null;
	const count = value.count;
	const lastUsed = value.lastUsed;
	if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null;
	if (typeof lastUsed !== 'number' || !Number.isFinite(lastUsed)) return null;
	return { count, lastUsed };
}
