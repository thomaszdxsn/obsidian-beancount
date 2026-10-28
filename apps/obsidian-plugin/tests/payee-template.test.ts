/**
 * Payee posting templates: the latest transaction per payee, how those
 * postings become an insert, and what picking a suggestion does to the editor.
 */
import { describe, expect, it, vi } from 'vitest';
import type { App, Editor, EditorSuggestContext, TFile } from 'obsidian';
import { PayeeSuggest, planPayeeAutofill } from '../payee-suggest';
import type { PayeeAutofill } from '../payee-suggest';
import { buildPayeeAutofill } from '../payee-template';
import type { TemplatePosting } from '../payee-template';
import { SnippetSession } from '../snippet-suggest';
import { createEditor } from './fakes';
import type { FakeEditor, FakePosition } from './fakes';

function posting(partial: Partial<TemplatePosting> & Pick<TemplatePosting, 'account'>): TemplatePosting {
	return { leadingFlag: '', trailingFlag: '', ...partial };
}

describe('buildPayeeAutofill', () => {
	it('collapses two opposite amounts in one commodity to the first amount', () => {
		const body = buildPayeeAutofill([
			posting({ account: 'Expenses:Food', amount: '1,000.00 USD' }),
			posting({ account: 'Assets:Cash', trailingFlag: '*', amount: '-1000.00 USD' }),
		]);
		expect(body?.text).toBe('\n  Expenses:Food  1,000.00 USD\n  Assets:Cash *');
		expect(body?.stops).toEqual([
			{
				index: 1,
				from: body!.text.indexOf('1,000.00'),
				to: body!.text.indexOf('1,000.00') + '1,000.00'.length,
			},
		]);
	});

	it('keeps a single implicit leg account-only and the explicit amount where it was', () => {
		const onFirst = buildPayeeAutofill([
			posting({ leadingFlag: '!', account: 'Expenses:Food', amount: '12.50 USD' }),
			posting({ account: 'Assets:Cash' }),
		]);
		expect(onFirst?.text).toBe('\n  ! Expenses:Food  12.50 USD\n  Assets:Cash');
		expect(onFirst?.stops).toHaveLength(1);

		const onSecond = buildPayeeAutofill([
			posting({ account: 'Expenses:Food' }),
			posting({ account: 'Assets:Cash', amount: '-12.50 USD' }),
		]);
		expect(onSecond?.text).toBe('\n  Expenses:Food\n  Assets:Cash  -12.50 USD');
		expect(onSecond?.stops).toHaveLength(1);
		expect(onSecond?.text.slice(onSecond.stops[0].from, onSecond.stops[0].to)).toBe('-12.50');
	});

	it('keeps every amount of a multi-leg transaction and of a non-balancing pair', () => {
		const multi = buildPayeeAutofill([
			posting({ account: 'Expenses:Food', amount: '10.00 USD' }),
			posting({ account: 'Expenses:Tip', amount: '2.00 USD' }),
			posting({ account: 'Assets:Cash', amount: '-12.00 USD' }),
		]);
		expect(multi?.stops).toHaveLength(3);
		expect(multi?.text).toBe('\n  Expenses:Food  10.00 USD\n  Expenses:Tip  2.00 USD\n  Assets:Cash  -12.00 USD');

		const priced = buildPayeeAutofill([
			posting({ account: 'Assets:Stocks', amount: '10 HOOL {500.00 USD}' }),
			posting({ account: 'Assets:Cash', amount: '-5000.00 USD' }),
		]);
		expect(priced?.stops).toHaveLength(2);
		expect(priced?.text).toContain('10 HOOL {500.00 USD}');
		expect(priced?.text.slice(priced.stops[0].from, priced.stops[0].to)).toBe('10');
	});

	it('keeps a non-ASCII account and does not collapse different commodities', () => {
		const body = buildPayeeAutofill([
			posting({ account: 'Expenses:餐饮', amount: '10.00 USD' }),
			posting({ account: 'Assets:Cash', amount: '-10.00 EUR' }),
		]);
		expect(body?.text).toBe('\n  Expenses:餐饮  10.00 USD\n  Assets:Cash  -10.00 EUR');
		expect(body?.stops).toHaveLength(2);
	});

	it('inserts a cost-only amount verbatim and does not make it a tab stop', () => {
		const body = buildPayeeAutofill([
			posting({ account: 'Assets:Stocks', amount: '{500.00 USD}' }),
			posting({ account: 'Assets:Cash' }),
		]);
		expect(body?.text).toBe('\n  Assets:Stocks  {500.00 USD}\n  Assets:Cash');
		expect(body?.stops).toEqual([]);
	});
});

function applyReplacements(editor: FakeEditor): string {
	let text = editor.lines.join('\n');
	for (const replacement of editor.replacements) {
		const current = text.split('\n');
		const from = offsetAt(current, replacement.from);
		const to = offsetAt(current, replacement.to ?? replacement.from);
		text = text.slice(0, from) + replacement.replacement + text.slice(to);
	}
	return text;
}

function offsetAt(lines: readonly string[], pos: FakePosition): number {
	let offset = 0;
	for (let line = 0; line < pos.line; line += 1) offset += lines[line].length + 1;
	return offset + pos.ch;
}

function pick(lines: string[], payee: string, query: string, autofill: PayeeAutofill, ch?: number): {
	text: string;
	editor: FakeEditor;
	session: SnippetSession;
} {
	const editor = createEditor(lines);
	const suggest = new PayeeSuggest({} as App, { match: () => [payee] }, () => true, autofill);
	const cursor = ch ?? lines[0].length;
	const start = cursor - query.length;
	suggest.context = {
		start: { line: 0, ch: start },
		end: { line: 0, ch: cursor },
		query,
		editor: editor as unknown as Editor,
		file: {} as TFile,
	} as EditorSuggestContext;
	suggest.selectSuggestion(payee, {} as MouseEvent);
	return { text: applyReplacements(editor), editor, session: autofill.session };
}

function host(postings: readonly TemplatePosting[] | null, enabled = true): PayeeAutofill {
	return {
		enabled: () => enabled,
		templateFor: () => postings,
		session: new SnippetSession(),
	};
}

const TWO_LEG: readonly TemplatePosting[] = [
	posting({ account: 'Expenses:Food', amount: '12.50 USD' }),
	posting({ account: 'Assets:Cash', amount: '-12.50 USD' }),
];

describe('payee autofill on select', () => {
	it('closes an unclosed payee before inserting postings and selects the amount', () => {
		const applied = pick(['2026-10-04 * "Ca'], 'Cafe', 'Ca', host(TWO_LEG));
		// The closer is part of the pick: without it the postings are inside the string.
		expect(applied.text).toBe('2026-10-04 * "Cafe"\n  Expenses:Food  12.50 USD\n  Assets:Cash');
		expect(applied.editor.selections).toEqual([{ anchor: { line: 1, ch: 17 }, head: { line: 1, ch: 22 } }]);
		expect(applied.text.split('\n')[1].slice(17, 22)).toBe('12.50');
		expect(applied.session.active).toBe(true);
	});

	it('writes the payee and the postings in one transaction', () => {
		const editor = createEditor(['2026-10-04 * "Ca']);
		const seen: Array<{ changes: unknown; selection?: { from: FakePosition; to?: FakePosition } }> = [];
		const transaction = editor.transaction.bind(editor);
		editor.transaction = (tx) => {
			seen.push(tx);
			transaction(tx);
		};
		const autofill = host(TWO_LEG);
		const suggest = new PayeeSuggest({} as App, { match: () => ['Cafe'] }, () => true, autofill);
		suggest.context = {
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 16 },
			query: 'Ca',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		// Two replaceRange calls would be two undo steps; the first Cmd-Z
		// would leave the snippet session on offsets the document no longer has.
		expect(editor.replacements).toEqual([]);
		expect(seen).toEqual([
			{
				changes: [
					{ from: { line: 0, ch: 14 }, to: { line: 0, ch: 16 }, text: 'Cafe"' },
					{
						from: { line: 0, ch: 16 },
						to: { line: 0, ch: 16 },
						text: '\n  Expenses:Food  12.50 USD\n  Assets:Cash',
					},
				],
				selection: { from: { line: 1, ch: 17 }, to: { line: 1, ch: 22 } },
			},
		]);
		expect(applyReplacements(editor)).toBe('2026-10-04 * "Cafe"\n  Expenses:Food  12.50 USD\n  Assets:Cash');
		expect(editor.selections).toEqual([{ anchor: { line: 1, ch: 17 }, head: { line: 1, ch: 22 } }]);
		expect(autofill.session.active).toBe(true);
	});

	it('counts the inserted closer in the amount stop', () => {
		const plan = planPayeeAutofill({
			lines: ['2026-10-04 * "Ca'],
			line: 0,
			startCh: 14,
			endCh: 16,
			payee: 'Cafe',
			enabled: true,
			postings: TWO_LEG,
		});
		const header = '2026-10-04 * "Cafe"';
		expect(plan?.atCh).toBe(header.length);
		const doc = header + (plan?.insert ?? '');
		const stop = plan?.stops[0];
		expect(doc.slice(stop?.from, stop?.to)).toBe('12.50');
	});

	it('lands in the narration quotes and tabs to the amount stop', () => {
		const applied = pick(['2026-10-04 * "" ""'], 'Cafe', '', host(TWO_LEG), 14);
		expect(applied.text).toBe('2026-10-04 * "Cafe" ""\n  Expenses:Food  12.50 USD\n  Assets:Cash');
		expect(applied.editor.selections).toEqual([{ anchor: { line: 0, ch: 21 }, head: { line: 0, ch: 21 } }]);
		expect(applied.text.slice(21, 22)).toBe('"');
		const next = applied.session.advance(offsetAt(applied.text.split('\n'), applied.editor.selections[0].head));
		expect(next).not.toBeNull();
		expect(applied.text.slice(next!.from, next!.to)).toBe('12.50');
	});

	it('does not rewrite an existing narration', () => {
		const applied = pick(['2026-10-04 * "Ca" "lunch"'], 'Cafe', 'Ca', host(TWO_LEG), 16);
		expect(applied.text.startsWith('2026-10-04 * "Cafe" "lunch"\n  Expenses:Food  12.50 USD\n')).toBe(true);
		expect(applied.editor.selections[0]).toEqual({ anchor: { line: 0, ch: 21 }, head: { line: 0, ch: 21 } });
		expect(applied.text.slice(21, 26)).toBe('lunch');
	});

	it('fills a blank continuation and the end of the buffer', () => {
		const blank = pick(['2026-10-04 * "Ca', ''], 'Cafe', 'Ca', host(TWO_LEG));
		expect(blank.text).toBe('2026-10-04 * "Cafe"\n  Expenses:Food  12.50 USD\n  Assets:Cash\n');
		const eof = pick(['2026-10-04 * "Ca'], 'Cafe', 'Ca', host(TWO_LEG));
		expect(eof.text).toBe('2026-10-04 * "Cafe"\n  Expenses:Food  12.50 USD\n  Assets:Cash');
	});

	it('fills inside a beancount fence when the next line is the closing marker', () => {
		const editor = createEditor(['```beancount', '2026-10-04 * "Ca', '```']);
		const autofill = host(TWO_LEG);
		const suggest = new PayeeSuggest({} as App, { match: () => ['Cafe'] }, () => true, autofill);
		suggest.context = {
			start: { line: 1, ch: 14 },
			end: { line: 1, ch: 16 },
			query: 'Ca',
			editor: editor as unknown as Editor,
			file: { extension: 'md' } as TFile,
		} as EditorSuggestContext;
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		expect(applyReplacements(editor)).toBe(
			'```beancount\n2026-10-04 * "Cafe"\n  Expenses:Food  12.50 USD\n  Assets:Cash\n```'
		);
		// Insert is the pre-edit end of the header (ch 16), not the post-edit column.
		expect(editor.replacements).toEqual([]);
		expect(editor.transactions).toEqual([
			[
				{ from: { line: 1, ch: 14 }, to: { line: 1, ch: 16 }, text: 'Cafe"' },
				{
					from: { line: 1, ch: 16 },
					to: { line: 1, ch: 16 },
					text: '\n  Expenses:Food  12.50 USD\n  Assets:Cash',
				},
			],
		]);
		expect(autofill.session.active).toBe(true);
	});

	it('does not fill when postings already exist or the setting is off', () => {
		const continued = pick(['2026-10-04 * "Ca', '  Expenses:Old  1 USD'], 'Cafe', 'Ca', host(TWO_LEG));
		expect(continued.text).toBe('2026-10-04 * "Cafe"\n  Expenses:Old  1 USD');
		expect(continued.editor.replacements).toHaveLength(1);
		expect(continued.session.active).toBe(false);

		const off = pick(['2026-10-04 * "Ca'], 'Cafe', 'Ca', host(TWO_LEG, false));
		expect(off.text).toBe('2026-10-04 * "Cafe"');
		expect(off.session.active).toBe(false);

		const unknown = pick(['2026-10-04 * "Ca'], 'Cafe', 'Ca', host(null));
		expect(unknown.text).toBe('2026-10-04 * "Cafe"');
	});

	it('still closes the popover after filling', () => {
		const editor = createEditor(['2026-10-04 * "Ca']);
		const suggest = new PayeeSuggest({} as App, { match: () => ['Cafe'] }, () => true, host(TWO_LEG));
		suggest.context = {
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 16 },
			query: 'Ca',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		expect(close).toHaveBeenCalledOnce();
	});
});
