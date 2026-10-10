/**
 * bean-check's report is its stderr, never its exit code: a syntax error can
 * exit 0 while a balance error exits 1, and both print the same
 * `<file>:<line>:       <message>` shape. These tests parse that shape, and
 * check a real `bean-check` once so the parsed message is the terminal's.
 */
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import BeancountPlugin from '../main';
import type { LineDiagnostic } from '../bean-check';
import { matchesVaultFile, parseBeanCheckErrors, runBeanCheck, toLineDiagnostics } from '../bean-check';
import { clipText, isBeanCheckBinary } from '../bean-check';
import { setLineDiagnostics } from '../diagnostics';
import { createEditor, FakeVault } from './fakes';

/** stderr of a real `bean-check`, whatever status it exits with. */
const execFileAsync = promisify(execFile);

/** The real-spawn tests need the binary (and are version-tolerant where they can be). */
const hasBeanCheck = spawnSync('bean-check', ['--version']).error === undefined;

async function beanCheckStderr(file: string): Promise<string> {
	try {
		const { stderr } = await execFileAsync('bean-check', [file], { encoding: 'utf8' });
		return String(stderr);
	} catch (error) {
		// A numeric exit status still carries the report; only a failed spawn does not.
		const failure = error as NodeJS.ErrnoException & { stderr?: string };
		if (typeof failure.code === 'string') throw error;
		return String(failure.stderr ?? '');
	}
}

describe('parseBeanCheckErrors', () => {
	it('reads every error line and skips the indented source echo', () => {
		const stderr = [
			'/vault/main.bean:1:       Invalid reference to unknown account \'Expenses:Food\'',
			'',
			'   2026-10-01 * "Broken"',
			'     Expenses:Food   10.00 USD',
			'',
			'/vault/main.bean:1:       Transaction does not balance: (10.00 USD)',
			'',
			'<load>:0:       File "/vault/missing.bean" does not exist',
			'',
		].join('\n');

		expect(parseBeanCheckErrors(stderr)).toEqual([
			{
				file: '/vault/main.bean',
				line: 1,
				message: "Invalid reference to unknown account 'Expenses:Food'",
			},
			{ file: '/vault/main.bean', line: 1, message: 'Transaction does not balance: (10.00 USD)' },
			{ file: '<load>', line: 0, message: 'File "/vault/missing.bean" does not exist' },
		]);
	});

	it('takes the line number as the last colon-digits followed by whitespace', () => {
		const stderr = "/home/2024:3/ledger.bean:12:       Invalid token: '2026'\n";

		expect(parseBeanCheckErrors(stderr)).toEqual([
			{ file: '/home/2024:3/ledger.bean', line: 12, message: "Invalid token: '2026'" },
		]);
	});

	it('does not mistake a colon-digit account name for the separator', () => {
		// Digits are legal in an account sub-component, so `:2024:` appears in
		// ordinary messages — but never followed by the whitespace bean-check
		// pads its separator with. Captured from real bean-check 2.3.5 output.
		const stderr =
			"/tmp/bc/a.bean:2:       Invalid reference to unknown account 'Assets:2024:Cash'\n";

		expect(parseBeanCheckErrors(stderr)).toEqual([
			{
				file: '/tmp/bc/a.bean',
				line: 2,
				message: "Invalid reference to unknown account 'Assets:2024:Cash'",
			},
		]);
	});

	it('parses CRLF output — Windows bean-check writes text-mode stderr', () => {
		expect(parseBeanCheckErrors('C:\\v\\a.bean:3:       Bad\r\n\r\n   echo\r\n')).toEqual([
			{ file: 'C:\\v\\a.bean', line: 3, message: 'Bad' },
		]);
	});
});

describe('matchesVaultFile', () => {
	const root = '/home/u/vault/';

	it('accepts the vault-rooted path or a bare relative report', () => {
		expect(matchesVaultFile('/home/u/vault/sub/a.bean', 'sub/a.bean', root)).toBe(true);
		expect(matchesVaultFile('sub/a.bean', 'sub/a.bean', root)).toBe(true);
		expect(matchesVaultFile('C:\\vault\\sub\\a.bean', 'sub/a.bean', 'C:/vault/')).toBe(true);
	});

	it('rejects a path that merely ends with the vault file', () => {
		// A same-named ledger outside the vault must not draw on the vault's.
		expect(matchesVaultFile('/home/u/shared/a.bean', 'a.bean', root)).toBe(false);
		expect(matchesVaultFile('/vault/other/sub/a.bean', 'sub/a.bean', '/vault/')).toBe(false);
		expect(matchesVaultFile('/home/u/vault/sub/a.bean', 'other/sub/a.bean', root)).toBe(false);
	});
});

describe('toLineDiagnostics', () => {
	it('folds one file into 0-based lines, messages in print order', () => {
		const diagnostics = toLineDiagnostics([
			{ file: 'a.bean', line: 5, message: 'second line' },
			{ file: 'a.bean', line: 1, message: 'first' },
			{ file: 'a.bean', line: 1, message: 'second' },
		]);

		expect(diagnostics).toEqual([
			{ line: 0, message: 'first\nsecond' },
			{ line: 4, message: 'second line' },
		]);
	});

	it('clips a pathological message for notices and tooltips', () => {
		const [diagnostic] = toLineDiagnostics([{ file: 'a.bean', line: 1, message: 'x'.repeat(500) }]);

		expect(diagnostic.message).toBe(clipText('x'.repeat(500)));
		expect(diagnostic.message).toHaveLength(401);
	});
});

describe('isBeanCheckBinary', () => {
	it('accepts bean-check at any location', () => {
		expect(isBeanCheckBinary('bean-check')).toBe(true);
		expect(isBeanCheckBinary('/opt/homebrew/bin/bean-check')).toBe(true);
		expect(isBeanCheckBinary('C:\\Python312\\Scripts\\bean-check.exe')).toBe(true);
	});

	it('refuses anything a hostile setting could turn into "run this program"', () => {
		expect(isBeanCheckBinary('/bin/bash')).toBe(false);
		expect(isBeanCheckBinary('/usr/bin/python3')).toBe(false);
		expect(isBeanCheckBinary('/vault/bean-check.py')).toBe(false);
	});
});

describe('runBeanCheck', () => {
	it('reports a spawn failure instead of a ledger', async () => {
		const run = await runBeanCheck('bean-check-not-installed-xyz', ['ledger.bean']);

		expect(run.missing).toBe(true);
		expect(run.stderr).toBe('');
	});

	it('distinguishes a killed run from a missing binary', async () => {
		// Output over maxBuffer is a cut-short run, not "not installed".
		const big = await runBeanCheck(process.execPath, ['-e', 'console.error("x".repeat(20 * 1024 * 1024))']);
		expect(big.missing).toBe(false);
		expect(big.failure).toBe('produced too much output');
		expect(big.stderr.length).toBeGreaterThan(0);

		// A ledger can make bean-check hang (`include "/dev/stdin"`); the run
		// is bounded and the timeout is again not "not installed". Real clock:
		// the subject under test is the child process being killed.
		const hung = await runBeanCheck(process.execPath, ['-e', 'process.stdin.resume()'], 200);
		expect(hung.missing).toBe(false);
		expect(hung.failure).toBe('timed out');
	});

	it.skipIf(!hasBeanCheck)('returns the same stderr the terminal prints, exit code aside', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bean-check-'));
		try {
			// A syntax error: bean-check 2.3 prints `Invalid token` and exits 0.
			const syntax = join(dir, 'syntax.bean');
			writeFileSync(syntax, 'this is not beancount\n');
			const syntaxStderr = await beanCheckStderr(syntax);
			expect(parseBeanCheckErrors(syntaxStderr).length).toBeGreaterThan(0);
			expect(await runBeanCheck('bean-check', [syntax])).toEqual({ stderr: syntaxStderr, missing: false });

			// A ledger error: the same tool exits non-zero, and the report is still stderr.
			const ledger = join(dir, 'ledger.bean');
			writeFileSync(ledger, '2026-10-01 * "Broken"\n  Assets:Cash  10.00 USD\n');
			const ledgerStderr = await beanCheckStderr(ledger);
			expect(ledgerStderr).toContain('Transaction does not balance');
			const run = await runBeanCheck('bean-check', [ledger]);
			expect(run).toEqual({ stderr: ledgerStderr, missing: false });

			// The line the marker would carry says what the terminal said.
			const [diagnostic] = toLineDiagnostics(parseBeanCheckErrors(run.stderr));
			expect(diagnostic.line).toBe(0);
			for (const message of diagnostic.message.split('\n')) expect(ledgerStderr).toContain(message);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('save-time validation end to end', () => {
	it.skipIf(!hasBeanCheck)('marks the saved line with exactly what the terminal bean-check prints', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bean-check-vault-'));
		try {
			// A ledger saved with a deliberate mistake: `Assets:CaSH` is not an
			// account, and neither is `Expenses:Food` — bean-check reports both
			// on the transaction's header line, line 1.
			const broken = '2026-10-01 * "Cafe"\n  Expenses:Food  10.00 USD\n  Assets:CaSH   -10.00 USD\n';
			writeFileSync(join(dir, 'main.bean'), broken);

			const vault = new FakeVault(dir);
			const file = vault.write('main.bean', broken);
			const editor = createEditor(broken.split('\n'));
			const plugin = new BeancountPlugin(
				{ vault: vault.api, workspace: { getLeavesOfType: () => [{ view: { file, editor } }], activeEditor: null, on: () => ({}) } } as unknown as App,
				{ id: 'beancount-obsidian' } as PluginManifest
			);
			await plugin.onload();
			plugin.beanCheckRunner = runBeanCheck;

			await vault.emit('modify', file);
			// Wait for the run to land — a fixed sleep would race a cold spawn.
			await vi.waitFor(() => expect(editor.cm.dispatched).toHaveLength(1), { timeout: 10_000 });

			// What the terminal's own `bean-check` says about this file — run
			// on the same real, vault-rooted path the plugin used…
			const root = realpathSync(dir).replace(/\\/g, '/') + '/';
			const terminal = await beanCheckStderr(join(root, 'main.bean'));
			const reported = parseBeanCheckErrors(terminal).filter((error) =>
				matchesVaultFile(error.file, 'main.bean', root)
			);
			expect(reported.length).toBeGreaterThan(0);
			// …is line for line what the editor was handed to mark.
			const [spec] = editor.cm.dispatched[0].effects as Array<{
				value: unknown;
				is(spec: unknown): boolean;
			}>;
			expect(spec.is(setLineDiagnostics)).toBe(true);
			// bean-check's print order varies between processes (its account
			// set iteration is hash-randomised), so compare line by line with
			// the line's messages sorted.
			const marked = toLineDiagnostics(reported);
			const shown = spec.value as LineDiagnostic[];
			expect(shown).toHaveLength(marked.length);
			for (let i = 0; i < marked.length; i += 1) {
				expect(shown[i].line).toBe(marked[i].line);
				expect(shown[i].message.split('\n').sort()).toEqual(marked[i].message.split('\n').sort());
			}
			expect(marked).toHaveLength(1);
			expect(marked[0].line).toBe(0);
			expect(marked[0].message).toContain("Invalid reference to unknown account 'Assets:CaSH'");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(!hasBeanCheck)('marks a markdown fence with the terminal bean-check message', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bean-check-md-'));
		try {
			const broken = '2026-10-01 * "Cafe"\n  Expenses:Food  10.00 USD\n  Assets:CaSH   -10.00 USD\n';
			const note = '```beancount\n' + broken + '```\n';
			writeFileSync(join(dir, 'note.md'), note);

			const vault = new FakeVault(dir);
			const file = vault.write('note.md', note);
			const editor = createEditor(note.split('\n'));
			const plugin = new BeancountPlugin(
				{ vault: vault.api, workspace: { getLeavesOfType: () => [{ view: { file, editor } }], activeEditor: null, on: () => ({}) } } as unknown as App,
				{ id: 'beancount-obsidian' } as PluginManifest
			);
			await plugin.onload();
			plugin.beanCheckRunner = runBeanCheck;

			await vault.emit('modify', file);
			await vi.waitFor(() => expect(editor.cm.dispatched).toHaveLength(1), { timeout: 10_000 });

			const [spec] = editor.cm.dispatched[0].effects as Array<{
				value: unknown;
				is(spec: unknown): boolean;
			}>;
			expect(spec.is(setLineDiagnostics)).toBe(true);
			const shown = spec.value as LineDiagnostic[];
			expect(shown).toHaveLength(1);
			// Opening fence is line 0; the transaction header is the first body line.
			expect(shown[0].line).toBe(1);
			expect(shown[0].message).toContain("Invalid reference to unknown account 'Assets:CaSH'");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
