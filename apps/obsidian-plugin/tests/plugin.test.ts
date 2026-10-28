import type { App, PluginManifest } from 'obsidian';
import { Plugin } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BeanCheckRun, LineDiagnostic } from '../bean-check';
import { setBeanDiagnostics } from '../diagnostics';
import type { FakeSettingContainer, Plugin as RecordingPlugin } from './mocks/obsidian';
import { notices, shownMenus } from './mocks/obsidian';
import type {
	MockGutterConfig,
	MockHoverTooltip,
	MockKeymapExtension,
	MockLanguageDataExtension,
	MockView,
} from './mocks/codemirror';
import { createView } from './mocks/codemirror';
import type { FakeEditor, FakeFile } from './fakes';
import { createEditor, FakeClock, FakeVault, flush, registered } from './fakes';
import { FLAG_OKAY_TITLE, FLAGGED_MESSAGE, PAD_TRANSACTION_TITLE, openAccountTitle } from '../code-actions';
import { beancountMode, BEANCOUNT_LANGUAGE_DATA } from '../beancount-mode';
import { BeancountSettingTab } from '../settings';
import BeancountPlugin from '../main';
import { AccountSuggest } from '../account-suggest';
import { PayeeSuggest } from '../payee-suggest';
import { CommoditySuggest, LinkSuggest, NarrationSuggest, TagSuggest } from '../token-suggest';
import { BeancountProblemsView, VIEW_TYPE_PROBLEMS } from '../problems-view';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;



// Obsidian injects `CodeMirror` onto the global at startup; tests install a
// fake registry there to observe plugin registration and teardown.
const host = globalThis as { CodeMirror?: unknown };

interface FakeRegistry {
	modes: Record<string, unknown>;
	defineMode(name: string, mode: unknown): void;
	getMode(spec: string): typeof beancountMode;
}

function fakeRegistry(): FakeRegistry {
	const modes: Record<string, unknown> = {};
	return {
		modes,
		defineMode(name: string, mode: unknown) {
			modes[name] = mode;
		},
		// Mirrors CodeMirror.getMode: it calls the registered value as a
		// factory (a bare mode object must fail here) and writes the mode's
		// `name` back.
		getMode(spec: string): typeof beancountMode {
			const factory = modes[spec];
			if (typeof factory !== 'function') throw new TypeError('mfactory is not a function');
			const mode = factory() as typeof beancountMode;
			mode.name = spec;
			return mode;
		},
	};
}

/** What each `bean-check` run is told, and what it answers. */
const beanCheckRuns: Array<{ command: string; args: readonly string[] }> = [];
let beanCheckResult: BeanCheckRun = { stderr: '', missing: false };

async function loadPlugin(
	vault: FakeVault = new FakeVault(),
	loadedData: unknown = null,
	leaves: FakeLeaf[] = [],
	activeEditor: FakeLeaf['view'] | null = null,
	clock?: FakeClock,
): Promise<{ plugin: BeancountPlugin & RecordingPlugin; vault: FakeVault }> {
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: { getLeavesOfType: () => leaves, activeEditor, on: () => ({}) },
		} as unknown as App,
		manifest,
		clock,
	) as BeancountPlugin & RecordingPlugin;
	plugin.loadedData = loadedData;
	await plugin.onload();
	plugin.beanCheckRunner = async (command, args) => {
		beanCheckRuns.push({ command, args: [...args] });
		return beanCheckResult;
	};
	return { plugin, vault };
}


/** Plugin tests drive suggesters with partial fakes, not a full EditorSuggestContext. */
type QueryIndex = { getSuggestions(context: { query: string }): string[] };
type FrecencyIndex = QueryIndex & {
	selectSuggestion(value: string, evt: MouseEvent): void;
	context: {
		start: { line: number; ch: number };
		end: { line: number; ch: number };
		query: string;
		editor: unknown;
		file: unknown;
	} | null;
};
type TriggerSuggest = {
	onTrigger(
		cursor: { line: number; ch: number },
		editor: unknown,
		file: { path: string; extension: string } | null
	): unknown;
};



/** An open leaf whose view shows `file` in `editor`. */
interface FakeLeaf {
	view: { file: FakeFile | null; editor: FakeEditor | null };
}

/** The diagnostics last published to `editor`'s view, if any. */
function published(editor: FakeEditor): LineDiagnostic[] {
	const last = editor.cm.dispatched[editor.cm.dispatched.length - 1];
	const effect = last?.effects[0] as { value?: unknown; is(spec: unknown): boolean } | undefined;
	return effect?.is(setBeanDiagnostics) ? (effect.value as LineDiagnostic[]) : [];
}

async function problemTexts(plugin: BeancountPlugin & RecordingPlugin): Promise<string[]> {
	const creator = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_PROBLEMS);
	const created = creator?.creator({ app: plugin.app });
	if (!(created instanceof BeancountProblemsView)) throw new Error('missing problems view');
	await created.onOpen();
	const el: unknown = created.contentEl;
	if (!el || typeof el !== 'object' || !('children' in el) || !Array.isArray(el.children)) {
		throw new Error('problems view has no mount');
	}
	return el.children.map((child) => {
		if (!child || typeof child !== 'object' || !('text' in child) || typeof child.text !== 'string') {
			throw new Error('problems row has no text');
		}
		return child.text;
	});
}

function clickDiagnostic(
	plugin: BeancountPlugin,
	editor: FakeEditor,
	line: number,
	diagnostics: LineDiagnostic[]
): boolean {
	const extension = (plugin as unknown as RecordingPlugin).registrations.editorExtensions[2] as unknown[];
	const gutter = extension.find((member) => member && typeof member === 'object' && 'lineMarker' in member) as MockGutterConfig;
	const from = editor.lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
	Object.assign(editor.cm, {
		state: {
			doc: {
				lineAt: () => ({ from, number: line + 1, text: editor.lines[line] }),
			},
			field: () => diagnostics,
		},
	});
	const event = { preventDefault() {} } as MouseEvent;
	return gutter.domEventHandlers?.mousedown?.(editor.cm, { from, to: from }, event) ?? false;
}


afterEach(() => {
	delete host.CodeMirror;
	beanCheckRuns.length = 0;
	beanCheckResult = { stderr: '', missing: false };
	notices.length = 0;
	shownMenus.length = 0;
});

describe('BeancountPlugin', () => {
	it('is an Obsidian Plugin subclass', () => {
		const plugin = new BeancountPlugin({} as App, manifest);
		expect(plugin).toBeInstanceOf(Plugin);
		expect(plugin.manifest.id).toBe('beancount-obsidian');
	});



	it('wires every completion index to the vault on load', async () => {
		const vault = new FakeVault();
		vault.write(
			'ledger.bean',
			[
				'2026-09-30 * "Whole Foods" "Groceries" #trip ^receipt',
				'  Expenses:Food  10.00 USD',
				'2026-09-30 price USD 1.10 CAD',
			].join('\n')
		);

		const { plugin } = await loadPlugin(vault);
		await flush();

		const accounts = registered(plugin, AccountSuggest) as QueryIndex;
		const payees = registered(plugin, PayeeSuggest) as QueryIndex;
		const commodities = registered(plugin, CommoditySuggest) as QueryIndex;
		const tags = registered(plugin, TagSuggest) as QueryIndex;
		const links = registered(plugin, LinkSuggest) as QueryIndex;
		expect(accounts.getSuggestions({ query: 'Expenses' })).toEqual(['Expenses:Food']);
		expect(payees.getSuggestions({ query: 'Whole' })).toEqual(['Whole Foods']);
		expect(commodities.getSuggestions({ query: 'US' })).toEqual(['USD']);
		expect(tags.getSuggestions({ query: '#tr' })).toEqual(['#trip']);
		expect(links.getSuggestions({ query: '^r' })).toEqual(['^receipt']);
	});

	it('completes and hovers note accounts from beancount fences only, across edits', async () => {
		const vault = new FakeVault();
		const note = vault.write(
			'note.md',
			['PG_DATA_DIR:-supabase-db-data', '```beancount', '2020-01-01 open Assets:Cash USD', '```'].join('\n')
		);
		const { plugin } = await loadPlugin(vault);
		await flush();
		const accounts = registered(plugin, AccountSuggest) as QueryIndex;
		const hover = plugin.registrations.editorExtensions[3] as MockHoverTooltip;
		const hoverAt = (text: string) =>
			hover.source({ state: { doc: { lineAt: () => ({ from: 0, to: text.length, text }) } } }, 0);
		expect(accounts.getSuggestions({ query: '' })).toEqual(['Assets:Cash']);
		expect(hoverAt('PG_DATA_DIR:-supabase-db-data')).toBeNull();

		// A later edit that moves the account out of the fence drops it.
		vault.write('note.md', 'Assets:Cash in prose now\n```beancount\n  Expenses:Food  1 USD\n```');
		await vault.emit('modify', note);
		await flush();
		expect(accounts.getSuggestions({ query: '' })).toEqual(['Expenses:Food']);
		expect(hoverAt('Assets:Cash')).toBeNull();
	});

	it('ranks a stored frecency pick first after reload', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', 'Assets:Broker Assets:Cash');
		const { plugin } = await loadPlugin(vault);
		await flush();
		const accounts = registered(plugin, AccountSuggest) as FrecencyIndex;
		expect(accounts.getSuggestions({ query: 'Assets:' })).toEqual(['Assets:Broker', 'Assets:Cash']);
		const editor = createEditor(['Assets:']);
		accounts.context = {
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 7 },
			query: 'Assets:',
			editor,
			file: {},
		};
		accounts.selectSuggestion('Assets:Cash', {} as MouseEvent);
		expect(plugin.savedData.at(-1)).toMatchObject({
			completionUsage: { 'Assets:Cash': { count: 1, lastUsed: expect.any(Number) } },
		});

		const reloaded = await loadPlugin(vault, plugin.savedData.at(-1));
		await flush();
		const again = registered(reloaded.plugin, AccountSuggest) as QueryIndex;
		expect(again.getSuggestions({ query: 'Assets:' })).toEqual(['Assets:Cash', 'Assets:Broker']);
	});

	it('starts with defaults when data.json cannot be read', async () => {
		const plugin = new BeancountPlugin({ vault: new FakeVault().api, workspace: { getLeavesOfType: () => [], activeEditor: null, on: () => ({}) } } as unknown as App, manifest);
		plugin.loadData = async () => {
			throw new Error('corrupt');
		};
		await plugin.onload();
		expect(plugin.settings.alignOnSave).toBe(false);
		expect(plugin.settings.instantAlignment).toBe(true);
	});

	it('ignores a corrupt completionUsage bag and still loads settings', async () => {
		const { plugin } = await loadPlugin(new FakeVault(), {
			alignOnSave: true,
			completionUsage: 'not-an-object',
		});
		expect(plugin.settings.alignOnSave).toBe(true);
		expect('completionUsage' in plugin.settings).toBe(false);
	});
	it('offers narration completion only with the setting on', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-09-30 * "Shell" "Fuel"');
		const { plugin } = await loadPlugin(vault);
		await flush();

		const narrations = registered(plugin, NarrationSuggest) as TriggerSuggest;
		const line = createEditor(['2026-09-30 * "Shell" "Fu']);
		const cursor = { line: 0, ch: line.lines[0].length };
		const ledger = { path: 'ledger.bean', extension: 'bean' };
		expect(narrations.onTrigger(cursor, line, ledger)).toBeNull();
		plugin.settings.completeNarration = true;
		expect(narrations.onTrigger(cursor, line, ledger)).toMatchObject({ query: 'Fu' });
	});


	it('offers directive snippets from a prefix at column 0', async () => {
		const { plugin } = await loadPlugin();
		const snippets = plugin.registrations.editorSuggests.find((suggest) => {
			const items = (
				suggest as { getSuggestions(context: { query: string }): Array<{ prefix?: string }> }
			).getSuggestions({ query: 'txn' });
			return items[0]?.prefix === 'txn';
		}) as {
			onTrigger: (
				cursor: { line: number; ch: number },
				editor: unknown,
				file: { extension: string }
			) => unknown;
			getSuggestions(context: { query: string }): Array<{ prefix: string }>;
		};
		const editor = createEditor(['txn']);
		expect(snippets.onTrigger({ line: 0, ch: 3 }, editor, { extension: 'bean' })).toMatchObject({
			query: 'txn',
		});
		expect(snippets.getSuggestions({ query: 'txn' }).map((entry) => entry.prefix)).toEqual([
			'txn',
			'txn!',
			'txn*',
		]);
	});

	it('installs the beancount mode and its bean alias into the mode registry', async () => {
		const registry = fakeRegistry();
		host.CodeMirror = registry;

		await loadPlugin();

		// getMode throws unless the registered value is a callable factory;
		// each call must return a fresh spec because getMode writes `name`
		// back — aliases must not clobber each other or the shared spec.
		const beancount = registry.getMode('beancount');
		const bean = registry.getMode('bean');
		expect(beancount).not.toBe(beancountMode);
		expect(bean).not.toBe(beancountMode);
		expect(beancount).not.toBe(bean);
		expect(beancount.name).toBe('beancount');
		expect(bean.name).toBe('bean');
		expect(beancount.token).toBe(beancountMode.token);
		expect(beancountMode.name).toBe('beancount');
	});

	it('removes the registered modes on unload', async () => {
		const registry = fakeRegistry();
		host.CodeMirror = registry;

		const { plugin } = await loadPlugin();
		for (const cleanup of plugin.registrations.cleanups) cleanup();

		expect(registry.modes.beancount).toBeUndefined();
		expect(registry.modes.bean).toBeUndefined();
	});

	it('leaves mode names re-registered by others alone on unload', async () => {
		const registry = fakeRegistry();
		host.CodeMirror = registry;

		const { plugin } = await loadPlugin();
		const otherFactory = () => ({});
		registry.modes.bean = otherFactory;
		for (const cleanup of plugin.registrations.cleanups) cleanup();

		expect(registry.modes.bean).toBe(otherFactory);
		expect(registry.modes.beancount).toBeUndefined();
	});

	it('tolerates a registry without a modes map', async () => {
		const defined: string[] = [];
		host.CodeMirror = {
			defineMode(name: string) {
				defined.push(name);
			},
		};

		const { plugin } = await loadPlugin();
		expect(defined).toEqual(['beancount', 'bean']);
		expect(() => plugin.registrations.cleanups[0]()).not.toThrow();
	});

	it('overlays beancount commentTokens inside markdown fence bodies', async () => {
		const { plugin } = await loadPlugin();
		const extension = plugin.registrations.editorExtensions[4] as Array<
			MockKeymapExtension | MockLanguageDataExtension
		>;
		const keymapExt = extension.find((item): item is MockKeymapExtension => 'bindings' in item);
		const lang = extension.find((item): item is MockLanguageDataExtension => 'languageData' in item);
		expect(keymapExt?.bindings.map((binding) => binding.key)).toEqual(['Mod-/']);
		const text = ['```beancount', '  Assets:Cash', '```', 'prose'].join('\n');
		const state = { doc: { toString: () => text } };
		expect(lang?.languageData(state, text.indexOf('Assets'))).toEqual([BEANCOUNT_LANGUAGE_DATA]);
		expect(lang?.languageData(state, text.indexOf('prose'))).toEqual([]);
	});

	it('shows a hover card on known accounts and stays quiet on unknown ones', async () => {
		const vault = new FakeVault();
		vault.write(
			'a.bean',
			['2020-01-01 open Assets:Cash USD', '2021-01-01 close Assets:Cash'].join('\n')
		);
		const { plugin } = await loadPlugin(vault);
		await flush();
		const hover = plugin.registrations.editorExtensions[3] as MockHoverTooltip;
		const known = '  Assets:Cash  10.00 USD';
		expect(
			hover.source({ state: { doc: { lineAt: () => ({ from: 0, to: known.length, text: known }) } } }, 2)
		).toMatchObject({ pos: 2, end: 13 });
		const unknown = '  Expenses:Ghost  1.00 USD';
		expect(
			hover.source(
				{ state: { doc: { lineAt: () => ({ from: 0, to: unknown.length, text: unknown }) } } },
				2
			)
		).toBeNull();
	});

	it('lets the plugin’s own completion popovers keep Enter', async () => {
		const { plugin } = await loadPlugin();
		const extension = plugin.registrations.editorExtensions[0] as MockKeymapExtension;
		const run = extension.bindings[0].run as unknown as (view: MockView) => boolean;
		const suggest = registered(plugin, AccountSuggest) as { context: unknown };
		// A popup is open: Enter accepts the suggestion, never indents.
		suggest.context = {};
		const open = createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]);
		(open.state as { field?: () => { file: { path: string; extension: string } } }).field = () => ({
			file: { path: 'ledger.bean', extension: 'bean' },
		});
		expect(run(open)).toBe(false);
		expect(open.dispatched).toEqual([]);
		suggest.context = null;
		const closed = createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]);
		(closed.state as { field?: () => { file: { path: string; extension: string } } }).field = () => ({
			file: { path: 'ledger.bean', extension: 'bean' },
		});
		expect(run(closed)).toBe(true);
		expect(closed.dispatched).toHaveLength(1);
	});

	it('registers the instant-alignment period binding', async () => {
		const { plugin } = await loadPlugin();
		const extension = plugin.registrations.editorExtensions[1] as MockKeymapExtension;
		expect(extension.bindings.map((binding) => binding.key)).toEqual(['.']);
		const run = extension.bindings[0].run as unknown as (view: MockView) => boolean;
		const text = '  Assets:Cash 12 USD';
		const caret = text.indexOf('12') + 2;
		const view = createView(text, [{ anchor: caret }]);
		(view.state as { field?: () => { file: { path: string; extension: string } } }).field = () => ({
			file: { path: 'ledger.bean', extension: 'bean' },
		});
		expect(run(view)).toBe(true);
		expect(view.dispatched).toHaveLength(1);
		// Default separator column 50: the inserted `.` sits at 0-based index 49.
		expect(view.dispatched[0].changes[0].insert.indexOf('.')).toBe(49);
		plugin.settings.separatorColumn = 40;
		const col40 = createView(text, [{ anchor: caret }]);
		(col40.state as { field?: () => { file: { path: string; extension: string } } }).field = () => ({
			file: { path: 'ledger.bean', extension: 'bean' },
		});
		expect(run(col40)).toBe(true);
		expect(col40.dispatched[0].changes[0].insert.indexOf('.')).toBe(39);
		plugin.settings.instantAlignment = false;
		const silenced = createView(text, [{ anchor: caret }]);
		(silenced.state as { field?: () => { file: { path: string; extension: string } } }).field = () => ({
			file: { path: 'ledger.bean', extension: 'bean' },
		});
		expect(run(silenced)).toBe(false);
		expect(silenced.dispatched).toEqual([]);
	});



	it('registers the date command and inserts today', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 30));
		try {
			const { plugin } = await loadPlugin();
			const command = plugin.registrations.commands.find((entry) => entry.id === 'insert-today-date');
			const editor = createEditor(['']);
			command?.editorCallback?.(editor);
			expect(editor.getValue()).toBe('2026-09-30');
		} finally {
			vi.useRealTimers();
		}
	});



	it('persists the on-save toggle and honors it', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const clock = new FakeClock();
		const { plugin } = await loadPlugin(vault, null, [], null, clock);
		const tab = new BeancountSettingTab({} as App, plugin);
		tab.display();
		const { settings } = tab.containerEl as unknown as FakeSettingContainer;

		expect(settings.map((setting) => setting.name)).toEqual([
			'Alignment',
			'Align amounts on save',
			'Instant alignment',
			'Separator column',
			'Show separator ruler',
			'Validation',
			'Bean-check executable',
			'Entry ledger',
			'Balance inlay hints',
			'Completion',
			'Complete payees',
			'Autofill payee postings',
			'Complete narrations',
			'Pinyin initials matching',
			'Fava',
			'Fava executable',
			'Fava port',
			'Run Fava on activate',
			'Flag warnings',
			'Incomplete transactions (!)',
			'Cleared transactions (*)',
		]);
		const named = Object.fromEntries(settings.map((setting) => [setting.name, setting]));
		expect(named['Align amounts on save']?.toggle?.value).toBe(false);
		expect(named['Instant alignment']?.toggle?.value).toBe(true);
		expect(named['Complete narrations']?.toggle?.value).toBe(false);
		expect(named['Complete payees']?.toggle?.value).toBe(true);
		expect(named['Incomplete transactions (!)']?.dropdown?.value).toBe('warning');
		expect(named['Cleared transactions (*)']?.dropdown?.value).toBe('none');
		await named['Align amounts on save']?.toggle?.onChangeHandler?.(true);
		expect(plugin.savedData).toEqual([expect.objectContaining({ alignOnSave: true })]);
		await named['Complete narrations']?.toggle?.onChangeHandler?.(true);
		expect(plugin.settings.completeNarration).toBe(true);
		expect(plugin.savedData?.at(-1)).toMatchObject({ completeNarration: true });

		await named['Bean-check executable']?.text?.onChangeHandler?.('/usr/local/bin/bean-check');
		await named['Entry ledger']?.text?.onChangeHandler?.('ledger/main.bean');
		expect(plugin.settings.beanCheckPath).toBe('/usr/local/bin/bean-check');
		expect(plugin.settings.entryLedger).toBe('ledger/main.bean');
		await named['Instant alignment']?.toggle?.onChangeHandler?.(false);
		expect(plugin.settings.instantAlignment).toBe(false);
		await named['Separator column']?.text?.onChangeHandler?.('40');
		expect(plugin.settings.separatorColumn).toBe(40);
		await named['Separator column']?.text?.onChangeHandler?.('nope');
		expect(plugin.settings.separatorColumn).toBe(40);
		await named['Complete payees']?.toggle?.onChangeHandler?.(false);
		expect(plugin.settings.completePayee).toBe(false);
		await named['Incomplete transactions (!)']?.dropdown?.onChangeHandler?.('error');
		expect(plugin.settings.flagWarnings['!']).toBe('error');
		await named['Fava executable']?.text?.onChangeHandler?.('/opt/homebrew/bin/fava');
		expect(plugin.settings.favaPath).toBe('/opt/homebrew/bin/fava');
		await named['Fava port']?.text?.onChangeHandler?.('8080');
		expect(plugin.settings.favaPort).toBe(8080);
		await named['Fava port']?.text?.onChangeHandler?.('nope');
		expect(plugin.settings.favaPort).toBe(8080);

		await vault.emit('modify', file);
		clock.tick(500);
		await flush();
		await flush();
		expect(vault.writes).toEqual(['ledger.bean']);
	});

	it('serves the same settings declaratively for Obsidian 1.13+ search and rendering', async () => {
		const { plugin } = await loadPlugin(new FakeVault());
		const tab = new BeancountSettingTab({} as App, plugin);
		tab.display();
		const imperative = (tab.containerEl as unknown as FakeSettingContainer).settings.map((setting) => setting.name);
		const groups = tab.getSettingDefinitions() as Array<{
			heading: string;
			items: Array<{ name: string; control: { key: string; type: string } }>;
		}>;
		// One table drives both renderers: same headings and rows, same order.
		expect(groups.flatMap((group) => [group.heading, ...group.items.map((item) => item.name)])).toEqual(imperative);

		const controls = Object.fromEntries(groups.flatMap((group) => group.items.map((item) => [item.name, item.control])));
		// Every declared key resolves to the stored value.
		for (const { key } of Object.values(controls)) expect(tab.getControlValue(key)).not.toBeUndefined();
		expect(tab.getControlValue(controls['Instant alignment'].key)).toBe(true);
		expect(tab.getControlValue(controls['Fava port'].key)).toBe('5000');
		expect(tab.getControlValue(controls['Incomplete transactions (!)'].key)).toBe('warning');
		expect(tab.getControlValue('constructor')).toBeUndefined();

		await tab.setControlValue(controls['Fava port'].key, '8080');
		await tab.setControlValue(controls['Separator column'].key, '0');
		await tab.setControlValue(controls['Cleared transactions (*)'].key, 'error');
		await tab.setControlValue(controls['Pinyin initials matching'].key, true);
		expect(plugin.settings).toMatchObject({
			favaPort: 8080,
			separatorColumn: 50,
			pinyinMatching: true,
			flagWarnings: { '*': 'error' },
		});
		expect(plugin.savedData?.at(-1)).toMatchObject({ favaPort: 8080, pinyinMatching: true });
	});

	it('runs bean-check for a saved ledger after the validation debounce', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const clock = new FakeClock();
		await loadPlugin(vault, null, [], null, clock);

		await vault.emit('modify', file);
		clock.tick(500);
		await flush();
		await flush();

		expect(beanCheckRuns).toEqual([{ command: 'bean-check', args: ['/vault/ledger.bean'] }]);
	});

	it('marks every pane showing a reported file', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const first = createEditor(['2026-10-01 * "A"']);
		const second = createEditor(['2026-10-01 * "A"']);
		const clock = new FakeClock();
		await loadPlugin(
			vault,
			null,
			[
				{ view: { file, editor: first } },
				{ view: { file, editor: second } },
			],
			null,
			clock,
		);
		beanCheckResult = { stderr: '/vault/ledger.bean:1:       oops\n', missing: false };
		await vault.emit('modify', file);
		clock.tick(500);
		await flush();
		await flush();
		expect(published(first)).toEqual([{ line: 0, message: 'oops' }]);
		expect(published(second)).toEqual([{ line: 0, message: 'oops' }]);
	});


	it('clears Problems when saveSettings changes the entry ledger without running bean-check', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const clock = new FakeClock();
		const { plugin } = await loadPlugin(vault, null, [], null, clock);
		beanCheckResult = { stderr: '/vault/ledger.bean:1:       oops\n', missing: false };

		await vault.emit('modify', file);
		clock.tick(500);
		await flush();
		await flush();

		plugin.settings.entryLedger = 'main.bean';
		await plugin.saveSettings();

		expect(await problemTexts(plugin)).toEqual(['No problems.']);
		expect(beanCheckRuns).toEqual([{ command: 'bean-check', args: ['/vault/ledger.bean'] }]);
	});

	it('offers Flag as okay from the gutter and replaces the header flag', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 ! "Cafe"\n');
		const editor = createEditor(['2026-10-01 ! "Cafe"']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		const diagnostics = [{ line: 0, message: FLAGGED_MESSAGE }];
		clickDiagnostic(plugin, editor, 0, diagnostics);

		expect(shownMenus.map((menu) => menu.titles)).toEqual([[FLAG_OKAY_TITLE]]);
		shownMenus[0].items[0].click();
		expect(editor.getValue()).toBe('2026-10-01 * "Cafe"');
	});

	it('inserts a balancing posting from two-leg history with the same payee', async () => {
		const vault = new FakeVault();
		vault.write(
			'history.bean',
			['2026-09-01 * "Cafe"', '  Expenses:Food  4.00 USD', '  Assets:Cash   -4.00 USD'].join('\n')
		);
		const file = vault.write('journal.bean', '2026-10-01 * "Cafe"\n  Expenses:Food  10.00 USD\n');
		const editor = createEditor(['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		await flush();
		clickDiagnostic(plugin, editor, 0, [{ line: 0, message: 'Transaction does not balance: (10.00 USD)' }]);

		expect(shownMenus.map((menu) => menu.titles)).toEqual([[PAD_TRANSACTION_TITLE]]);
		shownMenus[0].items[0].click();
		expect(editor.getValue()).toBe(
			['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash  -10.00 USD'].join('\n')
		);
	});

	it('inserts an open directive into the vault file that already holds opens', async () => {
		const vault = new FakeVault();
		vault.write('accounts.bean', '2020-01-01 open Assets:Cash USD\n');
		const file = vault.write(
			'journal.bean',
			['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '  Assets:Cash   -10.00 USD'].join('\n')
		);
		const editor = createEditor([
			'2026-10-01 * "Cafe"',
			'  Expenses:Food  10.00 USD',
			'  Assets:Cash   -10.00 USD',
		]);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		await flush();
		clickDiagnostic(plugin, editor, 0, [
			{ line: 0, message: "Invalid reference to unknown account 'Expenses:Food'" },
		]);

		expect(shownMenus.map((menu) => menu.titles)).toEqual([[openAccountTitle('Expenses:Food')]]);
		shownMenus[0].items[0].click();
		await flush();
		expect(vault.contents.get('accounts.bean')).toBe(
			'2020-01-01 open Assets:Cash USD\n2026-10-01 open Expenses:Food USD\n'
		);
	});

	it('edits an open accounts file through its editor, not vault.modify', async () => {
		const vault = new FakeVault();
		const accounts = vault.write('accounts.bean', '2020-01-01 open Assets:Cash USD\n');
		const file = vault.write('journal.bean', '2026-10-01 * "Cafe"\n  Expenses:Food  10.00 USD\n');
		const editor = createEditor(['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD']);
		const accountsEditor = createEditor(['2020-01-01 open Assets:Cash USD', '']);
		const { plugin } = await loadPlugin(vault, null, [
			{ view: { file, editor } },
			{ view: { file: accounts, editor: accountsEditor } },
		]);
		await flush();
		clickDiagnostic(plugin, editor, 0, [
			{ line: 0, message: "Invalid reference to unknown account 'Expenses:Food'" },
		]);
		shownMenus[0].items[0].click();
		expect(accountsEditor.getValue()).toBe(
			'2020-01-01 open Assets:Cash USD\n2026-10-01 open Expenses:Food USD\n'
		);
		expect(vault.writes).toEqual([]);
	});

	it('stays quiet when the marked line has no fix', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', 'garbage\n');
		const editor = createEditor(['garbage']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		expect(clickDiagnostic(plugin, editor, 0, [{ line: 0, message: "Invalid token: 'garbage'" }])).toBe(false);
		expect(shownMenus).toEqual([]);
		expect(clickDiagnostic(plugin, editor, 0, [])).toBe(false);
		expect(plugin.onDiagnosticClick({} as never, 0, { preventDefault() {} } as MouseEvent)).toBe(false);
	});

	it('deletes a posting flag from the gutter via the active editor', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "Cafe"\n  ! Assets:Cash  10.00 USD\n');
		const editor = createEditor(['2026-10-01 * "Cafe"', '  ! Assets:Cash  10.00 USD']);
		const { plugin } = await loadPlugin(vault, null, [], { file, editor });
		expect(clickDiagnostic(plugin, editor, 1, [{ line: 1, message: FLAGGED_MESSAGE }])).toBe(true);
		shownMenus[0].items[0].click();
		expect(editor.getValue()).toBe('2026-10-01 * "Cafe"\n  Assets:Cash  10.00 USD');
	});

	it('opens an unknown account in the current file when the vault has no open file', async () => {
		const vault = new FakeVault();
		const file = vault.write('journal.bean', '2026-10-01 * "Cafe"\n  Expenses:Food  10.00 USD\n');
		const editor = createEditor(['2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		await flush();
		clickDiagnostic(plugin, editor, 0, [
			{ line: 0, message: "Invalid reference to unknown account 'Expenses:Food'" },
		]);
		shownMenus[0].items[0].click();
		expect(editor.getValue()).toBe(
			['2026-10-01 open Expenses:Food USD', '2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD'].join('\n')
		);
	});

	it('does not offer Open account on a markdown note when no ledger holds opens', async () => {
		const vault = new FakeVault();
		const note = ['```beancount', '2026-10-01 * "Cafe"', '  Expenses:Food  10.00 USD', '```'].join('\n');
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		await flush();

		expect(
			clickDiagnostic(plugin, editor, 1, [
				{ line: 1, message: "Invalid reference to unknown account 'Expenses:Food'" },
			])
		).toBe(false);
		expect(shownMenus).toEqual([]);
	});

	it('formats a bean buffer and leaves an already formatted one untouched', async () => {
		const { plugin } = await loadPlugin();
		const command = plugin.registrations.commands.find((entry) => entry.id === 'format-ledger');
		const editor = createEditor(['2022-01-01   open   Assets:A']);

		command?.editorCallback?.(editor, { file: { extension: 'bean' } });

		expect(editor.getValue()).toBe('2022-01-01 open Assets:A');
		expect(editor.transactions).toHaveLength(1);
		expect(notices).toEqual([]);

		command?.editorCallback?.(editor, { file: null });

		expect(editor.transactions).toHaveLength(1);
		expect(notices).toEqual([]);
	});





});
