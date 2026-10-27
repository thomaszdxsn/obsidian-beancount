/**
 * Vault-relative paths must stay inside the vault; symlink and `..` escapes
 * are rejected before bean-check or an include line can follow them.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveInVault, vaultRoot } from '../vault-path';

describe('vaultRoot', () => {
	it('normalizes slashes and a trailing slash when the base does not exist', () => {
		expect(vaultRoot('/vault')).toBe('/vault/');
		expect(vaultRoot('/vault/')).toBe('/vault/');
	});
});

describe('resolveInVault', () => {
	it('accepts a file inside the vault', () => {
		expect(resolveInVault('/vault/', 'main.bean')).toEqual({
			ok: true,
			absPath: '/vault/main.bean',
		});
	});

	it('rejects absolute paths, parent segments, and empty relative results', () => {
		expect(resolveInVault('/vault/', '/etc/passwd')).toEqual({ ok: false, reason: 'escape' });
		expect(resolveInVault('/vault/', '../escape')).toEqual({ ok: false, reason: 'escape' });
		expect(resolveInVault('/vault/', '.')).toEqual({ ok: false, reason: 'escape' });
	});

	it('does not treat an include-injection string as a path escape', () => {
		const resolved = resolveInVault('/vault/', 'main.bean\nplugin "os"');
		expect(resolved.ok).toBe(true);
		if (resolved.ok) expect(resolved.absPath).toContain('main.bean');
	});
});

describe('resolveInVault symlink escape', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it('rejects a vault-relative name that realpath-resolves outside the vault', () => {
		dir = mkdtempSync(join(tmpdir(), 'obsidian-beancount-vault-path-'));
		const vault = join(dir, 'vault');
		const outside = join(dir, 'outside.bean');
		mkdirSync(vault);
		writeFileSync(outside, '');
		symlinkSync(outside, join(vault, 'escape.bean'));
		const root = vaultRoot(vault);
		expect(resolveInVault(root, 'escape.bean')).toEqual({ ok: false, reason: 'escape' });
		expect(resolveInVault(root, 'missing.bean')).toEqual({
			ok: true,
			absPath: resolve(root, 'missing.bean').replace(/\\/g, '/'),
		});
	});
});
