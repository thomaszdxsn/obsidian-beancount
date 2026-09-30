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

	readonly api = {
		getFiles: (): FakeFile[] => [...this.files.values()],
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
	/** Editor selections; a caret is a selection whose anchor equals its head. */
	selections: FakeSelection[];
	getLine(line: number): string;
	lineCount(): number;
	getValue(): string;
	getCursor(): FakePosition;
	setCursor(pos: FakePosition): void;
	somethingSelected(): boolean;
	listSelections(): FakeSelection[];
	replaceRange(replacement: string, from: FakePosition, to?: FakePosition): void;
	replaceSelection(replacement: string): void;
	transaction(tx: { changes: FakeEditorChange[]; selection?: { from: FakePosition } }): void;
}

export function createEditor(lines: string[]): FakeEditor {
	return {
		lines,
		replacements: [],
		selectionReplacements: [],
		transactions: [],
		selections: [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
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
			this.selectionReplacements.push(replacement);
			// One edit per selection over the flat buffer. Carets land just
			// after their own inserted text, shifted by the net length change
			// of every edit before them; the edits themselves apply back to
			// front so earlier offsets stay valid.
			const text = this.lines.join('\n');
			const ranges: Array<{ from: number; to: number }> = [];
			for (const selection of this.selections) {
				const anchor = offsetOf(this.lines, selection.anchor);
				const head = offsetOf(this.lines, selection.head);
				ranges.push({ from: Math.min(anchor, head), to: Math.max(anchor, head) });
			}
			ranges.sort((a, b) => a.from - b.from);
			let shift = 0;
			const carets = ranges.map((range) => {
				const caret = range.from + replacement.length + shift;
				shift += replacement.length - (range.to - range.from);
				return caret;
			});
			let out = text;
			for (let index = ranges.length - 1; index >= 0; index -= 1) {
				const range = ranges[index];
				out = out.slice(0, range.from) + replacement + out.slice(range.to);
			}
			this.lines = out.split('\n');
			this.selections = carets.map((offset) => {
				const pos = positionAt(offset, this.lines);
				return { anchor: pos, head: pos };
			});
		},
		transaction(tx: { changes: FakeEditorChange[]; selection?: { from: FakePosition } }): void {
			this.transactions.push(tx.changes);
			for (const change of tx.changes) {
				const line = this.lines[change.from.line];
				this.lines[change.from.line] =
					line.slice(0, change.from.ch) + change.text + line.slice(change.to.ch);
			}
			if (tx.selection) {
				this.selections = [{ anchor: tx.selection.from, head: tx.selection.from }];
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
