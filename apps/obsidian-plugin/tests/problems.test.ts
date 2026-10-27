/**
 * The Problems view lists bean-check rows the editor cannot mark: a child
 * of the include chain that is not open, and `<load>` / outside-vault
 * reports.
 */
import type { App, WorkspaceLeaf } from 'obsidian';
import { describe, expect, it } from 'vitest';
import {
	fileMtime,
	ProblemStore,
	problemRowText,
	toProblemRows,
	VALIDATION_FAILURE_PREFIX,
} from '../problems';
import { BeancountProblemsView, drawProblems, revealProblem, revealProblemsView, VIEW_TYPE_PROBLEMS } from '../problems-view';
import type { ProblemsMount } from '../problems-view';
import { createEditor } from './fakes';
import type { FakeEditor } from './fakes';

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

	it('lists a run failure beside existing rows until the next report', () => {
		const store = new ProblemStore();
		store.replace('ledger.bean', [row('ledger.bean', 1, 'does not balance', 'ledger.bean')]);
		store.fail('ledger.bean', 'timed out');
		expect(store.rowsFor('ledger.bean')).toEqual([row('ledger.bean', 1, 'does not balance', 'ledger.bean')]);
		expect(store.groups()[0].rows.map((entry) => entry.message)).toEqual([
			`${VALIDATION_FAILURE_PREFIX}timed out`,
			'does not balance',
		]);
		store.fail('ledger.bean', 'timed out');
		store.replace('ledger.bean', [row('ledger.bean', 1, 'does not balance', 'ledger.bean')]);
		expect(store.groups()[0].rows.map((entry) => entry.message)).toEqual(['does not balance']);
		store.fail('note.md', 'could not write the temporary ledger');
		expect(store.count()).toBe(2);
		store.replace('note.md', []);
		expect(store.count()).toBe(1);
	});

	it('does not notify when recording the same failure twice', () => {
		const store = new ProblemStore();
		let calls = 0;
		store.subscribe(() => {
			calls += 1;
		});
		store.fail('ledger.bean', 'not found');
		store.fail('ledger.bean', 'not found');
		expect(calls).toBe(1);
		store.replace('ledger.bean', []);
		expect(calls).toBe(2);
		store.replace('ledger.bean', []);
		expect(calls).toBe(2);
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

describe('problemRowText', () => {
	it('omits the line number when it is 0', () => {
		expect(problemRowText(row('<load>', 0, 'does not exist'))).toBe('<load>  does not exist');
		expect(problemRowText(row('ledger.bean', 0, `${VALIDATION_FAILURE_PREFIX}timed out`))).toBe(
			`ledger.bean  ${VALIDATION_FAILURE_PREFIX}timed out`,
		);
		expect(problemRowText(row('child.bean', 2, 'unknown account'))).toBe('child.bean:2  unknown account');
	});
});

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

	it('does not make a line-0 row clickable even when it names a vault file', () => {
		const mount = new FakeMount();
		drawProblems(
			mount,
			[
				{
					file: 'ledger.bean',
					vaultPath: 'ledger.bean',
					rows: [row('ledger.bean', 0, `${VALIDATION_FAILURE_PREFIX}timed out`, 'ledger.bean')],
				},
			],
			() => {
				throw new Error('opened');
			},
		);
		expect(mount.children.map((child) => ({ className: child.className, text: child.text, clicks: child.clicks.length }))).toEqual([
			{ className: 'beancount-problems-header', text: '1 problem', clicks: 0 },
			{ className: 'beancount-problems-file', text: 'ledger.bean', clicks: 0 },
			{
				className: 'beancount-problems-row beancount-problems-unmapped',
				text: `ledger.bean  ${VALIDATION_FAILURE_PREFIX}timed out`,
				clicks: 0,
			},
		]);
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
		const children = mountChildren(view);
		const empty = children.find((child) => child.text.startsWith('gone:'));
		const mapped = children.find((child) => child.text.startsWith('child.bean:'));
		expect(empty?.className).toBe('beancount-problems-row beancount-problems-unmapped');
		expect(empty?.clicks).toEqual([]);
		expect(mapped?.className).toBe('beancount-problems-row');
		expect(mapped?.clicks).toHaveLength(1);
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
