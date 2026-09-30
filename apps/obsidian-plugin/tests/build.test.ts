import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as obsidian from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import { FakeVault } from './fakes';

type PluginConstructor = new (app: App, manifest: PluginManifest) => obsidian.Plugin;

const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('esbuild production bundle', () => {
	it('emits a bundle that evaluates as CommonJS and loads with only the expected registrations', async () => {
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
			// The shipped artifact must contain no dynamic code: `new Function`
			// below is the test's loader, never the bundle's.
			expect(bundle).not.toMatch(/\beval\s*\(/);
			expect(bundle).not.toMatch(/new\s+Function\s*\(/);
			expect(bundle).not.toMatch(/\bimport\s*\(/);
			const moduleShim = { exports: {} as { default?: unknown } };
			// Modules from the esbuild `external` list are provided by Obsidian
			// at runtime (`obsidian` plus the CodeMirror/Lezer packages it
			// bundles); everything else must be bundled into main.js.
			const nodeRequire = createRequire(import.meta.url);
			const requireShim = (id: string): unknown => {
				if (id === 'obsidian') {
					return obsidian;
				}
				if (
					id === '@codemirror/language' ||
					id === '@codemirror/state' ||
					id === '@codemirror/view' ||
					id === '@lezer/highlight'
				) {
					return nodeRequire(id);
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

			const instance = new LoadedPlugin({ vault: new FakeVault().api } as unknown as App, {
				id: 'beancount-obsidian',
			} as PluginManifest);
			await instance.onload();
			const { events, editorSuggests, editorExtensions, commands, settingTabs, cleanups, ...registrations } = (
				instance as unknown as RecordingPlugin
			).registrations;
			// The plugin's whole surface, in bundle form: one command, one
			// settings tab, the vault events behind completion and on-save
			// alignment, the two editor suggests, the posting-indent Enter
			// binding, and the cleanup for pending on-save work. Nothing else.
			expect(commands.map((command) => command.id)).toEqual(['align-decimal-points']);
			expect(settingTabs).toBe(1);
			expect(editorExtensions).toHaveLength(1);
			expect(registrations).toEqual({
				ribbonIcons: [],
				statusBarItems: 0,
				domEvents: [],
				intervals: [],
			});
			expect(events).toHaveLength(5);
			expect(editorSuggests).toHaveLength(2);
			expect(cleanups).toHaveLength(1);
			await instance.onunload();
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});
});
