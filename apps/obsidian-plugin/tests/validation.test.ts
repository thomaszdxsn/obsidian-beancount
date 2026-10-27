/**
 * Ledger validation at its public handle() seam: FakeClock, fake runner,
 * no plugin, no wall-clock delay.
 */
import { describe, expect, it } from 'vitest';
import type { BeanCheckRun, LineDiagnostic } from '../bean-check';
import { FLAGGED_MESSAGE } from '../code-actions';
import { VALIDATION_FAILURE_PREFIX } from '../problems';
import { resolveInVault } from '../vault-path';
import {
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
}

function harness(): Harness {
	const clock = new FakeClock();
	const calls: Harness['calls'] = [];
	const pending: Harness['pending'] = [];
	const markers = new Map<string, LineDiagnostic[]>();
	const notices: string[] = [];
	const tempWrites: string[] = [];
	const contents = new Map<string, string>();
	const files: FileRef[] = [];
	const state = { disposals: 0, entryLedger: '', beanCheckPath: '' };

	const vault: VaultPort = {
		read: async (path) => {
			const text = contents.get(path);
			if (text === undefined) throw new Error(`missing ${path}`);
			return text;
		},
		files: () => files,
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
				return new Promise((resolve) => {
					pending.push(resolve);
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
			if (!resolve) throw new Error('no pending bean-check');
			resolve(run);
			await flush();
			await flush();
		},
		async resolveAt(index: number, run: BeanCheckRun = { stderr: '', missing: false }) {
			const resolve = pending[index];
			if (!resolve) throw new Error(`no pending bean-check at ${index}`);
			pending.splice(index, 1);
			resolve(run);
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

	it('never writes Flag as okay text through setBean', async () => {
		const h = harness();
		const file = h.add('ledger.bean', '2026-10-01 ! "Cafe"\n');
		h.saved(file);
		await h.tick();
		await h.finish({ stderr: '/vault/ledger.bean:2:       unknown\n', missing: false });
		expect(h.markers.get('ledger.bean')?.some((row) => row.message === FLAGGED_MESSAGE)).toBe(false);
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

		h.opened(child);
		await h.tick();
		expect(h.calls).toHaveLength(3);
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
