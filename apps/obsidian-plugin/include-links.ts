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
}

/** Mark ranges for include paths on ledger lines of `doc`. `text` is `doc`'s full text. */
export function includeLinkMarks(
	doc: LinkDoc,
	text: string,
	file: { path: string; extension: string } | null | undefined
): Array<{ from: number; to: number }> {
	const eligible = ledgerLines(text, file);
	if (eligible === 'none') return [];
	const marks: Array<{ from: number; to: number }> = [];
	for (let i = 0; i < doc.lines; i += 1) {
		if (eligible !== null && !eligible.has(i)) continue;
		const line = doc.line(i + 1);
		const span = includeLinkSpan(line.text);
		if (!span || span.to <= span.from) continue;
		marks.push({ from: line.from + span.from, to: line.from + span.to });
	}
	return marks;
}

function includeDecorations(view: EditorView): DecorationSet {
	const text = view.state.doc.toString();
	const marks = includeLinkMarks(view.state.doc, text, editorFile(view.state));
	// An empty set, not `Decoration.none`: the test double has no shared
	// empty decoration, and a real editor treats an empty set the same.
	return Decoration.set(
		marks.map((mark) => Decoration.mark({ class: INCLUDE_LINK_CLASS }).range(mark.from, mark.to)),
		true
	);
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
	const eligible = ledgerLines(view.state.doc.toString(), file);
	if (eligible === 'none' || (eligible !== null && !eligible.has(line.number - 1))) return false;
	const span = includeLinkSpan(line.text);
	if (!span || !file) return false;
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
				if (!update.docChanged && key === this.fileKey) return;
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
	return matchAt(pattern, 0, text, 0);
}

function matchAt(pattern: string, pi: number, text: string, ti: number): boolean {
	while (pi < pattern.length) {
		const ch = pattern[pi];
		if (ch === '*') {
			for (let k = text.length; k >= ti; k -= 1) {
				if (matchAt(pattern, pi + 1, text, k)) return true;
			}
			return false;
		}
		if (ti >= text.length) return false;
		if (ch === '?') {
			pi += 1;
			ti += 1;
			continue;
		}
		if (ch === '[') {
			const close = pattern.indexOf(']', pi + 1);
			if (close === -1) {
				if (text[ti] !== '[') return false;
				pi += 1;
				ti += 1;
				continue;
			}
			let cls = pattern.slice(pi + 1, close);
			let neg = false;
			if (cls.startsWith('!') || cls.startsWith('^')) {
				neg = true;
				cls = cls.slice(1);
			}
			const hit = classHas(cls, text[ti]);
			if (neg ? hit : !hit) return false;
			pi = close + 1;
			ti += 1;
			continue;
		}
		if (text[ti] !== ch) return false;
		pi += 1;
		ti += 1;
	}
	return ti === text.length;
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
