import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
	readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
) as Record<string, unknown>;
const packageJson = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

describe('manifest.json', () => {
	it('keeps an installable id (lowercase, folder-name safe — Obsidian requires the plugin folder to equal the id)', () => {
		expect(manifest.id).toMatch(/^[a-z][a-z0-9-]*$/);
	});

	it('carries a semver version in sync with package.json', () => {
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
		expect(manifest.version).toBe(packageJson.version);
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
