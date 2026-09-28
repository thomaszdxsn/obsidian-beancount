import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as obsidian from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';

type PluginConstructor = new (app: App, manifest: PluginManifest) => obsidian.Plugin;

const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('esbuild production bundle', () => {
	it('emits a bundle that evaluates as CommonJS and loads without registering anything', async () => {
		// Build to a temp file so tests never clobber the dev/build main.js artifact.
		const outDir = mkdtempSync(join(tmpdir(), 'esbuild-bundle-'));
		const outFile = join(outDir, 'main.js');
		try {
			execFileSync(process.execPath, ['esbuild.config.mjs', 'production'], {
				cwd: packageDir,
				env: { ...process.env, ESBUILD_OUTFILE: outFile },
				stdio: 'pipe',
			});

			const bundle = readFileSync(outFile, 'utf8');
			const moduleShim = { exports: {} as { default?: unknown } };
			const requireShim = (id: string): unknown => {
				if (id === 'obsidian') {
					return obsidian;
				}
				throw new Error(`bundle must not require external module "${id}"`);
			};

			// Dev-time test only: evaluates the locally built bundle the same way
			// Obsidian does (CommonJS with `require('obsidian')`). Never runs in the
			// shipped plugin — the artifact itself contains no eval/new Function.
			(new Function('require', 'module', 'exports', bundle) as (
				require: typeof requireShim,
				module: typeof moduleShim,
				exports: typeof moduleShim.exports
			) => void)(requireShim, moduleShim, moduleShim.exports);

			const LoadedPlugin = moduleShim.exports.default as unknown as PluginConstructor;
			expect(LoadedPlugin).toBeTypeOf('function');
			expect(LoadedPlugin.prototype).toBeInstanceOf(obsidian.Plugin);

			const instance = new LoadedPlugin({} as App, { id: 'beancount-obsidian' } as PluginManifest);
			await instance.onload();
			const registrations = (instance as unknown as RecordingPlugin).registrations;
			expect(registrations).toEqual({
				commands: [],
				ribbonIcons: [],
				statusBarItems: 0,
				settingTabs: 0,
				domEvents: [],
				intervals: [],
			});
			await instance.onunload();
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});
});
