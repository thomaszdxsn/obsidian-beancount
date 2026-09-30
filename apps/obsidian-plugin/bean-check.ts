/**
 * Running `bean-check` and turning its stderr into per-line complaints.
 *
 * `bean-check` is the validator shipped with beancount (`pip install
 * beancount`). It parses a ledger — entry file plus its `include` chain — and
 * prints one error per line on stderr as `<file>:<line>:       <message>`,
 * followed by an indented echo of the offending source. A non-zero exit just
 * means "errors found": the report is the stderr text, and the exit code adds
 * nothing to it. Errors about files it could not load keep the same shape
 * under a `<load>` pseudo-file, which matches no vault file and is dropped.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

/** What one `bean-check` invocation produced. */
export interface BeanCheckRun {
	/** Everything the tool wrote on stderr — where the report lives. */
	stderr: string;
	/** Whether the executable could not be started at all (not found, not runnable). */
	missing: boolean;
	/** Why the run was cut short (timeout, oversized output), when it was. */
	failure?: string;
}

/**
 * How the plugin starts bean-check: `command` is the configured path or the
 * bare `bean-check` (the OS then resolves it through PATH), `args` its
 * arguments. `timeoutMs` bounds the run — a ledger can make bean-check hang.
 */
export type BeanCheckRunner = (
	command: string,
	args: readonly string[],
	timeoutMs?: number
) => Promise<BeanCheckRun>;

/**
 * Whether `command` names the validator itself. The setting may point at any
 * location holding bean-check — and nothing else: a hostile synced `data.json`
 * must not turn the spawn into "run this program on the ledger".
 */
export function isBeanCheckBinary(command: string): boolean {
	const base = command.replace(/\\/g, '/').split('/').pop() ?? '';
	return base === 'bean-check' || base === 'bean-check.exe';
}

/** Notices and tooltips copy bean-check text; a pathological line stays small. */
const MAX_TEXT = 400;

export function clipText(text: string): string {
	return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

/** Failures that mean "no such program" — everything else is a tool problem. */
const SPAWN_FAILURES = new Set(['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM']);

const execFileAsync = promisify(execFile);

export const runBeanCheck: BeanCheckRunner = async (command, args, timeoutMs = 30_000) => {
	try {
		const { stderr } = await execFileAsync(command, [...args], {
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
			timeout: timeoutMs,
			killSignal: 'SIGKILL',
		});
		return { stderr: String(stderr), missing: false };
	} catch (error) {
		// A spawn failure carries a string `code` (ENOENT, EACCES); an exit
		// status carries a number and still has a report. Node's own kills
		// (timeout, output over `maxBuffer`) are neither: the tool ran, and
		// what it printed before the cut is all there is.
		const failure = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
		const spawnFailed = typeof failure.code === 'string' && SPAWN_FAILURES.has(failure.code);
		return {
			stderr: String(failure.stderr ?? ''),
			missing: spawnFailed,
			failure: spawnFailed
				? undefined
				: failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
					? 'produced too much output'
					: failure.killed
						? 'timed out'
						: undefined,
		};
	}
};

/** One error as bean-check prints it. */
export interface BeanCheckError {
	/** The file exactly as bean-check reported it — usually an absolute path. */
	file: string;
	/** The 1-based line, as printed. */
	line: number;
	message: string;
}

/**
 * An error line, at column 0: `<file>:<line>:<message>`. The indented source
 * bean-check echoes under every error never starts at column 0, so it is
 * skipped. The file group is greedy — the separator is the *last* `:<digits>:`
 * the report follows with whitespace — so paths holding a colon-digit segment
 * still parse, while account names inside the message (`Assets:2024:Cash`,
 * digits are legal in a sub-account) cannot: their colons are never followed
 * by a space, and bean-check always pads the separator (`:12:       Invalid …`).
 */
const ERROR_LINE_RE = /^(\S.*):(\d+):\s+(.*)$/;

export function parseBeanCheckErrors(stderr: string): BeanCheckError[] {
	const errors: BeanCheckError[] = [];
	// Windows bean-check writes CRLF text mode; `\r` would otherwise stick to
	// the message (or, failing the regex, hide the whole line).
	for (const line of stderr.split(/\r?\n/)) {
		const match = ERROR_LINE_RE.exec(line);
		if (!match) continue;
		errors.push({ file: match[1], line: Number(match[2]), message: match[3] });
	}
	return errors;
}

/**
 * Whether a path bean-check reported points at vault file `path` under
 * `vaultRoot` (the vault base, `/`-separated, trailing slash). bean-check
 * prints what its loader resolved — a real absolute path — so the reported
 * path must be exactly the vault file's location, or a bare relative report;
 * a path that merely *ends with* the vault path (a same-named ledger outside
 * the vault, or another folder's `sub/a.bean`) does not match.
 */
export function matchesVaultFile(reported: string, path: string, vaultRoot: string): boolean {
	const normalized = reported.replace(/\\/g, '/');
	return normalized === vaultRoot + path || normalized === path;
}

/** A complaint about one line of one file, ready for the editor's markers. */
export interface LineDiagnostic {
	/** The 0-based line, as CodeMirror numbers it. */
	line: number;
	/** Every message bean-check printed for the line, print order, newline-joined. */
	message: string;
}

/**
 * Fold one file's `errors` into per-line diagnostics: one entry per line in
 * ascending order, the 1-based line bean-check prints becoming the 0-based
 * line CodeMirror marks.
 */
export function toLineDiagnostics(errors: readonly BeanCheckError[]): LineDiagnostic[] {
	const messagesByLine = new Map<number, string[]>();
	for (const error of errors) {
		const messages = messagesByLine.get(error.line) ?? [];
		messages.push(error.message);
		messagesByLine.set(error.line, messages);
	}
	const diagnostics: LineDiagnostic[] = [];
	for (const [line, messages] of messagesByLine) {
		diagnostics.push({ line: line - 1, message: clipText(messages.join('\n')) });
	}
	return diagnostics.sort((a, b) => a.line - b.line);
}
