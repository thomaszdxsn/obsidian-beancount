import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The community plugin list reads these from the repository root.
const manifest = JSON.parse(
	readFileSync(new URL('../../../manifest.json', import.meta.url), 'utf8')
) as Record<string, unknown>;
const versions = JSON.parse(
	readFileSync(new URL('../../../versions.json', import.meta.url), 'utf8')
) as Record<string, string>;
const packageJson = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

describe('manifest.json', () => {
	it('keeps an installable id (lowercase, folder-name safe — Obsidian requires the plugin folder to equal the id)', () => {
		expect(manifest.id).toMatch(/^[a-z][a-z0-9-]*$/);
		// The community plugin list rejects ids containing "obsidian".
		expect(manifest.id).not.toMatch(/obsidian/);
	});

	it('carries a plain x.y.z version in sync with package.json and versions.json', () => {
		// Obsidian compares release tags as x.y.z; prerelease suffixes are rejected.
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(manifest.version).toBe(packageJson.version);
		expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
	});

	it('declares the required publishing fields', () => {
		expect(manifest.name).toBe('Beancount');
		expect(manifest.description).toBeTruthy();
		expect(manifest.author).toBe('thomaszdxsn');
		expect(manifest.minAppVersion).toMatch(/^\d+\.\d+(\.\d+)?$/);
	});

	it('stays desktop-only (Phase 3 validation shells out to bean-check)', () => {
		expect(manifest.isDesktopOnly).toBe(true);
	});
});
