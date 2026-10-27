/**
 * Ledger validation at its public handle() seam: FakeClock, fake runner,
 * no plugin, no wall-clock delay.
 */
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { BeanCheckRun, LineDiagnostic } from '../bean-check';
import { VALIDATION_FAILURE_PREFIX } from '../problems';
import { resolveInVault } from '../vault-path';
import {
	createTempFilePort,
	LedgerValidation,
	openValidationTarget,
	VALIDATE_DEBOUNCE_MS,
} from '../validation';
import type { FileRef, MarkerSink, TempFilePort, VaultPort } from '../validation';
import { FakeClock, flush } from './fakes';

interface Harness {
	validation: LedgerValidation;
	clock: FakeClock;
	calls: Array<{ command: string; args: readonly string[] }>;
	pending: Array<(run: BeanCheckRun) => void>;
	markers: Map<string, LineDiagnostic[]>;
	notices: string[];
	tempWrites: string[];
	disposals: number;
	filesCalls: number;
	byPathCalls: number;
	contents: Map<string, string>;
	files: FileRef[];
	entryLedger: string;
	beanCheckPath: string;
	add(path: string, text: string, mtime?: number): FileRef;
	saved(file: FileRef): void;
	opened(file: FileRef, text?: string): void;
	tick(): Promise<void>;
	finish(run?: BeanCheckRun): Promise<void>;
	resolveAt(index: number, run?: BeanCheckRun): Promise<void>;
	rejectRun(message?: string): Promise<void>;
}

function harness(): Harness {
	const clock = new FakeClock();
	const calls: Harness['calls'] = [];
	const pending: Harness['pending'] = [];
	const rejects: Array<(error: Error) => void> = [];
	const markers = new Map<string, LineDiagnostic[]>();
	const notices: string[] = [];
	const tempWrites: string[] = [];
	const contents = new Map<string, string>();
	const files: FileRef[] = [];
	const state = { disposals: 0, entryLedger: '', beanCheckPath: '', filesCalls: 0, byPathCalls: 0 };

	const vault: VaultPort = {
		read: async (path) => {
			const text = contents.get(path);
			if (text === undefined) throw new Error(`missing ${path}`);
			return text;
		},
		files: () => {
			state.filesCalls += 1;
			return files;
		},
		byPath: (path) => {
			state.byPathCalls += 1;
			return files.find((entry) => entry.path === path);
		},
		resolveInVault: (vaultRel) => resolveInVault('/vault/', vaultRel),
		vaultRoot: () => '/vault/',
	};
	const tempFile: TempFilePort = {
		write(text) {
			tempWrites.push(text);
			return {
				checkPath: '/tmp/obsidian-beancount-fake/fences.bean',
				dispose() {
					state.disposals += 1;
				},
			};
		},
	};
	const markerSink: MarkerSink = {
		setBean(path, diagnostics) {
			markers.set(path, [...diagnostics]);
		},
	};
	const validation = new LedgerValidation(
		{
			clock,
			runner: (command, args) => {
				calls.push({ command, args: [...args] });
				return new Promise((resolve, reject) => {
					pending.push(resolve);
					rejects.push(reject);
				});
			},
			vault,
			tempFile,
			markers: markerSink,
			notifier: { show: (text) => notices.push(text) },
		},
		{
			entryLedger: () => state.entryLedger,
			beanCheckPath: () => state.beanCheckPath,
		},
	);

	const add = (path: string, text: string, mtime = 1): FileRef => {
		const slash = path.lastIndexOf('/');
		const base = slash >= 0 ? path.slice(slash + 1) : path;
		const dot = base.lastIndexOf('.');
		const file: FileRef = {
			path,
			extension: dot >= 0 ? base.slice(dot + 1) : '',
			mtime,
		};
		const existing = files.findIndex((entry) => entry.path === path);
		if (existing >= 0) files[existing] = file;
		else files.push(file);
		contents.set(path, text);
		return file;
	};

	return {
		validation,
		clock,
		calls,
		pending,
		markers,
		notices,
		tempWrites,
		get disposals() {
			return state.disposals;
		},
		get filesCalls() {
			return state.filesCalls;
		},
		get byPathCalls() {
			return state.byPathCalls;
		},
		contents,
		files,
		get entryLedger() {
			return state.entryLedger;
		},
		set entryLedger(value: string) {
			state.entryLedger = value;
		},
		get beanCheckPath() {
			return state.beanCheckPath;
		},
		set beanCheckPath(value: string) {
			state.beanCheckPath = value;
		},
		add,
		saved(file) {
			validation.handle({ kind: 'saved', file });
		},
		opened(file, text) {
			validation.handle({ kind: 'opened', file, text: text ?? contents.get(file.path) ?? '' });
		},
		async tick() {
			clock.tick(VALIDATE_DEBOUNCE_MS);
			await flush();
			await flush();
		},
		async finish(run: BeanCheckRun = { stderr: '', missing: false }) {
			const resolve = pending.shift();
			rejects.shift();
			if (!resolve) throw new Error('no pending bean-check');
			resolve(run);
			await flush();
			await flush();
		},
		async resolveAt(index: number, run: BeanCheckRun = { stderr: '', missing: false }) {
			const resolve = pending[index];
			if (!resolve) throw new Error(`no pending bean-check at ${index}`);
			pending.splice(index, 1);
			rejects.splice(index, 1);
			resolve(run);
			await flush();
			await flush();
		},
		async rejectRun(message = 'boom') {
			const reject = rejects.shift();
			pending.shift();
			if (!reject) throw new Error('no pending bean-check');
			reject(new Error(message));
			await flush();
			await flush();
		},
	};
}

const FENCED = '```beancount\n2026-10-01 * "Cafe"\n  Assets:Cash  10.00 USD\n```\n';

describe('openValidationTarget', () => {
	it('schedules a ledger open against the entry ledger', () => {
		expect(
			openValidationTarget({
				path: 'child.bean',
				extension: 'bean',
				text: '',
				entryLedger: '  main.bean  ',
				targetMtime: 10,
				lastValidatedMtime: undefined,
			}),
		).toBe('main.bean');
	});

	it('uses the opened ledger when no entry ledger is set', () => {
		expect(
			openValidationTarget({
				path: 'ledger.beancount',
				extension: 'beancount',
				text: '',
				entryLedger: '   ',
				targetMtime: undefined,
				lastValidatedMtime: 4,
			}),
		).toBe('ledger.beancount');
	});

	it('schedules a markdown note only when it has a beancount fence, and not via the entry ledger', () => {
		expect(
			openValidationTarget({
				path: 'note.md',
				extension: 'md',
				text: FENCED,
				entryLedger: 'main.bean',
				targetMtime: 1,
				lastValidatedMtime: undefined,
			}),
		).toBe('note.md');
		expect(
			openValidationTarget({
				path: 'note.md',
				extension: 'md',
				text: 'just prose',
				entryLedger: 'main.bean',
				targetMtime: 1,
				lastValidatedMtime: undefined,
			}),
		).toBeNull();
	});

	it('skips a target already validated at the same mtime and runs when it moved', () => {
		const base = {
			path: 'main.bean',
			extension: 'bean',
			text: '',
			entryLedger: '',
			targetMtime: 10,
			lastValidatedMtime: 10,
		};
		expect(openValidationTarget(base)).toBeNull();
		expect(openValidationTarget({ ...base, targetMtime: 11 })).toBe('main.bean');
		expect(openValidationTarget({ ...base, targetMtime: undefined })).toBe('main.bean');
	});

	it('ignores files that are neither ledgers nor markdown', () => {
		expect(
			openValidationTarget({
				path: 'pic.png',
				extension: 'png',
				text: '```bean\n2026-01-01 open Assets:Cash\n```',
				entryLedger: '',
				targetMtime: undefined,
				lastValidatedMtime: undefined,
			}),
		).toBeNull();
		expect(
			openValidationTarget({
				path: 'notes.txt',
				extension: 'txt',
				text: '```beancount\n2026-01-01 open Assets:Cash\n```',
				entryLedger: '',
				targetMtime: undefined,
				lastValidatedMtime: undefined,
			}),
		).toBeNull();
	});
});

describe('LedgerValidation run target', () => {
	it('checks the saved ledger file when entry ledger is empty', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '2026-10-01 * "A"\n');
		h.saved(file);
		await h.tick();
		expect(h.calls).toEqual([{ command: 'bean-check', args: ['/vault/ledger.bean'] }]);
		await h.finish();
	});

	it('checks the entry ledger when a member ledger is saved', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		h.add('main.bean', 'include "child.bean"\n');
		const child = h.add('child.bean', '2026-10-01 * "A"\n');
		h.saved(child);
		await h.tick();
		expect(h.calls).toEqual([{ command: 'bean-check', args: ['/vault/main.bean'] }]);
		await h.finish();
	});

	it('checks a temp fences.bean for a markdown note and does not merge with a ledger save', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		h.add('main.bean', '');
		const note = h.add('note.md', FENCED);
		const ledger = h.add('ledger.bean', '');
		h.saved(note);
		h.saved(ledger);
		await h.tick();
		expect(h.calls).toHaveLength(2);
		expect(h.calls.map((call) => call.args[0]).sort()).toEqual([
			'/tmp/obsidian-beancount-fake/fences.bean',
			'/vault/main.bean',
		]);
		await h.finish();
		await h.finish();
	});
});

describe('LedgerValidation debounce', () => {
	it('runs bean-check once for a burst on the same target', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		const main = h.add('main.bean', '');
		const child = h.add('child.bean', '');
		h.saved(child);
		h.saved(child);
		h.saved(main);
		await h.tick();
		expect(h.calls).toEqual([{ command: 'bean-check', args: ['/vault/main.bean'] }]);
		await h.finish();
	});
});

describe('LedgerValidation seq', () => {
	it('does not let a slower older run overwrite a newer clean report', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '2026-10-01 * "A"\n');
		h.saved(file);
		await h.tick();
		h.saved(file);
		await h.tick();
		expect(h.calls).toHaveLength(2);
		await h.resolveAt(1, { stderr: '', missing: false });
		expect(h.markers.get('ledger.bean')).toEqual([]);
		await h.resolveAt(0, { stderr: '/vault/ledger.bean:1:       stale\n', missing: false });
		expect(h.markers.get('ledger.bean')).toEqual([]);
	});
});

describe('LedgerValidation unload', () => {
	it('does not publish, notice, or run a pending debounce after unload', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '');
		h.saved(file);
		await h.tick();
		h.validation.handle({ kind: 'unload' });
		await h.finish({ stderr: '/vault/ledger.bean:1:       late\n', missing: false });
		expect(h.markers.size).toBe(0);
		expect(h.notices).toEqual([]);

		const again = harness();
		again.saved(again.add('ledger.bean', ''));
		again.validation.handle({ kind: 'unload' });
		await again.tick();
		expect(again.calls).toEqual([]);
	});

	it('drops missing and <load> reports after unload', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '');
		h.saved(file);
		await h.tick();
		h.validation.handle({ kind: 'unload' });
		await h.finish({ stderr: '', missing: true });
		expect(h.notices).toEqual([]);
		const late = harness();
		late.saved(late.add('ledger.bean', ''));
		await late.tick();
		late.validation.handle({ kind: 'unload' });
		await late.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(late.notices).toEqual([]);
		expect(late.markers.size).toBe(0);
	});
});

describe('LedgerValidation replay', () => {
	it('replays stored host markers at the same mtime without running bean-check', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '2026-10-01 * "A"\n', 10);
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/vault/ledger.bean:2:       unknown\n', missing: false });
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 1, message: 'unknown' }]);
		h.markers.delete('ledger.bean');
		h.opened(file);
		expect(h.calls).toHaveLength(1);
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 1, message: 'unknown' }]);
	});

	it('does not replay while a re-check is debounced or in flight', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		const main = h.add('main.bean', '', 10);
		const child = h.add('child.bean', '2026-10-01 * "A"\n', 10);
		h.saved(main);
		await h.tick();
		await h.finish({ stderr: '/vault/child.bean:2:       stored\n', missing: false });
		expect(h.markers.get('child.bean')).toEqual([{ line: 1, message: 'stored' }]);

		h.saved(child);
		h.markers.set('child.bean', [{ line: 4, message: 'stored' }]);
		h.opened(child);
		expect(h.markers.get('child.bean')).toEqual([{ line: 4, message: 'stored' }]);
		expect(h.calls).toHaveLength(1);
		await h.tick();
		expect(h.calls).toHaveLength(2);
		await h.finish({ stderr: '/vault/child.bean:5:       follow-up\n', missing: false });
		expect(h.markers.get('child.bean')).toEqual([{ line: 4, message: 'follow-up' }]);
	});
});

describe('LedgerValidation temp ledger', () => {
	it('maps temp lines onto host lines, disposes the file, and skips prose', async () => {
		const h = harness();
		const note = h.add(
			'note.md',
			['# x', '', '```beancount', '2026-10-01 * "A"', '```', '', '```beancount', 'oops', '```', ''].join('\n'),
		);
		h.saved(note);
		await h.tick();
		expect(h.calls[0]?.args[0]).toBe('/tmp/obsidian-beancount-fake/fences.bean');
		await h.finish({
			stderr:
				'/tmp/obsidian-beancount-fake/fences.bean:1:       first\n/tmp/obsidian-beancount-fake/fences.bean:3:       second\n',
			missing: false,
		});
		expect(h.disposals).toBe(1);
		expect(h.markers.get('note.md')).toEqual([
			{ line: 3, message: 'first' },
			{ line: 7, message: 'second' },
		]);

		const prose = h.add('prose.md', 'just words\n');
		h.saved(prose);
		await h.tick();
		expect(h.calls).toHaveLength(1);
		expect(h.markers.get('prose.md')).toEqual([]);
	});

	it('prepends include of the entry ledger and does not mark include or entry-only errors on the note', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		h.add('main.bean', '2020-01-01 open Assets:Cash\n');
		const note = h.add('note.md', '```beancount\n2026-10-01 * "Cafe"\n```\n');
		h.saved(note);
		await h.tick();
		expect(h.tempWrites[0]?.startsWith('include "/vault/main.bean"')).toBe(true);
		await h.finish({
			stderr:
				'/tmp/obsidian-beancount-fake/fences.bean:1:       include boom\n/vault/main.bean:1:       only entry\n/tmp/obsidian-beancount-fake/fences.bean:3:       fence body\n',
			missing: false,
		});
		expect(h.markers.get('note.md')).toEqual([{ line: 1, message: 'fence body' }]);
		expect(h.notices).toEqual([]);
	});
});

describe('LedgerValidation unsafe entry ledger', () => {
	it.each(['/etc/passwd', 'main.bean\nplugin "os"'])('refuses %j without calling bean-check', async (entry) => {
		const h = harness();
		h.entryLedger = entry;
		const file = h.add('ledger.bean', '');
		h.saved(file);
		await h.tick();
		expect(h.calls).toEqual([]);
		expect(h.notices[0]).toContain('entry ledger must be a vault file');
	});
});

describe('LedgerValidation unmapped paths', () => {
	it('turns <load> and outside paths into a deduped notice and still clears owned marks', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '');
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/vault/ledger.bean:1:       oops\n', missing: false });
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 0, message: 'oops' }]);

		h.saved(file);
		await h.tick();
		await h.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(h.markers.get('ledger.bean')).toEqual([]);
		expect(h.notices).toEqual(['bean-check: <load>: File "/vault/gone.bean" does not exist']);

		h.saved(file);
		await h.tick();
		await h.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(h.notices).toHaveLength(1);

		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/Users/me/shared/main.bean:3:       oops\n', missing: false });
		expect(h.notices).toContain('bean-check: /Users/me/shared/main.bean: oops');
		expect(h.markers.get('ledger.bean')).toEqual([]);
	});
});

describe('LedgerValidation marker owner', () => {
	it('lets a quiet run clear marks it owns and leaves another target alone', async () => {
		const h = harness();
		const main = h.add('main.bean', '');
		const child = h.add('child.bean', '');
		h.saved(main);
		await h.tick();
		await h.finish({ stderr: '/vault/child.bean:2:       bad\n', missing: false });
		expect(h.markers.get('child.bean')).toEqual([{ line: 1, message: 'bad' }]);

		h.saved(main);
		await h.tick();
		await h.finish({ stderr: '', missing: false });
		expect(h.markers.get('child.bean')).toEqual([]);

		const a = h.add('a.bean', '');
		const b = h.add('b.bean', '');
		h.saved(a);
		await h.tick();
		await h.finish({ stderr: '/vault/a.bean:1:       oops\n', missing: false });
		h.saved(b);
		await h.tick();
		await h.finish({ stderr: '', missing: false });
		expect(h.markers.get('a.bean')).toEqual([{ line: 0, message: 'oops' }]);
		expect(h.markers.get('b.bean')).toEqual([]);

		h.saved(child);
		await h.tick();
		await h.finish({ stderr: '/vault/child.bean:2:       mine\n', missing: false });
		h.saved(main);
		await h.tick();
		await h.finish({ stderr: '', missing: false });
		expect(h.markers.get('child.bean')).toEqual([{ line: 1, message: 'mine' }]);
	});
});

describe('LedgerValidation entry ledger change', () => {
	it('clears Problems, drops in-flight ledger reports, and lets a note still publish', async () => {
		const h = harness();
		h.entryLedger = '';
		const child = h.add('child.bean', '');
		const note = h.add('note.md', FENCED);
		h.saved(child);
		h.saved(note);
		await h.tick();
		expect(h.calls).toHaveLength(2);
		h.validation.handle({ kind: 'entryLedgerChanged', entryLedger: 'main.bean' });
		h.entryLedger = 'main.bean';
		expect(h.validation.problems.count()).toBe(0);
		await h.finish({ stderr: '/vault/child.bean:1:       late ledger\n', missing: false });
		expect(h.validation.problems.count()).toBe(0);
		await h.finish({
			stderr: '/tmp/obsidian-beancount-fake/fences.bean:1:       fence\n',
			missing: false,
		});
		expect(h.markers.get('note.md')).toEqual([{ line: 1, message: 'fence' }]);
		expect(h.markers.get('child.bean') ?? []).toEqual([]);
	});

	it('clears lastValidatedMtime so a same-mtime open after entry change re-runs', async () => {
		const h = harness();
		const child = h.add('child.bean', '2026-10-01 * "A"\n', 10);
		h.saved(child);
		await h.tick();
		await h.finish({ stderr: '/vault/child.bean:1:       old\n', missing: false });
		h.opened(child);
		expect(h.calls).toHaveLength(1);
		h.markers.set('child.bean', [{ line: 0, message: 'flag stays' }]);
		h.validation.handle({ kind: 'entryLedgerChanged', entryLedger: 'main.bean' });
		h.entryLedger = 'main.bean';
		h.add('main.bean', '', 10);
		expect(h.markers.get('child.bean')).toEqual([]);
		h.opened(child);
		await h.tick();
		expect(h.calls).toHaveLength(2);
	});

	it('does not rerun bean-check on beanCheckPathChanged at the same mtime', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '', 10);
		h.saved(file);
		await h.tick();
		await h.finish();
		h.validation.handle({ kind: 'beanCheckPathChanged' });
		h.opened(file);
		expect(h.calls).toHaveLength(1);
	});
});

describe('LedgerValidation missing bean-check', () => {
	it('does not spawn another program, keeps old marks, and retries each save', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '');
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/vault/ledger.bean:1:       oops\n', missing: false });
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 0, message: 'oops' }]);

		h.beanCheckPath = '/usr/bin/python';
		h.saved(file);
		await h.tick();
		expect(h.calls).toHaveLength(1);
		expect(h.notices[0]).toContain('pip install beancount');
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 0, message: 'oops' }]);
		expect(h.validation.problems.groups()[0].rows[0].message.startsWith(VALIDATION_FAILURE_PREFIX)).toBe(true);

		h.saved(file);
		await h.tick();
		expect(h.calls).toHaveLength(1);
		expect(h.notices).toHaveLength(1);

		h.beanCheckPath = '';
		h.saved(file);
		await h.tick();
		expect(h.calls).toHaveLength(2);
		await h.finish({ stderr: '', missing: true });
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 0, message: 'oops' }]);
		expect(h.notices).toHaveLength(1);
	});
});

describe('LedgerValidation unload outcomes', () => {
	it('does not publish a clean report, a failure, or a fence report after unload', async () => {
		const clean = harness();
		clean.saved(clean.add('ledger.bean', ''));
		await clean.tick();
		clean.validation.handle({ kind: 'unload' });
		await clean.finish({ stderr: '', missing: false });
		expect(clean.markers.size).toBe(0);
		expect(clean.notices).toEqual([]);

		const failed = harness();
		failed.saved(failed.add('ledger.bean', ''));
		await failed.tick();
		failed.validation.handle({ kind: 'unload' });
		await failed.finish({ stderr: 'Traceback (most recent call last):\nBoom', missing: false, failure: undefined });
		expect(failed.notices).toEqual([]);
		expect(failed.markers.size).toBe(0);

		const fenced = harness();
		fenced.saved(fenced.add('note.md', FENCED));
		await fenced.tick();
		fenced.validation.handle({ kind: 'unload' });
		await fenced.finish({
			stderr: '/tmp/obsidian-beancount-fake/fences.bean:1:       fence\n',
			missing: false,
		});
		expect(fenced.markers.size).toBe(0);
		expect(fenced.notices).toEqual([]);
	});
});

describe('LedgerValidation replay of fences and includes', () => {
	it('replays fence markers on host lines', async () => {
		const h = harness();
		const note = h.add('note.md', '# x\n\n```beancount\n2026-10-01 * "A"\n```\n', 4);
		h.saved(note);
		await h.tick();
		await h.finish({
			stderr: '/tmp/obsidian-beancount-fake/fences.bean:1:       Invalid token\n',
			missing: false,
		});
		expect(h.markers.get('note.md')).toEqual([{ line: 3, message: 'Invalid token' }]);
		h.markers.delete('note.md');
		h.opened(note);
		expect(h.calls).toHaveLength(1);
		expect(h.markers.get('note.md')).toEqual([{ line: 3, message: 'Invalid token' }]);
	});

	it('replays stored markers onto an include child that was closed during the run', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		const main = h.add('main.bean', 'include "child.bean"\n', 3);
		const child = h.add('child.bean', '2026-10-01 * "A"\n', 3);
		h.saved(main);
		await h.tick();
		await h.finish({ stderr: '/vault/child.bean:2:       unknown\n', missing: false });
		expect(h.markers.get('child.bean')).toEqual([{ line: 1, message: 'unknown' }]);
		h.markers.delete('child.bean');
		h.opened(child);
		expect(h.calls).toHaveLength(1);
		expect(h.markers.get('child.bean')).toEqual([{ line: 1, message: 'unknown' }]);
	});

	it('does not replay while a run is in flight after debounce has fired', async () => {
		const h = harness();
		h.entryLedger = 'main.bean';
		const main = h.add('main.bean', '', 10);
		const child = h.add('child.bean', '', 10);
		h.saved(main);
		await h.tick();
		await h.finish({ stderr: '/vault/child.bean:2:       stored\n', missing: false });
		h.saved(child);
		await h.tick();
		expect(h.calls).toHaveLength(2);
		h.markers.set('child.bean', [{ line: 4, message: 'stored' }]);
		h.opened(child);
		expect(h.markers.get('child.bean')).toEqual([{ line: 4, message: 'stored' }]);
		expect(h.calls).toHaveLength(2);
		await h.finish({ stderr: '/vault/child.bean:5:       follow-up\n', missing: false });
		expect(h.markers.get('child.bean')).toEqual([{ line: 4, message: 'follow-up' }]);
	});

	it('looks up the open target by path instead of listing every vault file', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '', 8);
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/vault/ledger.bean:1:       x\n', missing: false });
		const filesBefore = h.filesCalls;
		h.opened(file);
		expect(h.byPathCalls).toBeGreaterThan(0);
		expect(h.filesCalls).toBe(filesBefore);
		expect(h.calls).toHaveLength(1);
	});
});

describe('LedgerValidation unmapped same-name and path order', () => {
	it('does not mark a vault file that only shares the basename of an outside report', async () => {
		const h = harness();
		const file = h.add('main.bean', 'include "/Users/me/shared/main.bean"\n');
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/Users/me/shared/main.bean:3:       oops\n', missing: false });
		expect(h.markers.get('main.bean')).toEqual([]);
		expect(h.notices[0]).toContain('/Users/me/shared/main.bean');
	});

	it('maps a report that matches two vault paths onto the earlier file', async () => {
		const h = harness();
		h.add('sub/a.bean', '2026-10-01 * "S"\n');
		h.add('other/sub/a.bean', '2026-10-02 * "L"\n');
		const main = h.add('main.bean', '');
		h.entryLedger = 'main.bean';
		h.saved(main);
		await h.tick();
		await h.finish({ stderr: 'sub/a.bean:1:       which file\n', missing: false });
		expect(h.markers.get('sub/a.bean')).toEqual([{ line: 0, message: 'which file' }]);
		expect(h.markers.get('other/sub/a.bean') ?? []).toEqual([]);
	});

	it('matches a backslash report and a repeated path once per run', async () => {
		const h = harness();
		const child = h.add('child.bean', '');
		h.saved(child);
		await h.tick();
		const filesBefore = h.filesCalls;
		await h.finish({
			stderr: '\\vault\\child.bean:2:       a\n',
			missing: false,
		});
		expect(h.markers.get('child.bean')).toEqual([{ line: 1, message: 'a' }]);
		expect(h.filesCalls - filesBefore).toBe(1);
	});
});

describe('LedgerValidation notices and failures', () => {
	it('does not let another target quiet run re-arm this target, and re-notices after a quiet run or beanCheckPathChanged', async () => {
		const h = harness();
		const ledger = h.add('ledger.bean', '');
		const note = h.add('note.md', FENCED);
		h.saved(ledger);
		await h.tick();
		await h.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(h.notices).toHaveLength(1);
		h.saved(note);
		await h.tick();
		await h.finish({ stderr: '', missing: false });
		h.saved(ledger);
		await h.tick();
		await h.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(h.notices).toHaveLength(1);

		h.saved(ledger);
		await h.tick();
		await h.finish({ stderr: '', missing: false });
		h.saved(ledger);
		await h.tick();
		await h.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(h.notices).toHaveLength(2);

		h.beanCheckPath = '/opt/homebrew/bin/bean-check';
		h.validation.handle({ kind: 'beanCheckPathChanged' });
		h.saved(ledger);
		await h.tick();
		expect(h.calls.at(-1)?.command).toBe('/opt/homebrew/bin/bean-check');
		await h.finish({
			stderr: '<load>:0:       File "/vault/gone.bean" does not exist\n',
			missing: false,
		});
		expect(h.notices).toHaveLength(3);
	});

	it('keeps old marks on a traceback and on a timeout', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '');
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/vault/ledger.bean:1:       oops\n', missing: false });
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: 'Traceback (most recent call last):\nBoom', missing: false });
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 0, message: 'oops' }]);
		expect(h.validation.problems.groups()[0].rows[0].message).toContain('failed:');
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '', missing: false, failure: 'timed out' });
		expect(h.markers.get('ledger.bean')).toEqual([{ line: 0, message: 'oops' }]);
		expect(h.notices.some((text) => text.includes('timed out'))).toBe(true);
	});

	it('notices a temp-ledger write failure without calling the runner', async () => {
		const h = harness();
		const throwing: TempFilePort = {
			write() {
				throw new Error('EACCES');
			},
		};
		const validation = new LedgerValidation(
			{
				clock: h.clock,
				runner: async () => {
					throw new Error('should not run');
				},
				vault: {
					read: async (path) => h.contents.get(path) ?? '',
					files: () => h.files,
					byPath: (path) => h.files.find((entry) => entry.path === path),
					resolveInVault: (rel) => resolveInVault('/vault/', rel),
					vaultRoot: () => '/vault/',
				},
				tempFile: throwing,
				markers: { setBean: (path, diagnostics) => h.markers.set(path, [...diagnostics]) },
				notifier: { show: (text) => h.notices.push(text) },
			},
			{ entryLedger: () => '', beanCheckPath: () => '' },
		);
		const note = h.add('note.md', FENCED);
		validation.handle({ kind: 'saved', file: note });
		h.clock.tick(VALIDATE_DEBOUNCE_MS);
		await flush();
		await flush();
		expect(h.notices[0]).toBe('bean-check could not write the temporary ledger');
	});
});

describe('LedgerValidation deleted and renamed', () => {
	it('drops rows and cancels a pending run when the target is deleted or renamed', async () => {
		const h = harness();
		const alpha = h.add('alpha.bean', '');
		const beta = h.add('beta.bean', '');
		h.saved(alpha);
		await h.tick();
		await h.finish({ stderr: '/vault/alpha.bean:1:       bad alpha\n', missing: false });
		h.saved(beta);
		h.validation.handle({ kind: 'deleted', path: 'beta.bean' });
		await h.tick();
		expect(h.calls).toHaveLength(1);
		h.validation.handle({ kind: 'renamed', oldPath: 'alpha.bean' });
		expect(h.validation.problems.rowsFor('alpha.bean')).toEqual([]);
	});
});

describe('createTempFilePort', () => {
	it('disposes the directory after a successful write', () => {
		const written = createTempFilePort().write('option "title" "X"\n');
		expect(written.checkPath.endsWith('fences.bean')).toBe(true);
		written.dispose();
		expect(() => fs.readdirSync(written.checkPath)).toThrow();
	});

	it('removes the temp directory when writing fences.bean fails', () => {
		const before = new Set(fs.readdirSync(tmpdir()).filter((name) => name.startsWith('obsidian-beancount-')));
		expect(() =>
			createTempFilePort({
				mkdtempSync: fs.mkdtempSync,
				writeFileSync: () => {
					throw new Error('EACCES');
				},
				realpathSync: fs.realpathSync,
				rmSync: fs.rmSync,
			}).write('x'),
		).toThrow('EACCES');
		const after = fs.readdirSync(tmpdir()).filter((name) => name.startsWith('obsidian-beancount-'));
		expect(after.every((name) => before.has(name))).toBe(true);
	});
});

describe('LedgerValidation runner reject', () => {
	it('disposes the temp ledger when the runner rejects', async () => {
		const h = harness();
		h.saved(h.add('note.md', FENCED));
		await h.tick();
		expect(h.disposals).toBe(0);
		await h.rejectRun('spawn failed');
		expect(h.disposals).toBe(1);
		expect(h.markers.size).toBe(0);
	});
});

describe('LedgerValidation configured binary and ledger symlink', () => {
	it('runs the configured bean-check path', async () => {
		const h = harness();
		h.beanCheckPath = '/opt/homebrew/bin/bean-check';
		h.saved(h.add('ledger.bean', ''));
		await h.tick();
		expect(h.calls).toEqual([{ command: '/opt/homebrew/bin/bean-check', args: ['/vault/ledger.bean'] }]);
		await h.finish();
	});
});

