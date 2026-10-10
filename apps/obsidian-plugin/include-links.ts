/**
 * Clickable `include` paths: the quoted filename of an `include` directive
 * is a link, the way vscode-beancount's documentLinkProvider treats it.
 *
 * The mark is editor-only (reading view is out of scope) and only inside
 * ledger text — a `.bean`/`.beancount` file, or a ```beancount / ```bean
 * fence. Mod-click (Cmd on macOS, Ctrl elsewhere, plus Alt / Shift for
 * Obsidian's split and window panes) opens the target. A plain click still
 * places the caret.
 *
 * Resolution is relative to the including file's folder. A fence has no
 * ledger directory of its own, so the note's folder is the base. `./` and
 * `../` collapse; a relative path that leaves the vault is not opened.
 * Backslashes are directory separators, so a Windows include maps the same
 * way. An absolute path opens only when it lies under
 * `FileSystemAdapter.getBasePath()`; anything outside the vault is refused
 * rather than handed to the OS. A glob (`2024/*.bean`) opens the
 * lexicographically first vault match and, when more than one file matches,
 * a notice states the count. A target the vault does not have shows
 * `Included file not found: …`.
 */
import type { Extension } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { Notice, editorInfoField } from 'obsidian';
import type { App, PaneType } from 'obsidian';
import { extractBeancountFences } from './fences';
import { isLedgerFile } from './vault-index';

/** The CSS contract with `styles.css`: link color, underline on hover. */
export const INCLUDE_LINK_CLASS = 'beancount-include-link';

/** The quoted path of one `include` directive, in line-local offsets. */
export interface IncludeLinkSpan {
	/** Offset of the opening quote. */
	from: number;
	/** Exclusive offset just after the closing quote. */
	to: number;
	/**
	 * Path inside the quotes. `\\` and `\"` are unescaped; other backslashes
	 * stay, so a Windows path written with either one or two slashes still
	 * resolves.
	 */
	path: string;
}

/**
 * The `include "..."` directive on `line`, or null.
 *
 * Anchored at the start (optional indent) so a metadata key (`include:`)
 * and an `include` mentioned in a comment, a narration, or another
 * directive do not match. The range covers both quotes; a `;` comment
 * after the string is not part of it. An unclosed or empty string is not
 * a link — there is nothing to open.
 */
export function includeLinkSpan(line: string): IncludeLinkSpan | null {
	const head = /^[ \t]*include(?![A-Za-z0-9_])[ \t]+/.exec(line);
	if (!head) return null;
	let i = head[0].length;
	if (line[i] !== '"') return null;
	const from = i;
	i += 1;
	let path = '';
	while (i < line.length) {
		const ch = line[i];
		if (ch === '\\' && i + 1 < line.length) {
			const next = line[i + 1];
			if (next === '\\' || next === '"') {
				path += next;
				i += 2;
				continue;
			}
			// A lone backslash is a separator, not an escape. Keep it and
			// let the next character through on the following iteration.
			path += ch;
			i += 1;
			continue;
		}
		if (ch === '"') {
			if (path.length === 0) return null;
			return { from, to: i + 1, path };
		}
		if (ch === '\r') return null;
		path += ch;
		i += 1;
	}
	return null;
}

/** Where an include path points, after vault mapping. */
export type IncludeResolution =
	| { kind: 'file'; vaultPath: string }
	| { kind: 'glob'; matches: readonly string[] }
	| { kind: 'missing'; vaultPath: string }
	| { kind: 'outside' };

/**
 * Map `includePath` (as `includeLinkSpan` returns it) onto a vault path.
 *
 * `sourcePath` is the vault path of the file being edited — the note, for
 * a fence. `vaultRoot` is the adapter base path, slashes either way.
 * `vaultFiles` are the vault paths a glob or a missing check consults;
 * comparison is exact, so a same-named file in another folder does not
 * match. Glob metacharacters (`*`, `?`, `[`) never cross `/`, matching
 * beancount's non-recursive `glob.glob`, and a leading `.` in a segment
 * is matched only by a pattern that asks for it. Matches are sorted
 * lexicographically: that order is the order beancount includes them, so
 * "first" is stable.
 */
export function resolveIncludePath(
	includePath: string,
	sourcePath: string,
	vaultRoot: string,
	vaultFiles: readonly string[]
): IncludeResolution {
	const normalized = includePath.replace(/\\/g, '/');
	const absolute = splitAbsolute(normalized);
	const collapsed = absolute
		? collapse(absolute.parts, true)
		: collapse(dirname(sourcePath).concat(normalized.split('/')), false);
	if (collapsed === null) return { kind: 'outside' };

	let vaultPath: string;
	if (absolute) {
		const abs = absolute.prefix + collapsed.join('/');
		const rel = underVaultRoot(abs, vaultRoot);
		if (rel === null) return { kind: 'outside' };
		vaultPath = rel;
	} else {
		vaultPath = collapsed.join('/');
	}

	if (/[*?\[]/.test(vaultPath)) {
		const matches = vaultFiles.filter((file) => globMatch(vaultPath, file));
		matches.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		return { kind: 'glob', matches };
	}
	if (vaultFiles.indexOf(vaultPath) === -1) return { kind: 'missing', vaultPath };
	return { kind: 'file', vaultPath };
}

/** Notice shown when the vault has no file for the include. */
export function missingIncludeNotice(includePath: string): string {
	return `Included file not found: ${includePath}`;
}

/** Notice stating how many vault files a glob matched. */
export function globCountNotice(includePath: string, count: number): string {
	return `${count} files match ${includePath}`;
}

/**
 * Open the include, or notice why it cannot be opened.
 *
 * A glob with matches opens the first and, when the count is more than
 * one, also notices that count. Zero matches, a missing file, and a path
 * outside the vault all use the same not-found notice — none of them is a
 * vault file to open.
 */
export function openIncludedFile(app: App, sourcePath: string, includePath: string, pane: PaneType): void {
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	const root = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
	const files = app.vault.getFiles();
	const resolved = resolveIncludePath(
		includePath,
		sourcePath,
		root,
		files.map((file) => file.path)
	);
	if (resolved.kind === 'file') {
		void openVaultFile(app, files, resolved.vaultPath, includePath, pane);
		return;
	}
	if (resolved.kind === 'glob' && resolved.matches.length > 0) {
		void openVaultFile(app, files, resolved.matches[0], includePath, pane);
		if (resolved.matches.length > 1) new Notice(globCountNotice(includePath, resolved.matches.length));
		return;
	}
	new Notice(missingIncludeNotice(includePath));
}

function openVaultFile(
	app: App,
	files: readonly { path: string }[],
	vaultPath: string,
	includePath: string,
	pane: PaneType
): Promise<void> {
	const file = files.find((entry) => entry.path === vaultPath);
	if (!file) {
		new Notice(missingIncludeNotice(includePath));
		return Promise.resolve();
	}
	try {
		return app.workspace
			.getLeaf(pane)
			.openFile(file as never)
			.catch(() => {
				new Notice(missingIncludeNotice(includePath));
			});
	} catch {
		new Notice(missingIncludeNotice(includePath));
		return Promise.resolve();
	}
}

/** Obsidian's editor-info field; tests and the live view put `{ file }` on it. */
interface EditorFileInfo {
	file?: { path: string; extension: string } | null;
}

function editorFile(state: EditorView['state']): EditorFileInfo['file'] {
	const info = state.field(editorInfoField, false) as EditorFileInfo | undefined;
	return info?.file;
}

function editorFileKey(state: EditorView['state']): string {
	const file = editorFile(state);
	return file ? `${file.path}\0${file.extension}` : '';
}

/**
 * 0-based lines that are ledger text. A ledger file is entirely ledger; a
 * markdown note contributes only fence bodies. Anything else (and a note
 * with no fence) has no include links. `null` means every line.
 */
function ledgerLines(
	text: string,
	file: { path: string; extension: string } | null | undefined
): Set<number> | null | 'none' {
	if (!file) return 'none';
	if (isLedgerFile(file)) return null;
	if (file.extension !== 'md') return 'none';
	const fences = extractBeancountFences(text);
	if (fences.length === 0) return 'none';
	const lines = new Set<number>();
	for (const fence of fences) {
		for (let i = 0; i < fence.lines.length; i += 1) lines.add(fence.startLine + i);
	}
	return lines;
}

interface LinkDoc {
	lines: number;
	line(n: number): { from: number; to: number; text: string };
	toString(): string;
}

/** Mark ranges for include paths on ledger lines of `doc`. `text` is `doc`'s full text. */
export function includeLinkMarks(
	doc: LinkDoc,
	text: string,
	file: { path: string; extension: string } | null | undefined
): Array<{ from: number; to: number }> {
	const eligible = ledgerLines(text, file);
	if (eligible === 'none') return [];
	if (eligible === null) return collectIncludeMarks(doc, null);
	const lines = [...eligible].sort((a, b) => a - b);
	return collectIncludeMarks(
		doc,
		lines.map((line) => ({ fromLine: line, toLine: line }))
	);
}

/**
 * Include-path ranges on `spans` (0-based, inclusive). `null` walks every
 * line. A line is visited once, so overlapping viewport ranges cannot emit
 * two marks for the same path.
 */
function collectIncludeMarks(
	doc: LinkDoc,
	spans: ReadonlyArray<{ fromLine: number; toLine: number }> | null
): Array<{ from: number; to: number }> {
	const marks: Array<{ from: number; to: number }> = [];
	const seen = new Set<number>();
	const visit = (index: number) => {
		if (index < 0 || index >= doc.lines || seen.has(index)) return;
		seen.add(index);
		const line = doc.line(index + 1);
		const span = includeLinkSpan(line.text);
		if (!span || span.to <= span.from) return;
		marks.push({ from: line.from + span.from, to: line.from + span.to });
	};
	if (spans === null) {
		for (let i = 0; i < doc.lines; i += 1) visit(i);
		return marks;
	}
	for (const span of spans) {
		const from = Math.max(0, span.fromLine);
		const to = Math.min(doc.lines - 1, span.toLine);
		for (let i = from; i <= to; i += 1) visit(i);
	}
	return marks;
}

/**
 * Whether any line could open a markdown fence. A miss means the note has
 * no ledger text, so the caller must not materialize the document or look
 * for `include` directives. A hit is cheap to confirm; fence bodies are
 * short, and only those are walked afterwards.
 */
function docHasFence(doc: LinkDoc): boolean {
	for (let n = 1; n <= doc.lines; n += 1) {
		if (/^ {0,3}(`{3,}|~{3,})/.test(doc.line(n).text)) return true;
	}
	return false;
}

/**
 * 0-based line spans `view.visibleRanges` covers. `null` means the viewport
 * is unmeasured (missing or empty): every line is eligible, the same
 * fallback the ledger highlighter uses before the first measure. A range
 * that does not overlap the document is skipped, so a stale range past the
 * end does not decorate the last line.
 */
function visibleLineSpans(view: EditorView): Array<{ fromLine: number; toLine: number }> | null {
	const doc = view.state.doc;
	const ranges = view.visibleRanges;
	if (!ranges || ranges.length === 0) return null;
	if (doc.lines === 0) return [];
	const length = typeof doc.length === 'number' ? doc.length : doc.line(doc.lines).to;
	const spans: Array<{ fromLine: number; toLine: number }> = [];
	for (const range of ranges) {
		if (range.to < 0 || range.from > length) continue;
		const fromPos = range.from < 0 ? 0 : range.from;
		const endPos = range.to > range.from ? range.to - 1 : range.from;
		if (endPos < 0) continue;
		const fromLine = doc.lineAt(fromPos > length ? length : fromPos).number - 1;
		const toLine = doc.lineAt(endPos > length ? length : endPos).number - 1;
		if (toLine >= fromLine) spans.push({ fromLine, toLine });
	}
	return spans;
}

/**
 * Marks for this view. A ledger file walks only the viewport and never
 * allocates `doc.toString()` — that string was unused, and a full scan on
 * every keystroke in every editor is the cost this avoids. A markdown note
 * is read only when it contains a fence.
 */
function includeMarks(view: EditorView): Array<{ from: number; to: number }> {
	const file = editorFile(view.state);
	if (!file) return [];
	const doc = view.state.doc;
	if (isLedgerFile(file)) return collectIncludeMarks(doc, visibleLineSpans(view));
	if (file.extension !== 'md' || !docHasFence(doc)) return [];
	return includeLinkMarks(doc, doc.toString(), file);
}

function includeDecorations(view: EditorView): DecorationSet {
	const marks = includeMarks(view);
	// An empty set, not `Decoration.none`: the test double has no shared
	// empty decoration, and a real editor treats an empty set the same.
	return Decoration.set(
		marks.map((mark) => Decoration.mark({ class: INCLUDE_LINK_CLASS }).range(mark.from, mark.to)),
		true
	);
}

/**
 * Whether 0-based `lineIndex` is ledger text. A ledger file is, and that
 * does not read the document — Mod-click must not allocate the whole file
 * to answer it. A note is only when the line sits in a beancount fence.
 */
function lineInLedger(doc: LinkDoc, lineIndex: number, file: { path: string; extension: string }): boolean {
	if (isLedgerFile(file)) return true;
	if (file.extension !== 'md' || !docHasFence(doc)) return false;
	const eligible = ledgerLines(doc.toString(), file);
	return eligible !== 'none' && eligible !== null && eligible.has(lineIndex);
}

/**
 * Mod-click on an include path. Returns true when the click was consumed.
 *
 * `posAtCoords` can land on the exclusive end of the glyph that was
 * clicked, so the closing quote's right half still counts. A click that
 * is not a Mod-click, or that is not on ledger include text, returns
 * false and leaves the caret alone.
 */
export function includeLinkMouseDown(view: EditorView, event: MouseEvent, app: App): boolean {
	const pane = modPane(event);
	if (pane === null) return false;
	const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
	if (pos === null) return false;
	const line = view.state.doc.lineAt(pos);
	const file = editorFile(view.state);
	if (!file || !lineInLedger(view.state.doc, line.number - 1, file)) return false;
	const span = includeLinkSpan(line.text);
	if (!span) return false;
	const col = pos - line.from;
	if (col < span.from || col > span.to) return false;
	event.preventDefault();
	openIncludedFile(app, file.path, span.path, pane);
	return true;
}

/**
 * Pane a Mod-click should open, or null when the click is not a Mod-click.
 * Mirrors `Keymap.isModEvent` for a primary-button click: Cmd on macOS,
 * Ctrl elsewhere; Alt splits; Alt+Shift opens a window. Middle-click is
 * not a Mod-click here — reading view and plain clicks stay out of scope.
 * A host with no platform (tests) treats either modifier as Mod.
 */
function modPane(event: MouseEvent): PaneType | null {
	if (event.button !== 0) return null;
	const platform =
		typeof globalThis.navigator === 'object' && globalThis.navigator !== null
			? String(globalThis.navigator.platform ?? '')
			: '';
	const mac = /Mac|iPhone|iPad|iPod/.test(platform);
	const mod = platform === '' ? event.metaKey || event.ctrlKey : mac ? event.metaKey : event.ctrlKey;
	if (!mod) return null;
	if (event.altKey && event.shiftKey) return 'window';
	if (event.altKey) return 'split';
	return 'tab';
}

export function includeLinksExtension(app: App): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private fileKey: string;

			constructor(private readonly view: EditorView) {
				this.fileKey = editorFileKey(view.state);
				this.decorations = includeDecorations(view);
			}

			update(update: ViewUpdate): void {
				const key = editorFileKey(update.state);
				const fileChanged = key !== this.fileKey;
				const viewportOnly = Boolean(update.viewportChanged) && !update.docChanged && !fileChanged;
				if (!update.docChanged && !fileChanged && !update.viewportChanged) return;
				// Fence marks do not depend on the viewport; only a ledger file does.
				const file = editorFile(update.state);
				if (viewportOnly && !(file && isLedgerFile(file))) return;
				this.fileKey = key;
				this.decorations = includeDecorations(update.view);
			}
		},
		{
			decorations: (plugin) => plugin.decorations,
			eventHandlers: {
				mousedown(event, view) {
					return includeLinkMouseDown(view, event, app);
				},
			},
		}
	);
}

function dirname(vaultPath: string): string[] {
	const normalized = vaultPath.replace(/\\/g, '/');
	const slash = normalized.lastIndexOf('/');
	if (slash <= 0) return [];
	return normalized.slice(0, slash).split('/');
}

function splitAbsolute(path: string): { prefix: string; parts: string[] } | null {
	const drive = /^[A-Za-z]:\//.exec(path);
	if (drive) return { prefix: drive[0][0].toUpperCase() + ':/', parts: path.slice(drive[0].length).split('/') };
	if (path.startsWith('/')) return { prefix: '/', parts: path.slice(1).split('/') };
	return null;
}

/**
 * Collapse `.` and `..`. `null` when a relative path leaves the vault.
 * An absolute `..` that would pass the filesystem root is dropped, the
 * way `/../x` is `/x`.
 */
function collapse(parts: readonly string[], absolute: boolean): string[] | null {
	const out: string[] = [];
	for (const seg of parts) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') {
			if (out.length === 0) {
				if (absolute) continue;
				return null;
			}
			out.pop();
			continue;
		}
		out.push(seg);
	}
	return out;
}

function normalizeRoot(root: string): string {
	let path = root.replace(/\\/g, '/');
	if (/^[A-Za-z]:/.test(path)) path = path[0].toUpperCase() + path.slice(1);
	if (path !== '/') path = path.replace(/\/+$/, '');
	return path;
}

/** Vault-relative path when `abs` is inside `vaultRoot`; otherwise null. */
function underVaultRoot(abs: string, vaultRoot: string): string | null {
	const root = normalizeRoot(vaultRoot);
	const path = /^[A-Za-z]:/.test(abs) ? abs[0].toUpperCase() + abs.slice(1) : abs;
	if (root === '/') return path.startsWith('/') ? path.slice(1) : null;
	if (path === root) return null;
	const prefix = root + '/';
	if (!path.startsWith(prefix)) return null;
	return path.slice(prefix.length);
}

/** `pattern` and `file` are vault-relative, forward-slash paths. `*` does not cross `/`. */
function globMatch(pattern: string, file: string): boolean {
	const pat = pattern.split('/');
	const parts = file.split('/');
	if (pat.length !== parts.length) return false;
	for (let i = 0; i < pat.length; i += 1) {
		if (!segmentMatch(pat[i], parts[i])) return false;
	}
	return true;
}

/**
 * One path segment. A name starting with `.` matches only a pattern that
 * starts with `.` — `*` and `?` do not see hidden names, same as Python's
 * glob, which is what beancount calls.
 */
function segmentMatch(pattern: string, text: string): boolean {
	if (text.startsWith('.') && !pattern.startsWith('.')) return false;
	return matchSegment(pattern, text);
}

/** One pattern atom. A star is not an atom — it is the retry point. */
type SegmentAtom =
	| { kind: 'star' }
	| { kind: 'any' }
	| { kind: 'lit'; ch: string }
	| { kind: 'class'; neg: boolean; cls: string };

/**
 * Match one segment. A `*` remembers the atom after it and the text index
 * it last consumed, then retries from the next character on failure. That
 * stays linear in the name: a pattern of many stars cannot hang Mod-click
 * the way a recursive search of every star boundary would. `?` is one
 * character. `[...]` is one character, including `!`/`^` negation and
 * ranges; an unclosed `[` is a literal. Stars are collapsed, since `**`
 * matches the same names as `*`.
 */
function matchSegment(pattern: string, text: string): boolean {
	const atoms = segmentAtoms(pattern);
	let ai = 0;
	let ti = 0;
	let starAi = -1;
	let starTi = -1;
	while (ti < text.length) {
		if (ai < atoms.length && atoms[ai].kind === 'star') {
			starAi = ai;
			starTi = ti;
			ai += 1;
			continue;
		}
		if (ai < atoms.length && segmentAtomMatches(atoms[ai], text[ti])) {
			ai += 1;
			ti += 1;
			continue;
		}
		if (starAi < 0) return false;
		starTi += 1;
		ti = starTi;
		ai = starAi + 1;
	}
	while (ai < atoms.length && atoms[ai].kind === 'star') ai += 1;
	return ai === atoms.length;
}

function segmentAtoms(pattern: string): SegmentAtom[] {
	const atoms: SegmentAtom[] = [];
	for (let pi = 0; pi < pattern.length; ) {
		const ch = pattern[pi];
		if (ch === '*') {
			if (atoms.length === 0 || atoms[atoms.length - 1].kind !== 'star') atoms.push({ kind: 'star' });
			pi += 1;
			continue;
		}
		if (ch === '?') {
			atoms.push({ kind: 'any' });
			pi += 1;
			continue;
		}
		if (ch === '[') {
			const close = pattern.indexOf(']', pi + 1);
			if (close === -1) {
				atoms.push({ kind: 'lit', ch: '[' });
				pi += 1;
				continue;
			}
			let cls = pattern.slice(pi + 1, close);
			let neg = false;
			if (cls.startsWith('!') || cls.startsWith('^')) {
				neg = true;
				cls = cls.slice(1);
			}
			atoms.push({ kind: 'class', neg, cls });
			pi = close + 1;
			continue;
		}
		atoms.push({ kind: 'lit', ch });
		pi += 1;
	}
	return atoms;
}

function segmentAtomMatches(atom: SegmentAtom, ch: string): boolean {
	if (atom.kind === 'any') return true;
	if (atom.kind === 'lit') return atom.ch === ch;
	if (atom.kind !== 'class') return false;
	const hit = classHas(atom.cls, ch);
	return atom.neg ? !hit : hit;
}

function classHas(cls: string, ch: string): boolean {
	for (let i = 0; i < cls.length; i += 1) {
		if (cls[i] === '-' && i > 0 && i + 1 < cls.length) {
			if (ch >= cls[i - 1] && ch <= cls[i + 1]) return true;
			continue;
		}
		if (cls[i] === ch) return true;
	}
	return false;
}
