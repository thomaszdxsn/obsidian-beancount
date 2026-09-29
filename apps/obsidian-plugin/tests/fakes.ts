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
	/** Paths whose next reads reject, to simulate files vanishing mid-scan. */
	readonly failures = new Set<string>();
	/** Per-path delay queues in ms, to resolve concurrent reads out of order. */
	readonly delays = new Map<string, number[]>();
	readonly handlers = new Map<string, Array<(file: FakeFile, oldPath?: string) => void>>();

	readonly api = {
		getFiles: (): FakeFile[] => [...this.files.values()],
		cachedRead: (file: FakeFile): Promise<string> => this.read(file),
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

export interface FakeEditor {
	lines: string[];
	replacements: Array<{ replacement: string; from: FakePosition; to?: FakePosition }>;
	getLine(line: number): string;
	replaceRange(replacement: string, from: FakePosition, to?: FakePosition): void;
}

export function createEditor(lines: string[]): FakeEditor {
	return {
		lines,
		replacements: [],
		getLine(line: number): string {
			return this.lines[line] ?? '';
		},
		replaceRange(replacement: string, from: FakePosition, to?: FakePosition): void {
			this.replacements.push({ replacement, from, to });
		},
	};
}
