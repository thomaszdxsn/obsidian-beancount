import type { App, WorkspaceLeaf } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE_REFRESH_MS, BeancountBalancesView, drawBalances, revealBalancesView, VIEW_TYPE_BALANCES } from '../report-view';
import type { BalanceDraw, BalanceEl, BalanceMount } from '../report-view';
import { FakeVault } from './fakes';

interface FakeNode extends BalanceEl {
	className: string;
	text: string;
	children: FakeNode[];
}


function mountOf(): BalanceMount & { children: FakeNode[] } {
	const mount = {
		children: [] as FakeNode[],
		empty() {
			this.children = [];
		},
		createDiv(opts?: { cls?: string; text?: string }) {
			const node = nodeOf(opts);
			this.children.push(node);
			return node;
		},
	};
	return mount;
}

function nodeOf(opts?: { cls?: string; text?: string }): FakeNode {
	const node: FakeNode = {
		className: opts?.cls ?? '',
		text: opts?.text ?? '',
		children: [],
		createDiv(nested) {
			const child = nodeOf(nested);
			this.children.push(child);
			return child;
		},
	};
	return node;
}

function texts(nodes: readonly FakeNode[]): string[] {
	const out: string[] = [];
	for (const node of nodes) {
		if (node.text) out.push(node.text);
		out.push(...texts(node.children));
	}
	return out;
}

/** Every text the view drew. */
function shownIn(view: BeancountBalancesView): string[] {
	// The mock `ItemView.contentEl` builds `FakeNode`-shaped children; its declared type is Obsidian's HTMLElement.
	const content = view.contentEl as unknown as { children: FakeNode[] };
	return texts(content.children);
}

describe('drawBalances', () => {
	it('draws one right-aligned amount line per currency and a placeholder when empty', () => {
		const mount = mountOf();
		const draw: BalanceDraw = {
			kind: 'table',
			rows: [{ account: 'Assets:Bank', amounts: [{ text: '5.5', currency: 'EUR' }, { text: '10', currency: 'USD' }] }],
		};
		drawBalances(mount, draw);
		const rows = mount.children[0].children.filter((child) => child.className === 'beancount-balances-row');
		expect(rows.map((row) => row.children.map((cell) => cell.text))).toEqual([
			['Assets:Bank', '5.5 EUR'],
			['', '10 USD'],
		]);
		expect(rows[0].children[1].className).toBe('beancount-balances-amount');

		drawBalances(mount, { kind: 'table', rows: [] });
		expect(texts(mount.children)).toContain('No balances.');

		drawBalances(mount, {
			kind: 'errors',
			errors: [{ file: 'child.bean', line: 2, message: 'Too many postings with missing amounts' }],
		});
		expect(texts(mount.children)).toEqual(['child.bean:2  Too many postings with missing amounts']);
		expect(mount.children.some((child) => child.className.includes('amount'))).toBe(false);
	});
});

describe('revealBalancesView', () => {
	it('reveals an existing leaf, opens a right leaf, or does nothing without one', async () => {
		const existing = { id: 'existing' };
		const revealed: unknown[] = [];
		await revealBalancesView({
			workspace: {
				getLeavesOfType: (type: string) => (type === VIEW_TYPE_BALANCES ? [existing] : []),
				revealLeaf: async (leaf: unknown) => {
					revealed.push(leaf);
				},
				getRightLeaf: () => {
					throw new Error('must not split');
				},
			},
		} as unknown as App);
		expect(revealed).toEqual([existing]);

		const leaf = { setViewState: async (state: unknown) => states.push(state) };
		const states: unknown[] = [];
		await revealBalancesView({
			workspace: {
				getLeavesOfType: () => [],
				getRightLeaf: () => leaf,
				revealLeaf: async (opened: unknown) => revealed.push(opened),
			},
		} as unknown as App);
		expect(states).toEqual([{ type: VIEW_TYPE_BALANCES, active: true }]);

		await expect(
			revealBalancesView({
				workspace: { getLeavesOfType: () => [], getRightLeaf: () => null, revealLeaf: () => undefined },
			} as unknown as App),
		).resolves.toBeUndefined();
	});
});

function viewFor(vault: FakeVault, file: { path: string; extension: string } | null, entryLedger = '') {
	const box = { file };
	const events: Array<{ name: string; callback: (leaf?: unknown) => void }> = [];
	const app = {
		vault: vault.api,
		workspace: {
			getActiveFile: () => box.file,
			on: (name: string, callback: (leaf?: unknown) => void) => {
				events.push({ name, callback });
				return { name };
			},
			getLeavesOfType: () => [],
			getRightLeaf: () => null,
			revealLeaf: async () => undefined,
		},
	};
	const view = new BeancountBalancesView({ app } as unknown as WorkspaceLeaf, { settings: { entryLedger } });
	return { view, events, box, app };
}

describe('BeancountBalancesView', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('draws the active ledger, note fences, and an entry ledger in preference', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n');
		vault.write('note.md', '# hi\n```bean\n2020-01-02 * "n"\n  Assets:Bank  2 EUR\n  Expenses:Food\n```\n');
		vault.write('main.bean', '2020-01-03 * "m"\n  Assets:Cash  9 USD\n  Expenses:Food\n');
		const { view } = viewFor(vault, { path: 'ledger.bean', extension: 'bean' });
		expect(view.getViewType()).toBe(VIEW_TYPE_BALANCES);
		expect(view.getDisplayText()).toBe('Account balances');
		expect(view.getIcon()).toBe('table');

		await view.onOpen();
		expect(texts((view.contentEl as unknown as BalanceMount & { children: FakeNode[] }).children)).toContain('Assets:Cash');

		const note = viewFor(vault, { path: 'note.md', extension: 'md' });
		await note.view.onOpen();
		expect(shownIn(note.view)).toContain('2 EUR');

		const prose = viewFor(vault, { path: 'note.md', extension: 'md' });
		vault.write('empty.md', '# no fences\n');
		prose.box.file = { path: 'empty.md', extension: 'md' };
		await prose.view.onOpen();
		expect(shownIn(prose.view)).toEqual([
			'This note has no Beancount fences.',
		]);

		const entry = viewFor(vault, { path: 'ledger.bean', extension: 'bean' }, 'main.bean');
		await entry.view.onOpen();
		expect(shownIn(entry.view)).toContain('9 USD');
		expect(shownIn(entry.view)).not.toContain('1 USD');
	});

	it('shows a missing entry and a parse error instead of numbers', async () => {
		const vault = new FakeVault();
		const missing = viewFor(vault, null, 'gone.bean');
		await missing.view.onOpen();
		expect(shownIn(missing.view)[0]).toMatch(/Entry ledger not found/);

		vault.write('bad.bean', '2020-01-01 open\n');
		const broken = viewFor(vault, { path: 'bad.bean', extension: 'bean' });
		await broken.view.onOpen();
		const shown = shownIn(broken.view);
		expect(shown.some((text) => text.startsWith('bad.bean:'))).toBe(true);
		expect(shown.some((text) => text.includes('USD'))).toBe(false);
	});

	it("reports a fence error at the note's line and keeps fences from merging", async () => {
		const vault = new FakeVault();
		const note = [
			'# Spending', // 1
			'```beancount', // 2
			'2020-01-01 * "a"', // 3
			'  Assets:Cash  1 USD', // 4
			'  Expenses:Food', // 5
			'```', // 6
			'prose', // 7
			'```beancount', // 8
			'2020-01-02 open', // 9
			'```', // 10
		].join('\n');
		vault.write('note.md', note);
		const broken = viewFor(vault, { path: 'note.md', extension: 'md' });
		await broken.view.onOpen();
		const shown = shownIn(broken.view);
		expect(shown.some((text) => text.startsWith('note.md:9'))).toBe(true);

		// An indented line opening the second fence must not join the first fence's entry.
		vault.write('two.md', '```bean\n2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n```\n```bean\n  Assets:Bank  5 USD\n```\n');
		const split = viewFor(vault, { path: 'two.md', extension: 'md' });
		await split.view.onOpen();
		const splitShown = shownIn(split.view);
		expect(splitShown.some((text) => text.includes('5 USD'))).toBe(false);
		expect(splitShown.some((text) => text.startsWith('two.md:7'))).toBe(true);
	});

	it('keeps the last ledger when focus leaves the file, and clears a non-ledger file', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n');
		const { view, events, box } = viewFor(vault, { path: 'ledger.bean', extension: 'bean' });
		await view.onOpen();
		box.file = null;
		events[0].callback();
		await Promise.resolve();
		expect(shownIn(view)).toContain('Assets:Cash');

		box.file = { path: 'pic.png', extension: 'png' };
		events[0].callback();
		await Promise.resolve();
		expect(shownIn(view)).toEqual([
			'Open a Beancount file to see account balances.',
		]);
		events[0].callback({ view });
		expect(shownIn(view)).toEqual([
			'Open a Beancount file to see account balances.',
		]);
	});

	it('debounces a modify of an included file and ignores unrelated files', async () => {
		vi.useFakeTimers();
		const vault = new FakeVault();
		vault.write('main.bean', 'include "child.bean"\n');
		vault.write('child.bean', '2020-01-01 * "c"\n  Assets:Cash  1 USD\n  Expenses:Food\n');
		vault.write('other.md', 'prose');
		vault.api.read = async (file) => vault.contents.get(file.path) ?? '';
		const { view } = viewFor(vault, null, 'main.bean');
		const opening = view.onOpen();
		await vi.runAllTimersAsync();
		await opening;
		const shown = () => shownIn(view);
		expect(shown()).toContain('1 USD');

		const modify = vault.handlers.get('modify') ?? [];
		modify[0](vault.files.get('other.md') as never);
		await vi.advanceTimersByTimeAsync(BALANCE_REFRESH_MS);
		expect(shown()).toContain('1 USD');

		vault.write('child.bean', '2020-01-01 * "c"\n  Assets:Cash  6 USD\n  Expenses:Food\n');
		modify[0](vault.files.get('child.bean') as never);
		await vi.advanceTimersByTimeAsync(BALANCE_REFRESH_MS - 1);
		expect(shown()).toContain('1 USD');
		await vi.advanceTimersByTimeAsync(1);
		expect(shown()).toContain('6 USD');

		vault.write('child.bean', '2020-01-01 * "c"\n  Assets:Cash  8 USD\n  Expenses:Food\n');
		modify[0](vault.files.get('child.bean') as never);
		await view.onClose();
		await vi.advanceTimersByTimeAsync(BALANCE_REFRESH_MS);
		expect(shown()).toContain('6 USD');
	});

	it('drops a stale read when a newer sync finishes first', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n');
		const { view } = viewFor(vault, { path: 'ledger.bean', extension: 'bean' });
		const pending: Array<(text: string) => void> = [];
		vault.api.read = () => new Promise((resolve) => pending.push(resolve));
		const first = view.sync();
		const second = view.sync();
		expect(pending).toHaveLength(2);
		pending[1]('2020-01-01 * "b"\n  Assets:Cash  4 USD\n  Expenses:Food\n');
		await second;
		pending[0]('2020-01-01 * "a"\n  Assets:Cash  1 USD\n  Expenses:Food\n');
		await first;
		expect(shownIn(view)).toContain('4 USD');
		expect(shownIn(view)).not.toContain('1 USD');
	});
});
