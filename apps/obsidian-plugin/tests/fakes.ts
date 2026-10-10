/**
 * Shared test doubles for the Obsidian surface the plugin touches: a vault
 * whose reads and events tests drive directly (including delayed reads, to
 * exercise out-of-order invalidation), and an editor that records
 * replacements.
 */
import { setTimeout as delay } from 'node:timers/promises';

export interface FakeFile {
	path: string;
	name: string;
	basename: string;
	/** Folders have no extension, mirroring `TAbstractFile`. */
	extension?: string;
}

/**
 * What `editor.cm` offers the plugin: diagnostics publications arrive as
 * dispatches, exactly as they do on the real `EditorView`.
 */
export interface FakeCm {
	dispatched: Array<{ effects: unknown[] }>;
	dispatch(spec: { effects: unknown[] }): void;
}

export interface FakePosition {
	line: number;
	ch: number;
}

export function flush(): Promise<void> {
	return delay(0);
}

export class FakeVault {
	readonly files = new Map<string, FakeFile>();
	readonly contents = new Map<string, string>();
	readonly reads: string[] = [];
	/** Paths written through `modify`, in order — one per real write. */
	readonly writes: string[] = [];
	/** Paths whose next reads reject, to simulate files vanishing mid-scan. */
	readonly failures = new Set<string>();
	/** Per-path delay queues in ms, to resolve concurrent reads out of order. */
	readonly delays = new Map<string, number[]>();
	readonly handlers = new Map<string, Array<(file: FakeFile, oldPath?: string) => void>>();

	constructor(/** The vault's absolute path on disk, as `getBasePath` reports it. */ readonly basePath = '/vault') {}

	readonly api = {
		getFiles: (): FakeFile[] => [...this.files.values()],
		getAbstractFileByPath: (path: string): FakeFile | null => this.files.get(path) ?? null,
		cachedRead: (file: FakeFile): Promise<string> => this.read(file),
		read: (file: FakeFile): Promise<string> => this.read(file),
		modify: async (file: FakeFile, data: string): Promise<void> => {
			this.writes.push(file.path);
			this.contents.set(file.path, data);
			await this.emit('modify', file);
		},
		on: (name: string, handler: (file: FakeFile, oldPath?: string) => void) => {
			const handlers = this.handlers.get(name) ?? [];
			handlers.push(handler);
			this.handlers.set(name, handlers);
			return { name };
		},
		// The desktop `FileSystemAdapter` surface the validator needs: paths
		// on disk for the `bean-check` it runs outside Obsidian.
		adapter: {
			getBasePath: (): string => this.basePath,
			getFullPath: (path: string): string => `${this.basePath}/${path}`,
		},
	};

	/** Add or overwrite a file's content and file entry. */
	write(path: string, content: string): FakeFile {
		// Mirror Obsidian: ancestor folders exist as entries of their own.
		let slash = path.indexOf('/');
		while (slash !== -1) {
			const directory = path.slice(0, slash);
			if (!this.files.has(directory)) this.folder(directory);
			slash = path.indexOf('/', slash + 1);
		}
		const dot = path.lastIndexOf('.');
		const nameStart = path.lastIndexOf('/') + 1;
		const file: FakeFile = {
			path,
			name: path.slice(nameStart),
			basename: dot >= nameStart ? path.slice(nameStart, dot) : path.slice(nameStart),
			extension: dot >= nameStart ? path.slice(dot + 1) : undefined,
		};
		this.files.set(path, file);
		this.contents.set(path, content);
		return file;
	}

	folder(path: string): FakeFile {
		const slash = path.lastIndexOf('/');
		const file: FakeFile = { path, name: path.slice(slash + 1), basename: path.slice(slash + 1) };
		this.files.set(path, file);
		return file;
	}

	rename(oldPath: string, newPath: string): FakeFile {
		const source = this.files.get(oldPath);
		if (!source) throw new Error(`unknown path: ${oldPath}`);
		const isFolder = source.extension === undefined && !this.contents.has(oldPath);
		const moved = [oldPath];
		if (isFolder) {
			for (const path of [...this.files.keys()]) {
				if (path.startsWith(oldPath + '/')) moved.push(path);
			}
		}
		let renamed = source;
		for (const path of moved) {
			const content = this.contents.get(path);
			this.files.delete(path);
			this.contents.delete(path);
			const target = this.write(newPath + path.slice(oldPath.length), content ?? '');
			if (content === undefined) this.contents.delete(target.path);
			if (path === oldPath) renamed = target;
		}
		return renamed;
	}

	delete(path: string): FakeFile {
		const file = this.files.get(path);
		if (!file) throw new Error(`unknown path: ${path}`);
		this.files.delete(path);
		this.contents.delete(path);
		return file;
	}

	async emit(name: 'create' | 'modify' | 'delete', file: FakeFile): Promise<void>;
	async emit(name: 'rename', file: FakeFile, oldPath: string): Promise<void>;
	async emit(name: string, file: FakeFile, oldPath?: string): Promise<void> {
		for (const handler of this.handlers.get(name) ?? []) handler(file, oldPath);
		await flush();
	}

	private read(file: FakeFile): Promise<string> {
		this.reads.push(file.path);
		if (this.failures.has(file.path)) return Promise.reject(new Error('unreadable'));
		// The content is captured when the read starts, like a real read of a
		// file that is edited again before this promise resolves.
		const content = this.contents.get(file.path) ?? '';
		const queue = this.delays.get(file.path);
		const ms = queue?.shift() ?? 0;
		return delay(ms).then(() => content);
	}
}

export interface FakeEditorChange {
	from: FakePosition;
	to: FakePosition;
	text: string;
}

export interface FakeSelection {
	anchor: FakePosition;
	head: FakePosition;
}

export interface FakeEditor {
	lines: string[];
	replacements: Array<{ replacement: string; from: FakePosition; to?: FakePosition }>;
	/** Texts passed to `replaceSelection`, in order — one per call. */
	selectionReplacements: string[];
	/** Change batches passed to `transaction`, in order. */
	transactions: FakeEditorChange[][];
	/** The CodeMirror view behind the editor: effects land in `cm.dispatched`. */
	cm: FakeCm;
	/** Editor selections; a caret is a selection whose anchor equals its head. */
	selections: FakeSelection[];
	/** Ranges passed to `scrollIntoView`, in order. */
	scrollIntoViewCalls: Array<{ range: { from: FakePosition; to: FakePosition }; center?: boolean }>;
	getLine(line: number): string;
	lineCount(): number;
	getValue(): string;
	getCursor(): FakePosition;
	setCursor(pos: FakePosition): void;
	setSelection(anchor: FakePosition, head: FakePosition): void;
	scrollIntoView(range: { from: FakePosition; to: FakePosition }, center?: boolean): void;
	somethingSelected(): boolean;
	listSelections(): FakeSelection[];
	replaceRange(replacement: string, from: FakePosition, to?: FakePosition): void;
	replaceSelection(replacement: string): void;
	transaction(tx: { changes: FakeEditorChange[]; selection?: { from: FakePosition; to?: FakePosition } }): void;
}

export function createEditor(lines: string[]): FakeEditor {
	const cm: FakeCm = {
		dispatched: [],
		dispatch(spec: { effects: unknown[] }): void {
			this.dispatched.push(spec);
		},
	};
	return {
		lines,
		replacements: [],
		selectionReplacements: [],
		transactions: [],
		cm,
		selections: [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
		scrollIntoViewCalls: [],
		getLine(line: number): string {
			return this.lines[line] ?? '';
		},
		lineCount(): number {
			return this.lines.length;
		},
		getValue(): string {
			return this.lines.join('\n');
		},
		getCursor(): FakePosition {
			return this.selections[0].head;
		},
		setCursor(pos: FakePosition): void {
			this.selections = [{ anchor: pos, head: pos }];
		},
		setSelection(anchor: FakePosition, head: FakePosition): void {
			this.selections = [{ anchor, head }];
		},
		scrollIntoView(range: { from: FakePosition; to: FakePosition }, center?: boolean): void {
			this.scrollIntoViewCalls.push({ range, center });
		},
		somethingSelected(): boolean {
			return this.selections.some(
				(selection: FakeSelection) =>
					selection.anchor.line !== selection.head.line || selection.anchor.ch !== selection.head.ch
			);
		},
		listSelections(): FakeSelection[] {
			return this.selections;
		},
		replaceRange(replacement: string, from: FakePosition, to?: FakePosition): void {
			this.replacements.push({ replacement, from, to });
		},
		replaceSelection(replacement: string): void {
			// Recording is the contract the tests assert; the text effect is
			// the single-caret case they smoke-check. Multi-caret insertion
			// and caret mapping are Obsidian's behavior, not the plugin's.
			this.selectionReplacements.push(replacement);
			const selection = this.selections[0];
			const text = this.lines.join('\n');
			const anchor = offsetOf(this.lines, selection.anchor);
			const head = offsetOf(this.lines, selection.head);
			const from = Math.min(anchor, head);
			const to = Math.max(anchor, head);
			this.lines = (text.slice(0, from) + replacement + text.slice(to)).split('\n');
			const pos = positionAt(from + replacement.length, this.lines);
			this.selections = [{ anchor: pos, head: pos }];
		},
		transaction(tx: {
			changes: FakeEditorChange[];
			selection?: { from: FakePosition; to?: FakePosition };
		}): void {
			this.transactions.push(tx.changes);
			// Pre-edit coordinates: a later change on the same line is applied
			// first so an earlier range still addresses the original text.
			const ordered = [...tx.changes].sort((a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch);
			for (const change of ordered) {
				const line = this.lines[change.from.line] ?? '';
				const toCh = change.to.line === change.from.line ? change.to.ch : line.length;
				this.lines[change.from.line] = line.slice(0, change.from.ch) + change.text + line.slice(toCh);
			}
			if (tx.selection) {
				this.selections = [{ anchor: tx.selection.from, head: tx.selection.to ?? tx.selection.from }];
			}
		},
	};
}

/** Flat-buffer offset of `pos`, counting the newline before each line. */
function offsetOf(lines: readonly string[], pos: FakePosition): number {
	let offset = 0;
	for (let line = 0; line < pos.line; line += 1) offset += lines[line].length + 1;
	return offset + pos.ch;
}

/** The position of a flat-buffer offset in `lines`, clamped to the buffer. */
function positionAt(offset: number, lines: readonly string[]): FakePosition {
	let rest = offset;
	for (let line = 0; line < lines.length; line += 1) {
		if (rest <= lines[line].length) return { line, ch: rest };
		rest -= lines[line].length + 1;
	}
	const last = lines.length - 1;
	return { line: last, ch: lines[last].length };
}
