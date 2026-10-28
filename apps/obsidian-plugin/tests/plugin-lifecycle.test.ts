/**
 * Plugin lifecycle the editor never sees on its own: sidebar commands,
 * payee autofill, saveSettings refresh, and Fava start without a process.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import BeancountPlugin from '../main';
import { PayeeSuggest } from '../payee-suggest';
import { VIEW_TYPE_OUTLINE } from '../outline-view';
import { VIEW_TYPE_PROBLEMS } from '../problems-view';
import { BeancountBalancesView, VIEW_TYPE_BALANCES } from '../report-view';
import { WARNING_LINE_CLASS } from '../flag-warnings';
import type { MockViewPlugin } from './mocks/codemirror';
import { notices } from './mocks/obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import { createEditor, FakeVault, flush, registered } from './fakes';
import type { FakeEditor, FakeFile } from './fakes';

vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});

const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;
const manifest = { id: 'beancount-obsidian' } as PluginManifest;


interface OpenLeaf {
	view: { file: FakeFile | null; editor: FakeEditor | null };
}

interface Loaded {
	plugin: BeancountPlugin & RecordingPlugin;
	vault: FakeVault;
	opened: Array<(file: unknown) => void>;
	leaves: OpenLeaf[];
	revealed: unknown[];
	viewStates: unknown[];
}

/** A loaded plugin whose file-open, vault, and sidebar commands the test drives. */
async function loadPlugin(vault: FakeVault = new FakeVault(), stored?: unknown): Promise<Loaded> {
	const opened: Array<(file: unknown) => void> = [];
	const leaves: OpenLeaf[] = [];
	const revealed: unknown[] = [];
	const viewStates: unknown[] = [];
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: {
				getLeavesOfType: (type: string) => (type === 'markdown' ? leaves : []),
				get activeEditor() {
					return leaves[0]?.view ?? null;
				},
				on: (name: string, callback: (file: unknown) => void) => {
					if (name === 'file-open') opened.push(callback);
					return { name };
				},
				revealLeaf: (leaf: unknown) => {
					revealed.push(leaf);
				},
				getRightLeaf: () => ({
					setViewState: async (state: unknown) => {
						viewStates.push(state);
					},
				}),
			},
		} as unknown as App,
		manifest,
	) as BeancountPlugin & RecordingPlugin;
	if (stored !== undefined) plugin.loadedData = stored;
	await plugin.onload();
	return { plugin, vault, opened, leaves, revealed, viewStates };
}

function command(plugin: BeancountPlugin & RecordingPlugin, id: string): () => void | Promise<void> {
	const found = plugin.registrations.commands.find((entry) => entry.id === id);
	if (!found?.callback) throw new Error(`missing command ${id}`);
	return found.callback;
}

interface HintPane {
	dispatches: number;
	classes(): string[];
	labels(): string[];
}

interface DecoratedPlugin {
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
}

/** Install one editor extension the way Obsidian would, and count setting refreshes. */
function attachPane(extension: unknown, text: string, extensionName: string): HintPane | null {
	if (!extension || typeof extension !== 'object' || !('cls' in extension)) return null;
	const spec = extension as MockViewPlugin<DecoratedPlugin>;
	const file = { path: `book.${extensionName}`, extension: extensionName };
	const pane: HintPane = {
		dispatches: 0,
		classes() {
			return classesOf(installed.decorations);
		},
		labels() {
			return labelsOf(installed.decorations);
		},
	};
	let installed!: DecoratedPlugin;
	const view = {
		state: { doc: Text.of(text.split('\n')), field: () => ({ file }) },
		dispatch(specDispatch: { effects?: unknown }) {
			if (!installed) return;
			pane.dispatches += 1;
			const effects = Array.isArray(specDispatch.effects)
				? specDispatch.effects
				: specDispatch.effects === undefined
					? []
					: [specDispatch.effects];
			installed.update({
				view,
				state: view.state,
				startState: view.state,
				docChanged: false,
				viewportChanged: false,
				transactions: [{ effects }],
			} as unknown as ViewUpdate);
		},
	};
	try {
		installed = new spec.cls(view as never);
	} catch {
		// The separator ruler touches `document`; node tests have no DOM.
		return null;
	}
	// Plugins without decorations (the snippet-session guard) paint nothing.
	if (!installed.decorations) return null;
	return pane;
}

function classesOf(set: DecorationSet): string[] {
	const out: string[] = [];
	const iter = set.iter();
	while (iter.value) {
		const spec = iter.value.spec;
		if (spec && typeof spec === 'object' && 'class' in spec && typeof spec.class === 'string') out.push(spec.class);
		iter.next();
	}
	return out;
}

function labelsOf(set: DecorationSet): string[] {
	const out: string[] = [];
	const iter = set.iter();
	while (iter.value) {
		const spec = iter.value.spec;
		if (spec && typeof spec === 'object' && 'widget' in spec && spec.widget && typeof spec.widget === 'object' && 'label' in spec.widget && typeof spec.widget.label === 'string') {
			out.push(spec.widget.label);
		}
		iter.next();
	}
	return out;
}

function* viewPlugins(extensions: readonly unknown[]): Generator<unknown> {
	for (const extension of extensions) {
		if (Array.isArray(extension)) yield* viewPlugins(extension);
		else if (extension && typeof extension === 'object' && 'cls' in extension) yield extension;
	}
}

afterEach(() => {
	notices.length = 0;
});

describe('sidebar commands', () => {
	it('opens the outline and problems views from their commands', async () => {
		const { plugin, revealed, viewStates } = await loadPlugin();
		const outline = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_OUTLINE);
		const created = outline?.creator({ app: plugin.app });
		if (!created || typeof created !== 'object' || !('getViewType' in created) || !('getDisplayText' in created)) {
			throw new Error('missing outline view');
		}
		if (typeof created.getViewType !== 'function' || typeof created.getDisplayText !== 'function') {
			throw new Error('missing outline view');
		}
		expect(created.getViewType()).toBe(VIEW_TYPE_OUTLINE);

		await command(plugin, 'show-outline')();
		await command(plugin, 'show-problems')();

		const balances = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_BALANCES);
		const balancesView = balances?.creator({ app: plugin.app });
		if (!(balancesView instanceof BeancountBalancesView)) throw new Error('missing balances view');
		expect(balancesView.getDisplayText()).toBe('Account balances');
		await command(plugin, 'show-balances')();

		expect(viewStates).toEqual([
			{ type: VIEW_TYPE_OUTLINE, active: true },
			{ type: VIEW_TYPE_PROBLEMS, active: true },
			{ type: VIEW_TYPE_BALANCES, active: true },
		]);
		expect(revealed).toHaveLength(3);
	});
});

describe('payee autofill', () => {
	it('inserts the latest postings, skips an unknown payee, and stays off when the setting is', async () => {
		const vault = new FakeVault();
		vault.write(
			'ledger.bean',
			['2026-09-01 * "Cafe" "Latte"', '  Expenses:Food  4.50 USD', '  Assets:Cash'].join('\n'),
		);
		const { plugin } = await loadPlugin(vault);
		await flush();
		const suggest = registered(plugin, PayeeSuggest) as {
			getSuggestions(context: { query: string }): string[];
			selectSuggestion(value: string, evt: MouseEvent): void;
		};
		expect(suggest.getSuggestions({ query: 'Ca' })).toContain('Cafe');

		const typing = createEditor(['2026-10-02 * "Ca']);
		Object.assign(suggest, {
			context: { start: { line: 0, ch: 14 }, end: { line: 0, ch: 16 }, editor: typing },
		});
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		expect(typing.getValue()).toBe(['2026-10-02 * "Cafe"', '  Expenses:Food  4.50 USD', '  Assets:Cash'].join('\n'));

		const unknown = createEditor(['2026-10-02 * "No']);
		Object.assign(suggest, {
			context: { start: { line: 0, ch: 14 }, end: { line: 0, ch: 16 }, editor: unknown },
		});
		suggest.selectSuggestion('Nope', {} as MouseEvent);
		expect(unknown.replacements).toEqual([
			{ replacement: 'Nope"', from: { line: 0, ch: 14 }, to: { line: 0, ch: 16 } },
		]);

		plugin.settings.payeeAutofill = false;
		const silenced = createEditor(['2026-10-02 * "Ca']);
		Object.assign(suggest, {
			context: { start: { line: 0, ch: 14 }, end: { line: 0, ch: 16 }, editor: silenced },
		});
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		expect(silenced.replacements).toEqual([
			{ replacement: 'Cafe"', from: { line: 0, ch: 14 }, to: { line: 0, ch: 16 } },
		]);
	});
});

describe('saveSettings refresh', () => {
	it('rebuilds flag markers, balance hints, and ledger highlighting without an edit', async () => {
		const { plugin } = await loadPlugin();
		const flagged = '2026-10-01 ! "Cafe"';
		const balanced = ['2026-01-01 * "Deposit"', '  Assets:Cash  10.00 USD', '2026-01-02 balance Assets:Cash  12.50 USD'].join(
			'\n',
		);
		let flags: HintPane | null = null;
		let hints: HintPane | null = null;
		let ledger: HintPane | null = null;
		for (const extension of viewPlugins(plugin.registrations.editorExtensions)) {
			const flaggedPane = attachPane(extension, flagged, 'bean');
			if (flaggedPane?.classes().includes(WARNING_LINE_CLASS)) flags = flaggedPane;
			const hintCandidate = attachPane(extension, balanced, 'bean');
			if (hintCandidate && hintCandidate.labels().length > 0) hints = hintCandidate;
			const ledgerCandidate = attachPane(extension, '2026-10-01 * "Cafe"\n  Assets:Cash  1.00 USD\n', 'bean');
			if (ledgerCandidate && ledgerCandidate.classes().some((cls) => cls.startsWith('cm-'))) ledger = ledgerCandidate;
		}
		if (!flags || !hints || !ledger) throw new Error('open editors did not receive hint extensions');
		const ledgerClasses = ledger.classes();

		plugin.settings.flagWarnings = { ...plugin.settings.flagWarnings, '!': null };
		plugin.settings.inlayHints = false;
		await plugin.saveSettings();

		expect(flags.dispatches).toBeGreaterThan(0);
		expect(flags.classes()).toEqual([]);
		expect(hints.dispatches).toBeGreaterThan(0);
		expect(hints.labels()).toEqual([]);
		expect(ledger.dispatches).toBeGreaterThan(0);
		expect(ledger.classes()).toEqual(ledgerClasses);
	});
});

describe('fava start without a process', () => {
	it('does not open a URL or latch a running server when the runner returns no child', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', 'option "title" "Main"\n');
		const { plugin } = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const runs: string[][] = [];
		const opened: string[] = [];
		plugin.favaRunner = async (_command, args) => {
			runs.push([...args]);
			return { missing: false };
		};
		plugin.favaOpener = (url) => {
			opened.push(url);
		};
		plugin.favaReadyProbe = async () => 200;
		plugin.favaDelay = async () => {};
		plugin.favaCloseTimeoutMs = 0;

		await command(plugin, 'start-fava')();
		await command(plugin, 'start-fava')();
		command(plugin, 'stop-fava')();

		expect(runs).toHaveLength(2);
		expect(opened).toEqual([]);
		expect(notices).toEqual(['Fava is not running.']);
	});
});
