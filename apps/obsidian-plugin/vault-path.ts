/**
 * Confine a vault-relative path to the vault root. Symlink realpath that
 * leaves the vault is an escape; include-injection characters are not
 * this module's job (`isSafeIncludePath`).
 */
import { realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * The vault base as bean-check reports files under it: the real path (its
 * loader resolves symlinks), `/`-separated, with a trailing slash.
 */
export function vaultRoot(basePath: string): string {
	try {
		return realpathSync(basePath).replace(/\\/g, '/') + '/';
	} catch {
		// A base path that does not exist has no real path to resolve.
		return basePath.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
	}
}

function escapesRoot(root: string, absPath: string): boolean {
	const rel = relative(root, absPath);
	return rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

/**
 * Resolve `vaultRel` under `root`. `root` is `/`-separated with a trailing
 * slash, as `vaultRoot` returns it.
 */
export function resolveInVault(
	root: string,
	vaultRel: string,
): { ok: true; absPath: string } | { ok: false; reason: 'escape' } {
	const confined = resolve(root, vaultRel);
	if (escapesRoot(root, confined)) return { ok: false, reason: 'escape' };
	try {
		const real = realpathSync(confined).replace(/\\/g, '/');
		if (escapesRoot(root, real)) return { ok: false, reason: 'escape' };
		return { ok: true, absPath: real };
	} catch {
		return { ok: true, absPath: confined.replace(/\\/g, '/') };
	}
}
