import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Obsidian and the community directory read manifest.json/versions.json from
// the repository root's default branch, so the root copies are the only ones.
const readJson = <T>(relative: string): T =>
	JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as T;

const manifest = readJson<Record<string, unknown>>('../../../manifest.json');
const versions = readJson<Record<string, string>>('../../../versions.json');
const packageJson = readJson<{ version: string }>('../package.json');

describe('manifest.json', () => {
	it('keeps an id the community directory accepts (lowercase + hyphens, no "obsidian", no trailing "plugin")', () => {
		expect(manifest.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
		expect(manifest.id).not.toMatch(/obsidian/);
		expect(manifest.id).not.toMatch(/plugin$/);
	});

	it('carries an x.y.z version in sync with package.json (release tags must match it exactly)', () => {
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(manifest.version).toBe(packageJson.version);
	});

	it('declares the required publishing fields', () => {
		expect(manifest.name).toBe('Beancount');
		expect(manifest.author).toBe('thomaszdxsn');
		expect(manifest.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('keeps a description the directory accepts (≤250 chars, ends with a period, no "Obsidian")', () => {
		const description = manifest.description as string;
		expect(description.length).toBeGreaterThan(0);
		expect(description.length).toBeLessThanOrEqual(250);
		expect(description).toMatch(/\.$/);
		expect(description).not.toMatch(/obsidian/i);
	});

	it('stays desktop-only (Phase 3 validation shells out to bean-check)', () => {
		expect(manifest.isDesktopOnly).toBe(true);
	});
});

describe('versions.json', () => {
	it('maps the current version to its minAppVersion, so older apps fall back correctly', () => {
		expect(versions[manifest.version as string]).toBe(manifest.minAppVersion);
	});
});
