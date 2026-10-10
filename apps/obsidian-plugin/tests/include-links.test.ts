/**
 * Include links: the quoted path of an `include` directive resolves against
 * the including file and is the only range the editor marks.
 */
import { describe, expect, it } from 'vitest';
import type { App, PaneType } from 'obsidian';
import { notices } from './mocks/obsidian';
import {
	globCountNotice,
	INCLUDE_LINK_CLASS,
	includeLinkMarks,
	includeLinkMouseDown,
	includeLinkSpan,
	includeLinksExtension,
	missingIncludeNotice,
	openIncludedFile,
	resolveIncludePath,
} from '../include-links';
import type { MockViewPlugin } from './mocks/codemirror';

const FILES = [
	'ledger/a.bean',
	'ledger/2024/a.bean',
	'ledger/2024/b.bean',
	'ledger/2024/sub/c.bean',
	'ledger/2024/.hidden.bean',
	'other.bean',
	'notes/a.bean',
];

function resolve(
	includePath: string,
	source = 'ledger/main.bean',
	root = '/vault',
	vaultFiles: readonly string[] = FILES
) {
	return resolveIncludePath(includePath, source, root, vaultFiles);
}

describe('includeLinkSpan', () => {
	it('covers both quotes and not a comment after the path', () => {
		expect(includeLinkSpan('include "a.bean" ; see "nope"')).toEqual({
			from: 8,
			to: 16,
			path: 'a.bean',
		});
		expect(includeLinkSpan('include "a.bean" ; see "nope"')!.to).toBe(
			'include "a.bean"'.length
		);
	});

	it('keeps spaces inside the quotes and a tab before them', () => {
		expect(includeLinkSpan('include\t"my file.bean"')).toEqual({
			from: 8,
			to: 22,
			path: 'my file.bean',
		});
	});

	it('does not end the string at an escaped quote', () => {
		const line = 'include "a\\"b.bean"';
		const span = includeLinkSpan(line);
		expect(span).toEqual({ from: 8, to: line.length, path: 'a"b.bean' });
		expect(line.slice(span!.from, span!.to)).toBe('"a\\"b.bean"');
	});

	it('keeps a single backslash so a Windows path still resolves', () => {
		expect(includeLinkSpan('include "sub\\a.bean"')!.path).toBe('sub\\a.bean');
		expect(includeLinkSpan('include "sub\\\\a.bean"')!.path).toBe('sub\\a.bean');
	});

	it('ignores a metadata key, a comment, and a lookalike word', () => {
		expect(includeLinkSpan('  include: "other.bean"')).toBeNull();
		expect(includeLinkSpan('include: "other.bean"')).toBeNull();
		expect(includeLinkSpan('include :"other.bean"')).toBeNull();
		expect(includeLinkSpan('; include "other.bean"')).toBeNull();
		expect(includeLinkSpan('  ; include "other.bean"')).toBeNull();
		expect(includeLinkSpan('included "other.bean"')).toBeNull();
		expect(includeLinkSpan('INCLUDE "other.bean"')).toBeNull();
		expect(includeLinkSpan('plugin "other.bean"')).toBeNull();
		expect(includeLinkSpan('* include "other.bean"')).toBeNull();
	});

	it('rejects an unclosed or empty string', () => {
		expect(includeLinkSpan('include "unterminated')).toBeNull();
		expect(includeLinkSpan('include ""')).toBeNull();
		expect(includeLinkSpan('include "a.bean')).toBeNull();
	});

	it('rejects a carriage return inside the quotes', () => {
		expect(includeLinkSpan('include "a\r.bean"')).toBeNull();
	});

	it('still matches an indented directive', () => {
		expect(includeLinkSpan('  include "indented.bean"')).toEqual({
			from: 10,
			to: 25,
			path: 'indented.bean',
		});
	});
});

describe('resolveIncludePath', () => {
	it('resolves a relative path against the including file', () => {
		expect(resolve('a.bean')).toEqual({ kind: 'file', vaultPath: 'ledger/a.bean' });
		expect(resolve('./a.bean')).toEqual({ kind: 'file', vaultPath: 'ledger/a.bean' });
		expect(resolve('././a.bean')).toEqual({ kind: 'file', vaultPath: 'ledger/a.bean' });
		expect(resolve('sub/../a.bean')).toEqual({ kind: 'file', vaultPath: 'ledger/a.bean' });
	});

	it('collapses ../ without leaving the vault', () => {
		expect(resolve('../other.bean', 'ledger/sub/main.bean')).toEqual({
			kind: 'missing',
			vaultPath: 'ledger/other.bean',
		});
		expect(resolve('./../other.bean', 'ledger/main.bean')).toEqual({
			kind: 'file',
			vaultPath: 'other.bean',
		});
		expect(resolve('foo/../../other.bean', 'ledger/main.bean')).toEqual({
			kind: 'file',
			vaultPath: 'other.bean',
		});
	});

	it('refuses a relative path that escapes the vault', () => {
		expect(resolve('../outside.bean', 'main.bean')).toEqual({ kind: 'outside' });
		expect(resolve('../../outside.bean', 'ledger/main.bean')).toEqual({ kind: 'outside' });
		expect(resolve('foo/../../../outside.bean', 'ledger/main.bean')).toEqual({ kind: 'outside' });
	});

	it('maps an absolute path inside the vault and rejects one outside', () => {
		expect(resolve('/vault/ledger/a.bean', 'main.bean', '/vault')).toEqual({
			kind: 'file',
			vaultPath: 'ledger/a.bean',
		});
		expect(resolve('/vault/ledger/../other.bean', 'main.bean', '/vault/')).toEqual({
			kind: 'file',
			vaultPath: 'other.bean',
		});
		expect(resolve('/etc/a.bean', 'main.bean', '/vault')).toEqual({ kind: 'outside' });
		expect(resolve('/vault2/a.bean', 'main.bean', '/vault')).toEqual({ kind: 'outside' });
		expect(resolve('/Vault/a.bean', 'main.bean', '/vault')).toEqual({ kind: 'outside' });
	});

	it('treats Windows backslashes as separators, inside and outside the vault', () => {
		expect(resolve('sub\\a.bean', 'ledger/main.bean', 'C:\\vault', ['ledger/sub/a.bean'])).toEqual({
			kind: 'file',
			vaultPath: 'ledger/sub/a.bean',
		});
		expect(resolve('C:\\vault\\ledger\\a.bean', 'main.bean', 'C:\\vault')).toEqual({
			kind: 'file',
			vaultPath: 'ledger/a.bean',
		});
		expect(resolve('C:/vault/ledger/a.bean', 'main.bean', 'c:\\vault\\')).toEqual({
			kind: 'file',
			vaultPath: 'ledger/a.bean',
		});
		expect(resolve('D:\\other\\a.bean', 'main.bean', 'C:\\vault')).toEqual({ kind: 'outside' });
		expect(resolve('c:\\vault\\other.bean', 'main.bean', 'C:/vault')).toEqual({
			kind: 'file',
			vaultPath: 'other.bean',
		});
	});

	it('globs within one directory and sorts the matches', () => {
		expect(resolve('2024/*.bean')).toEqual({
			kind: 'glob',
			matches: ['ledger/2024/a.bean', 'ledger/2024/b.bean'],
		});
		expect(resolve('2024/*.bean').kind === 'glob' && resolve('2024/*.bean')).not.toEqual(
			expect.objectContaining({ matches: expect.arrayContaining(['ledger/2024/sub/c.bean']) })
		);
		const glob = resolve('2024/*.bean');
		expect(glob.kind === 'glob' ? glob.matches : []).not.toContain('ledger/2024/.hidden.bean');
		expect(glob.kind === 'glob' ? glob.matches : []).not.toContain('ledger/2024/sub/c.bean');
	});

	it('reports a glob with no vault match separately from a missing literal', () => {
		expect(resolve('2024/nope-*.bean')).toEqual({ kind: 'glob', matches: [] });
		expect(resolve('missing.bean')).toEqual({ kind: 'missing', vaultPath: 'ledger/missing.bean' });
		expect(resolve('../../*.bean', 'ledger/main.bean')).toEqual({ kind: 'outside' });
	});

	it('resolves a fence include against the note folder', () => {
		expect(resolve('a.bean', 'notes/budget.md')).toEqual({ kind: 'file', vaultPath: 'notes/a.bean' });
		expect(resolve('../other.bean', 'notes/budget.md')).toEqual({ kind: 'file', vaultPath: 'other.bean' });
	});

	it('drops .. past the filesystem root and rejects the vault root itself', () => {
		expect(resolve('/../vault/ledger/a.bean', 'main.bean', '/vault')).toEqual({
			kind: 'file',
			vaultPath: 'ledger/a.bean',
		});
		expect(resolve('C:/../vault/a.bean', 'main.bean', 'C:/vault', ['a.bean'])).toEqual({
			kind: 'file',
			vaultPath: 'a.bean',
		});
		expect(resolve('/vault', 'main.bean', '/vault')).toEqual({ kind: 'outside' });
		expect(resolve('/vault/', 'main.bean', '/vault/')).toEqual({ kind: 'outside' });
		expect(resolve('/notes/a.bean', 'main.bean', '/', ['notes/a.bean'])).toEqual({
			kind: 'file',
			vaultPath: 'notes/a.bean',
		});
		expect(resolve('C:/notes/a.bean', 'main.bean', '/')).toEqual({ kind: 'outside' });
	});

	it('matches ?, character classes, and a star that cannot finish the name', () => {
		const files = ['c.bean', 'a.bean', 'ab.bean', 'az.bean', 'axz.bean', '.hidden.bean', 'b.bean'];
		expect(resolve('?.bean', 'main.bean', '/vault', files)).toEqual({
			kind: 'glob',
			matches: ['a.bean', 'b.bean', 'c.bean'],
		});
		expect(resolve('a?', 'main.bean', '/vault', ['a', 'ab', 'b'])).toEqual({ kind: 'glob', matches: ['ab'] });
		expect(resolve('a*z.bean', 'main.bean', '/vault', files)).toEqual({
			kind: 'glob',
			matches: ['axz.bean', 'az.bean'],
		});
		expect(resolve('[ab].bean', 'main.bean', '/vault', files)).toEqual({
			kind: 'glob',
			matches: ['a.bean', 'b.bean'],
		});
		expect(resolve('[a-c].bean', 'main.bean', '/vault', [...files, 'z.bean'])).toEqual({
			kind: 'glob',
			matches: ['a.bean', 'b.bean', 'c.bean'],
		});
		expect(resolve('[a-cz].bean', 'main.bean', '/vault', ['z.bean', 'd.bean'])).toEqual({
			kind: 'glob',
			matches: ['z.bean'],
		});
		expect(resolve('[a-].bean', 'main.bean', '/vault', ['a.bean', '-.bean'])).toEqual({
			kind: 'glob',
			matches: ['-.bean', 'a.bean'],
		});
		expect(resolve('[!a].bean', 'main.bean', '/vault', files)).toEqual({
			kind: 'glob',
			matches: ['b.bean', 'c.bean'],
		});
		expect(resolve('[^a].bean', 'main.bean', '/vault', files)).toEqual({
			kind: 'glob',
			matches: ['b.bean', 'c.bean'],
		});
		expect(resolve('[.bean', 'main.bean', '/vault', ['[.bean', 'a.bean'])).toEqual({
			kind: 'glob',
			matches: ['[.bean'],
		});
		expect(resolve('?.bean', 'main.bean', '/vault', ['[.bean', '.hidden.bean', 'ab.bean'])).toEqual({
			kind: 'glob',
			matches: ['[.bean'],
		});
		expect(resolve('.*.bean', 'main.bean', '/vault', files)).toEqual({
			kind: 'glob',
			matches: ['.hidden.bean'],
		});
	});
});

describe('openIncludedFile', () => {
	function host(
		paths: string[],
		options?: {
			root?: string | null;
			getLeaf?: (pane: PaneType | boolean) => { openFile: (file: { path: string }) => Promise<void> };
		},
	) {
		const opened: string[] = [];
		const root = options?.root === undefined ? '/vault' : options.root;
		const app = {
			vault: {
				adapter: root === null ? {} : { getBasePath: () => root },
				getFiles: () => paths.map((path) => ({ path })),
			},
			workspace: {
				getLeaf:
					options?.getLeaf ??
					((pane: PaneType | boolean) => ({
						openFile: (file: { path: string }) => {
							opened.push(`${String(pane)}:${file.path}`);
							return Promise.resolve();
						},
					})),
			},
		} as unknown as App;
		return { app, opened };
	}

	it('opens a resolved file and notices a missing one', () => {
		notices.length = 0;
		const found = host(FILES);
		openIncludedFile(found.app, 'ledger/main.bean', 'a.bean', 'tab');
		expect(found.opened).toEqual(['tab:ledger/a.bean']);
		expect(notices).toEqual([]);

		const missing = host(FILES);
		openIncludedFile(missing.app, 'ledger/main.bean', 'nope.bean', 'split');
		expect(missing.opened).toEqual([]);
		expect(notices).toEqual([missingIncludeNotice('nope.bean')]);
	});

	it('opens the first glob match and notices the count when several match', () => {
		notices.length = 0;
		const { app, opened } = host(FILES);
		openIncludedFile(app, 'ledger/main.bean', '2024/*.bean', 'window');
		expect(opened).toEqual(['window:ledger/2024/a.bean']);
		expect(notices).toEqual([globCountNotice('2024/*.bean', 2)]);
	});

	it('notices a glob that matches nothing and a path outside the vault', () => {
		notices.length = 0;
		const { app, opened } = host(FILES);
		openIncludedFile(app, 'ledger/main.bean', '2024/nope-*.bean', 'tab');
		openIncludedFile(app, 'main.bean', '../outside.bean', 'tab');
		openIncludedFile(app, 'main.bean', '/etc/passwd', 'tab');
		expect(opened).toEqual([]);
		expect(notices).toEqual([
			missingIncludeNotice('2024/nope-*.bean'),
			missingIncludeNotice('../outside.bean'),
			missingIncludeNotice('/etc/passwd'),
		]);
	});

	it('opens a single glob match without a count notice', () => {
		notices.length = 0;
		const { app, opened } = host(FILES);
		openIncludedFile(app, 'ledger/main.bean', '2024/a*.bean', 'split');
		expect(opened).toEqual(['split:ledger/2024/a.bean']);
		expect(notices).toEqual([]);
	});

	it('still resolves a relative include when the adapter has no base path', () => {
		notices.length = 0;
		const { app, opened } = host(FILES, { root: null });
		openIncludedFile(app, 'ledger/main.bean', 'a.bean', 'tab');
		expect(opened).toEqual(['tab:ledger/a.bean']);
		openIncludedFile(app, 'main.bean', '/vault/other.bean', 'tab');
		expect(notices).toEqual([missingIncludeNotice('/vault/other.bean')]);
	});

	it('notices when opening the file rejects or throws', async () => {
		notices.length = 0;
		const rejected = host(FILES, {
			getLeaf: () => ({
				openFile: () => Promise.reject(new Error('busy')),
			}),
		});
		openIncludedFile(rejected.app, 'ledger/main.bean', 'a.bean', 'tab');
		await Promise.resolve();
		expect(rejected.opened).toEqual([]);
		expect(notices).toEqual([missingIncludeNotice('a.bean')]);

		notices.length = 0;
		const thrown = host(FILES, {
			getLeaf: () => {
				throw new Error('no leaf');
			},
		});
		openIncludedFile(thrown.app, 'ledger/main.bean', 'a.bean', 'tab');
		expect(notices).toEqual([missingIncludeNotice('a.bean')]);
	});
});

function docOf(text: string) {
	const lines = text.split('\n');
	const starts: number[] = [];
	let at = 0;
	for (const line of lines) {
		starts.push(at);
		at += line.length + 1;
	}
	return {
		lines: lines.length,
		toString: () => text,
		line(n: number) {
			const body = lines[n - 1];
			return { from: starts[n - 1], to: starts[n - 1] + body.length, text: body, number: n };
		},
		lineAt(pos: number) {
			let i = 0;
			while (i + 1 < starts.length && starts[i + 1] <= pos) i += 1;
			return this.line(i + 1);
		},
	};
}

describe('includeLinkMarks', () => {
	it('marks the quoted path and skips a metadata key on the next line', () => {
		const text = 'include "a.bean" ; comment\n  include: "other.bean"\n';
		const doc = docOf(text);
		expect(includeLinkMarks(doc, text, { path: 'ledger/main.bean', extension: 'bean' })).toEqual([
			{ from: 8, to: 16 },
		]);
	});

	it('marks a fence include and not the same words in prose or another language', () => {
		const text = [
			'include "prose.bean"',
			'```js',
			'include "script.bean"',
			'```',
			'```beancount',
			'include "a.bean"',
			'```',
			'',
		].join('\n');
		const doc = docOf(text);
		const marks = includeLinkMarks(doc, text, { path: 'notes/budget.md', extension: 'md' });
		const fenceLine = doc.line(6);
		expect(marks).toEqual([{ from: fenceLine.from + 8, to: fenceLine.from + 16 }]);
	});

	it('marks nothing when the editor has no file', () => {
		const text = 'include "a.bean"';
		expect(includeLinkMarks(docOf(text), text, null)).toEqual([]);
	});

	it('marks nothing in a non-ledger, non-markdown file', () => {
		const text = 'include "a.bean"';
		expect(includeLinkMarks(docOf(text), text, { path: 'notes/readme.txt', extension: 'txt' })).toEqual([]);
	});
});


describe('includeLinkMouseDown', () => {
	function click(
		text: string,
		file: { path: string; extension: string } | null,
		pos: number | null,
		mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean; button?: number }
	) {
		notices.length = 0;
		const opened: string[] = [];
		const doc = docOf(text);
		const view = {
			state: {
				doc,
				field: () => ({ file }),
			},
			posAtCoords: () => pos,
		};
		const app = {
			vault: {
				adapter: { getBasePath: () => '/vault' },
				getFiles: () => FILES.map((path) => ({ path })),
			},
			workspace: {
				getLeaf: (pane: PaneType | boolean) => ({
					openFile: (entry: { path: string }) => {
						opened.push(`${String(pane)}:${entry.path}`);
						return Promise.resolve();
					},
				}),
			},
		} as unknown as App;
		const event = {
			button: mods.button ?? 0,
			metaKey: mods.meta ?? false,
			ctrlKey: mods.ctrl ?? false,
			altKey: mods.alt ?? false,
			shiftKey: mods.shift ?? false,
			clientX: pos,
			clientY: 0,
			preventDefault() {
				this.defaultPrevented = true;
			},
			defaultPrevented: false,
		} as MouseEvent & { defaultPrevented: boolean };
		const handled = includeLinkMouseDown(view as never, event, app);
		return { handled, opened, prevented: event.defaultPrevented };
	}

	/** `null` drops navigator; a string stubs `platform`; `undefined` leaves it unset. */
	function withNavigator<T>(platform: string | null | undefined, run: () => T): T {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		const value = platform === null ? undefined : ({ platform } as Navigator);
		Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
		try {
			return run();
		} finally {
			if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		}
	}

	const bean = { path: 'ledger/main.bean', extension: 'bean' };

	it('opens on Mod-click of the quoted path and ignores a plain click', () => {
		const line = 'include "a.bean" ; comment';
		const mod = click(line, { path: 'ledger/main.bean', extension: 'bean' }, 8, { meta: true, ctrl: true });
		expect(mod.handled).toBe(true);
		expect(mod.prevented).toBe(true);
		expect(mod.opened).toEqual(['tab:ledger/a.bean']);

		const plain = click(line, { path: 'ledger/main.bean', extension: 'bean' }, 8, {});
		expect(plain.handled).toBe(false);
		expect(plain.opened).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('does not open a click on the comment, a metadata key, or prose', () => {
		const line = 'include "a.bean" ; comment';
		const comment = click(line, { path: 'ledger/main.bean', extension: 'bean' }, line.indexOf(';'), {
			meta: true,
			ctrl: true,
		});
		expect(comment.handled).toBe(false);

		const meta = click('  include: "a.bean"', { path: 'ledger/main.bean', extension: 'bean' }, 12, {
			meta: true,
			ctrl: true,
		});
		expect(meta.handled).toBe(false);

		const prose = click('include "a.bean"', { path: 'notes/budget.md', extension: 'md' }, 8, {
			meta: true,
			ctrl: true,
		});
		expect(prose.handled).toBe(false);
		expect(prose.opened).toEqual([]);
	});

	it('resolves a fence include against the note and notices a missing target', () => {
		const text = '```beancount\ninclude "missing.bean"\n```';
		const doc = docOf(text);
		const quote = doc.line(2).from + 8;
		const result = click(text, { path: 'notes/budget.md', extension: 'md' }, quote, { meta: true, ctrl: true });
		expect(result.handled).toBe(true);
		expect(result.opened).toEqual([]);
		expect(notices).toEqual([missingIncludeNotice('missing.bean')]);
	});

	it('still hits the closing quote when the position is its exclusive end', () => {
		const line = 'include "a.bean"';
		const end = includeLinkSpan(line)!.to;
		const hit = click(line, { path: 'ledger/main.bean', extension: 'bean' }, end, { meta: true, ctrl: true });
		expect(hit.handled).toBe(true);
		const miss = click(line, { path: 'ledger/main.bean', extension: 'bean' }, end + 1, { meta: true, ctrl: true });
		expect(miss.handled).toBe(false);
	});

	it('chooses the pane from the platform Mod key, Alt, and Alt+Shift', () => {
		const line = 'include "a.bean"';
		withNavigator('MacIntel', () => {
			const tab = click(line, bean, 8, { meta: true });
			expect(tab.opened).toEqual(['tab:ledger/a.bean']);
			const split = click(line, bean, 8, { meta: true, alt: true });
			expect(split.opened).toEqual(['split:ledger/a.bean']);
			const window = click(line, bean, 8, { meta: true, alt: true, shift: true });
			expect(window.opened).toEqual(['window:ledger/a.bean']);
			const ctrl = click(line, bean, 8, { ctrl: true, alt: true, shift: true });
			expect(ctrl.handled).toBe(false);
			expect(ctrl.opened).toEqual([]);
			const altOnly = click(line, bean, 8, { alt: true, shift: true });
			expect(altOnly.handled).toBe(false);
		});
		withNavigator('Win32', () => {
			const tab = click(line, bean, 8, { ctrl: true });
			expect(tab.opened).toEqual(['tab:ledger/a.bean']);
			const meta = click(line, bean, 8, { meta: true });
			expect(meta.handled).toBe(false);
			expect(meta.opened).toEqual([]);
		});
		withNavigator('iPad', () => {
			expect(click(line, bean, 8, { meta: true }).opened).toEqual(['tab:ledger/a.bean']);
			expect(click(line, bean, 8, { ctrl: true }).handled).toBe(false);
		});
		withNavigator(null, () => {
			expect(click(line, bean, 8, { ctrl: true }).opened).toEqual(['tab:ledger/a.bean']);
			expect(click(line, bean, 8, { meta: true }).opened).toEqual(['tab:ledger/a.bean']);
			expect(click(line, bean, 8, {}).handled).toBe(false);
		});
		withNavigator(undefined, () => {
			expect(click(line, bean, 8, { ctrl: true }).opened).toEqual(['tab:ledger/a.bean']);
		});
	});

	it('ignores a non-primary button, a click off the editor, and a click before the path', () => {
		const line = 'include "a.bean"';
		const middle = click(line, bean, 8, { meta: true, ctrl: true, button: 1 });
		expect(middle.handled).toBe(false);
		expect(middle.opened).toEqual([]);
		const off = click(line, bean, null, { meta: true, ctrl: true });
		expect(off.handled).toBe(false);
		const before = click(line, bean, 0, { meta: true, ctrl: true });
		expect(before.handled).toBe(false);
		expect(notices).toEqual([]);
	});

	it('ignores an include in a text file and in prose beside a fence', () => {
		const txt = click('include "a.bean"', { path: 'notes/readme.txt', extension: 'txt' }, 8, {
			meta: true,
			ctrl: true,
		});
		expect(txt.handled).toBe(false);
		const mixed = 'include "a.bean"\n```beancount\ninclude "other.bean"\n```';
		const prose = click(mixed, { path: 'notes/budget.md', extension: 'md' }, 8, { meta: true, ctrl: true });
		expect(prose.handled).toBe(false);
		expect(prose.opened).toEqual([]);
	});

	it('resolves a fence include against the note and notices a multi-match glob', () => {
		const text = '```beancount\ninclude "../other.bean"\n```';
		const quote = docOf(text).line(2).from + 8;
		const opened = click(text, { path: 'notes/budget.md', extension: 'md' }, quote, {
			meta: true,
			ctrl: true,
			alt: true,
		});
		expect(opened.handled).toBe(true);
		expect(opened.opened).toEqual(['split:other.bean']);
		expect(notices).toEqual([]);

		const glob = click('include "2024/*.bean"', bean, 8, { meta: true, ctrl: true });
		expect(glob.opened).toEqual(['tab:ledger/2024/a.bean']);
		expect(notices).toEqual([globCountNotice('2024/*.bean', 2)]);

		const outside = click('include "../outside.bean"', { path: 'main.bean', extension: 'bean' }, 8, {
			meta: true,
			ctrl: true,
		});
		expect(outside.handled).toBe(true);
		expect(outside.opened).toEqual([]);
		expect(notices).toEqual([missingIncludeNotice('../outside.bean')]);
	});
});

describe('includeLinksExtension', () => {
	it('decorates the quoted path and routes Mod-click through the same opener', () => {
		const text = 'include "a.bean"';
		const doc = docOf(text);
		const file = { path: 'ledger/main.bean', extension: 'bean' };
		const view = {
			state: { doc, field: () => ({ file }) },
			posAtCoords: () => 8,
		};
		const extension = includeLinksExtension({} as App) as unknown as MockViewPlugin<{
			decorations: Array<{ from: number; to: number; value: { spec: { class?: string } } }>;
			update(update: { docChanged: boolean; state: typeof view.state; view: typeof view }): void;
		}> & {
			spec: {
				eventHandlers: { mousedown: (event: MouseEvent, view: unknown) => boolean };
			};
		};
		const plugin = new extension.cls(view as never);
		expect(plugin.decorations).toEqual([
			expect.objectContaining({
				from: 8,
				to: 16,
				value: expect.objectContaining({ spec: { class: INCLUDE_LINK_CLASS } }),
			}),
		]);
		plugin.update({ docChanged: false, state: view.state, view });
		expect(extension.spec.eventHandlers.mousedown({ button: 0 } as MouseEvent, view)).toBe(false);
	});

	it('refreshes marks only when the document or file changes, and opens from the handler', () => {
		let text = 'include "a.bean"';
		let file: { path: string; extension: string } | null = { path: 'ledger/main.bean', extension: 'bean' };
		const view = {
			state: {
				get doc() {
					return docOf(text);
				},
				field: () => ({ file }),
			},
			posAtCoords: () => 8,
		};
		const opened: string[] = [];
		const app = {
			vault: {
				adapter: { getBasePath: () => '/vault' },
				getFiles: () => FILES.map((path) => ({ path })),
			},
			workspace: {
				getLeaf: (pane: PaneType | boolean) => ({
					openFile: (entry: { path: string }) => {
						opened.push(`${String(pane)}:${entry.path}`);
						return Promise.resolve();
					},
				}),
			},
		} as unknown as App;
		const extension = includeLinksExtension(app) as unknown as MockViewPlugin<{
			decorations: Array<{ from: number; to: number }>;
			update(update: { docChanged: boolean; state: typeof view.state; view: typeof view }): void;
		}> & {
			spec: {
				decorations: (plugin: { decorations: unknown }) => unknown;
				eventHandlers: { mousedown: (event: MouseEvent, view: unknown) => boolean };
			};
		};
		const plugin = new extension.cls(view as never);
		expect(extension.spec.decorations(plugin)).toBe(plugin.decorations);
		const stale = plugin.decorations;

		text = 'include "other.bean"';
		plugin.update({ docChanged: false, state: view.state, view });
		expect(plugin.decorations).toBe(stale);

		plugin.update({ docChanged: true, state: view.state, view });
		expect(plugin.decorations).toEqual([expect.objectContaining({ from: 8, to: 20 })]);

		file = null;
		plugin.update({ docChanged: false, state: view.state, view });
		expect(plugin.decorations).toEqual([]);

		file = { path: 'notes/readme.txt', extension: 'txt' };
		plugin.update({ docChanged: false, state: view.state, view });
		expect(plugin.decorations).toEqual([]);

		file = { path: 'ledger/main.bean', extension: 'bean' };
		text = 'include "a.bean"';
		plugin.update({ docChanged: true, state: view.state, view });
		const event = {
			button: 0,
			metaKey: true,
			ctrlKey: true,
			altKey: false,
			shiftKey: false,
			clientX: 8,
			clientY: 0,
			preventDefault() {
				this.defaultPrevented = true;
			},
			defaultPrevented: false,
		} as MouseEvent & { defaultPrevented: boolean };
		expect(extension.spec.eventHandlers.mousedown(event, view)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(opened).toEqual(['tab:ledger/a.bean']);
	});
});
