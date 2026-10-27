/**
 * Launching Fava against the entry ledger. The setting may point at any
 * location holding `fava` — and nothing else: a hostile synced `data.json`
 * must not turn the spawn into "run this program on the ledger".
 */
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { get as httpGet } from 'http';

/** Failures that mean "no such program" — everything else is a tool problem. */
const SPAWN_FAILURES = new Set(['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM']);

/** How long Start Fava waits for the HTTP UI before giving up. */
export const FAVA_READY_TIMEOUT_MS = 30_000;
/** Pause between readiness probes. */
export const FAVA_PROBE_INTERVAL_MS = 100;
/** Per-request hang bound so a silent port cannot stall the whole wait. */
export const FAVA_PROBE_REQUEST_TIMEOUT_MS = 400;
/** Bytes of Fava stderr kept for the exit notice. */
const STDERR_TAIL = 4_096;

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

/** Opens the Fava UI; tests swap this so Node never needs `window`. */
export type FavaOpener = (url: string) => void;

/**
 * One HTTP GET of Fava's root. Status code when a response arrives (Fava
 * redirects with < 400; AirPlay's 403 does not count as ready); `null` on
 * timeout or connection error. Tests swap this so they never open sockets.
 */
export type FavaReadyProbe = (url: string) => Promise<number | null>;

export const openFavaUrl: FavaOpener = (url) => {
	if (typeof window !== 'undefined' && typeof window.open === 'function') {
		window.open(url);
	}
};

export const runFavaProcess: FavaRunner = (command, args) =>
	new Promise((resolve) => {
		try {
			// stderr is piped so a crash can be quoted in the notice; it must
			// stay drained for the child's lifetime or a noisy Fava can block.
			const child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
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

/** GET `url` with a short timeout; used only against the Fava we started. */
export const probeFavaUrl: FavaReadyProbe = (url) =>
	new Promise((resolve) => {
		const req = httpGet(url, { timeout: FAVA_PROBE_REQUEST_TIMEOUT_MS }, (res) => {
			res.resume();
			resolve(res.statusCode ?? null);
		});
		req.on('timeout', () => {
			req.destroy();
			resolve(null);
		});
		req.on('error', () => resolve(null));
	});

/**
 * Drain `child.stderr` for as long as the process lives and keep a small
 * tail. Call this as soon as spawn returns so an immediate crash is not lost.
 * A `data` listener puts the stream in flowing mode, which is the drain.
 */
export function captureFavaStderr(child: ChildProcess): () => string {
	let tail = '';
	const stream = child.stderr;
	if (stream) {
		stream.setEncoding('utf8');
		stream.on('data', (chunk: string) => {
			tail = (tail + chunk).slice(-STDERR_TAIL);
		});
	}
	return () => tail;
}

/** Last non-blank stderr line, skipping caret markers (`^^^^`). Python puts the exception last. */
export function lastMeaningfulStderrLine(stderr: string): string | null {
	let last: string | null = null;
	for (const raw of stderr.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || /^\^+$/.test(line)) continue;
		last = line;
	}
	return last;
}

export function favaExitReason(stderr: string, code: number | null | undefined): string {
	return lastMeaningfulStderrLine(stderr) ?? String(code ?? 'unknown');
}

export type FavaReadyOutcome = 'ready' | 'exited' | 'timeout';

/** Poll until Fava answers with status < 400, the child exits, or time is up. */
export async function waitForFavaReady(
	child: ChildProcess,
	url: string,
	probe: FavaReadyProbe,
	options: {
		timeoutMs?: number;
		intervalMs?: number;
		delay?: (ms: number) => Promise<void>;
		now?: () => number;
	} = {}
): Promise<FavaReadyOutcome> {
	const timeoutMs = options.timeoutMs ?? FAVA_READY_TIMEOUT_MS;
	const intervalMs = options.intervalMs ?? FAVA_PROBE_INTERVAL_MS;
	const delay =
		options.delay ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
	const now = options.now ?? Date.now;
	const started = now();
	let exited = child.exitCode !== null;
	const onExit = () => {
		exited = true;
	};
	child.once('exit', onExit);
	try {
		while (true) {
			if (exited || child.exitCode !== null) return 'exited';
			const status = await probe(url);
			if (exited || child.exitCode !== null) return 'exited';
			if (status != null && status < 400) return 'ready';
			if (now() - started >= timeoutMs) return 'timeout';
			await delay(intervalMs);
		}
	} finally {
		if (typeof child.removeListener === 'function') child.removeListener('exit', onExit);
	}
}

/** Default Fava bind, matching vscode-beancount. */
export const FAVA_HOST = '127.0.0.1';
export const DEFAULT_FAVA_PORT = 5000;

/** Bind port Fava `-p` accepts: integer 1–65535, else the default. */
export function normalizeFavaPort(value: unknown): number {
	const n =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number.parseInt(value, 10)
				: NaN;
	if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_FAVA_PORT;
	return n;
}

export function favaUrl(port: number): string {
	return `http://${FAVA_HOST}:${normalizeFavaPort(port)}/`;
}
