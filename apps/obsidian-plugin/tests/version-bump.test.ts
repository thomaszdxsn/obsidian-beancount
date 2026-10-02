import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('version-bump.mjs (release flow invoked by `npm version`)', () => {
	it('writes the target version into the root manifest.json and registers minAppVersion in versions.json', () => {
		// Mirror the repo layout: the script runs in the package dir and is
		// pointed at the root that holds manifest.json/versions.json.
		const rootDir = mkdtempSync(join(tmpdir(), 'version-bump-'));
		const pkgDir = join(rootDir, 'apps', 'obsidian-plugin');
		try {
			mkdirSync(pkgDir, { recursive: true });
			copyFileSync(join(packageDir, 'version-bump.mjs'), join(pkgDir, 'version-bump.mjs'));
			copyFileSync(join(repoRoot, 'manifest.json'), join(rootDir, 'manifest.json'));
			copyFileSync(join(repoRoot, 'versions.json'), join(rootDir, 'versions.json'));

			const manifestBefore = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf8'));
			const versionsBefore = JSON.parse(readFileSync(join(rootDir, 'versions.json'), 'utf8')) as Record<string, string>;

			execFileSync(process.execPath, ['version-bump.mjs', '../..'], {
				cwd: pkgDir,
				env: { ...process.env, npm_package_version: '1.2.3' },
				stdio: 'pipe',
			});

			const manifestAfter = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf8'));
			expect(manifestAfter.version).toBe('1.2.3');
			expect(manifestAfter.minAppVersion).toBe(manifestBefore.minAppVersion);
			expect(manifestAfter.id).toBe(manifestBefore.id);

			const versionsAfter = JSON.parse(readFileSync(join(rootDir, 'versions.json'), 'utf8')) as Record<string, string>;
			expect(versionsAfter['1.2.3']).toBe(manifestBefore.minAppVersion);
			// Existing version→minAppVersion history must survive bumps.
			for (const [version, minAppVersion] of Object.entries(versionsBefore)) {
				expect(versionsAfter[version]).toBe(minAppVersion);
			}
		} finally {
			rmSync(rootDir, { recursive: true, force: true });
		}
	});
});
