import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('version-bump.mjs (release flow invoked by `npm version`)', () => {
	it('writes the target version into manifest.json and registers minAppVersion in versions.json', () => {
		const workDir = mkdtempSync(join(tmpdir(), 'version-bump-'));
		copyFileSync(join(packageDir, 'version-bump.mjs'), join(workDir, 'version-bump.mjs'));
		copyFileSync(join(packageDir, 'manifest.json'), join(workDir, 'manifest.json'));
		copyFileSync(join(packageDir, 'versions.json'), join(workDir, 'versions.json'));

		const manifestBefore = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8'));
		const versionsBefore = JSON.parse(readFileSync(join(workDir, 'versions.json'), 'utf8')) as Record<string, string>;

		execFileSync(process.execPath, ['version-bump.mjs'], {
			cwd: workDir,
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
	});
});
