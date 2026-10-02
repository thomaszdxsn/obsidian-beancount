import type { App, Editor, WorkspaceLeaf } from 'obsidian';
import { describe, expect, it } from 'vitest';
import {
	BeancountOutlineView,
	drawOutline,
	revealOutlineView,
	VIEW_TYPE_OUTLINE,
} from '../outline-view';
import {
	DUMMY_HEADING,
	flattenOutline,
	jumpToOutlineLine,
	parseBeancountOutline,
} from '../outline';
import type { OutlineNode } from '../outline';
import { createEditor } from './fakes';
import type { FakeEditor } from './fakes';

function titles(nodes: readonly OutlineNode[]): unknown {
	return nodes.map((node) => ({
		kind: node.kind,
		title: node.title,
		line: node.line,
		children: titles(node.children),
	}));
}

class FakeMount {
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

describe('parseBeancountOutline', () => {
	it('is empty for a blank buffer', () => {
		expect(parseBeancountOutline('')).toEqual([]);
		expect(parseBeancountOutline('\n\n')).toEqual([]);
	});

	it('groups consecutive transactions by date and jumps to the header line', () => {
		const text = [
			'2026-01-01 * "Store" "Groceries"',
			'  Expenses:Food  10.00 USD',
			'2026-01-01 * "Cafe" "Coffee"',
			'2026-01-02 * "Metro"',
		].join('\n');

		expect(titles(parseBeancountOutline(text))).toEqual([
			{
				kind: 'date',
				title: '2026-01-01',
				line: 0,
				children: [
					{ kind: 'transaction', title: 'Store — Groceries', line: 0, children: [] },
					{ kind: 'transaction', title: 'Cafe — Coffee', line: 2, children: [] },
				],
			},
			{
				kind: 'date',
				title: '2026-01-02',
				line: 3,
				children: [{ kind: 'transaction', title: 'Metro', line: 3, children: [] }],
			},
		]);
	});

	it('opens a new date group when the same date reappears after another', () => {
		const text = [
			'2026-01-01 * "A"',
			'2026-01-02 * "B"',
			'2026-01-01 * "C"',
		].join('\n');
		const nodes = parseBeancountOutline(text);
		expect(nodes.map((node) => node.title)).toEqual(['2026-01-01', '2026-01-02', '2026-01-01']);
		expect(nodes[2].children.map((child) => child.title)).toEqual(['C']);
	});

	it('uses the flag as the title when a transaction has no quoted fields', () => {
		expect(titles(parseBeancountOutline('2026-01-01 *'))).toEqual([
			{
				kind: 'date',
				title: '2026-01-01',
				line: 0,
				children: [{ kind: 'transaction', title: '*', line: 0, children: [] }],
			},
		]);
		expect(parseBeancountOutline('2026-01-01 txn')[0].children[0].title).toBe('txn');
		expect(parseBeancountOutline('2026-01-01 ! "Only"')[0].children[0].title).toBe('Only');
		expect(parseBeancountOutline('2026-01-01 * "" "Narration"')[0].children[0].title).toBe('Narration');
	});
	it('unescapes quoted fields so the outline shows the payee as written', () => {
		expect(parseBeancountOutline('2026-01-01 * "Say \\"Hi\\"" "Note"')[0].children[0].title).toBe(
			'Say "Hi" — Note'
		);
	});

	it('keeps slash dates as written rather than normalizing them', () => {
		expect(parseBeancountOutline('2026/01/02 * "A"')[0].title).toBe('2026/01/02');
	});

	it('nests open, close and balance under the date, and ignores pad and price', () => {
		const text = [
			'2026-01-01 open Assets:Cash USD',
			'2026-01-01 pad Assets:Cash Equity:Opening',
			'2026-01-01 balance Assets:Cash  10.00 USD',
			'2026-01-02 close Assets:Cash',
			'2026-01-02 price USD  7.20 CNY',
		].join('\n');
		expect(titles(parseBeancountOutline(text))).toEqual([
			{
				kind: 'date',
				title: '2026-01-01',
				line: 0,
				children: [
					{ kind: 'open', title: 'open Assets:Cash', line: 0, children: [] },
					{ kind: 'balance', title: 'balance Assets:Cash', line: 2, children: [] },
				],
			},
			{
				kind: 'date',
				title: '2026-01-02',
				line: 3,
				children: [{ kind: 'close', title: 'close Assets:Cash', line: 3, children: [] }],
			},
		]);
	});

	it('still lists a directive when the account token is missing', () => {
		expect(parseBeancountOutline('2026-01-01 open')[0].children[0].title).toBe('open');
	});

	it('builds a heading tree with vscode dummy levels for skipped depths', () => {
		const text = [
			'* Food',
			'** Groceries',
			'2026-01-01 * "Store"',
			'*** Nested',
			'* Travel',
			'*** Flights',
		].join('\n');
		expect(titles(parseBeancountOutline(text))).toEqual([
			{
				kind: 'heading',
				title: 'Food',
				line: 0,
				children: [
					{
						kind: 'heading',
						title: 'Groceries',
						line: 1,
						children: [
							{
								kind: 'date',
								title: '2026-01-01',
								line: 2,
								children: [{ kind: 'transaction', title: 'Store', line: 2, children: [] }],
							},
							{ kind: 'heading', title: 'Nested', line: 3, children: [] },
						],
					},
				],
			},
			{
				kind: 'heading',
				title: 'Travel',
				line: 4,
				children: [
					{
						kind: 'heading',
						title: DUMMY_HEADING,
						line: 5,
						children: [{ kind: 'heading', title: 'Flights', line: 5, children: [] }],
					},
				],
			},
		]);
	});

	it('skips empty heading names and stops the title at a semicolon', () => {
		const text = ['*', '*; region', '*  Costs  ; trailing', '2026-01-01 * "A"'].join('\n');
		expect(titles(parseBeancountOutline(text))).toEqual([
			{
				kind: 'heading',
				title: 'Costs',
				line: 2,
				children: [
					{
						kind: 'date',
						title: '2026-01-01',
						line: 3,
						children: [{ kind: 'transaction', title: 'A', line: 3, children: [] }],
					},
				],
			},
		]);
	});

	it('ignores indented lines, comments and option directives', () => {
		const text = [
			'; comment',
			'  2026-01-01 * "Indented"',
			'option "operating_currency" "USD"',
			'2026-01-01 * "Real"',
		].join('\n');
		expect(parseBeancountOutline(text)).toHaveLength(1);
		expect(parseBeancountOutline(text)[0].children[0].title).toBe('Real');
	});

	it('places dated entries before the first heading at the root', () => {
		const text = ['2026-01-01 * "Before"', '* Later', '2026-01-02 * "After"'].join('\n');
		const nodes = parseBeancountOutline(text);
		expect(nodes[0].kind).toBe('date');
		expect(nodes[1].kind).toBe('heading');
		expect(nodes[1].children[0].children[0].title).toBe('After');
	});
});

describe('flattenOutline', () => {
	it('walks the tree depth-first with root depth 0', () => {
		const nodes = parseBeancountOutline(['* Food', '2026-01-01 * "Store"'].join('\n'));
		expect(flattenOutline(nodes)).toEqual([
			{ kind: 'heading', title: 'Food', line: 0, depth: 0 },
			{ kind: 'date', title: '2026-01-01', line: 1, depth: 1 },
			{ kind: 'transaction', title: 'Store', line: 1, depth: 2 },
		]);
	});
});

describe('jumpToOutlineLine', () => {
	it('moves the caret to column 0 of the item and scrolls it into view', () => {
		const editor = createEditor(['first', 'second', 'third']);
		editor.setCursor({ line: 0, ch: 2 });

		jumpToOutlineLine(editor as unknown as Editor, 2);

		expect(editor.getCursor()).toEqual({ line: 2, ch: 0 });
		expect(editor.scrollIntoViewCalls).toEqual([
			{ range: { from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } }, center: true },
		]);
	});
});

describe('drawOutline', () => {
	it('renders a placeholder when the buffer has no outline items', () => {
		const mount = new FakeMount();
		drawOutline(mount, '; just a comment', () => undefined);
		expect(mount.children.map((child) => ({ className: child.className, text: child.text }))).toEqual([
			{ className: 'beancount-outline-empty', text: 'No outline items.' },
		]);
	});

	it('renders clickable rows that jump to the item line', () => {
		const mount = new FakeMount();
		const jumped: number[] = [];
		drawOutline(mount, '2026-01-01 * "Store" "Groceries"', (line) => jumped.push(line));
		expect(mount.children.map((child) => ({ className: child.className, text: child.text }))).toEqual([
			{
				className: 'beancount-outline-item beancount-outline-date beancount-outline-depth-0',
				text: '2026-01-01',
			},
			{
				className: 'beancount-outline-item beancount-outline-transaction beancount-outline-depth-1',
				text: 'Store — Groceries',
			},
		]);
		mount.children[1].clicks[0]();
		expect(jumped).toEqual([0]);
	});
});

describe('revealOutlineView', () => {
	it('reveals an existing outline leaf', async () => {
		const existing = { id: 'already-open' };
		const revealed: unknown[] = [];
		const app = {
			workspace: {
				getLeavesOfType: (type: string) => (type === VIEW_TYPE_OUTLINE ? [existing] : []),
				revealLeaf: (leaf: unknown) => revealed.push(leaf),
				getRightLeaf: () => {
					throw new Error('must not split a new leaf');
				},
			},
		} as unknown as App;

		await revealOutlineView(app);
		expect(revealed).toEqual([existing]);
	});

	it('opens the outline in the right leaf when none exists', async () => {
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

		await revealOutlineView(app);
		expect(states).toEqual([{ type: VIEW_TYPE_OUTLINE, active: true }]);
		expect(revealed).toEqual([leaf]);
	});

	it('does nothing when the workspace has no right leaf', async () => {
		const app = {
			workspace: {
				getLeavesOfType: () => [],
				getRightLeaf: () => null,
				revealLeaf: () => {
					throw new Error('must not reveal');
				},
			},
		} as unknown as App;
		await expect(revealOutlineView(app)).resolves.toBeUndefined();
	});
});

describe('BeancountOutlineView', () => {
	function leafFor(editor: FakeEditor | null, file: { path: string; extension: string } | null) {
		const events: Array<{ name: string; callback: () => void }> = [];
		const app = {
			workspace: {
				getActiveFile: () => file,
				activeEditor: editor ? { editor, file } : null,
				on: (name: string, callback: () => void) => {
					events.push({ name, callback });
					return { name, callback };
				},
			},
		};
		return { leaf: { app } as unknown as WorkspaceLeaf, app, events };
	}

	it('names the view and redraws from the active ledger', async () => {
		const editor = createEditor(['2026-01-01 * "Store"']);
		const { leaf, events } = leafFor(editor, { path: 'ledger.bean', extension: 'bean' });
		const view = new BeancountOutlineView(leaf);
		expect(view.getViewType()).toBe(VIEW_TYPE_OUTLINE);
		expect(view.getDisplayText()).toBe('Beancount Outline');
		expect(view.getIcon()).toBe('list-tree');

		await view.onOpen();
		expect(events.map((event) => event.name)).toEqual(['active-leaf-change', 'editor-change']);
		const items = (view.contentEl as unknown as FakeMount).children;
		expect(items.map((item) => item.text)).toEqual(['2026-01-01', 'Store']);
		items[1].clicks[0]();
		expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
	});

	it('shows a placeholder when the active file is not a ledger', async () => {
		const editor = createEditor(['# note']);
		const { leaf } = leafFor(editor, { path: 'note.md', extension: 'md' });
		const view = new BeancountOutlineView(leaf);
		await view.onOpen();
		expect((view.contentEl as unknown as FakeMount).children[0].text).toBe(
			'Open a Beancount file to see its outline.'
		);
	});

	it('rebuilds when the workspace reports an editor change', async () => {
		const editor = createEditor(['2026-01-01 * "Store"']);
		const file = { path: 'ledger.bean', extension: 'bean' };
		const { leaf, events } = leafFor(editor, file);
		const view = new BeancountOutlineView(leaf);
		await view.onOpen();
		editor.lines = ['2026-02-02 * "Later"'];
		events[1].callback();
		expect((view.contentEl as unknown as FakeMount).children.map((item) => item.text)).toEqual([
			'2026-02-02',
			'Later',
		]);
	});
});
