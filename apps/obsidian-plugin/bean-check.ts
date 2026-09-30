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
}

/**
 * How the plugin starts bean-check: `command` is the configured path or the
 * bare `bean-check` (the OS then resolves it through PATH), `args` its
 * arguments.
 */
export type BeanCheckRunner = (command: string, args: readonly string[]) => Promise<BeanCheckRun>;

const execFileAsync = promisify(execFile);

export const runBeanCheck: BeanCheckRunner = async (command, args) => {
	try {
		const { stderr } = await execFileAsync(command, [...args], {
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		});
		return { stderr: String(stderr), missing: false };
	} catch (error) {
		// A spawn failure carries a string `code` (ENOENT, EACCES); an exit
		// status carries a number — and that one still has a report.
		const failure = error as NodeJS.ErrnoException & { stderr?: string };
		return { stderr: String(failure.stderr ?? ''), missing: typeof failure.code === 'string' };
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
 * skipped. The file group is greedy: the line number is the *last*
 * `:<digits>:` before the message, so paths holding a colon-digit segment
 * (`/home/2024:3/ledger.bean`) still parse — while a message like
 * `Invalid token: '2026'` never carries one.
 */
const ERROR_LINE_RE = /^(\S.*):(\d+):\s*(.*)$/;

export function parseBeanCheckErrors(stderr: string): BeanCheckError[] {
	const errors: BeanCheckError[] = [];
	for (const line of stderr.split('\n')) {
		const match = ERROR_LINE_RE.exec(line);
		if (!match) continue;
		errors.push({ file: match[1], line: Number(match[2]), message: match[3] });
	}
	return errors;
}

/**
 * Whether a path bean-check reported points at vault file `path`. bean-check
 * prints what its loader resolved — typically a real absolute path — so both
 * sides are compared `/`-separated and the vault-relative path is matched at
 * its end: `/home/u/vault/a.bean` and `a.bean` both name `a.bean`. A shorter
 * path can also match a longer one's suffix (`sub/a.bean` inside
 * `other/sub/a.bean`); the caller keeps the longest match.
 */
export function matchesVaultFile(reported: string, path: string): boolean {
	const normalized = reported.replace(/\\/g, '/');
	return normalized === path || normalized.endsWith('/' + path);
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
		diagnostics.push({ line: line - 1, message: messages.join('\n') });
	}
	return diagnostics.sort((a, b) => a.line - b.line);
}
