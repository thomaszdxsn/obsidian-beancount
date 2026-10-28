/**
 * Seam 4: AlignOnSave — Clock + fake vault + fake openEditor.
 */
import { describe, expect, it } from 'vitest';
import type { EditPlan } from '../edits';
import { AlignOnSave } from '../edits';
import type { LedgerKind } from '../fences';
import { ledgerKind } from '../fences';
import { FakeClock, flush } from './fakes';

const TIGHT = '  Expenses:Food 12.5 USD\n  Assets:Cash -12.5 USD';
const AT50 =
	'  Expenses:Food                                12.5 USD\n' +
	'  Assets:Cash                                 -12.5 USD';
const TIGHT_COL1 = '  Expenses:Food 12.5 USD\n  Assets:Cash  -12.5 USD';

interface OpenBuf {
	text: string;
	applied: EditPlan[];
}

function harness(opts?: {
	alignOnSave?: boolean;
	separatorColumn?: number;
	contents?: Record<string, string>;
	open?: Record<string, OpenBuf>;
	fail?: Set<string>;
	holdFirstRead?: boolean;
}) {
	const clock = new FakeClock();
	const contents = new Map<string, string>(Object.entries(opts?.contents ?? {}));
	const writes: string[] = [];
	const open = new Map<string, OpenBuf>(Object.entries(opts?.open ?? {}));
	const fail = opts?.fail ?? new Set<string>();
	let alignOnSave = opts?.alignOnSave ?? true;
	let separatorColumn = opts?.separatorColumn ?? 50;
	let firstRead: ((text: string) => void) | null = null;
	let firstHeld: Promise<string> | null = null;
	if (opts?.holdFirstRead === true) {
		firstHeld = new Promise<string>((resolve) => {
			firstRead = resolve;
		});
	}
	let reads = 0;

	const ports = {
		clock,
		async read(path: string): Promise<string> {
			if (fail.has(path)) throw new Error('unreadable');
			const text = contents.get(path) ?? '';
			reads += 1;
			if (firstHeld !== null && reads === 1) return firstHeld;
			return text;
		},
		async modify(path: string, text: string): Promise<void> {
			writes.push(path);
			contents.set(path, text);
		},
		openEditor(path: string) {
			const buf = open.get(path);
			if (!buf) return null;
			return {
				getValue: () => buf.text,
				apply(plan: EditPlan) {
					buf.applied.push(plan);
					const lines = buf.text.split('\n');
					const ordered = [...plan.changes].sort(
						(a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch,
					);
					for (const change of ordered) {
						const line = lines[change.from.line] ?? '';
						const toCh = change.to.line === change.from.line ? change.to.ch : line.length;
						lines[change.from.line] = line.slice(0, change.from.ch) + change.text + line.slice(toCh);
					}
					buf.text = lines.join('\n');
				},
			};
		},
		alignOnSave: () => alignOnSave,
		separatorColumn: () => separatorColumn,
		ledgerKind: (file: { path: string; extension: string }): LedgerKind => ledgerKind(file),
	};
	const align = new AlignOnSave(ports);
	return {
		clock,
		contents,
		writes,
		open,
		align,
		setAlignOnSave(value: boolean) {
			alignOnSave = value;
		},
		releaseFirst(text: string) {
			firstRead?.(text);
		},
		file(path: string, extension: string) {
			return { path, extension };
		},
	};
}

async function settle(): Promise<void> {
	await flush();
	await flush();
}

describe('AlignOnSave', () => {
	it('does not modify when alignOnSave is off', async () => {
		const h = harness({ alignOnSave: false, contents: { 'ledger.bean': TIGHT } });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual([]);
	});

	it('aligns a closed .bean once and does not rewrite already aligned text', async () => {
		const h = harness({ contents: { 'ledger.bean': TIGHT } });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(h.contents.get('ledger.bean')).toBe(AT50);
		expect(h.writes).toEqual(['ledger.bean']);

		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual(['ledger.bean']);
	});

	it('debounces a burst of schedule calls into one rewrite', async () => {
		const h = harness({ contents: { 'ledger.bean': TIGHT } });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual(['ledger.bean']);
	});

	it('drops the pending rewrite when the setting is turned off while waiting', async () => {
		const h = harness({ contents: { 'ledger.bean': TIGHT } });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.setAlignOnSave(false);
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual([]);
	});

	it('does not write a png', async () => {
		const h = harness({ contents: { 'ledger.png': TIGHT } });
		h.align.schedule(h.file('ledger.png', 'png'));
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual([]);
	});

	it('applies planAlign to an open editor and does not modify the vault', async () => {
		const buf: OpenBuf = { text: TIGHT, applied: [] };
		const h = harness({ contents: { 'ledger.bean': TIGHT }, open: { 'ledger.bean': buf } });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(buf.text).toBe(AT50);
		expect(buf.applied).toHaveLength(1);
		expect(h.writes).toEqual([]);
	});

	it('does not write a stale snapshot when the file changes during the read', async () => {
		const h = harness({ contents: { 'ledger.bean': TIGHT }, holdFirstRead: true });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		const newer = '  Expenses:Food 99.00 USD\n  Assets:Cash -99.00 USD';
		h.contents.set('ledger.bean', newer);
		h.releaseFirst(TIGHT);
		await settle();
		expect(h.writes).toEqual([]);
		expect(h.contents.get('ledger.bean')).toBe(newer);
	});

	it('redirects to the editor when the file opens during the read', async () => {
		const buf: OpenBuf = { text: TIGHT, applied: [] };
		const h = harness({ contents: { 'ledger.bean': TIGHT }, holdFirstRead: true });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		h.open.set('ledger.bean', buf);
		h.releaseFirst(TIGHT);
		await settle();
		expect(buf.text).toBe(AT50);
		expect(h.writes).toEqual([]);
	});

	it('aligns only fence bodies and does not write a note without fences', async () => {
		const fenced = [
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash -12.5 USD',
			'```',
			'  Assets:Cash -12.5 USD',
			'',
		].join('\n');
		const h = harness({
			contents: {
				'note.md': fenced,
				'plain.md': TIGHT + '\n',
			},
		});
		h.align.schedule(h.file('note.md', 'md'));
		h.align.schedule(h.file('plain.md', 'md'));
		h.clock.tick(500);
		await settle();
		expect(h.contents.get('note.md')).toBe(
			[
				'  Expenses:Food 12.5 USD',
				'```beancount',
				'  Expenses:Food                                12.5 USD',
				'  Assets:Cash                                 -12.5 USD',
				'```',
				'  Assets:Cash -12.5 USD',
				'',
			].join('\n'),
		);
		expect(h.contents.get('plain.md')).toBe(TIGHT + '\n');
		expect(h.writes).toEqual(['note.md']);
	});

	it('keeps indented-fence indent and leaves a column-50 fence at 50', async () => {
		const padded = [
			'```beancount',
			'  Expenses:Food                                12.5 USD',
			'  Assets:Cash                                 -12.5 USD',
			'```',
			'',
		].join('\n');
		const indented = ['  ```beancount', '    Expenses:Food 12.5 USD', '    Assets:Cash -12.5 USD', '  ```', ''].join(
			'\n',
		);
		const h = harness({ contents: { 'at50.md': padded, 'indent.md': indented } });
		h.align.schedule(h.file('at50.md', 'md'));
		h.align.schedule(h.file('indent.md', 'md'));
		h.clock.tick(500);
		await settle();
		expect(h.contents.get('at50.md')).toBe(padded);
		expect(h.writes).not.toContain('at50.md');
		const indentLines = h.contents.get('indent.md')!.split('\n');
		expect(indentLines[0]).toBe('  ```beancount');
		expect(indentLines[1].startsWith('    ')).toBe(true);
		expect(indentLines[3]).toBe('  ```');
	});

	it('aligns an open note through its editor without touching prose', async () => {
		const content = [
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash -12.5 USD',
			'```',
			'',
		].join('\n');
		const buf: OpenBuf = { text: content, applied: [] };
		const h = harness({ contents: { 'note.md': content }, open: { 'note.md': buf } });
		h.align.schedule(h.file('note.md', 'md'));
		h.clock.tick(500);
		await settle();
		expect(buf.text.split('\n')).toEqual([
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'  Expenses:Food                                12.5 USD',
			'  Assets:Cash                                 -12.5 USD',
			'```',
			'',
		]);
		expect(h.writes).toEqual([]);
	});

	it('uses a tight gap when separatorColumn is 1', async () => {
		const h = harness({ contents: { 'tight.bean': TIGHT }, separatorColumn: 1 });
		h.align.schedule(h.file('tight.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(h.contents.get('tight.bean')).toBe(TIGHT_COL1);
	});

	it('swallows a read failure and does not write', async () => {
		const h = harness({ contents: { 'ledger.bean': TIGHT }, fail: new Set(['ledger.bean']) });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual([]);
	});

	it('drops pending work on dispose', async () => {
		const h = harness({ contents: { 'ledger.bean': TIGHT } });
		h.align.schedule(h.file('ledger.bean', 'bean'));
		h.align.dispose();
		h.clock.tick(500);
		await settle();
		expect(h.writes).toEqual([]);
	});
});
