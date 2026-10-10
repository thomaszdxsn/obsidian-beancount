/**
 * Pinyin initial form of a completion candidate.
 *
 * Mapped characters become the single initial the table assigns (polyphonic
 * characters are not expanded; a character listed twice keeps the later
 * letter). Everything else is kept and lowercased, so ASCII, digits and
 * punctuation survive: `Expenses:餐饮` → `expenses:cy`. The character map is
 * built once, on the first conversion.
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

/** Initials of `value`: mapped characters become letters, the rest stay lowercased. */
export function pinyinInitials(value: string): string {
	const table = charInitials();
	let out = '';
	for (const ch of value) {
		out += table.get(ch) ?? ch.toLowerCase();
	}
	return out;
}
