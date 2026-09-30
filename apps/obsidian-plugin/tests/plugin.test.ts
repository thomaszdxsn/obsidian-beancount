import type { App, PluginManifest } from 'obsidian';
import { Plugin } from 'obsidian';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { FakeSettingContainer, Plugin as RecordingPlugin } from './mocks/obsidian';
import type { FakeEditor, FakeFile } from './fakes';
import { createEditor, FakeVault, flush } from './fakes';
import { beancountMode } from '../beancount-mode';
import { BeancountSettingTab } from '../settings';
import BeancountPlugin from '../main';

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

async function loadPlugin(
	vault: FakeVault = new FakeVault(),
	loadedData: unknown = null,
	leaves: FakeLeaf[] = [],
	activeEditor: FakeLeaf['view'] | null = null
): Promise<{ plugin: BeancountPlugin & RecordingPlugin; vault: FakeVault }> {
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: { getLeavesOfType: () => leaves, activeEditor },
		} as unknown as App,
		manifest
	) as BeancountPlugin & RecordingPlugin;
	plugin.loadedData = loadedData;
	await plugin.onload();
	return { plugin, vault };
}

/** An open leaf whose view shows `file` in `editor`. */
interface FakeLeaf {
	view: { file: FakeFile | null; editor: FakeEditor | null };
}

afterEach(() => {
	delete host.CodeMirror;
});

describe('BeancountPlugin', () => {
	it('is an Obsidian Plugin subclass', () => {
		const plugin = new BeancountPlugin({} as App, manifest);
		expect(plugin).toBeInstanceOf(Plugin);
		expect(plugin.manifest.id).toBe('beancount-obsidian');
	});

	// The plugin's whole surface: one command, one settings tab, the vault
	// events behind completion and on-save alignment, and the two editor
	// suggests — no ribbon, status bar, DOM listeners or intervals.
	it('registers only the alignment command, settings tab and known listeners', async () => {
		const { plugin } = await loadPlugin();
		const { commands, settingTabs, events, editorSuggests, cleanups, ...rest } = plugin.registrations;
		expect(commands.map((command) => command.id)).toEqual(['align-decimal-points']);
		expect(settingTabs).toBe(1);
		expect(rest).toEqual({ ribbonIcons: [], statusBarItems: 0, domEvents: [], intervals: [] });
		expect(events).toHaveLength(5);
		expect(editorSuggests).toHaveLength(2);
		// One cleanup: pending on-save alignments. The mode uninstall registers
		// only when a CodeMirror registry exists.
		expect(cleanups).toHaveLength(1);

		await plugin.onunload();
		expect(plugin.registrations).toEqual({
			...rest,
			commands,
			settingTabs,
			events,
			editorSuggests,
			cleanups,
		});
	});

	it('wires account and payee completion to the vault on load', async () => {
		const vault = new FakeVault();
		vault.write(
			'ledger.bean',
			['2026-09-30 * "Whole Foods" "Groceries"', '  Expenses:Food  10.00 USD'].join('\n')
		);

		const { plugin } = await loadPlugin(vault);
		await flush();

		const [accounts, payees] = plugin.registrations.editorSuggests as Array<{
			getSuggestions(context: { query: string }): string[];
		}>;
		expect(accounts.getSuggestions({ query: 'Expenses' })).toEqual(['Expenses:Food']);
		expect(payees.getSuggestions({ query: 'Whole' })).toEqual(['Whole Foods']);
	});

	it('leaves the payee field to the payee suggest', async () => {
		const vault = new FakeVault();
		vault.write(
			'ledger.bean',
			['2026-09-30 * "Exxon" "Fuel"', '  Expenses:Food  10.00 USD'].join('\n')
		);
		const { plugin } = await loadPlugin(vault);
		await flush();
		const [accounts, payees] = plugin.registrations.editorSuggests as Array<{
			onTrigger: (cursor: { line: number; ch: number }, editor: unknown, file: null) => unknown;
		}>;
		// `"Ex` prefixes both the payee `Exxon` and the account
		// `Expenses:Food`; the payee field must show payees, not accounts.
		const payeeLine = createEditor(['2026-10-02 * "Ex']);
		const cursor = { line: 0, ch: payeeLine.lines[0].length };
		expect(accounts.onTrigger(cursor, payeeLine, null)).toBeNull();
		expect(payees.onTrigger(cursor, payeeLine, null)).toMatchObject({ query: 'Ex' });
		// …while account completion still answers on posting lines.
		const postingLine = createEditor(['  Expenses:Fo']);
		expect(accounts.onTrigger({ line: 0, ch: 13 }, postingLine, null)).toMatchObject({
			query: 'Expenses:Fo',
		});
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

	it('aligns the transaction block at the cursor from the command', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor([
			'2026-10-01 * "Store"',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash -12.5 USD',
		]);

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.lines).toEqual([
			'2026-10-01 * "Store"',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash  -12.5 USD',
		]);
		expect(editor.transactions).toHaveLength(1);
	});

	it('aligns only the transaction block at the cursor', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		]);
		editor.setCursor({ line: 6, ch: 1 });

		plugin.registrations.commands[0].editorCallback?.(editor);

		// The first transaction is outside the cursor's block and stays as
		// written — including its own unaligned-looking gap.
		expect(editor.lines).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash       -1234.5 CNY',
		]);
	});

	it('aligns the selection when there is one', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		]);
		editor.selections = [{ anchor: { line: 1, ch: 0 }, head: { line: 2, ch: 0 } }];

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.lines).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash  -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		]);
	});

	it('leaves an already aligned file untouched from the command', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash  -12.5 USD']);

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.transactions).toEqual([]);
	});

	it('keeps a lone caret before its amount when the gap moves', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		// Past the gap end on the line whose gap widens (1 → 2 spaces).
		editor.setCursor({ line: 1, ch: 15 });

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.getCursor()).toEqual({ line: 1, ch: 16 });
	});

	it('rides a caret inside the gap to the amount', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY']);
		editor.setCursor({ line: 0, ch: 14 });

		plugin.registrations.commands[0].editorCallback?.(editor);

		// The gap grows from 2 to 7 spaces; the caret lands at its new end.
		expect(editor.getCursor()).toEqual({ line: 0, ch: 20 });
	});

	it('keeps a caret before the gap in place', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY']);
		editor.setCursor({ line: 0, ch: 5 });

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.getCursor()).toEqual({ line: 0, ch: 5 });
	});

	it('leaves multi-caret positions to the editor', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY']);
		editor.selections = [
			{ anchor: { line: 0, ch: 14 }, head: { line: 0, ch: 14 } },
			{ anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 5 } },
		];

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.lines[0]).toBe('  Assets:Cash       12.5 CNY');
		// The plugin must not force a single caret over the user's carets.
		expect(editor.selections).toEqual([
			{ anchor: { line: 0, ch: 14 }, head: { line: 0, ch: 14 } },
			{ anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 5 } },
		]);
	});

	it('keeps a caret at the gap start with the account', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		// Exactly where the account ends and the gap begins on the line whose
		// gap widens; the account side keeps the caret.
		editor.setCursor({ line: 1, ch: 13 });

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.getCursor()).toEqual({ line: 1, ch: 13 });
	});

	it('keeps a range selection from collapsing', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor(['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY']);
		// An amount selected end-to-end, as it would be before retyping it.
		editor.selections = [{ anchor: { line: 0, ch: 15 }, head: { line: 1, ch: 23 } }];

		plugin.registrations.commands[0].editorCallback?.(editor);

		expect(editor.lines[0]).toBe('  Assets:Cash       12.5 CNY');
		// Forcing a caret here would make the next keystroke insert instead
		// of replacing the selection.
		expect(editor.selections).toEqual([{ anchor: { line: 0, ch: 15 }, head: { line: 1, ch: 23 } }]);
	});

	it('skips on-save alignment while the setting is off', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		await loadPlugin(vault);

		await vault.emit('modify', file);
		await delay(600);

		expect(vault.writes).toEqual([]);
	});

	it('aligns on save and stops once the file is aligned', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		await loadPlugin(vault, { alignOnSave: true });

		await vault.emit('modify', file);
		await delay(600);

		expect(vault.contents.get('ledger.bean')).toBe(
			'  Expenses:Food 12.5 USD\n  Assets:Cash  -12.5 USD'
		);
		expect(vault.writes).toEqual(['ledger.bean']);

		// The rewrite fires `modify` again; aligned text must not rewrite.
		await delay(600);
		expect(vault.writes).toEqual(['ledger.bean']);
	});

	it('debounces a burst of saves into one rewrite', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		await loadPlugin(vault, { alignOnSave: true });

		await vault.emit('modify', file);
		await vault.emit('modify', file);
		await delay(600);

		expect(vault.writes).toEqual(['ledger.bean']);
	});

	it('skips non-text files on save', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.png', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		await loadPlugin(vault, { alignOnSave: true });

		await vault.emit('modify', file);
		await delay(600);

		expect(vault.writes).toEqual([]);
	});

	it('aligns an open file through its editor on save', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		await loadPlugin(vault, { alignOnSave: true }, [{ view: { file, editor } }]);

		await vault.emit('modify', file);
		await delay(600);

		// The editor buffer is rewritten, not the file: the buffer is what
		// Obsidian autosaves, so a vault write would just be clobbered.
		expect(editor.lines).toEqual(['  Expenses:Food 12.5 USD', '  Assets:Cash  -12.5 USD']);
		expect(vault.writes).toEqual([]);
		// Autosaving the aligned buffer fires `modify` again; nothing is left.
		await vault.emit('modify', file);
		await delay(600);
		expect(editor.transactions).toHaveLength(1);
	});

	it('finds the file in a background leaf when another file is active', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		const otherFile = vault.write('other.bean', '');
		const otherView = { file: otherFile, editor: createEditor(['']) };
		await loadPlugin(
			vault,
			{ alignOnSave: true },
			[{ view: otherView }, { view: { file, editor } }],
			otherView
		);

		await vault.emit('modify', file);
		await delay(600);

		expect(editor.lines).toEqual(['  Expenses:Food 12.5 USD', '  Assets:Cash  -12.5 USD']);
		expect(vault.writes).toEqual([]);
	});

	it('skips the pending align when the setting is turned off meanwhile', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const { plugin } = await loadPlugin(vault, { alignOnSave: true });

		await vault.emit('modify', file);
		plugin.settings.alignOnSave = false;
		await delay(600);

		expect(vault.writes).toEqual([]);
	});

	it('drops pending on-save work on unload', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const { plugin } = await loadPlugin(vault, { alignOnSave: true });

		await vault.emit('modify', file);
		await plugin.onunload();
		for (const cleanup of plugin.registrations.cleanups) cleanup();
		await delay(600);

		expect(vault.writes).toEqual([]);
	});

	it('persists the on-save toggle and honors it', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const { plugin } = await loadPlugin(vault);
		const tab = new BeancountSettingTab({} as App, plugin);
		tab.display();
		const { settings } = tab.containerEl as unknown as FakeSettingContainer;

		expect(settings).toHaveLength(1);
		expect(settings[0].name).toBe('Align amounts on save');
		expect(settings[0].toggle?.value).toBe(false);
		await settings[0].toggle?.onChangeHandler?.(true);
		expect(plugin.savedData).toEqual([{ alignOnSave: true }]);

		await vault.emit('modify', file);
		await delay(600);
		expect(vault.writes).toEqual(['ledger.bean']);
	});
});
