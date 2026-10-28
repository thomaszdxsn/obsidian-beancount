/**
 * Seams:
 * 1. planAlign: 文本 + carets + mode + Separator column → changes + 可选 caret
 * 2. planFormat: 同上 + LedgerKind → changes + caret，或 { error }
 * 3. planInstantDot: offset carets → InstantPlan
 * 5. 薄 apply: createEditor + EditPlan → 一次 transaction（不启动插件）
 */
import { describe, expect, it } from 'vitest';
import type { EditPlan } from '../edits';
import { planAlign, planFormat, planInstantDot } from '../edits';
import { ledgerDoc } from '../fences';
import { createEditor } from './fakes';
import type { FakeEditor } from './fakes';

const COL50 = 50;
const COL1 = 1;

const AT50_FOOD = '  Expenses:Food                                12.5 USD';
const AT50_CASH = '  Assets:Cash                                 -12.5 USD';
const AT50_FOOD_CNY = '  Expenses:Food                                12.5 CNY';
const AT50_CASH_CNY = '  Assets:Cash                                 -12.5 CNY';
const AT50_CASH_POS_CNY = '  Assets:Cash                                  12.5 CNY';
const AT50_REST_CNY = '  Expenses:Food:Rest                         1234.5 CNY';
const AT50_CASH_REST_CNY = '  Assets:Cash                               -1234.5 CNY';

function caret(line: number, ch: number) {
	return { anchor: { line, ch }, head: { line, ch } };
}

function range(fromLine: number, fromCh: number, toLine: number, toCh: number) {
	return { anchor: { line: fromLine, ch: fromCh }, head: { line: toLine, ch: toCh } };
}

function apply(text: string, plan: EditPlan): string {
	const lines = text.split('\n');
	const ordered = [...plan.changes].sort((a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch);
	for (const change of ordered) {
		const line = lines[change.from.line] ?? '';
		const toCh = change.to.line === change.from.line ? change.to.ch : line.length;
		lines[change.from.line] = line.slice(0, change.from.ch) + change.text + line.slice(toCh);
	}
	return lines.join('\n');
}

function applyToEditor(editor: FakeEditor, plan: EditPlan | null): void {
	if (plan === null || plan.changes.length === 0) return;
	editor.transaction({
		changes: [...plan.changes],
		...(plan.caret ? { selection: { from: plan.caret } } : {}),
	});
}

function fenceFilter(text: string): (line: number) => boolean {
	const doc = ledgerDoc('fenced', text);
	return (line) => doc.lineIsLedger(line);
}

describe('planAlign', () => {
	it('aligns only the transaction block at the caret in block mode', () => {
		const text = [
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		].join('\n');
		const plan = planAlign(text, {
			carets: [caret(6, 1)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(plan).not.toBeNull();
		expect(plan!.changes.length).toBeGreaterThan(0);
		expect(plan!.caret).toEqual({ line: 6, ch: 1 });
		expect(apply(text, plan!).split('\n')).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			AT50_REST_CNY,
			AT50_CASH_REST_CNY,
		]);
	});

	it('returns null when a selected line is already on the separator column', () => {
		const text = AT50_FOOD;
		expect(
			planAlign(text, {
				carets: [range(0, 0, 0, text.length)],
				mode: 'selection',
				separatorColumn: COL50,
			}),
		).toBeNull();
	});

	it('aligns only the selected posting lines', () => {
		const lines = [
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		];
		const text = lines.join('\n');
		const plan = planAlign(text, {
			carets: [range(6, 0, 6, 23)],
			mode: 'selection',
			separatorColumn: COL50,
		});
		expect(apply(text, plan!).split('\n')).toEqual([
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			AT50_CASH_REST_CNY,
		]);
	});

	it('drops a selection that ends at column 0 of the next line', () => {
		const text = ['  Expenses:Food 12.5 CNY', '  Assets:Cash -12.5 CNY', '  Expenses:Food:Rest 1.00 USD'].join('\n');
		const plan = planAlign(text, {
			carets: [range(0, 0, 2, 0)],
			mode: 'selection',
			separatorColumn: COL50,
		});
		expect(apply(text, plan!).split('\n')).toEqual([
			AT50_FOOD_CNY,
			AT50_CASH_CNY,
			'  Expenses:Food:Rest 1.00 USD',
		]);
	});

	it('keeps a lone caret before its amount when the gap moves', () => {
		const text = ['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(1, 15)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(plan!.caret).toEqual({ line: 1, ch: 47 });
		expect(apply(text, plan!).split('\n')).toEqual([AT50_FOOD, AT50_CASH]);
	});

	it('rides a caret inside the gap to the amount', () => {
		const text = ['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(0, 14)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(plan!.caret).toEqual({ line: 0, ch: 47 });
		expect(apply(text, plan!).split('\n')[0]).toBe(AT50_CASH_POS_CNY);
	});

	it('keeps a caret before the gap in place', () => {
		const text = ['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(0, 5)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(plan!.caret).toEqual({ line: 0, ch: 5 });
	});

	it('keeps a caret at the gap start with the account', () => {
		const text = ['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(1, 13)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(plan!.caret).toEqual({ line: 1, ch: 13 });
	});

	it('omits caret for multi-cursor and for a range selection', () => {
		const text = ['  Assets:Cash  12.5 CNY', '  Expenses:A:B:C -1234.5 CNY'].join('\n');
		const many = planAlign(text, {
			carets: [caret(0, 14), caret(1, 5)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(many!.caret).toBeUndefined();
		expect(apply(text, many!).split('\n')[0]).toBe(AT50_CASH_POS_CNY);

		const selected = planAlign(text, {
			carets: [range(0, 15, 0, 19)],
			mode: 'selection',
			separatorColumn: COL50,
		});
		expect(selected!.caret).toBeUndefined();
		expect(apply(text, selected!).split('\n')[0]).toBe(AT50_CASH_POS_CNY);
		expect(apply(text, selected!).split('\n')[1]).toBe('  Expenses:A:B:C -1234.5 CNY');
	});

	it('does not rewrite Host lines that are not ledger text', () => {
		const text = [
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'2026-10-01 * "Cafe"',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash -12.5 USD',
			'```',
			'  Assets:Cash -12.5 USD',
		].join('\n');
		const plan = planAlign(text, {
			carets: [caret(4, 1)],
			mode: 'block',
			separatorColumn: COL50,
			lineIsLedger: fenceFilter(text),
		});
		expect(apply(text, plan!).split('\n')).toEqual([
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'2026-10-01 * "Cafe"',
			AT50_FOOD,
			AT50_CASH,
			'```',
			'  Assets:Cash -12.5 USD',
		]);
	});

	it('does nothing in a note when the caret is outside a fence', () => {
		const text = ['  Expenses:Food 12.5 USD', '```beancount', '  Assets:Cash -12.5 USD', '```'].join('\n');
		expect(
			planAlign(text, {
				carets: [caret(0, 2)],
				mode: 'block',
				separatorColumn: COL50,
				lineIsLedger: fenceFilter(text),
			}),
		).toBeNull();
	});

	it('aligns a fence below prose holding an unmatched quote', () => {
		const text = ['a 27" monitor', '```beancount', '  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD', '```'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(3, 1)],
			mode: 'block',
			separatorColumn: COL50,
			lineIsLedger: fenceFilter(text),
		});
		expect(apply(text, plan!).split('\n').slice(2, 4)).toEqual([AT50_FOOD, AT50_CASH]);
	});

	it('aligns only selected fence-body lines in a note', () => {
		const text = [
			'  Expenses:Food 12.5 USD',
			'```beancount',
			'  Expenses:Food 12.5 USD',
			'  Assets:Cash -12.5 USD',
			'```',
			'  Assets:Cash -12.5 USD',
		].join('\n');
		const plan = planAlign(text, {
			carets: [range(0, 0, 5, 10)],
			mode: 'selection',
			separatorColumn: COL50,
			lineIsLedger: fenceFilter(text),
		});
		expect(apply(text, plan!).split('\n')).toEqual([
			'  Expenses:Food 12.5 USD',
			'```beancount',
			AT50_FOOD,
			AT50_CASH,
			'```',
			'  Assets:Cash -12.5 USD',
		]);
	});

	it('treats the whole buffer as a ledger file when lineIsLedger is omitted', () => {
		const text = ['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(0, 2)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(apply(text, plan!).split('\n')).toEqual([AT50_FOOD, AT50_CASH]);
	});

	it('does not emit extra changes for a string continuation or a comment', () => {
		const text = [
			'2020-02-01 * "x',
			'  Assets:Cash    10.5 USD',
			'"',
			'  Expenses:Food 1 USD',
			'  Assets:Cash -1 USD',
		].join('\n');
		const plan = planAlign(text, {
			carets: [caret(4, 2)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(plan).not.toBeNull();
		expect(plan!.changes.every((change) => change.from.line !== 1)).toBe(true);
		expect(apply(text, plan!).split('\n')[1]).toBe('  Assets:Cash    10.5 USD');

		const comment = ['; not a posting 12.5 USD', '  Assets:Cash -12.5 USD'].join('\n');
		const commented = planAlign(comment, {
			carets: [caret(1, 2)],
			mode: 'block',
			separatorColumn: COL50,
		});
		expect(commented).not.toBeNull();
		expect(commented!.changes.every((change) => change.from.line !== 0)).toBe(true);
		expect(apply(comment, commented!).split('\n')[0]).toBe('; not a posting 12.5 USD');
	});

	it('replaces a tab gap with ordinary spaces', () => {
		const text = ['  Assets:Cash\t12.5 CNY', '  Expenses:A:B:C -1234.5 CNY'].join('\n');
		const plan = planAlign(text, {
			carets: [caret(0, 2)],
			mode: 'block',
			separatorColumn: COL1,
		});
		expect(apply(text, plan!).split('\n')).toEqual([
			'  Assets:Cash       12.5 CNY',
			'  Expenses:A:B:C -1234.5 CNY',
		]);
	});

	it('uses separator column 1 for a tight gap and leaves a column-50 block at 50', () => {
		const tight = ['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD'].join('\n');
		expect(
			apply(
				tight,
				planAlign(tight, {
					carets: [caret(0, 2)],
					mode: 'block',
					separatorColumn: COL1,
				})!,
			).split('\n'),
		).toEqual(['  Expenses:Food 12.5 USD', '  Assets:Cash  -12.5 USD']);

		const padded = [AT50_FOOD, AT50_CASH].join('\n');
		expect(
			planAlign(padded, {
				carets: [caret(0, 2)],
				mode: 'block',
				separatorColumn: COL50,
			}),
		).toBeNull();
	});

	it('aligns the whole document in document mode', () => {
		const text = [
			'2026-10-01 * "A"',
			'  Expenses:Food 12.5 CNY',
			'  Assets:Cash -12.5 CNY',
			'',
			'2026-10-02 * "B"',
			'  Expenses:Food:Rest 1234.5 CNY',
			'  Assets:Cash -1234.5 CNY',
		].join('\n');
		const plan = planAlign(text, {
			carets: [],
			mode: 'document',
			separatorColumn: COL50,
		});
		expect(plan!.caret).toBeUndefined();
		expect(apply(text, plan!).split('\n')).toEqual([
			'2026-10-01 * "A"',
			AT50_FOOD_CNY,
			AT50_CASH_CNY,
			'',
			'2026-10-02 * "B"',
			AT50_REST_CNY,
			AT50_CASH_REST_CNY,
		]);
	});
});

describe('planFormat', () => {
	it('collapses extra spaces in a ledger file and is a no-op when already formatted', () => {
		const text = '2022-01-01   open   Assets:A';
		const plan = planFormat(text, {
			carets: [caret(0, 0)],
			separatorColumn: COL50,
			kind: 'ledger-file',
		});
		expect(apply(text, plan as EditPlan)).toBe('2022-01-01 open Assets:A');
		expect(
			planFormat('2022-01-01 open Assets:A', {
				carets: [caret(0, 0)],
				separatorColumn: COL50,
				kind: 'ledger-file',
			}),
		).toBeNull();
	});

	it('formats fence bodies of beancount, bean, and ~~~bean and leaves prose and other fences', () => {
		const text = [
			'# title  ',
			'```beancount',
			'2022-01-01   open   Assets:A',
			'```',
			'```bean',
			'2022-01-02   close   Assets:A',
			'```',
			'~~~bean',
			'2022-01-03   open   Assets:B',
			'~~~',
			'```js',
			'const x =  1',
			'```',
		].join('\n');
		const plan = planFormat(text, {
			carets: [caret(0, 0)],
			separatorColumn: COL1,
			kind: 'fenced',
		}) as EditPlan;
		expect(apply(text, plan).split('\n')).toEqual([
			'# title  ',
			'```beancount',
			'2022-01-01 open Assets:A',
			'```',
			'```bean',
			'2022-01-02 close Assets:A',
			'```',
			'~~~bean',
			'2022-01-03 open Assets:B',
			'~~~',
			'```js',
			'const x =  1',
			'```',
		]);
	});

	it('keeps an indented fence’s leading spaces', () => {
		const text = ['  ```beancount', '  2022-01-01   open   Assets:A', '  ```'].join('\n');
		const plan = planFormat(text, {
			carets: [caret(1, 2)],
			separatorColumn: COL1,
			kind: 'fenced',
		}) as EditPlan;
		expect(apply(text, plan).split('\n')).toEqual([
			'  ```beancount',
			'  2022-01-01 open Assets:A',
			'  ```',
		]);
	});

	it('formats an unclosed fence without appending a blank line', () => {
		const text = 'intro\n```beancount\n2022-01-01   open   Assets:A\n';
		const plan = planFormat(text, {
			carets: [caret(2, 0)],
			separatorColumn: COL1,
			kind: 'fenced',
		}) as EditPlan;
		expect(apply(text, plan)).toBe('intro\n```beancount\n2022-01-01 open Assets:A\n');
	});

	it('returns a document-line syntax error and does not emit changes', () => {
		const note = ['intro', '', '```beancount', '2022-01-01 open', '```'].join('\n');
		expect(
			planFormat(note, {
				carets: [caret(0, 0)],
				separatorColumn: COL50,
				kind: 'fenced',
			}),
		).toEqual({
			error: { line: 4, column: 15, message: "missing ACCOUNT at '\\n'" },
		});
		expect(
			planFormat('2022-01-01 open', {
				carets: [caret(0, 0)],
				separatorColumn: COL50,
				kind: 'ledger-file',
			}),
		).toEqual({
			error: { line: 1, column: 15, message: "missing ACCOUNT at '<EOF>'" },
		});
		const later = [
			'```beancount',
			'2022-01-01 open Assets:A',
			'```',
			'```bean',
			'2022-01-01 open',
			'```',
		].join('\n');
		const result = planFormat(later, {
			carets: [caret(0, 0)],
			separatorColumn: COL50,
			kind: 'fenced',
		});
		expect(result).toMatchObject({ error: { line: 5 } });
		expect(result && 'changes' in result).toBe(false);
	});

	it('maps a lone caret across compressed whitespace runs and omits it for multi-cursor or a selection', () => {
		const text = ['2026-10-01   *   "Store"', '  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD'].join('\n');
		const star = planFormat(text, {
			carets: [caret(0, 13)],
			separatorColumn: COL50,
			kind: 'ledger-file',
		}) as EditPlan;
		expect(apply(text, star).split('\n')[0]).toBe('2026-10-01 * "Store"');
		expect(star.caret).toEqual({ line: 0, ch: 11 });

		const payee = planFormat(text, {
			carets: [caret(0, 18)],
			separatorColumn: COL50,
			kind: 'ledger-file',
		}) as EditPlan;
		expect(payee.caret).toEqual({ line: 0, ch: 14 });

		const many = planFormat(text, {
			carets: [caret(0, 13), caret(2, 5)],
			separatorColumn: COL50,
			kind: 'ledger-file',
		}) as EditPlan;
		expect(many.caret).toBeUndefined();

		const selected = planFormat(text, {
			carets: [range(0, 17, 0, 22)],
			separatorColumn: COL50,
			kind: 'ledger-file',
		}) as EditPlan;
		expect(selected.caret).toBeUndefined();
	});

	it('does not pull an already column-50 posting back when formatting', () => {
		const text = ['2026-10-01 * "Store"', AT50_FOOD, AT50_CASH].join('\n');
		expect(
			planFormat(text, {
				carets: [caret(0, 0)],
				separatorColumn: COL50,
				kind: 'ledger-file',
			}),
		).toBeNull();
		const note = ['prose', '```beancount', '2026-10-01 * "Store"', AT50_FOOD, AT50_CASH, '```'].join('\n');
		expect(
			planFormat(note, {
				carets: [caret(0, 0)],
				separatorColumn: COL50,
				kind: 'fenced',
			}),
		).toBeNull();
	});
});

describe('planInstantDot', () => {
	it('puts the inserted decimal on the separator column and leaves a neighbour transaction', () => {
		const text = [
			'2026-10-01 * "A"',
			'  Assets:Cash 12 USD',
			'2026-10-02 * "B"',
			'  Assets:Cash 34 USD',
		].join('\n');
		const caretAt = text.indexOf('12') + 2;
		const plan = planInstantDot(text, [{ anchor: caretAt, head: caretAt }], COL50);
		expect(plan).not.toBeNull();
		let next = text;
		for (const change of [...plan!.changes].sort((a, b) => b.from - a.from)) {
			next = next.slice(0, change.from) + change.insert + next.slice(change.to);
		}
		expect(next.split('\n')[1].indexOf('.')).toBe(49);
		expect(next.split('\n')[3]).toBe('  Assets:Cash 34 USD');
	});
});

describe('apply EditPlan', () => {
	it('rewrites the buffer in one transaction and parks a lone caret', () => {
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		const plan = planAlign(editor.getValue(), {
			carets: [caret(1, 15)],
			mode: 'block',
			separatorColumn: COL50,
		});
		applyToEditor(editor, plan);
		expect(editor.lines).toEqual([AT50_FOOD, AT50_CASH]);
		expect(editor.getCursor()).toEqual({ line: 1, ch: 47 });
		expect(editor.transactions).toHaveLength(1);
	});
});
