import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as obsidian from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';

type PluginConstructor = new (app: App, manifest: PluginManifest) => obsidian.Plugin;

const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('esbuild production bundle', () => {
	it('emits main.js that evaluates as CommonJS and loads without registering anything', () => {
		execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], {
			cwd: packageDir,
			stdio: 'pipe',
		});

		const bundle = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
		const moduleShim = { exports: {} as { default?: unknown } };
		const requireShim = (id: string): unknown => {
			if (id === 'obsidian') {
				return obsidian;
			}
			throw new Error(`bundle must not require external module "${id}"`);
		};

		// Obsidian evaluates main.js in a CommonJS-like context with `require('obsidian')`.
		(new Function('require', 'module', 'exports', bundle) as (
			require: typeof requireShim,
			module: typeof moduleShim,
			exports: typeof moduleShim.exports
		) => void)(requireShim, moduleShim, moduleShim.exports);

		const LoadedPlugin = moduleShim.exports.default as unknown as PluginConstructor;
		expect(LoadedPlugin).toBeTypeOf('function');
		expect(LoadedPlugin.prototype).toBeInstanceOf(obsidian.Plugin);

		const instance = new LoadedPlugin({} as App, { id: 'beancount-obsidian' } as PluginManifest);
		const registrations = (instance as unknown as RecordingPlugin).registrations;
		expect(registrations).toEqual({
			commands: [],
			ribbonIcons: [],
			statusBarItems: 0,
			settingTabs: 0,
			domEvents: [],
			intervals: [],
		});
	});
});
