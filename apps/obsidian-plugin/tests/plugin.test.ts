import type { App, PluginManifest } from 'obsidian';
import { Plugin } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import BeancountPlugin from '../main';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

function emptyRegistrations(): RecordingPlugin['registrations'] {
	return {
		commands: [],
		ribbonIcons: [],
		statusBarItems: 0,
		settingTabs: 0,
		domEvents: [],
		intervals: [],
	};
}

describe('BeancountPlugin', () => {
	it('is an Obsidian Plugin subclass', () => {
		const plugin = new BeancountPlugin({} as App, manifest);
		expect(plugin).toBeInstanceOf(Plugin);
		expect(plugin.manifest.id).toBe('beancount-obsidian');
	});

	// Phase 0 acceptance: the plugin loads with no sample UI — no dice ribbon,
	// no sample commands, no status bar text, no settings tab, no stray listeners.
	it('registers nothing when loaded and unloaded', async () => {
		const plugin = new BeancountPlugin({} as App, manifest);
		await plugin.onload();
		expect((plugin as unknown as RecordingPlugin).registrations).toEqual(emptyRegistrations());

		await plugin.onunload();
		expect((plugin as unknown as RecordingPlugin).registrations).toEqual(emptyRegistrations());
	});
});
