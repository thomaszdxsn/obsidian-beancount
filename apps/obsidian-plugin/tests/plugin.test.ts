import type { App, PluginManifest } from 'obsidian';
import { Plugin } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import { beancountMode } from '../beancount-mode';
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

function emptyRegistrations(): RecordingPlugin['registrations'] {
	return {
		commands: [],
		ribbonIcons: [],
		statusBarItems: 0,
		settingTabs: 0,
		domEvents: [],
		intervals: [],
		cleanups: [],
	};
}

function loadPlugin(): BeancountPlugin & RecordingPlugin {
	const plugin = new BeancountPlugin({} as App, manifest) as BeancountPlugin & RecordingPlugin;
	plugin.onload();
	return plugin;
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

	// Phase 0 acceptance: no sample UI — no ribbon, no commands, no status bar
	// text, no settings tab, no stray listeners.
	it('registers no sample UI when loaded and unloaded', async () => {
		const plugin = loadPlugin();
		expect(plugin.registrations).toEqual(emptyRegistrations());

		await plugin.onunload();
		expect(plugin.registrations).toEqual(emptyRegistrations());
	});

	it('installs the beancount mode and its bean alias into the mode registry', () => {
		const registry = fakeRegistry();
		host.CodeMirror = registry;

		loadPlugin();

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

	it('removes the registered modes on unload', () => {
		const registry = fakeRegistry();
		host.CodeMirror = registry;

		const plugin = loadPlugin();
		expect(plugin.registrations.cleanups).toHaveLength(1);
		for (const cleanup of plugin.registrations.cleanups) cleanup();

		expect(registry.modes.beancount).toBeUndefined();
		expect(registry.modes.bean).toBeUndefined();
	});

	it('leaves mode names re-registered by others alone on unload', () => {
		const registry = fakeRegistry();
		host.CodeMirror = registry;

		const plugin = loadPlugin();
		const otherFactory = () => ({});
		registry.modes.bean = otherFactory;
		for (const cleanup of plugin.registrations.cleanups) cleanup();

		expect(registry.modes.bean).toBe(otherFactory);
		expect(registry.modes.beancount).toBeUndefined();
	});

	it('tolerates a registry without a modes map', () => {
		const defined: string[] = [];
		host.CodeMirror = {
			defineMode(name: string) {
				defined.push(name);
			},
		};

		const plugin = loadPlugin();
		expect(defined).toEqual(['beancount', 'bean']);
		expect(() => plugin.registrations.cleanups[0]()).not.toThrow();
	});
});
