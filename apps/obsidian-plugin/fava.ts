/**
 * Launching Fava against the entry ledger. The setting may point at any
 * location holding `fava` — and nothing else: a hostile synced `data.json`
 * must not turn the spawn into "run this program on the ledger".
 */
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

/** Failures that mean "no such program" — everything else is a tool problem. */
const SPAWN_FAILURES = new Set(['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM']);

/** Whether `command` names Fava itself. */
export function isFavaBinary(command: string): boolean {
	const base = command.replace(/\\/g, '/').split('/').pop() ?? '';
	return base === 'fava' || base === 'fava.exe';
}

/**
 * How the plugin starts Fava: `command` is the configured path or the bare
 * `fava` (the OS then resolves it through PATH), `args` its arguments.
 * `child` is the live process when spawn succeeded, so the plugin can kill it.
 */
export type FavaRunner = (
	command: string,
	args: readonly string[]
) => Promise<{ missing: boolean; child?: ChildProcess }>;

export const runFavaProcess: FavaRunner = (command, args) =>
	new Promise((resolve) => {
		try {
			const child = spawn(command, [...args], { stdio: 'ignore' });
			child.once('error', (err) => {
				const code = (err as NodeJS.ErrnoException).code;
				resolve({ missing: SPAWN_FAILURES.has(code ?? '') });
			});
			child.once('spawn', () => {
				resolve({ missing: false, child });
			});
		} catch {
			resolve({ missing: true });
		}
	});

/** Default Fava bind, matching vscode-beancount. */
export const FAVA_HOST = '127.0.0.1';
export const FAVA_URL = `http://${FAVA_HOST}:5000/`;
