/**
 * Launching Fava against the entry ledger. The setting may point at any
 * location holding `fava` — and nothing else: a hostile synced `data.json`
 * must not turn the spawn into "run this program on the ledger".
 */
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { get as httpGet } from 'http';
import { clipText } from './bean-check';
import { resolveInVault } from './vault-path';

/** Failures that mean "no such program" — everything else is a tool problem. */
const SPAWN_FAILURES = new Set(['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM']);

/** How long Start Fava waits for the HTTP UI before giving up. */
export const FAVA_READY_TIMEOUT_MS = 30_000;
/** Pause between readiness probes. */
export const FAVA_PROBE_INTERVAL_MS = 100;
/** Per-request hang bound so a silent port cannot stall the whole wait. */
export const FAVA_PROBE_REQUEST_TIMEOUT_MS = 400;
/** Bound on waiting for stdio 'close' after 'exit' so the last stderr line is not lost. */
export const FAVA_CLOSE_TIMEOUT_MS = 1_000;
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

const defaultDelay = (ms: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

/** Node may emit 'exit' before stderr finishes; wait for 'close' (or `timeoutMs`) so the tail is complete. */
export async function waitForChildClose(
	child: ChildProcess,
	options: {
		alreadyClosed?: boolean;
		timeoutMs?: number;
		delay?: (ms: number) => Promise<void>;
	} = {}
): Promise<void> {
	if (options.alreadyClosed) return;
	const timeoutMs = options.timeoutMs ?? FAVA_CLOSE_TIMEOUT_MS;
	const delay = options.delay ?? defaultDelay;
	await new Promise<void>((resolve) => {
		let settled = false;
		const done = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		child.once('close', done);
		void delay(timeoutMs).then(done);
	});
}

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
		closeTimeoutMs?: number;
	} = {}
): Promise<FavaReadyOutcome> {
	const timeoutMs = options.timeoutMs ?? FAVA_READY_TIMEOUT_MS;
	const intervalMs = options.intervalMs ?? FAVA_PROBE_INTERVAL_MS;
	const delay = options.delay ?? defaultDelay;
	const now = options.now ?? Date.now;
	const started = now();
	let exited = child.exitCode !== null;
	let closed = false;
	const onExit = () => {
		exited = true;
	};
	const onClose = () => {
		closed = true;
	};
	child.once('exit', onExit);
	child.once('close', onClose);
	const finishExit = async (): Promise<'exited'> => {
		await waitForChildClose(child, {
			alreadyClosed: closed,
			timeoutMs: options.closeTimeoutMs ?? FAVA_CLOSE_TIMEOUT_MS,
			delay,
		});
		return 'exited';
	};
	try {
		while (true) {
			if (exited || child.exitCode !== null) return await finishExit();
			const status = await probe(url);
			if (exited || child.exitCode !== null) return await finishExit();
			if (status != null && status < 400) return 'ready';
			if (now() - started >= timeoutMs) return 'timeout';
			await delay(intervalMs);
		}
	} finally {
		if (typeof child.removeListener === 'function') {
			child.removeListener('exit', onExit);
			child.removeListener('close', onClose);
		}
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


export const MISSING_FAVA_NOTICE =
	'fava not found — install fava (pip install fava) or set the Fava path in the plugin settings.';
export const NO_LEDGER_FAVA_NOTICE =
	'Set Entry ledger in the Beancount settings or open a .bean / .beancount file.';

export type FavaLedgerResult =
	| { ok: true; absPath: string }
	| { ok: false; reason: 'no-ledger' | 'escape'; requested: string };

export function resolveFavaLedger(
	root: string,
	entryLedger: string,
	activePath: string | null,
): FavaLedgerResult {
	const requested = entryLedger.trim() || activePath || '';
	if (!requested.endsWith('.bean') && !requested.endsWith('.beancount')) {
		return { ok: false, reason: 'no-ledger', requested };
	}
	const resolved = resolveInVault(root, requested);
	if (!resolved.ok) return { ok: false, reason: 'escape', requested };
	return { ok: true, absPath: resolved.absPath };
}

export interface FavaPorts {
	runner: FavaRunner;
	opener: FavaOpener;
	probe: FavaReadyProbe;
	delay: (ms: number) => Promise<void>;
	notify: (text: string) => void;
	resolveLedger: (entryLedger: string, activePath: string | null) => FavaLedgerResult;
}

export type FavaStartRequest = {
	announce: boolean;
	command: string;
	port: number;
	entryLedger: string;
	activePath: string | null;
};

export class FavaProcess {
	private child: ChildProcess | null = null;
	private boundPort: number | null = null;
	private serving = false;
	private expectExit = false;
	private disposed = false;
	private launching = false;
	private generation = 0;
	private inFlight: { gen: number; promise: Promise<boolean> } | null = null;
	private stderr: () => string = () => '';
	private readonly readyMs: number;
	private readonly closeMs: number;

	constructor(
		private readonly ports: FavaPorts,
		timeouts?: { readyMs: number; closeMs: number },
	) {
		this.readyMs = timeouts?.readyMs ?? FAVA_READY_TIMEOUT_MS;
		this.closeMs = timeouts?.closeMs ?? FAVA_CLOSE_TIMEOUT_MS;
	}

	async start(req: FavaStartRequest): Promise<void> {
		if (this.disposed) return;
		while (this.inFlight) {
			if (this.inFlight.gen === this.generation) {
				const started = await this.inFlight.promise;
				if (this.disposed) return;
				if (started && this.isRunning()) this.reveal(req);
				return;
			}
			await this.inFlight.promise.catch(() => {});
			if (this.disposed) return;
		}
		if (this.isRunning() && this.serving) {
			this.reveal(req);
			return;
		}
		const promise =
			this.isRunning() && this.child ? this.waitUntilServes(this.child) : this.spawn(req);
		const flight = { gen: this.generation, promise };
		this.inFlight = flight;
		try {
			const started = await promise;
			if (this.disposed) return;
			if (started && this.isRunning()) this.reveal(req);
		} finally {
			if (this.inFlight === flight) this.inFlight = null;
		}
	}

	stop(): void {
		if (this.disposed) return;
		this.generation += 1;
		this.expectExit = true;
		if (this.isRunning() || this.launching) {
			this.child?.kill();
			this.clear();
			this.launching = false;
			this.ports.notify('Fava stopped.');
			return;
		}
		this.clear();
		this.ports.notify('Fava is not running.');
	}

	dispose(): void {
		this.disposed = true;
		this.generation += 1;
		this.expectExit = true;
		this.launching = false;
		this.child?.kill();
		this.clear();
	}

	private isRunning(): boolean {
		return this.child != null && this.child.exitCode === null;
	}

	private clear(): void {
		this.child = null;
		this.boundPort = null;
		this.serving = false;
		this.stderr = () => '';
	}

	private reveal(req: FavaStartRequest): void {
		if (!req.announce) return;
		const bound = this.boundPort ?? normalizeFavaPort(req.port);
		const wanted = normalizeFavaPort(req.port);
		const url = favaUrl(bound);
		this.ports.opener(url);
		if (bound !== wanted) {
			this.ports.notify(
				`Fava is already running on port ${bound}; stop it and start again to use port ${wanted}.`,
			);
			return;
		}
		this.ports.notify(`Fava is running at ${url}`);
	}

	private async waitUntilServes(child: ChildProcess): Promise<boolean> {
		const url = favaUrl(this.boundPort ?? DEFAULT_FAVA_PORT);
		const getStderr = this.stderr;
		const outcome = await waitForFavaReady(child, url, this.ports.probe, {
			timeoutMs: this.readyMs,
			delay: this.ports.delay,
			closeTimeoutMs: this.closeMs,
		});
		if (outcome === 'ready') {
			this.serving = true;
			return true;
		}
		if (outcome === 'timeout') {
			if (!this.expectExit) this.ports.notify(`Fava did not answer at ${url}`);
			return false;
		}
		if (!this.expectExit) {
			this.ports.notify(`Fava exited: ${favaExitReason(getStderr(), child.exitCode)}`);
		}
		if (this.child === child) this.clear();
		return false;
	}

	private async spawn(req: FavaStartRequest): Promise<boolean> {
		if (this.disposed) return false;
		this.expectExit = false;
		if (!isFavaBinary(req.command)) {
			this.ports.notify(MISSING_FAVA_NOTICE);
			return false;
		}
		const ledger = this.ports.resolveLedger(req.entryLedger, req.activePath);
		if (!ledger.ok) {
			if (ledger.reason === 'no-ledger') this.ports.notify(NO_LEDGER_FAVA_NOTICE);
			else this.ports.notify(`Fava: entry ledger must be a vault file, not "${clipText(ledger.requested)}"`);
			return false;
		}
		const port = normalizeFavaPort(req.port);
		this.launching = true;
		try {
			const result = await this.ports.runner(req.command, [
				'-H',
				FAVA_HOST,
				'-p',
				String(port),
				ledger.absPath,
			]);
			if (this.disposed) {
				result.child?.kill();
				return false;
			}
			if (result.missing) {
				if (!this.expectExit) this.ports.notify(MISSING_FAVA_NOTICE);
				return false;
			}
			const child = result.child ?? null;
			if (!child) return false;
			if (this.expectExit) {
				child.kill();
				return false;
			}
			const getStderr = captureFavaStderr(child);
			this.stderr = getStderr;
			this.serving = false;
			this.child = child;
			this.boundPort = port;
			let closed = false;
			child.once('close', () => {
				closed = true;
			});
			child.once('exit', (code) => {
				const unexpected = !this.expectExit && this.serving && this.child === child;
				void (async () => {
					await waitForChildClose(child, {
						alreadyClosed: closed,
						timeoutMs: this.closeMs,
						delay: this.ports.delay,
					});
					const stderr = getStderr();
					if (this.child === child) this.clear();
					if (unexpected && !this.expectExit) {
						this.ports.notify(`Fava exited: ${favaExitReason(stderr, code)}`);
					}
				})();
			});
			return this.waitUntilServes(child);
		} finally {
			this.launching = false;
		}
	}
}
