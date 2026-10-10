/**
 * Pinyin initial form of a completion candidate.
 *
 * Mapped characters become the single initial the table assigns (polyphonic
 * characters are not expanded; a character listed twice keeps the later
 * letter). Everything else is kept and lowercased, so ASCII, digits and
 * punctuation survive: `Expenses:餐饮` → `expenses:cy`. The character map is
 * built once, on the first conversion.
 *
 * Conversions are memoized per exact `value`. The cache holds at most
 * `PINYIN_INITIALS_CACHE_CAP` entries; the next new value clears it and
 * starts over, so a long-lived session cannot grow the map without bound.
 * A cleared value converts the same way on the next call.
 */
import { PINYIN_BY_INITIAL } from './pinyin-data';

let byChar: Map<string, string> | null = null;

/** Character → initial. Later table letters win if a character is listed twice. */
function charInitials(): Map<string, string> {
	if (byChar) return byChar;
	const map = new Map<string, string>();
	for (const letter of Object.keys(PINYIN_BY_INITIAL)) {
		for (const ch of PINYIN_BY_INITIAL[letter]) map.set(ch, letter);
	}
	byChar = map;
	return map;
}

/**
 * Characters the initials table can rewrite: CJK Unified Ideographs only
 * (U+4E00–U+9FFF). Every other character is kept and lowercased, so a value
 * that does not match has initials equal to a per-character lowercasing —
 * for ASCII, exactly `value.toLowerCase()`. Pinyin match tiers cannot add a
 * hit for those values.
 */
export const PINYIN_TABLE_HAN = /[\u4E00-\u9FFF]/;

/** Cap on memoized initials. A vault that exceeds it starts a fresh cache. */
export const PINYIN_INITIALS_CACHE_CAP = 50_000;

const initialsCache = new Map<string, string>();

/** Initials of `value`: mapped characters become letters, the rest stay lowercased. */
export function pinyinInitials(value: string): string {
	const cached = initialsCache.get(value);
	if (cached !== undefined) return cached;
	const table = charInitials();
	let out = '';
	for (const ch of value) {
		out += table.get(ch) ?? ch.toLowerCase();
	}
	if (initialsCache.size >= PINYIN_INITIALS_CACHE_CAP) initialsCache.clear();
	initialsCache.set(value, out);
	return out;
}
