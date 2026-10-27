/**
 * Start/Stop Fava: spawn once, reuse the live child, bind a configurable
 * port, open the UI, and notice a missing binary instead of launching
 * whatever a hostile `favaPath` pointed at.
 */
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { App, PluginManifest } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import { notices } from './mocks/obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import { FakeVault } from './fakes';
import {
	DEFAULT_FAVA_PORT,
	favaExitReason,
	favaUrl,
	firstMeaningfulStderrLine,
	isFavaBinary,
	normalizeFavaPort,
	openFavaUrl,
	runFavaProcess,
	waitForFavaReady,
} from '../fava';
import { mergeSettings } from '../settings';
import BeancountPlugin from '../main';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

const favaRuns: Array<{ command: string; args: readonly string[] }> = [];
const opened: string[] = [];
let favaMissing = false;
let nextChild: ChildProcess | undefined;

afterEach(() => {
	favaRuns.length = 0;
	opened.length = 0;
	favaMissing = false;
	nextChild = undefined;
	notices.length = 0;
});

function liveChild(exitCode: number | null = null, stderrText = ''): ChildProcess {
	const listeners: Array<(code: number | null) => void> = [];
	const stderr = new PassThrough();
	if (stderrText) stderr.write(stderrText);
	const child = {
		exitCode,
		stderr,
		once(event: string, cb: (...args: unknown[]) => void) {
			if (event === 'exit') listeners.push(cb as (code: number | null) => void);
			return child;
		},
		removeListener(event: string, cb: (...args: unknown[]) => void) {
			if (event !== 'exit') return child;
			const index = listeners.indexOf(cb as (code: number | null) => void);
			if (index >= 0) listeners.splice(index, 1);
			return child;
		},
		kill(code = 0) {
			child.exitCode = code;
			for (const cb of [...listeners]) cb(code);
			return true;
		},
	};
	return child as unknown as ChildProcess;
}

async function loadPlugin(
	vault: FakeVault = new FakeVault(),
	loadedData: unknown = null,
	activePath: string | null = null
): Promise<BeancountPlugin & RecordingPlugin> {
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: {
				getLeavesOfType: () => [],
				activeEditor: null,
				onLayoutReady: (cb: () => void) => cb(),
				on: () => ({}),
				getActiveFile: () =>
					activePath ? vault.api.getFiles().find((file) => file.path === activePath) ?? null : null,
			},
		} as unknown as App,
		manifest
	) as BeancountPlugin & RecordingPlugin;
	plugin.beanCheckRunner = async () => ({ stderr: '', missing: false });
	plugin.favaRunner = async (command, args) => {
		favaRuns.push({ command, args: [...args] });
		if (favaMissing) return { missing: true };
		const child = nextChild ?? liveChild();
		nextChild = undefined;
		return { missing: false, child };
	};
	plugin.favaOpener = (url) => {
		opened.push(url);
	};
	plugin.favaReadyProbe = async () => 200;
	plugin.favaReadyDelay = async () => {};
	plugin.loadData = async () => loadedData;
	await plugin.onload();
	return plugin;
}

describe('isFavaBinary', () => {
	it('accepts fava and rejects anything a hostile setting could spawn', () => {
		expect(isFavaBinary('fava')).toBe(true);
		expect(isFavaBinary('/opt/homebrew/bin/fava')).toBe(true);
		expect(isFavaBinary('C:\\Python\\Scripts\\fava.exe')).toBe(true);
		expect(isFavaBinary('/bin/bash')).toBe(false);
		expect(isFavaBinary('/usr/bin/python3')).toBe(false);
		expect(isFavaBinary('/vault/fava.py')).toBe(false);
	});
});

describe('normalizeFavaPort', () => {
	it('keeps integers in 1–65535 and otherwise uses 5000', () => {
		expect(normalizeFavaPort(8080)).toBe(8080);
		expect(normalizeFavaPort('8080')).toBe(8080);
		expect(normalizeFavaPort(1)).toBe(1);
		expect(normalizeFavaPort(65535)).toBe(65535);
		expect(normalizeFavaPort(0)).toBe(DEFAULT_FAVA_PORT);
		expect(normalizeFavaPort(65536)).toBe(DEFAULT_FAVA_PORT);
		expect(normalizeFavaPort(80.5)).toBe(DEFAULT_FAVA_PORT);
		expect(normalizeFavaPort('nope')).toBe(DEFAULT_FAVA_PORT);
		expect(normalizeFavaPort(undefined)).toBe(DEFAULT_FAVA_PORT);
	});
});

describe('favaUrl', () => {
	it('binds 127.0.0.1 to the normalized port', () => {
		expect(favaUrl(5000)).toBe('http://127.0.0.1:5000/');
		expect(favaUrl(8080)).toBe('http://127.0.0.1:8080/');
		expect(favaUrl(0)).toBe('http://127.0.0.1:5000/');
	});
});

describe('openFavaUrl', () => {
	it('opens the URL through window.open when it exists', () => {
		const hits: string[] = [];
		const host = globalThis as { window?: { open: (url: string) => void } };
		const previous = host.window;
		host.window = {
			open: (url) => {
				hits.push(url);
			},
		};
		try {
			openFavaUrl('http://127.0.0.1:8080/');
			expect(hits).toEqual(['http://127.0.0.1:8080/']);
		} finally {
			if (previous === undefined) delete host.window;
			else host.window = previous;
		}
	});
});

describe('runFavaProcess', () => {
	it('reports a spawn failure as missing', async () => {
		const run = await runFavaProcess('fava-not-installed-xyz', ['-H', '127.0.0.1']);
		expect(run.missing).toBe(true);
		expect(run.child).toBeUndefined();
	});

	it('returns the child when spawn succeeds', async () => {
		const run = await runFavaProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)']);
		try {
			expect(run.missing).toBe(false);
			expect(run.child).toBeDefined();
			expect(run.child?.exitCode).toBeNull();
			expect(run.child?.stderr).toBeDefined();
		} finally {
			run.child?.kill();
		}
	});
});

describe('waitForFavaReady', () => {
	it('treats a redirect as ready and ignores AirPlay 403 until a later success', async () => {
		const child = liveChild();
		const hits: number[] = [];
		const first = await waitForFavaReady(child, 'http://127.0.0.1:5000/', async () => 302, {
			delay: async () => {},
			timeoutMs: 0,
		});
		expect(first).toBe('ready');
		const outcome = await waitForFavaReady(
			liveChild(),
			'http://127.0.0.1:5000/',
			async () => {
				hits.push(1);
				return hits.length === 1 ? 403 : 200;
			},
			{ delay: async () => {}, timeoutMs: 30_000, now: () => (hits.length > 1 ? 1 : 0) }
		);
		expect(outcome).toBe('ready');
		expect(hits).toHaveLength(2);
	});

	it('returns exited or timeout without waiting in real time', async () => {
		expect(
			await waitForFavaReady(liveChild(1), 'http://127.0.0.1:5000/', async () => 200, {
				delay: async () => {},
				timeoutMs: 0,
			})
		).toBe('exited');
		expect(
			await waitForFavaReady(liveChild(), 'http://127.0.0.1:5000/', async () => 403, {
				delay: async () => {},
				timeoutMs: 0,
			})
		).toBe('timeout');
	});
});

describe('firstMeaningfulStderrLine', () => {
	it('skips traceback frames and falls back to the exit code', () => {
		expect(
			firstMeaningfulStderrLine(
				'Traceback (most recent call last):\n  File "fava", line 1, in <module>\nModuleNotFoundError: No module named \'pkg_resources\'\n'
			)
		).toBe("ModuleNotFoundError: No module named 'pkg_resources'");
		expect(favaExitReason('', 1)).toBe('1');
	});
});

describe('mergeSettings favaPort', () => {
	it('coerces a stored port and ignores junk', () => {
		expect(mergeSettings({ favaPort: 8080 }).favaPort).toBe(8080);
		expect(mergeSettings({ favaPort: '8080' as unknown as number }).favaPort).toBe(8080);
		expect(mergeSettings({ favaPort: 0 }).favaPort).toBe(5000);
		expect(mergeSettings(null).favaPort).toBe(5000);
	});
});

describe('Start Fava / Stop Fava', () => {
	it('starts Fava, opens the UI, and announces the URL', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', 'option "title" "Main"\n');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const start = plugin.registrations.commands.find((entry) => entry.id === 'start-fava');
		const stop = plugin.registrations.commands.find((entry) => entry.id === 'stop-fava');
		expect(start?.name).toBe('Start Fava');
		expect(stop?.name).toBe('Stop Fava');
		await start?.callback?.();
		expect(favaRuns).toEqual([
			{ command: 'fava', args: ['-H', '127.0.0.1', '-p', '5000', '/vault/main.bean'] },
		]);
		expect(opened).toEqual(['http://127.0.0.1:5000/']);
		expect(notices).toEqual(['Fava is running at http://127.0.0.1:5000/']);
	});

	it('passes a configured path and port', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, {
			entryLedger: 'main.bean',
			favaPath: '/opt/homebrew/bin/fava',
			favaPort: 8080,
		});
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		expect(favaRuns).toEqual([
			{
				command: '/opt/homebrew/bin/fava',
				args: ['-H', '127.0.0.1', '-p', '8080', '/vault/main.bean'],
			},
		]);
		expect(opened).toEqual(['http://127.0.0.1:8080/']);
		expect(notices).toEqual(['Fava is running at http://127.0.0.1:8080/']);
	});

	it('reuses a live process instead of spawning again and still opens the UI', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const start = plugin.registrations.commands.find((entry) => entry.id === 'start-fava');
		await start?.callback?.();
		await start?.callback?.();
		expect(favaRuns).toHaveLength(1);
		expect(opened).toEqual(['http://127.0.0.1:5000/', 'http://127.0.0.1:5000/']);
		expect(notices).toEqual([
			'Fava is running at http://127.0.0.1:5000/',
			'Fava is running at http://127.0.0.1:5000/',
		]);
	});

	it('reopens the bound port after the setting changes', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean', favaPort: 5000 });
		const start = plugin.registrations.commands.find((entry) => entry.id === 'start-fava');
		await start?.callback?.();
		plugin.settings.favaPort = 8080;
		opened.length = 0;
		notices.length = 0;
		await start?.callback?.();
		expect(favaRuns).toHaveLength(1);
		expect(opened).toEqual(['http://127.0.0.1:5000/']);
		expect(notices).toEqual([
			'Fava is already running on port 5000; stop it and start again to use port 8080.',
		]);
	});

	it('does not spawn twice when two starts overlap', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const start = plugin.registrations.commands.find((entry) => entry.id === 'start-fava');
		await Promise.all([start?.callback?.(), start?.callback?.()]);
		expect(favaRuns).toHaveLength(1);
		expect(opened).toEqual(['http://127.0.0.1:5000/', 'http://127.0.0.1:5000/']);
	});

	it('stops the live process and lets a later start spawn again', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const start = plugin.registrations.commands.find((entry) => entry.id === 'start-fava');
		await start?.callback?.();
		notices.length = 0;
		opened.length = 0;
		plugin.registrations.commands.find((entry) => entry.id === 'stop-fava')?.callback?.();
		expect(notices).toEqual(['Fava stopped.']);
		await start?.callback?.();
		expect(favaRuns).toHaveLength(2);
		expect(opened).toEqual(['http://127.0.0.1:5000/']);
	});

	it('notices when Stop Fava runs with no process', async () => {
		const plugin = await loadPlugin();
		plugin.registrations.commands.find((entry) => entry.id === 'stop-fava')?.callback?.();
		expect(notices).toEqual(['Fava is not running.']);
	});

	it('spawns again after the child exits on its own', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const child = liveChild();
		nextChild = child;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const start = plugin.registrations.commands.find((entry) => entry.id === 'start-fava');
		await start?.callback?.();
		child.kill();
		await start?.callback?.();
		expect(favaRuns).toHaveLength(2);
	});

	it('notices a missing binary and does not open the UI', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		favaMissing = true;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		expect(opened).toEqual([]);
		expect(notices[0]).toMatch(/fava not found/);
		expect(notices[0]).toMatch(/pip install fava/);
	});

	it('does not open the UI when Fava starts silently on activate', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-10-01 * "A"\n');
		await loadPlugin(vault, { runFavaOnActivate: true }, 'ledger.bean');
		expect(favaRuns).toHaveLength(1);
		expect(opened).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('kills the child when the plugin unloads', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const child = liveChild();
		nextChild = child;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		notices.length = 0;
		for (const cleanup of plugin.registrations.cleanups) cleanup();
		expect(child.exitCode).toBe(0);
		expect(notices).toEqual([]);
	});

	it('notices an early exit from stderr and opens nothing', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		nextChild = liveChild(
			1,
			"Traceback (most recent call last):\nModuleNotFoundError: No module named 'pkg_resources'\n"
		);
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		plugin.favaReadyProbe = async () => 403;
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		expect(opened).toEqual([]);
		expect(notices).toEqual(["Fava exited: ModuleNotFoundError: No module named 'pkg_resources'"]);
	});

	it('opens the UI only after the probe succeeds', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		let release: ((status: number) => void) | undefined;
		const first = new Promise<number>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		plugin.favaReadyProbe = async () => {
			calls += 1;
			if (calls === 1) return first;
			return 200;
		};
		const started = plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		await Promise.resolve();
		expect(opened).toEqual([]);
		expect(notices).toEqual([]);
		release?.(302);
		await started;
		expect(opened).toEqual(['http://127.0.0.1:5000/']);
		expect(notices).toEqual(['Fava is running at http://127.0.0.1:5000/']);
	});

	it('notices a timeout, leaves the process running, and does not open the UI', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const child = liveChild();
		nextChild = child;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		plugin.favaReadyProbe = async () => 403;
		plugin.favaReadyTimeoutMs = 0;
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		expect(opened).toEqual([]);
		expect(notices).toEqual(['Fava did not answer at http://127.0.0.1:5000/']);
		notices.length = 0;
		plugin.registrations.commands.find((entry) => entry.id === 'stop-fava')?.callback?.();
		expect(child.exitCode).toBe(0);
		expect(notices).toEqual(['Fava stopped.']);
	});

	it('notices an unexpected exit after a successful start', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const child = liveChild();
		nextChild = child;
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		notices.length = 0;
		opened.length = 0;
		child.kill(1);
		expect(notices).toEqual(['Fava exited: 1']);
		expect(opened).toEqual([]);
	});

	it('does not notice when Stop Fava kills the process', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		const plugin = await loadPlugin(vault, { entryLedger: 'main.bean' });
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		notices.length = 0;
		plugin.registrations.commands.find((entry) => entry.id === 'stop-fava')?.callback?.();
		expect(notices).toEqual(['Fava stopped.']);
	});

	it('reports a failed silent start on activate without opening the UI', async () => {
		const vault = new FakeVault();
		vault.write('ledger.bean', '2026-10-01 * "A"\n');
		nextChild = liveChild(1, 'Address already in use\n');
		await loadPlugin(vault, { runFavaOnActivate: true }, 'ledger.bean');
		expect(opened).toEqual([]);
		expect(notices).toEqual(['Fava exited: Address already in use']);
	});

	it('tells the user to set an entry ledger or open a bean file', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', '');
		vault.write('note.md', '```beancount\n2026-01-01 open Assets:Cash\n```\n');
		const plugin = await loadPlugin(vault, {}, 'note.md');
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		expect(favaRuns).toEqual([]);
		expect(opened).toEqual([]);
		expect(notices).toEqual([
			'Set Entry ledger in the Beancount settings or open a .bean / .beancount file.',
		]);
	});

	it('refuses an entry ledger outside the vault with the bean-check wording', async () => {
		const plugin = await loadPlugin(new FakeVault(), { entryLedger: '../outside.bean' });
		await plugin.registrations.commands.find((entry) => entry.id === 'start-fava')?.callback?.();
		expect(favaRuns).toEqual([]);
		expect(notices).toEqual(['Fava: entry ledger must be a vault file, not "../outside.bean"']);
	});
});
