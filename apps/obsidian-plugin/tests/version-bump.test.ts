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
		const workDir = mkdtempSync(join(tmpdir(), 'version-bump-'));
		try {
			// Same layout as the repo: the script lives two levels below the
			// root that holds manifest.json / versions.json.
			const scriptDir = join(workDir, 'apps', 'obsidian-plugin');
			mkdirSync(scriptDir, { recursive: true });
			copyFileSync(join(packageDir, 'version-bump.mjs'), join(scriptDir, 'version-bump.mjs'));
			copyFileSync(join(repoRoot, 'manifest.json'), join(workDir, 'manifest.json'));
			copyFileSync(join(repoRoot, 'versions.json'), join(workDir, 'versions.json'));

			const manifestBefore = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8'));
			const versionsBefore = JSON.parse(readFileSync(join(workDir, 'versions.json'), 'utf8')) as Record<string, string>;

			execFileSync(process.execPath, ['version-bump.mjs'], {
				cwd: scriptDir,
				env: { ...process.env, npm_package_version: '1.2.3' },
				stdio: 'pipe',
			});

			const manifestAfter = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8'));
			expect(manifestAfter.version).toBe('1.2.3');
			expect(manifestAfter.minAppVersion).toBe(manifestBefore.minAppVersion);
			expect(manifestAfter.id).toBe(manifestBefore.id);

			const versionsAfter = JSON.parse(readFileSync(join(workDir, 'versions.json'), 'utf8')) as Record<string, string>;
			expect(versionsAfter['1.2.3']).toBe(manifestBefore.minAppVersion);
			// Existing version→minAppVersion history must survive bumps.
			for (const [version, minAppVersion] of Object.entries(versionsBefore)) {
				expect(versionsAfter[version]).toBe(minAppVersion);
			}
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});
});
