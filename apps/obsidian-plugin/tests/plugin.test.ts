import type { App, PluginManifest } from 'obsidian';
import { Plugin } from 'obsidian';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BeanCheckRun, LineDiagnostic } from '../bean-check';
import { parseBeanCheckErrors, toLineDiagnostics } from '../bean-check';
import { setLineDiagnostics } from '../diagnostics';
import type { FakeSettingContainer, Plugin as RecordingPlugin } from './mocks/obsidian';
import { notices } from './mocks/obsidian';
import type { MockHoverTooltip, MockKeymapExtension, MockLanguageDataExtension, MockView } from './mocks/codemirror';
import { createView } from './mocks/codemirror';
import type { FakeEditor, FakeFile } from './fakes';
import { createEditor, FakeVault, flush } from './fakes';
import { beancountMode, BEANCOUNT_LANGUAGE_DATA } from '../beancount-mode';
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

/** What each `bean-check` run is told, and what it answers. */
const beanCheckRuns: Array<{ command: string; args: readonly string[] }> = [];
let beanCheckResult: BeanCheckRun = { stderr: '', missing: false };

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
	// Saves validate through bean-check; tests record the invocation and
	// answer with `beanCheckResult` instead of running the real tool.
	plugin.beanCheckRunner = async (command, args) => {
		beanCheckRuns.push({ command, args: [...args] });
		return beanCheckResult;
	};
	return { plugin, vault };
}

/** Completes the in-flight `bean-check` when the test calls the returned function. */
function holdBeanCheck(plugin: BeancountPlugin): (run: BeanCheckRun) => void {
	let release: (run: BeanCheckRun) => void = () => undefined;
	plugin.beanCheckRunner = async (command, args) => {
		beanCheckRuns.push({ command, args: [...args] });
		return await new Promise<BeanCheckRun>((resolve) => {
			release = resolve;
		});
	};
	return (run) => release(run);
}

async function unloadPlugin(plugin: BeancountPlugin & RecordingPlugin): Promise<void> {
	await plugin.onunload();
	for (const cleanup of plugin.registrations.cleanups) cleanup();
}

/** An open leaf whose view shows `file` in `editor`. */
interface FakeLeaf {
	view: { file: FakeFile | null; editor: FakeEditor | null };
}

/** The diagnostics last published to `editor`'s view, if any. */
function published(editor: FakeEditor): LineDiagnostic[] {
	const last = editor.cm.dispatched[editor.cm.dispatched.length - 1];
	const effect = last?.effects[0] as { value?: unknown; is(spec: unknown): boolean } | undefined;
	return effect?.is(setLineDiagnostics) ? (effect.value as LineDiagnostic[]) : [];
}

afterEach(() => {
	delete host.CodeMirror;
	beanCheckRuns.length = 0;
	beanCheckResult = { stderr: '', missing: false };
	notices.length = 0;
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

		const [accounts, payees, commodities, tags, links] = plugin.registrations.editorSuggests as Array<{
			getSuggestions(context: { query: string }): string[];
		}>;
		expect(accounts.getSuggestions({ query: 'Expenses' })).toEqual(['Expenses:Food']);
		expect(payees.getSuggestions({ query: 'Whole' })).toEqual(['Whole Foods']);
		expect(commodities.getSuggestions({ query: 'US' })).toEqual(['USD']);
		expect(tags.getSuggestions({ query: '#tr' })).toEqual(['#trip']);
		expect(links.getSuggestions({ query: '^r' })).toEqual(['^receipt']);
	});

	it('offers narration completion only with the setting on', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-09-30 * "Shell" "Fuel"');
		const { plugin } = await loadPlugin(vault);
		await flush();

		const narrations = plugin.registrations.editorSuggests[5] as {
			onTrigger(cursor: { line: number; ch: number }, editor: unknown, file: null): unknown;
		};
		const line = createEditor(['2026-09-30 * "Shell" "Fu']);
		const cursor = { line: 0, ch: line.lines[0].length };
		// Default settings leave the field alone…
		expect(narrations.onTrigger(cursor, line, null)).toBeNull();
		// …the toggle turns it on…
		plugin.settings.completeNarration = true;
		expect(narrations.onTrigger(cursor, line, null)).toMatchObject({ query: 'Fu' });
		// …and a stored true loads enabled.
		const loaded = await loadPlugin(vault, { completeNarration: true });
		await flush();
		const enabled = loaded.plugin.registrations.editorSuggests[5] as {
			onTrigger(cursor: { line: number; ch: number }, editor: unknown, file: null): unknown;
		};
		expect(enabled.onTrigger(cursor, line, null)).toMatchObject({ query: 'Fu' });
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
		const suggests = plugin.registrations.editorSuggests as Array<{ context: unknown }>;
		for (const suggest of suggests) {
			// A popup is open: Enter accepts the suggestion, never indents.
			suggest.context = {};
			const open = createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]);
			expect(run(open)).toBe(false);
			expect(open.dispatched).toEqual([]);

			suggest.context = null;
		}
		const closed = createView('2026-10-01 * "Store"', [{ anchor: 20, head: 20 }]);
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
		expect(run(view)).toBe(true);
		expect(view.dispatched).toHaveLength(1);
		// Default separator column 50: the inserted `.` sits at 0-based index 49.
		expect(view.dispatched[0].changes[0].insert.indexOf('.')).toBe(49);
		plugin.settings.separatorColumn = 40;
		const col40 = createView(text, [{ anchor: caret }]);
		expect(run(col40)).toBe(true);
		expect(col40.dispatched[0].changes[0].insert.indexOf('.')).toBe(39);
		plugin.settings.instantAlignment = false;
		const silenced = createView(text, [{ anchor: caret }]);
		expect(run(silenced)).toBe(false);
		expect(silenced.dispatched).toEqual([]);
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

	it('registers the date command with its default hotkey and inserts today', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 30));
		try {
			const { plugin } = await loadPlugin();
			const command = plugin.registrations.commands.find((entry) => entry.id === 'insert-today-date');
			expect(command?.hotkeys).toEqual([{ modifiers: ['Mod', 'Shift'], key: 'D' }]);
			const editor = createEditor(['']);
			command?.editorCallback?.(editor);
			expect(editor.getValue()).toBe('2026-09-30');
		} finally {
			vi.useRealTimers();
		}
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

	it('aligns the selection only, not the block around it', async () => {
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
		// One posting line of the second transaction — a strict subset of its
		// block, whose own column needs no padding.
		editor.selections = [{ anchor: { line: 6, ch: 0 }, head: { line: 6, ch: 23 } }];

		plugin.registrations.commands[0].editorCallback?.(editor);

		// Aligning the whole block instead would have padded line 6 to seven
		// spaces; the selection's own column leaves everything in place.
		expect(editor.lines).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		]);
	});

	it('aligns the selected lines to their block column', async () => {
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
		editor.selections = [{ anchor: { line: 5, ch: 0 }, head: { line: 6, ch: 23 } }];

		plugin.registrations.commands[0].editorCallback?.(editor);

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

	it('drops the trailing line of a selection that ends at column 0', async () => {
		const { plugin } = await loadPlugin();
		const editor = createEditor([
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'  Expenses:Food:Rest 1.00 USD',
		]);
		// Selecting whole lines by dragging to the next line's start.
		editor.selections = [{ anchor: { line: 0, ch: 0 }, head: { line: 2, ch: 0 } }];

		plugin.registrations.commands[0].editorCallback?.(editor);

		// Line 2 holds no selected characters: untouched, and its width does
		// not widen the column of the selected lines either.
		expect(editor.lines).toEqual([
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash  -12.5 CNY',
			'  Expenses:Food:Rest 1.00 USD',
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
		// An amount selected end-to-end inside one line, as it would be
		// before retyping it.
		editor.selections = [{ anchor: { line: 0, ch: 15 }, head: { line: 0, ch: 19 } }];

		plugin.registrations.commands[0].editorCallback?.(editor);

		// The selection is the scope, so the line drops to its own column
		// instead of the block's — and the range itself must survive.
		expect(editor.lines[0]).toBe('  Assets:Cash 12.5 CNY');
		// Forcing a caret here would make the next keystroke insert instead
		// of replacing the selection.
		expect(editor.selections).toEqual([{ anchor: { line: 0, ch: 15 }, head: { line: 0, ch: 19 } }]);
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
		const content = [
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		].join('\n');
		const file = vault.write('ledger.bean', content);
		const editor = createEditor(content.split('\n'));
		await loadPlugin(vault, { alignOnSave: true }, [{ view: { file, editor } }]);
		editor.setCursor({ line: 1, ch: 1 });

		await vault.emit('modify', file);
		await delay(600);

		// The editor buffer is rewritten, not the file: the buffer is what
		// Obsidian autosaves, so a vault write would just be clobbered. The
		// walk covers every block, not just the caret's: block B aligns even
		// though the cursor sits in block A.
		expect(editor.lines).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash  -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash       -1234.5 CNY',
		]);
		expect(vault.writes).toEqual([]);
		// Autosaving the aligned buffer fires `modify` again; nothing is left.
		await vault.emit('modify', file);
		await delay(600);
		expect(editor.transactions).toHaveLength(1);
	});

	it('aligns through the active editor when it shows the file', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		await loadPlugin(vault, { alignOnSave: true }, [], { file, editor });

		await vault.emit('modify', file);
		await delay(600);

		expect(editor.lines).toEqual(['  Expenses:Food 12.5 USD', '  Assets:Cash  -12.5 USD']);
		expect(vault.writes).toEqual([]);
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

	it('tolerates a file that vanishes before its on-save align reads it', async () => {
		const vault = new FakeVault();
		// Not open in any leaf: the aligner reads it through the vault.
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		await loadPlugin(vault, { alignOnSave: true });

		// The read rejects — the file vanished after the save. That must not
		// surface as an unhandled rejection, and nothing is rewritten.
		vault.failures.add('ledger.bean');
		await expect(vault.emit('modify', file)).resolves.toBeUndefined();
		await delay(600);

		expect(vault.writes).toEqual([]);
	});

	it('tolerates a bean-check run that rejects', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const { plugin } = await loadPlugin(vault);
		plugin.beanCheckRunner = async () => {
			throw new Error('bean-check exploded');
		};

		// A failing run must not surface as an unhandled rejection; the next
		// save simply tries again.
		await expect(vault.emit('modify', file)).resolves.toBeUndefined();
		await delay(600);

		expect(notices).toEqual([]);
	});

	it('leaves a file alone when it changed while the read was in flight', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		await loadPlugin(vault, { alignOnSave: true });
		await flush();
		// The first read belongs to the vault index's refresh of this
		// `modify`; the slow second one is the aligner's own.
		vault.delays.set('ledger.bean', [1, 1000]);

		await vault.emit('modify', file);
		await delay(650);
		// Something else rewrote the file while our read was in flight.
		const newer = '  Expenses:Food 99.00 USD\n  Assets:Cash -99.00 USD';
		vault.contents.set('ledger.bean', newer);
		await delay(1100);

		// The stale snapshot must not overwrite the newer text; the newer
		// text's own `modify` brings alignment back.
		expect(vault.writes).toEqual([]);
		expect(vault.contents.get('ledger.bean')).toBe(newer);
	});

	it('redirects to the editor when the file opens while the read is in flight', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const leaves: FakeLeaf[] = [];
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		await loadPlugin(vault, { alignOnSave: true }, leaves);
		await flush();
		// First read: the index refresh for this `modify`; second: the
		// aligner's own, kept in flight past the leaf push below.
		vault.delays.set('ledger.bean', [1, 1000]);

		await vault.emit('modify', file);
		await delay(650);
		// The file is opened while the closed-file read is in flight.
		leaves.push({ view: { file, editor } });
		await delay(1100);

		// The editor buffer owns it now — no vault write to be clobbered.
		expect(editor.lines).toEqual(['  Expenses:Food 12.5 USD', '  Assets:Cash  -12.5 USD']);
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
		// The validation the same save scheduled is dropped with it.
		expect(beanCheckRuns).toEqual([]);
	});

	it('discards an in-flight error report after unload', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const editor = createEditor(['2026-10-01 * "A"']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		const release = holdBeanCheck(plugin);

		await vault.emit('modify', file);
		await delay(600);
		expect(beanCheckRuns).toHaveLength(1);

		await unloadPlugin(plugin);
		release({ stderr: '/vault/ledger.bean:1:       late result\n', missing: false });
		await flush();

		expect(editor.cm.dispatched).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('discards an in-flight clean report after unload', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const editor = createEditor(['2026-10-01 * "A"']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		const release = holdBeanCheck(plugin);

		await vault.emit('modify', file);
		await delay(600);
		expect(beanCheckRuns).toHaveLength(1);

		await unloadPlugin(plugin);
		release({ stderr: '', missing: false });
		await flush();

		expect(editor.cm.dispatched).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('does not notice a missing bean-check after unload', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const { plugin } = await loadPlugin(vault);
		const release = holdBeanCheck(plugin);

		await vault.emit('modify', file);
		await delay(600);
		expect(beanCheckRuns).toHaveLength(1);

		await unloadPlugin(plugin);
		release({ stderr: '', missing: true });
		await flush();

		expect(notices).toEqual([]);
	});

	it('does not notice a bean-check failure after unload', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const editor = createEditor(['2026-10-01 * "A"']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		const release = holdBeanCheck(plugin);

		await vault.emit('modify', file);
		await delay(600);
		expect(beanCheckRuns).toHaveLength(1);

		await unloadPlugin(plugin);
		release({
			stderr: "Traceback (most recent call last):\nModuleNotFoundError: No module named 'beancount'\n",
			missing: false,
		});
		await flush();

		expect(editor.cm.dispatched).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('does not notice an unmapped report after unload', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', 'include "gone.bean"\n');
		const editor = createEditor(['include "gone.bean"']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		const release = holdBeanCheck(plugin);

		await vault.emit('modify', file);
		await delay(600);
		expect(beanCheckRuns).toHaveLength(1);

		await unloadPlugin(plugin);
		release({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		await flush();

		expect(editor.cm.dispatched).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('discards an in-flight fence report after unload', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		const release = holdBeanCheck(plugin);

		await vault.emit('modify', file);
		await delay(600);
		expect(beanCheckRuns).toHaveLength(1);

		await unloadPlugin(plugin);
		release({
			stderr: `${beanCheckRuns[0].args[0]}:1:       late fence\n`,
			missing: false,
		});
		await flush();

		expect(editor.cm.dispatched).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('persists the on-save toggle and honors it', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD');
		const { plugin } = await loadPlugin(vault);
		const tab = new BeancountSettingTab({} as App, plugin);
		tab.display();
		const { settings } = tab.containerEl as unknown as FakeSettingContainer;

		expect(settings.map((setting) => setting.name)).toEqual([
			'Alignment',
			'Align amounts on save',
			'Instant alignment',
			'Separator column',
			'Validation',
			'Bean-check executable',
			'Entry ledger',
			'Balance inlay hints',
			'Completion',
			'Complete payees',
			'Complete narrations',
			'Fava',
			'Fava executable',
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

		await vault.emit('modify', file);
		await delay(600);
		expect(vault.writes).toEqual(['ledger.bean']);
		// The aligned rewrite re-arms the validation; drain it so it cannot
		// land in the next test.
		await delay(600);
	});

	// The stderr bean-check prints for a ledger saved with a deliberate
	// mistake: one report per line, an indented source echo after each. It
	// names the real, vault-rooted path the plugin hands the tool.
	const BROKEN_STDERR = [
		'/vault/ledger.bean:1:       Transaction does not balance: (10.00 USD)',
		'',
		'   2026-10-01 * "Broken"',
		'     Assets:Cash  10.00 USD',
		'',
	].join('\n');

	it('marks the lines bean-check reports for the saved file', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "Broken"\n  Assets:Cash  10.00 USD\n');
		const editor = createEditor(['2026-10-01 * "Broken"', '  Assets:Cash  10.00 USD', '']);
		await loadPlugin(vault, null, [{ view: { file, editor } }]);
		beanCheckResult = { stderr: BROKEN_STDERR, missing: false };

		await vault.emit('modify', file);
		await delay(600);

		// The vault base path is joined onto the vault-relative target.
		expect(beanCheckRuns).toEqual([{ command: 'bean-check', args: ['/vault/ledger.bean'] }]);
		// What the editor receives is exactly the stderr, folded per line.
		expect(published(editor)).toEqual(toLineDiagnostics(parseBeanCheckErrors(BROKEN_STDERR)));
		expect(published(editor)).toEqual([{ line: 0, message: 'Transaction does not balance: (10.00 USD)' }]);
		expect(notices).toEqual([]);
	});

	it('debounces a burst of saves into one run', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "Broken"\n');
		await loadPlugin(vault);
		beanCheckResult = { stderr: BROKEN_STDERR, missing: false };

		await vault.emit('modify', file);
		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toHaveLength(1);
	});

	it('leaves non-ledger text files unvalidated', async () => {
		// Prose without a beancount fence is not a ledger; bean-check stays idle.
		const vault = new FakeVault();
		const file = vault.write('note.md', 'prose');
		await loadPlugin(vault);

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toEqual([]);
	});

	it('marks a fence error on the markdown line, not the temp-file line', async () => {
		const note = [
			'# Grocery',
			'',
			'```beancount',
			'2026-10-01 * "Cafe"',
			'  Expenses:Food  10.00 USD',
			'  Assets:CaSH   -10.00 USD',
			'```',
		].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		let tempPath = '';
		plugin.beanCheckRunner = async (command, args) => {
			tempPath = args[0];
			beanCheckRuns.push({ command, args: [...args] });
			return {
				stderr: `${args[0]}:1:       Invalid reference to unknown account 'Assets:CaSH'\n`,
				missing: false,
			};
		};

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toHaveLength(1);
		expect(tempPath.endsWith('fences.bean')).toBe(true);
		expect(tempPath.includes('/vault/')).toBe(false);
		expect(existsSync(tempPath)).toBe(false);
		// bean-check's line 1 is the transaction header — markdown line 3.
		expect(published(editor)).toEqual([
			{ line: 3, message: "Invalid reference to unknown account 'Assets:CaSH'" },
		]);
		expect(notices).toEqual([]);
	});

	it('does not notice when a fence is clean', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		await loadPlugin(vault, null, [{ view: { file, editor } }]);
		beanCheckResult = { stderr: '', missing: false };

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toHaveLength(1);
		expect(published(editor)).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('includes the entry ledger when checking a markdown fence', async () => {
		const note = ['```bean', '2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD', '```'].join('\n');
		const vault = new FakeVault();
		vault.write('main.bean', 'option "title" "Main"\n');
		const file = vault.write('note.md', note);
		const { plugin } = await loadPlugin(vault, { entryLedger: 'main.bean' });
		let body = '';
		plugin.beanCheckRunner = async (command, args) => {
			body = readFileSync(args[0], 'utf8');
			beanCheckRuns.push({ command, args: [...args] });
			return { stderr: '', missing: false };
		};

		await vault.emit('modify', file);
		await delay(600);

		expect(body.startsWith('include "/vault/main.bean"')).toBe(true);
		expect(notices).toEqual([]);
	});

	it('does not announce entry-ledger errors when the fence itself is clean', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		vault.write('main.bean', 'garbage\n');
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, { entryLedger: 'main.bean' }, [
			{ view: { file, editor } },
		]);
		plugin.beanCheckRunner = async (command, args) => {
			beanCheckRuns.push({ command, args: [...args] });
			return {
				stderr: '/vault/main.bean:1:       Invalid token: \'garbage\'\n',
				missing: false,
			};
		};

		await vault.emit('modify', file);
		await delay(600);

		expect(published(editor)).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('clears fence marks when the note no longer has a ledger fence', async () => {
		const note = ['```beancount', '2026-10-01 * "Cafe"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		plugin.beanCheckRunner = async (command, args) => {
			beanCheckRuns.push({ command, args: [...args] });
			return { stderr: `${args[0]}:1:       oops\n`, missing: false };
		};

		await vault.emit('modify', file);
		await delay(600);
		expect(published(editor)).toEqual([{ line: 1, message: 'oops' }]);

		vault.write('note.md', 'just prose\n');
		await vault.emit('modify', file);
		await delay(600);

		expect(published(editor)).toEqual([]);
		expect(beanCheckRuns).toHaveLength(1);
	});

	it('does not notice on a prose note even when bean-check is misconfigured', async () => {
		const vault = new FakeVault();
		const file = vault.write('note.md', 'just prose');
		await loadPlugin(vault, { beanCheckPath: '/bin/bash' });

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('refuses an entry ledger that would break out of the include line', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		await loadPlugin(vault, { entryLedger: 'main.bean\nplugin "os"' });

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toEqual([]);
		expect(notices[0]).toContain('entry ledger must be a vault file');
	});

	it('maps an error in the second fence onto that fence’s host line', async () => {
		const note = [
			'```beancount',
			'option "title" "A"',
			'```',
			'',
			'```beancount',
			'2026-10-02 * "B"',
			'```',
		].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		plugin.beanCheckRunner = async (command, args) => {
			beanCheckRuns.push({ command, args: [...args] });
			return { stderr: `${args[0]}:3:       oops\n`, missing: false };
		};

		await vault.emit('modify', file);
		await delay(600);

		expect(published(editor)).toEqual([{ line: 5, message: 'oops' }]);
	});

	it('deletes the temp fence ledger when the runner throws', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const { plugin } = await loadPlugin(vault);
		let tempPath = '';
		plugin.beanCheckRunner = async (_command, args) => {
			tempPath = args[0];
			throw new Error('boom');
		};

		await vault.emit('modify', file);
		await delay(600);

		expect(tempPath.endsWith('fences.bean')).toBe(true);
		expect(existsSync(tempPath)).toBe(false);
	});

	it('does not collapse a markdown save with an entry-ledger save', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'option "title" "Main"\n');
		const file = vault.write('note.md', note);
		await loadPlugin(vault, { entryLedger: 'main.bean' });

		await vault.emit('modify', file);
		await delay(100);
		await vault.emit('modify', main);
		await delay(600);

		expect(beanCheckRuns).toHaveLength(2);
	});

	it('announces a <load> failure from a markdown fence run', async () => {
		const note = ['```beancount', 'option "title" "ok"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		const editor = createEditor(note.split('\n'));
		const { plugin } = await loadPlugin(vault, { entryLedger: 'main.bean' }, [
			{ view: { file, editor } },
		]);
		plugin.beanCheckRunner = async (command, args) => {
			beanCheckRuns.push({ command, args: [...args] });
			return { stderr: '<load>:0:       File "/vault/main.bean" does not exist\n', missing: false };
		};

		await vault.emit('modify', file);
		await delay(600);

		expect(notices).toEqual(['bean-check: <load>: File "/vault/main.bean" does not exist']);
		expect(published(editor)).toEqual([]);
	});

	it('checks the whole entry ledger and marks every file it reports', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "child.bean"\n');
		const child = vault.write('child.bean', '2026-10-01 * "Sub"\n  Assets:Cash  5.00 USD\n');
		const mainEditor = createEditor(['include "child.bean"', '']);
		const childEditor = createEditor(['2026-10-01 * "Sub"', '  Assets:Cash  5.00 USD']);
		await loadPlugin(vault, { entryLedger: 'main.bean' }, [
			{ view: { file: main, editor: mainEditor } },
			{ view: { file: child, editor: childEditor } },
		]);
		beanCheckResult = {
			stderr: [
				'/vault/child.bean:2:       Invalid reference to unknown account \'Assets:Cash\'',
				'',
				'/vault/main.bean:1:       Invalid token: \'garbage\'',
				'',
			].join('\n'),
			missing: false,
		};

		await vault.emit('modify', child);
		await delay(600);

		// Saving a member file checks the configured entry file instead.
		expect(beanCheckRuns).toEqual([{ command: 'bean-check', args: ['/vault/main.bean'] }]);
		expect(published(childEditor)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
		expect(published(mainEditor)).toEqual([{ line: 0, message: "Invalid token: 'garbage'" }]);
	});

	it('clears a ledger-wide file that the next run reports clean', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "child.bean"\n');
		const child = vault.write('child.bean', '2026-10-01 * "Sub"\n  Assets:Cash  5.00 USD\n');
		const childEditor = createEditor(['2026-10-01 * "Sub"', '  Assets:Cash  5.00 USD']);
		await loadPlugin(vault, { entryLedger: 'main.bean' }, [{ view: { file: child, editor: childEditor } }]);
		beanCheckResult = {
			stderr: '/vault/child.bean:2:       Invalid reference to unknown account \'Assets:Cash\'\n',
			missing: false,
		};

		await vault.emit('modify', child);
		await delay(600);
		expect(published(childEditor)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);

		beanCheckResult = { stderr: '', missing: false };
		await vault.emit('modify', child);
		await delay(600);

		expect(published(childEditor)).toEqual([]);
	});

	it('keeps a file-scoped run from touching other files', async () => {
		const vault = new FakeVault();
		const a = vault.write('a.bean', '2026-10-01 * "A"\n');
		const b = vault.write('b.bean', '2026-10-02 * "B"\n');
		const aEditor = createEditor(['2026-10-01 * "A"']);
		const bEditor = createEditor(['2026-10-02 * "B"']);
		await loadPlugin(vault, null, [
			{ view: { file: a, editor: aEditor } },
			{ view: { file: b, editor: bEditor } },
		]);
		beanCheckResult = { stderr: '/vault/a.bean:1:       oops\n', missing: false };

		await vault.emit('modify', a);
		await delay(600);

		expect(published(aEditor)).toEqual([{ line: 0, message: 'oops' }]);
		// b was never part of this file-scoped run; its editor is untouched.
		expect(bEditor.cm.dispatched).toEqual([]);

		beanCheckResult = { stderr: '', missing: false };
		await vault.emit('modify', b);
		await delay(600);

		expect(published(bEditor)).toEqual([]);
		// a's marks belong to its own run and survive b's.
		expect(published(aEditor)).toEqual([{ line: 0, message: 'oops' }]);
	});

	it('marks included files in a file-scoped run and clears them when they go quiet', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "child.bean"\n');
		const child = vault.write('child.bean', '2026-10-01 * "Sub"\n  Assets:Cash  5.00 USD\n');
		const mainEditor = createEditor(['include "child.bean"']);
		const childEditor = createEditor(['2026-10-01 * "Sub"', '  Assets:Cash  5.00 USD']);
		await loadPlugin(vault, null, [
			{ view: { file: main, editor: mainEditor } },
			{ view: { file: child, editor: childEditor } },
		]);
		beanCheckResult = {
			stderr: '/vault/child.bean:2:       Invalid reference to unknown account \'Assets:Cash\'\n',
			missing: false,
		};

		// No entry ledger: saving the including file still reports the include.
		await vault.emit('modify', main);
		await delay(600);

		expect(published(childEditor)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
		// The saved file itself is clean, and is told so.
		expect(published(mainEditor)).toEqual([]);

		beanCheckResult = { stderr: '', missing: false };
		await vault.emit('modify', main);
		await delay(600);

		// The same run owns the marks it set: a quiet include is cleared.
		expect(published(childEditor)).toEqual([]);
	});

	it('hands a mark to the saved file’s own run once that file is saved', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "child.bean"\n');
		const child = vault.write('child.bean', '2026-10-01 * "Sub"\n  Assets:Cash  5.00 USD\n');
		const childEditor = createEditor(['2026-10-01 * "Sub"', '  Assets:Cash  5.00 USD']);
		await loadPlugin(vault, null, [{ view: { file: child, editor: childEditor } }]);
		const error = {
			stderr: '/vault/child.bean:2:       Invalid reference to unknown account \'Assets:Cash\'\n',
			missing: false,
		};

		// The mark is child.bean's, but main.bean's run put it there.
		beanCheckResult = error;
		await vault.emit('modify', main);
		await delay(600);
		expect(published(childEditor)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);

		// Saving child.bean moves the ownership to its own run…
		await vault.emit('modify', child);
		await delay(600);
		expect(published(childEditor)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
		expect(childEditor.cm.dispatched).toHaveLength(2);

		// …so a later clean run of main.bean no longer clears it.
		beanCheckResult = { stderr: '', missing: false };
		await vault.emit('modify', main);
		await delay(600);
		expect(published(childEditor)).toEqual([
			{ line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" },
		]);
	});

	it('warns once when bean-check is missing', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "Broken"\n');
		const editor = createEditor(['2026-10-01 * "Broken"']);
		await loadPlugin(vault, null, [{ view: { file, editor } }]);
		beanCheckResult = { stderr: '', missing: true };

		await vault.emit('modify', file);
		await delay(600);
		await vault.emit('modify', file);
		await delay(600);

		// Every save still tries, so installing beancount needs no reload.
		expect(beanCheckRuns).toHaveLength(2);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain('pip install beancount');
		expect(editor.cm.dispatched).toEqual([]);
	});

	it('announces reports no editor can place', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', 'include "gone.bean"\n');
		const editor = createEditor(['include "gone.bean"']);
		await loadPlugin(vault, null, [{ view: { file, editor } }]);
		// A missing include loads as `<load>:0` — no vault file, no line.
		beanCheckResult = {
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		};

		await vault.emit('modify', file);
		await delay(600);
		await vault.emit('modify', file);
		await delay(600);

		// The same problem announced once — autosave must not stack toasts.
		expect(notices).toEqual(['bean-check: <load>: File "/vault/gone.bean" does not exist']);
		// The saved file itself is still cleared: a file-scoped run owns it.
		expect(published(editor)).toEqual([]);
	});

	it('matches a report against the vault root, not a suffix', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const short = vault.write('sub/a.bean', '2026-10-01 * "S"\n');
		const long = vault.write('other/sub/a.bean', '2026-10-02 * "L"\n');
		const shortEditor = createEditor(['2026-10-01 * "S"']);
		const longEditor = createEditor(['2026-10-02 * "L"']);
		await loadPlugin(vault, { entryLedger: 'main.bean' }, [
			{ view: { file: short, editor: shortEditor } },
			{ view: { file: long, editor: longEditor } },
		]);
		beanCheckResult = { stderr: '/vault/other/sub/a.bean:3:       oops\n', missing: false };

		await vault.emit('modify', short);
		await delay(600);

		expect(published(longEditor)).toEqual([{ line: 2, message: 'oops' }]);
		// The same tail under another folder must not draw on `sub/a.bean`.
		expect(shortEditor.cm.dispatched).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('runs the configured bean-check executable', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "Broken"\n');
		await loadPlugin(vault, { beanCheckPath: '/opt/homebrew/bin/bean-check' });

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toEqual([
			{ command: '/opt/homebrew/bin/bean-check', args: ['/vault/ledger.bean'] },
		]);
	});

	it('marks every pane showing a reported file', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const first = createEditor(['2026-10-01 * "A"']);
		const second = createEditor(['2026-10-01 * "A"']);
		await loadPlugin(vault, null, [
			{ view: { file, editor: first } },
			{ view: { file, editor: second } },
		]);
		beanCheckResult = { stderr: '/vault/ledger.bean:1:       oops\n', missing: false };

		await vault.emit('modify', file);
		await delay(600);

		// Split panes are separate views; both carry the mark…
		expect(published(first)).toEqual([{ line: 0, message: 'oops' }]);
		expect(published(second)).toEqual([{ line: 0, message: 'oops' }]);

		// …and both clear together.
		beanCheckResult = { stderr: '', missing: false };
		await vault.emit('modify', file);
		await delay(600);
		expect(published(first)).toEqual([]);
		expect(published(second)).toEqual([]);
	});

	it('keeps the newest run for a target, not the fastest', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const editor = createEditor(['2026-10-01 * "A"']);
		const { plugin } = await loadPlugin(vault, null, [{ view: { file, editor } }]);
		let calls = 0;
		plugin.beanCheckRunner = async () => {
			calls += 1;
			if (calls === 1) {
				// The first run is slow and reports the pre-fix state.
				await delay(1200);
				return { stderr: '/vault/ledger.bean:1:       stale\n', missing: false };
			}
			return { stderr: '', missing: false };
		};

		await vault.emit('modify', file);
		await delay(600); // the slow run is in flight now
		await vault.emit('modify', file);
		await delay(2000); // …and resolves last

		// The newer clean report stands; the stale run is dropped.
		expect(calls).toBe(2);
		expect(editor.cm.dispatched).toHaveLength(1);
		expect(published(editor)).toEqual([]);
	});

	it('collapses saves across the include chain into one run', async () => {
		const vault = new FakeVault();
		const main = vault.write('main.bean', 'include "child.bean"\n');
		const child = vault.write('child.bean', '2026-10-01 * "Sub"\n');
		await loadPlugin(vault, { entryLedger: 'main.bean' });

		await vault.emit('modify', child);
		await delay(100);
		await vault.emit('modify', main);
		await delay(600);

		// One target, one debounce window, one run.
		expect(beanCheckRuns).toEqual([{ command: 'bean-check', args: ['/vault/main.bean'] }]);
	});

	it('does not draw outside-vault reports on same-named vault files', async () => {
		const vault = new FakeVault();
		const file = vault.write('main.bean', 'include "/Users/me/shared/main.bean"\n');
		const editor = createEditor(['include "/Users/me/shared/main.bean"']);
		await loadPlugin(vault, null, [{ view: { file, editor } }]);
		beanCheckResult = {
			stderr: '/Users/me/shared/main.bean:3:       oops\n',
			missing: false,
		};

		await vault.emit('modify', file);
		await delay(600);

		// Same tail, different file: the report is announced, not drawn.
		expect(notices).toEqual(['bean-check: /Users/me/shared/main.bean: oops']);
		expect(published(editor)).toEqual([]);
	});

	it('keeps marks when bean-check output is not a report', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const editor = createEditor(['2026-10-01 * "A"']);
		await loadPlugin(vault, null, [{ view: { file, editor } }]);
		beanCheckResult = { stderr: '/vault/ledger.bean:1:       oops\n', missing: false };

		await vault.emit('modify', file);
		await delay(600);
		expect(published(editor)).toEqual([{ line: 0, message: 'oops' }]);

		// bean-check broke (a traceback, not a report): say so and keep the
		// marks — clearing them would read as "clean".
		beanCheckResult = {
			stderr: "Traceback (most recent call last):\nModuleNotFoundError: No module named 'beancount'\n",
			missing: false,
		};
		await vault.emit('modify', file);
		await delay(600);

		expect(notices).toEqual(['bean-check failed: Traceback (most recent call last):']);
		expect(published(editor)).toEqual([{ line: 0, message: 'oops' }]);
	});

	it('refuses a bean-check path that is not the validator', async () => {
		// A hostile synced data.json must not turn the save into
		// "execute this ledger with /bin/bash".
		const vault = new FakeVault();
		const file = vault.write('pwn.bean', 'touch /tmp/pwned\n');
		await loadPlugin(vault, { beanCheckPath: '/bin/bash' });

		await vault.emit('modify', file);
		await delay(600);

		expect(beanCheckRuns).toEqual([]);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain('pip install beancount');
	});

	it('refuses an entry ledger outside the vault', async () => {
		const vault = new FakeVault();
		const file = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		await loadPlugin(vault, { entryLedger: '/etc/passwd' });

		await vault.emit('modify', file);
		await delay(600);

		// bean-check quotes source tokens in its report — it must never be
		// pointed at a file the vault does not own.
		expect(beanCheckRuns).toEqual([]);
		expect(notices).toEqual(['bean-check: entry ledger must be a vault file, not "/etc/passwd"']);
	});
});
