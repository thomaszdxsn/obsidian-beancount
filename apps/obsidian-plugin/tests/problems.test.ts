/**
 * The Problems view lists bean-check rows the editor cannot mark: a child
 * of the include chain that is not open, and `<load>` / outside-vault
 * reports. Opening a ledger schedules the same run as a save, unless that
 * target was already validated at the same mtime — that open still gets the
 * stored markers, without another bean-check run.
 */
import type { App, PluginManifest, WorkspaceLeaf } from 'obsidian';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { BeanCheckRun, LineDiagnostic } from '../bean-check';
import { setLineDiagnostics } from '../diagnostics';
import BeancountPlugin from '../main';
import { fileMtime, openValidationTarget, ProblemStore, problemRowText, toProblemRows } from '../problems';
import { BeancountProblemsView, drawProblems, revealProblem, revealProblemsView, VIEW_TYPE_PROBLEMS } from '../problems-view';
import type { ProblemsMount } from '../problems-view';
import { createEditor, FakeVault } from './fakes';
import type { FakeEditor } from './fakes';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

function stampMtime(file: object, mtime: number): void {
	Object.assign(file, { stat: { mtime } });
}

/** The diagnostics last published to `editor`, if any. */
function published(editor: FakeEditor): LineDiagnostic[] {
	const last = editor.cm.dispatched[editor.cm.dispatched.length - 1];
	const effect = last?.effects[0] as { value?: unknown; is(spec: unknown): boolean } | undefined;
	return effect?.is(setLineDiagnostics) ? (effect.value as LineDiagnostic[]) : [];
}

interface OpenLeaf {
	view: { file: { path: string }; editor: unknown };
}

/** A loaded-ready plugin whose file-open and vault events the test drives. */
function openPlugin(vault: FakeVault, stored?: unknown) {
	const opened: Array<(file: unknown) => void> = [];
	const leaves: OpenLeaf[] = [];
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: {
				getLeavesOfType: () => leaves,
				get activeEditor() {
					return leaves[0]?.view ?? null;
				},
				on: (name: string, callback: (file: unknown) => void) => {
					if (name === 'file-open') opened.push(callback);
					return { name };
				},
			},
		} as unknown as App,
		manifest,
	) as BeancountPlugin & RecordingPlugin;
	if (stored !== undefined) plugin.loadedData = stored;
	return { plugin, opened, leaves };
}

function problemsView(plugin: BeancountPlugin & RecordingPlugin): BeancountProblemsView {
	const creator = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_PROBLEMS);
	const created = creator?.creator({ app: plugin.app });
	if (!(created instanceof BeancountProblemsView)) throw new Error('missing problems view');
	return created;
}

/** The test double's contentEl is the mount, not a DOM HTMLElement. */
function mountChildren(view: BeancountProblemsView): FakeMount['children'] {
	const el: unknown = view.contentEl;
	if (!el || typeof el !== 'object' || !('children' in el)) throw new Error('problems view has no mount');
	return el.children as FakeMount['children'];
}
function row(file: string, line: number, message: string, vaultPath?: string) {
	return vaultPath ? { file, line, message, vaultPath } : { file, line, message };
}

describe('toProblemRows', () => {
	it('keeps unmapped reports and tags vault files', () => {
		const rows = toProblemRows(
			[
				{ file: '/vault/child.bean', line: 2, message: 'unknown account' },
				{ file: '<load>', line: 0, message: 'does not exist' },
				{ file: '/Users/me/outside.bean', line: 4, message: 'oops' },
			],
			(reported) => (reported === '/vault/child.bean' ? 'child.bean' : undefined),
		);
		expect(rows).toEqual([
			{ file: 'child.bean', line: 2, message: 'unknown account', vaultPath: 'child.bean' },
			{ file: '<load>', line: 0, message: 'does not exist' },
			{ file: '/Users/me/outside.bean', line: 4, message: 'oops' },
		]);
	});
});

describe('ProblemStore', () => {
	it('replaces one target and leaves the other', () => {
		const store = new ProblemStore();
		store.replace('main.bean', [
			row('child.bean', 2, 'unknown account', 'child.bean'),
			row('main.bean', 1, 'old', 'main.bean'),
		]);
		store.replace('note.md', [row('<load>', 0, 'missing')]);

		store.replace('main.bean', [row('child.bean', 4, 'newer', 'child.bean')]);

		expect(store.count()).toBe(2);
		expect(store.groups()).toEqual([
			{
				file: '<load>',
				rows: [row('<load>', 0, 'missing')],
			},
			{
				file: 'child.bean',
				vaultPath: 'child.bean',
				rows: [row('child.bean', 4, 'newer', 'child.bean')],
			},
		]);
	});

	it('clears a target when its new run reports nothing', () => {
		const store = new ProblemStore();
		const seen: number[] = [];
		const unsubscribe = store.subscribe(() => seen.push(store.count()));
		store.replace('main.bean', [row('main.bean', 1, 'bad', 'main.bean')]);
		store.replace('main.bean', []);
		unsubscribe();
		store.replace('other.bean', [row('other.bean', 1, 'still', 'other.bean')]);

		expect(store.groups()).toEqual([
			{
				file: 'other.bean',
				vaultPath: 'other.bean',
				rows: [row('other.bean', 1, 'still', 'other.bean')],
			},
		]);
		expect(seen).toEqual([1, 0]);
	});

	it('sorts groups by file and rows by line then message', () => {
		const store = new ProblemStore();
		store.replace('a', [
			row('z.bean', 3, 'later', 'z.bean'),
			row('a.bean', 5, 'b message', 'a.bean'),
			row('a.bean', 5, 'a message', 'a.bean'),
			row('a.bean', 1, 'first', 'a.bean'),
		]);
		expect(store.groups().map((group) => ({
			file: group.file,
			lines: group.rows.map((entry) => `${entry.line}:${entry.message}`),
		}))).toEqual([
			{ file: 'a.bean', lines: ['1:first', '5:a message', '5:b message'] },
			{ file: 'z.bean', lines: ['3:later'] },
		]);
	});

	it('lists an error reported by two overlapping targets once, until one target clears', () => {
		const store = new ProblemStore();
		store.replace('main.bean', [row('child.bean', 2, 'Invalid account', 'child.bean')]);
		store.replace('child.bean', [row('child.bean', 2, 'Invalid account', 'child.bean')]);
		expect(store.count()).toBe(1);
		expect(store.groups()[0].rows.map((entry) => entry.message)).toEqual(['Invalid account']);
		store.replace('child.bean', []);
		expect(store.count()).toBe(1);
		store.replace('main.bean', []);
		expect(store.count()).toBe(0);
	});

	it('does not notify when clearing a target that was already empty', () => {
		const store = new ProblemStore();
		let calls = 0;
		store.subscribe(() => {
			calls += 1;
		});
		store.replace('missing.bean', []);
		expect(calls).toBe(0);
		expect(store.count()).toBe(0);
	});

	it('clears every target once, and does not notify when already empty', () => {
		const store = new ProblemStore();
		let calls = 0;
		store.subscribe(() => {
			calls += 1;
		});
		store.replace('a.bean', [row('a.bean', 1, 'bad', 'a.bean')]);
		store.replace('b.bean', [row('b.bean', 2, 'worse', 'b.bean')]);
		store.clear();
		expect(store.count()).toBe(0);
		expect(store.rowsFor('a.bean')).toEqual([]);
		expect(calls).toBe(3);
		store.clear();
		expect(calls).toBe(3);
	});
});

describe('openValidationTarget', () => {
	it('schedules a ledger open against the entry ledger', () => {
		expect(
			openValidationTarget({
				path: 'child.bean',
				extension: 'bean',
				text: '',
				entryLedger: '  main.bean  ',
				targetMtime: 10,
				lastValidatedMtime: undefined,
			}),
		).toBe('main.bean');
	});

	it('uses the opened ledger when no entry ledger is set', () => {
		expect(
			openValidationTarget({
				path: 'ledger.beancount',
				extension: 'beancount',
				text: '',
				entryLedger: '   ',
				targetMtime: undefined,
				lastValidatedMtime: 4,
			}),
		).toBe('ledger.beancount');
	});

	it('schedules a markdown note only when it has a beancount fence, and not via the entry ledger', () => {
		const fenced = '```beancount\n2026-10-01 * "Cafe"\n```\n';
		expect(
			openValidationTarget({
				path: 'note.md',
				extension: 'md',
				text: fenced,
				entryLedger: 'main.bean',
				targetMtime: 1,
				lastValidatedMtime: undefined,
			}),
		).toBe('note.md');
		expect(
			openValidationTarget({
				path: 'note.md',
				extension: 'md',
				text: 'just prose',
				entryLedger: 'main.bean',
				targetMtime: 1,
				lastValidatedMtime: undefined,
			}),
		).toBeNull();
	});

	it('skips a target already validated at the same mtime and runs when it moved', () => {
		const base = {
			path: 'main.bean',
			extension: 'bean',
			text: '',
			entryLedger: '',
			targetMtime: 10,
			lastValidatedMtime: 10,
		};
		expect(openValidationTarget(base)).toBeNull();
		expect(openValidationTarget({ ...base, targetMtime: 11 })).toBe('main.bean');
		expect(openValidationTarget({ ...base, targetMtime: undefined })).toBe('main.bean');
	});

	it('ignores files that are neither ledgers nor markdown', () => {
		expect(
			openValidationTarget({
				path: 'pic.png',
				extension: 'png',
				text: '```bean\n2026-01-01 open Assets:Cash\n```',
				entryLedger: '',
				targetMtime: undefined,
				lastValidatedMtime: undefined,
			}),
		).toBeNull();
	});
});

describe('fileMtime', () => {
	it('reads a finite stat and treats a missing stamp as unknown', () => {
		expect(fileMtime({ stat: { mtime: 12 } })).toBe(12);
		expect(fileMtime({ stat: { mtime: Number.NaN } })).toBeUndefined();
		expect(fileMtime({})).toBeUndefined();
		expect(fileMtime(null)).toBeUndefined();
	});
});

class FakeMount implements ProblemsMount {
	children: Array<{ className: string; text: string; clicks: Array<() => void> }> = [];

	empty(): void {
		this.children = [];
	}

	createDiv(opts?: { cls?: string; text?: string }) {
		const child = {
			className: opts?.cls ?? '',
			text: opts?.text ?? '',
			clicks: [] as Array<() => void>,
			addEventListener(_type: 'click', listener: () => void) {
				this.clicks.push(listener);
			},
		};
		this.children.push(child);
		return child;
	}
}

describe('drawProblems', () => {
	it('shows the count and leaves unmapped rows unclickable', () => {
		const mount = new FakeMount();
		const opened: string[] = [];
		drawProblems(
			mount,
			[
				{
					file: '<load>',
					rows: [row('<load>', 0, 'does not exist')],
				},
				{
					file: 'child.bean',
					vaultPath: 'child.bean',
					rows: [row('child.bean', 2, 'unknown account', 'child.bean')],
				},
			],
			(entry) => opened.push(entry.file),
		);
		expect(mount.children.map((child) => ({ className: child.className, text: child.text }))).toEqual([
			{ className: 'beancount-problems-header', text: '2 problems' },
			{ className: 'beancount-problems-file', text: '<load>' },
			{
				className: 'beancount-problems-row beancount-problems-unmapped',
				text: problemRowText(row('<load>', 0, 'does not exist')),
			},
			{ className: 'beancount-problems-file', text: 'child.bean' },
			{
				className: 'beancount-problems-row',
				text: 'child.bean:2  unknown account',
			},
		]);
		expect(mount.children[2].clicks).toEqual([]);
		mount.children[4].clicks[0]();
		expect(opened).toEqual(['child.bean']);
	});

	it('uses a singular header and an empty sentence', () => {
		const one = new FakeMount();
		drawProblems(one, [{ file: 'a.bean', vaultPath: 'a.bean', rows: [row('a.bean', 1, 'x', 'a.bean')] }], () => undefined);
		expect(one.children[0].text).toBe('1 problem');
		const none = new FakeMount();
		drawProblems(none, [], () => undefined);
		expect(none.children.map((child) => child.text)).toEqual(['No problems.']);
	});
});

describe('revealProblemsView', () => {
	it('reveals an existing problems leaf', async () => {
		const existing = { id: 'already-open' };
		const revealed: unknown[] = [];
		const app = {
			workspace: {
				getLeavesOfType: (type: string) => (type === VIEW_TYPE_PROBLEMS ? [existing] : []),
				revealLeaf: (leaf: unknown) => revealed.push(leaf),
				getRightLeaf: () => {
					throw new Error('must not split a new leaf');
				},
			},
		} as unknown as App;
		await revealProblemsView(app);
		expect(revealed).toEqual([existing]);
	});

	it('opens the view in the right leaf when none exists', async () => {
		const states: unknown[] = [];
		const revealed: unknown[] = [];
		const leaf = {
			setViewState: async (state: unknown) => {
				states.push(state);
			},
		};
		const app = {
			workspace: {
				getLeavesOfType: () => [],
				getRightLeaf: (split: boolean) => {
					expect(split).toBe(false);
					return leaf;
				},
				revealLeaf: (opened: unknown) => revealed.push(opened),
			},
		} as unknown as App;
		await revealProblemsView(app);
		expect(states).toEqual([{ type: VIEW_TYPE_PROBLEMS, active: true }]);
		expect(revealed).toEqual([leaf]);
	});

	it('does nothing when the workspace has no right leaf', async () => {
		const app = {
			workspace: {
				getLeavesOfType: () => [],
				getRightLeaf: () => null,
			},
		} as unknown as App;
		await expect(revealProblemsView(app)).resolves.toBeUndefined();
	});
});

describe('revealProblem', () => {
	it('opens a closed vault file and jumps to the 0-based line', async () => {
		const editor = createEditor(['', '  Assets:Cash']);
		const file = { path: 'child.bean', extension: 'bean' };
		const opened: unknown[] = [];
		const focused: unknown[] = [];
		const leaf = {
			view: { editor, file: null as { path: string } | null },
			openFile: async (target: unknown) => {
				opened.push(target);
				leaf.view.file = target as { path: string };
			},
		};
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => (path === 'child.bean' ? file : null),
			},
			workspace: {
				getLeavesOfType: () => [],
				getLeaf: () => leaf,
				setActiveLeaf: (target: unknown) => focused.push(target),
				activeEditor: null,
			},
		} as unknown as App;

		await revealProblem(app, { vaultPath: 'child.bean', line: 2 });

		expect(opened).toEqual([file]);
		expect(focused).toEqual([leaf]);
		expect(editor.getCursor()).toEqual({ line: 1, ch: 0 });
	});

	it('reuses a leaf already showing the file and does not open a folder', async () => {
		const editor = createEditor(['2026-10-01 * "A"']);
		const opened: unknown[] = [];
		const leaf = {
			view: { file: { path: 'main.bean' }, editor },
			openFile: async () => {
				opened.push('open');
			},
		};
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === 'folder' ? { path: 'folder' } : { path, extension: 'bean' },
			},
			workspace: {
				getLeavesOfType: () => [leaf],
				getLeaf: () => {
					throw new Error('must reuse the open leaf');
				},
				setActiveLeaf: () => undefined,
				activeEditor: null,
			},
		} as unknown as App;

		await revealProblem(app, { vaultPath: 'main.bean', line: 1 });
		expect(opened).toEqual([]);
		expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });

		await revealProblem(app, { vaultPath: 'folder', line: 1 });
		expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
	});

	it('does nothing when no leaf can be opened', async () => {
		const focused: unknown[] = [];
		const app = {
			vault: {
				getAbstractFileByPath: () => ({ path: 'child.bean', extension: 'bean' }),
			},
			workspace: {
				getLeavesOfType: () => [],
				getLeaf: () => null,
				setActiveLeaf: (leaf: unknown) => focused.push(leaf),
			},
		} as unknown as App;
		await revealProblem(app, { vaultPath: 'child.bean', line: 4 });
		expect(focused).toEqual([]);
	});

	it('focuses a leafless view, then uses the active editor when the leaf has none', async () => {
		const editor = createEditor(['only']);
		const bare = {
			view: { file: { path: 'child.bean' } },
			openFile: async () => {
				throw new Error('already open');
			},
		};
		const focused: unknown[] = [];
		const workspace = {
			getLeavesOfType: () => [bare],
			getLeaf: () => {
				throw new Error('must reuse the open leaf');
			},
			setActiveLeaf: (leaf: unknown) => focused.push(leaf),
			activeEditor: null as { editor: FakeEditor } | null,
		};
		const app = {
			vault: {
				getAbstractFileByPath: () => ({ path: 'child.bean', extension: 'bean' }),
			},
			workspace,
		} as unknown as App;

		await revealProblem(app, { vaultPath: 'child.bean', line: 1 });
		expect(focused).toEqual([bare]);
		expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
		expect(editor.scrollIntoViewCalls).toEqual([]);

		workspace.activeEditor = { editor };
		await revealProblem(app, { vaultPath: 'child.bean', line: 3 });
		expect(editor.getCursor()).toEqual({ line: 2, ch: 0 });
		expect(editor.scrollIntoViewCalls).toEqual([
			{ range: { from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } }, center: true },
		]);
	});
});

describe('open-triggered validation', () => {
	it('runs bean-check when a ledger opens, skips an unchanged target, and lists unopened include errors', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "child.bean"\n');
		const child = vault.write('child.bean', '2026-10-01 * "Sub"\n');
		stampMtime(main, 10);
		stampMtime(child, 10);
		const opened: Array<(file: unknown) => void> = [];
		const plugin = new BeancountPlugin(
			{
				vault: vault.api,
				workspace: {
					getLeavesOfType: () => [],
					activeEditor: null,
					on: (name: string, callback: (file: unknown) => void) => {
						if (name === 'file-open') opened.push(callback);
						return { name };
					},
				},
			} as unknown as App,
			manifest,
		) as BeancountPlugin & RecordingPlugin;
		plugin.loadedData = { entryLedger: 'main.bean' };
		await plugin.onload();
		const runs: string[][] = [];
		plugin.beanCheckRunner = async (_command, args) => {
			runs.push([...args]);
			const stderr = [
				'/vault/child.bean:2:       Invalid reference to unknown account \'Assets:Cash\'',
				'<load>:0:       File "/vault/gone.bean" does not exist',
				'',
			].join('\n');
			return { stderr, missing: false } satisfies BeanCheckRun;
		};

		expect(plugin.registrations.commands.find((entry) => entry.id === 'show-problems')?.name).toBe('Show problems');
		expect(opened).toHaveLength(1);

		opened[0](child);
		await delay(600);
		expect(runs).toEqual([['/vault/main.bean']]);

		stampMtime(child, 99);
		opened[0](child);
		await delay(600);
		expect(runs).toHaveLength(1);

		stampMtime(main, 11);
		opened[0](main);
		await delay(600);
		expect(runs).toHaveLength(2);

		const creator = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_PROBLEMS);
		const created = creator?.creator({ app: plugin.app });
		if (!(created instanceof BeancountProblemsView)) throw new Error('missing problems view');
		await created.onOpen();
		const children = mountChildren(created);
		const texts = children.map((child) => child.text);
		expect(created.getViewType()).toBe(VIEW_TYPE_PROBLEMS);
		expect(texts[0]).toBe('2 problems');
		expect(texts).toContain('<load>:0  File "/vault/gone.bean" does not exist');
		expect(texts).toContain("child.bean:2  Invalid reference to unknown account 'Assets:Cash'");
		const unmapped = children.find((child) => child.text.startsWith('<load>:'));
		expect(unmapped?.clicks).toEqual([]);
		expect(unmapped?.className).toContain('beancount-problems-unmapped');
	});

	it('does not schedule a prose note, and does schedule a fenced note', async () => {
		const vault = new FakeVault();
		const prose = vault.write('note.md', 'just prose');
		const fenced = vault.write('fenced.md', '```bean\n2026-10-01 * "A"\n```\n');
		const proseEditor = createEditor(['just prose']);
		const fencedEditor = createEditor(['```bean', '2026-10-01 * "A"', '```', '']);
		const opened: Array<(file: unknown) => void> = [];
		let leaves: Array<{ view: { file: { path: string }; editor: unknown } }> = [];
		const plugin = new BeancountPlugin(
			{
				vault: vault.api,
				workspace: {
					getLeavesOfType: () => leaves,
					get activeEditor() {
						return leaves[0]?.view ?? null;
					},
					on: (name: string, callback: (file: unknown) => void) => {
						if (name === 'file-open') opened.push(callback);
						return { name };
					},
				},
			} as unknown as App,
			manifest,
		);
		await plugin.onload();
		const runs: number[] = [];
		plugin.beanCheckRunner = async () => {
			runs.push(1);
			return { stderr: '', missing: false };
		};
		const readsBefore = vault.reads.length;

		leaves = [{ view: { file: prose, editor: proseEditor } }];
		opened[0](prose);
		await delay(600);
		expect(runs).toEqual([]);
		expect(vault.reads.length).toBe(readsBefore);

		leaves = [{ view: { file: fenced, editor: fencedEditor } }];
		opened[0](fenced);
		await delay(600);
		expect(runs).toEqual([1]);
	});
});

describe('stored markers and stale targets', () => {
	it('marks a second child from the stored report without another bean-check run', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "a.bean"\ninclude "b.bean"\n');
		const a = vault.write('a.bean', '2026-10-01 * "A"\n');
		const b = vault.write('b.bean', '2026-10-01 * "B"\n  Assets:Cash  5.00 USD\n');
		stampMtime(main, 10);
		stampMtime(a, 10);
		stampMtime(b, 10);
		const editorA = createEditor(['2026-10-01 * "A"']);
		const editorB = createEditor(['2026-10-01 * "B"', '  Assets:Cash  5.00 USD']);
		const { plugin, opened, leaves } = openPlugin(vault, { entryLedger: 'main.bean' });
		await plugin.onload();
		const runs: string[][] = [];
		plugin.beanCheckRunner = async (_command, args) => {
			runs.push([...args]);
			return {
				stderr: "/vault/b.bean:2:       Invalid reference to unknown account 'Assets:Cash'\n",
				missing: false,
			};
		};

		// b is not open when the entry ledger's run finishes, so it is not marked.
		leaves.push({ view: { file: a, editor: editorA } });
		opened[0](a);
		await delay(600);
		expect(runs).toEqual([['/vault/main.bean']]);
		expect(editorB.cm.dispatched).toEqual([]);

		// Background pane: not the active editor, still needs the stored markers.
		leaves.push({ view: { file: b, editor: editorB } });
		opened[0](b);
		expect(published(editorB)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
		await delay(600);
		expect(runs).toHaveLength(1);
		// A later child mtime must not look like the entry ledger changed.
		stampMtime(b, 99);
		const again = createEditor(['2026-10-01 * "B"', '  Assets:Cash  5.00 USD']);
		leaves[1] = { view: { file: b, editor: again } };
		opened[0](b);
		expect(published(again)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
		await delay(600);
		expect(runs).toHaveLength(1);
	});

	it('reapplies stored markers when a ledger tab is closed and reopened', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n  Assets:Cash  1.00 USD\n');
		stampMtime(file, 3);
		const first = createEditor(['2026-10-01 * "A"', '  Assets:Cash  1.00 USD']);
		const { plugin, opened, leaves } = openPlugin(vault);
		await plugin.onload();
		let runs = 0;
		plugin.beanCheckRunner = async () => {
			runs += 1;
			return {
				stderr: "/vault/ledger.bean:2:       Invalid reference to unknown account 'Assets:Cash'\n",
				missing: false,
			};
		};

		leaves.push({ view: { file, editor: first } });
		opened[0](file);
		await delay(600);
		expect(runs).toBe(1);
		expect(published(first)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);

		const again = createEditor(['2026-10-01 * "A"', '  Assets:Cash  1.00 USD']);
		leaves[0] = { view: { file, editor: again } };
		opened[0](file);
		expect(published(again)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
		await delay(600);
		expect(runs).toBe(1);
	});

	it('reapplies host-mapped fence markers when a note is reopened', async () => {
		const note = ['# Grocery', '', '```beancount', '2026-10-01 * "Cafe"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		stampMtime(file, 4);
		const first = createEditor(note.split('\n'));
		const { plugin, opened, leaves } = openPlugin(vault);
		await plugin.onload();
		let runs = 0;
		plugin.beanCheckRunner = async (_command, args) => {
			runs += 1;
			return { stderr: `${args[0]}:1:       Invalid token\n`, missing: false };
		};

		leaves.push({ view: { file, editor: first } });
		opened[0](file);
		await delay(600);
		expect(runs).toBe(1);
		// Temp line 1 is the fence body — markdown line 4, not the temp file's line 1.
		expect(published(first)).toEqual([{ line: 3, message: 'Invalid token' }]);

		const again = createEditor(note.split('\n'));
		leaves[0] = { view: { file, editor: again } };
		opened[0](file);
		expect(published(again)).toEqual([{ line: 3, message: 'Invalid token' }]);
		await delay(600);
		expect(runs).toBe(1);
	});

	it('drops rows for a deleted or renamed target and keeps the other', async () => {
		const vault = new FakeVault();
		const alpha = vault.write('alpha.bean', '2026-10-01 * "A"\n');
		const beta = vault.write('beta.bean', '2026-10-01 * "B"\n');
		stampMtime(alpha, 1);
		stampMtime(beta, 1);
		const { plugin, opened, leaves } = openPlugin(vault);
		await plugin.onload();
		plugin.beanCheckRunner = async (_command, args) => {
			const name = args[0].endsWith('beta.bean') ? 'beta.bean' : 'alpha.bean';
			return { stderr: `/vault/${name}:1:       bad ${name}\n`, missing: false };
		};
		leaves.push({ view: { file: alpha, editor: createEditor(['2026-10-01 * "A"']) } });
		opened[0](alpha);
		await delay(600);
		leaves.push({ view: { file: beta, editor: createEditor(['2026-10-01 * "B"']) } });
		opened[0](beta);
		await delay(600);

		const view = problemsView(plugin);
		await view.onOpen();
		expect(mountChildren(view).map((child) => child.text)).toEqual(
			expect.arrayContaining(['2 problems', 'alpha.bean:1  bad alpha.bean', 'beta.bean:1  bad beta.bean']),
		);

		await vault.emit('delete', vault.delete('alpha.bean'));
		const afterDelete = mountChildren(view).map((child) => child.text);
		expect(afterDelete[0]).toBe('1 problem');
		expect(afterDelete).not.toContain('alpha.bean:1  bad alpha.bean');
		expect(afterDelete).toContain('beta.bean:1  bad beta.bean');

		const renamed = vault.rename('beta.bean', 'gamma.bean');
		await vault.emit('rename', renamed, 'beta.bean');
		expect(mountChildren(view).map((child) => child.text)).toEqual(['No problems.']);
	});

	it('clears the store when entryLedger changes, and not when another setting is saved', async () => {
		const vault = new FakeVault();
		const file = vault.write('child.bean', '2026-10-01 * "Sub"\n');
		stampMtime(file, 10);
		const editor = createEditor(['2026-10-01 * "Sub"']);
		const { plugin, opened, leaves } = openPlugin(vault);
		await plugin.onload();
		const runs: string[][] = [];
		plugin.beanCheckRunner = async (_command, args) => {
			runs.push([...args]);
			return { stderr: "/vault/child.bean:1:       bad\n", missing: false };
		};
		leaves.push({ view: { file, editor } });
		opened[0](file);
		await delay(600);
		expect(runs).toHaveLength(1);

		const view = problemsView(plugin);
		await view.onOpen();
		expect(mountChildren(view).map((child) => child.text)).toContain('child.bean:1  bad');

		plugin.settings.alignOnSave = false;
		await plugin.saveSettings();
		expect(mountChildren(view).map((child) => child.text)).toContain('child.bean:1  bad');

		// Same target, same mtime: the recorded skip must hold until the setting changes.
		opened[0](file);
		await delay(600);
		expect(runs).toHaveLength(1);

		plugin.settings.entryLedger = 'main.bean';
		await plugin.saveSettings();
		expect(mountChildren(view).map((child) => child.text)).toEqual(['No problems.']);

		plugin.settings.entryLedger = '';
		await plugin.saveSettings();
		opened[0](file);
		await delay(600);
		// The mtime map was dropped with the store, so the same file is checked again.
		expect(runs).toHaveLength(2);
	});
});

describe('BeancountProblemsView', () => {
	it('redraws when the store replaces a target', async () => {
		const store = new ProblemStore();
		const leaf = { app: { workspace: {}, vault: {} } } as unknown as WorkspaceLeaf;
		const view = new BeancountProblemsView(leaf, store);
		await view.onOpen();
		expect(mountChildren(view).map((child) => child.text)).toEqual(['No problems.']);

		store.replace('main.bean', [row('child.bean', 3, 'bad', 'child.bean')]);
		expect(mountChildren(view).map((child) => child.text)).toContain('child.bean:3  bad');

		await view.onClose();
		store.replace('main.bean', [row('child.bean', 9, 'later', 'child.bean')]);
		expect(mountChildren(view).map((child) => child.text)).not.toContain('child.bean:9  later');
	});

	it('names itself for the sidebar', () => {
		const view = new BeancountProblemsView({ app: {} } as unknown as WorkspaceLeaf, new ProblemStore());
		expect(view.getDisplayText()).toBe('Beancount Problems');
		expect(view.getIcon()).toBe('alert-triangle');
		expect(view.getViewType()).toBe(VIEW_TYPE_PROBLEMS);
	});

	it('replaces the previous subscription and resumes after it is opened again', async () => {
		const store = new ProblemStore();
		const view = new BeancountProblemsView({ app: { workspace: {}, vault: {} } } as unknown as WorkspaceLeaf, store);
		await view.onOpen();
		await view.onOpen();
		store.replace('main.bean', [row('child.bean', 1, 'once', 'child.bean')]);
		expect(mountChildren(view).filter((child) => child.text === 'child.bean:1  once')).toHaveLength(1);

		await view.onClose();
		await view.onClose();
		store.replace('main.bean', [row('child.bean', 2, 'closed', 'child.bean')]);
		expect(mountChildren(view).map((child) => child.text)).not.toContain('child.bean:2  closed');

		await view.onOpen();
		store.replace('main.bean', [row('child.bean', 3, 'reopened', 'child.bean')]);
		expect(mountChildren(view).map((child) => child.text)).toContain('child.bean:3  reopened');
	});

	it('opens the clicked vault row and ignores an empty vault path', async () => {
		const editor = createEditor(['', '  Assets:Cash']);
		const file = { path: 'child.bean', extension: 'bean' };
		const opened: unknown[] = [];
		const workspaceLeaf = {
			view: { editor, file: null as { path: string } | null },
			openFile: async (target: unknown) => {
				opened.push(target);
			},
		};
		let lookups = 0;
		const app = {
			vault: {
				getAbstractFileByPath: (path: string) => {
					lookups += 1;
					return path === 'child.bean' ? file : null;
				},
			},
			workspace: {
				getLeavesOfType: () => [],
				getLeaf: () => workspaceLeaf,
				setActiveLeaf: () => undefined,
				activeEditor: null,
			},
		};
		const store = new ProblemStore();
		const view = new BeancountProblemsView({ app } as unknown as WorkspaceLeaf, store);
		await view.onOpen();
		store.replace('main.bean', [
			{ file: 'gone', line: 1, message: 'missing', vaultPath: '' },
			row('child.bean', 2, 'bad', 'child.bean'),
		]);
		const rows = mountChildren(view).filter((child) => child.className === 'beancount-problems-row');
		const empty = rows.find((child) => child.text.startsWith('gone:'));
		const mapped = rows.find((child) => child.text.startsWith('child.bean:'));
		expect(empty?.clicks).toHaveLength(1);
		expect(mapped?.clicks).toHaveLength(1);
		empty?.clicks[0]();
		await Promise.resolve();
		expect(lookups).toBe(0);
		expect(opened).toEqual([]);

		mapped?.clicks[0]();
		await Promise.resolve();
		await Promise.resolve();
		expect(opened).toEqual([file]);
		expect(editor.getCursor()).toEqual({ line: 1, ch: 0 });
		expect(editor.scrollIntoViewCalls).toEqual([
			{ range: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } }, center: true },
		]);
	});
});
