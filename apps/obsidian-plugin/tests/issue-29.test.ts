import type { App, PluginManifest } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import { notices } from './mocks/obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import { FakeVault } from './fakes';
import { isFavaBinary } from '../fava';
import { mergeSettings } from '../settings';
import { DEFAULT_FLAG_WARNINGS } from '../flag-warnings';
import BeancountPlugin from '../main';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

const favaRuns: Array<{ command: string; args: readonly string[] }> = [];
let favaMissing = false;

afterEach(() => {
	favaRuns.length = 0;
	favaMissing = false;
	notices.length = 0;
});

async function loadPlugin(
	vault: FakeVault = new FakeVault(),
	loadedData: unknown = null,
	activePath: string | null = null
): Promise<BeancountPlugin & RecordingPlugin> {
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: {
				getLeavesOfType: () => [],
				activeEditor: null,
				getActiveFile: () =>
					activePath ? vault.api.getFiles().find((file) => file.path === activePath) ?? null : null,
			},
		} as unknown as App,
		manifest
	) as BeancountPlugin & RecordingPlugin;
	plugin.beanCheckRunner = async () => ({ stderr: '', missing: false });
	plugin.favaRunner = async (command, args) => {
		favaRuns.push({ command, args: [...args] });
		return { missing: favaMissing };
	};
	plugin.loadData = async () => loadedData;
	await plugin.onload();
	return plugin;
}

describe('isFavaBinary', () => {
	it('accepts fava and rejects anything else', () => {
		expect(isFavaBinary('fava')).toBe(true);
		expect(isFavaBinary('/opt/homebrew/bin/fava')).toBe(true);
		expect(isFavaBinary('C:\\Python\\Scripts\\fava.exe')).toBe(true);
		expect(isFavaBinary('/bin/bash')).toBe(false);
	});
});

describe('mergeSettings', () => {
	it('fills flagWarnings defaults under a partial stored map', () => {
		const settings = mergeSettings({ completePayee: false, flagWarnings: { '!': 'error' } });
		expect(settings.completePayee).toBe(false);
		expect(settings.flagWarnings['!']).toBe('error');
		expect(settings.flagWarnings['*']).toBe(DEFAULT_FLAG_WARNINGS['*']);
		expect(settings.separatorColumn).toBe(50);
	});
});

describe('issue 29 commands and Fava', () => {
	it('registers align-decimal-points with Mod+Shift+.', async () => {
		const plugin = await loadPlugin();
		const command = plugin.registrations.commands.find((entry) => entry.id === 'align-decimal-points');
		expect(command?.hotkeys).toEqual([{ modifiers: ['Mod', 'Shift'], key: '.' }]);
	});

	it('starts Fava against the entry ledger and announces the URL', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', 'option "title" "Main"\n');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const command = plugin.registrations.commands.find((entry) => entry.id === 'run-fava');
		await command?.callback?.();
		expect(favaRuns).toEqual([{ command: 'fava', args: ['-H', '127.0.0.1', '/vault/main.bean'] }]);
		expect(notices).toEqual(['Fava is running at http://127.0.0.1:5000/']);
	});

	it('refuses a Fava path that is not the binary', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean', favaPath: '/bin/bash' });
		const command = plugin.registrations.commands.find((entry) => entry.id === 'run-fava');
		await command?.callback?.();
		expect(favaRuns).toEqual([]);
		expect(notices[0]).toMatch(/fava not found/);
	});

	it('runs Fava on activate when the setting is on', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-10-01 * "A"\n');
		await loadPlugin(vault, { runFavaOnActivate: true }, 'ledger.bean');
		expect(favaRuns).toEqual([{ command: 'fava', args: ['-H', '127.0.0.1', '/vault/ledger.bean'] }]);
		expect(notices).toEqual([]);
	});

	it('notices when the Fava spawn is missing', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		favaMissing = true;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const command = plugin.registrations.commands.find((entry) => entry.id === 'run-fava');
		await command?.callback?.();
		expect(notices[0]).toMatch(/fava not found/);
	});

	it('notices when no ledger file is available', async () => {
		const plugin = await loadPlugin();
		const command = plugin.registrations.commands.find((entry) => entry.id === 'run-fava');
		await command?.callback?.();
		expect(favaRuns).toEqual([]);
		expect(notices).toEqual(['No valid bean file is available.']);
	});
});
