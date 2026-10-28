/**
 * Which vault files the plugin treats as text: completion indexes them,
 * alignment rewrites their postings, and save-time work skips the rest.
 */
import type { TFile } from 'obsidian';

/** File extensions whose text is read: scanned for names, rewritten on align. */
export const TEXT_EXTENSIONS: Record<string, true> = { md: true, beancount: true, bean: true };

/** The shape `isTextFile` needs: a folder has no `extension`. */
interface VaultEntry {
	path: string;
	extension?: string;
}

/**
 * Whether a vault entry is one of the text files the plugin works in:
 * completion scans them for names, alignment rewrites their postings.
 */
export function isTextFile(file: VaultEntry): file is TFile {
	// `=== true`, not truthiness: inherited keys such as `constructor` or
	// `toString` resolve to functions on the prototype chain.
	return typeof file.extension === 'string' && TEXT_EXTENSIONS[file.extension] === true;
}
