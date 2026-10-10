import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import type { MockViewPlugin } from './mocks/codemirror';
import { BalanceInlayController, INFERRED_HINT_CLASS, UNBALANCED_HINT_CLASS } from '../inlay-hints';
import { postingHints } from '../posting-hints';
import type { PostingHint } from '../posting-hints';

vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});
const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;

const hints = (...lines: string[]) => postingHints(lines);

function inferred(line: number, label: string, aligned = true): PostingHint {
	return { line, kind: 'inferred', label, aligned };
}

function unbalanced(line: number, label: string): PostingHint {
	return { line, kind: 'unbalanced', label, aligned: false };
}

describe('posting amount hints', () => {
	it('does not annotate a two-leg transaction of one commodity', () => {
		expect(hints('2026-01-01 * "Shop"', '  Assets:Cash  10.00 USD', '  Expenses:Food')).toEqual([]);
		expect(hints('2026-01-01 txn "Shop"', '  Expenses:Food', '  Assets:Cash  -10 USD')).toEqual([]);
	});

	it('infers the omitted leg of a three-posting transaction at the previous decimal', () => {
		// `  Assets:A  10.00 USD` puts the dot at column 14; `  Assets:C` is 10 wide;
		// `-30.00` 's dot is 3 in, so one space lands it on that column.
		expect(
			hints(
				'2026-01-01 * "Shop"',
				'  Assets:A  10.00 USD',
				'  Assets:B  20.00 USD',
				'  Assets:C'
			)
		).toEqual([inferred(3, ' -30.00 USD')]);
	});

	it('quantizes the inferred amount to the coarsest fractional precision and drops thousands separators', () => {
		expect(
			hints(
				'2026-01-01 * "Shop"',
				'  Assets:A  1,000.50 USD',
				'  Assets:B  0.5 USD',
				'  Assets:C'
			)
		).toEqual([inferred(3, ' -1001.0 USD')]);
		// Half-even: 10.125 → 10.12 (2 even), 10.135 → 10.14 (3 odd), 10.126 is not a tie.
		expect(
			hints('2026-01-01 * "Shop"', '  Expenses:A  10.00 USD', '  Expenses:B  0.125 USD', '  Assets:Cash')
		).toEqual([inferred(3, ' -10.12 USD')]);
		expect(
			hints('2026-01-01 * "Shop"', '  Expenses:A  10.00 USD', '  Expenses:B  0.135 USD', '  Assets:Cash')
		).toEqual([inferred(3, ' -10.14 USD')]);
		expect(
			hints('2026-01-01 * "Shop"', '  Expenses:A  10.00 USD', '  Expenses:B  0.126 USD', '  Assets:Cash')
		).toEqual([inferred(3, ' -10.13 USD')]);
		// Integer-only commodities have no quantum.
		expect(hints('2026-01-01 * "Int"', '  Expenses:A  10 USD', '  Expenses:B  1 USD', '  Assets:Cash')).toEqual([
			inferred(3, ' -11 USD'),
		]);
		// A residual that rounds to zero at the coarsest precision is a cancel, not a third commodity.
		expect(
			hints(
				'2026-01-01 * "Fx"',
				'  Assets:A  10.00 USD',
				'  Assets:B  -10.004 USD',
				'  Assets:C  5 EUR',
				'  Assets:D'
			).map((hint) => hint.label.trim())
		).toEqual(['-5 EUR']);
		expect(
			hints('2026-01-01 * "Round"', '  Assets:A  10.00 USD', '  Assets:B  -10.004 USD', '  Assets:C').map(
				(hint) => hint.label.trim()
			)
		).toEqual(['0.00 USD']);
	});

	it('joins a multi-commodity residual in appearance order', () => {
		expect(
			hints(
				'2026-01-01 * "Fx"',
				'  Expenses:A  10.00 USD',
				'  Expenses:B  5 EUR',
				'  Assets:Cash'
			)
		).toEqual([inferred(3, ' -10.00 USD, -5 EUR')]);
	});

	it('leaves a commodity that already cancels out of a multi-commodity residual', () => {
		expect(
			hints(
				'2026-01-01 * "Fx"',
				'  Assets:Cash  -10 USD',
				'  Assets:Card  10 USD',
				'  Assets:Broker  5 EUR',
				'  Assets:Other'
			).map((hint) => hint.label.trim())
		).toEqual(['-5 EUR']);
	});

	it('shows a quoted commodity as written', () => {
		expect(
			hints(
				'2026-01-01 * "Stock"',
				'  Assets:Broker  2 "HOOL"',
				'  Assets:Broker  3 "HOOL"',
				'  Expenses:Fees'
			)
		).toEqual([inferred(3, ' -5 "HOOL"')]);
	});

	it('aligns to the nearest earlier amount, not a later one', () => {
		expect(
			hints(
				'2026-01-01 * "Shop"',
				'  Assets:A  10.00 USD',
				'  Assets:C',
				'  Assets:B    20.00 USD'
			)
		).toEqual([inferred(2, ' -30.00 USD')]);
	});

	it('pads a leading omitted posting to the separator column when one is configured', () => {
		const lines = ['2026-01-01 * "Shop"', '  Assets:C', '  Assets:A  10.00 USD', '  Assets:B  20.00 USD'];
		expect(postingHints(lines)).toEqual([inferred(1, '-30.00 USD', false)]);
		// Column 20 is 0-based 19; the line is 10 wide and `-30.00` 's dot is at 3.
		expect(postingHints(lines, { separatorColumn: 20 })).toEqual([inferred(1, '      -30.00 USD')]);
	});

	it('uses one space when the account already passes the amount column', () => {
		expect(
			hints(
				'2026-01-01 * "Shop"',
				'  Assets:A  10.00 USD',
				'  Assets:B  20.00 USD',
				'  Assets:Checking:VeryLong'
			)
		).toEqual([inferred(3, ' -30.00 USD')]);
	});

	it('gives a positive inferred amount the extra space the missing minus would have taken', () => {
		expect(
			hints(
				'2026-01-01 * "Refund"',
				'  Assets:A  -10.00 USD',
				'  Assets:B  -20.00 USD',
				'  Income:C'
			)
		).toEqual([inferred(3, '   30.00 USD')]);
	});

	it('measures wide account characters when placing the decimal', () => {
		// `  Expenses:餐饮  10.00` — 餐饮 is two cells each, so the dot sits at column 19.
		expect(
			hints(
				'2026-01-01 * "Lunch"',
				'  Assets:A  1 USD',
				'  Expenses:餐饮  10.00 USD',
				'  Assets:B'
			)
		).toEqual([inferred(3, '      -11.00 USD')]);
	});

	it('shows a zero interpolation when the other legs already cancel', () => {
		expect(
			hints(
				'2026-01-01 * "Shop"',
				'  Assets:A  10.00 USD',
				'  Assets:B  -10.00 USD',
				'  Assets:C'
			)
		).toEqual([inferred(3, '    0.00 USD')]);
	});

	it('does not hint cost, price, or arithmetic', () => {
		const header = '2026-01-01 * "Trade"';
		expect(hints(header, '  Assets:Broker  1 HOOL {500.00 USD}', '  Assets:Cash  -500.00 USD', '  Expenses:Fees')).toEqual(
			[]
		);
		expect(hints(header, '  Assets:Broker  1 HOOL @ 500.00 USD', '  Assets:Cash', '  Expenses:Fees  1 USD')).toEqual([]);
		expect(hints(header, '  Assets:Broker  2 HOOL @@ 500 USD', '  Assets:Cash', '  Expenses:Fees  1 USD')).toEqual([]);
		expect(hints(header, '  Expenses:A  2 * 3.00 USD', '  Expenses:B  1.00 USD', '  Assets:Cash')).toEqual([]);
		expect(hints(header, '  Expenses:A  10 + 5 USD', '  Assets:Cash  -15 USD')).toEqual([]);
	});

	it('warns when every posting has an amount and a commodity is nonzero', () => {
		expect(hints('2026-01-01 * "Off"', '  Assets:A  10.00 USD', '  Assets:B  -9.00 USD')).toEqual([
			unbalanced(0, '≠ 0: 1.00 USD'),
		]);
		expect(hints('2026-01-01 * "One"', '  Assets:Cash  10 USD')).toEqual([unbalanced(0, '≠ 0: 10 USD')]);
		expect(
			hints(
				'2026-01-01 * "Mix"',
				'  Assets:A  10.00 USD',
				'  Assets:B  -9.00 USD',
				'  Assets:C  2 EUR',
				'  Assets:D  -1 EUR'
			)
		).toEqual([unbalanced(0, '≠ 0: 1.00 USD, 1 EUR')]);
	});

	it('accepts a residual within half a unit of the coarsest written precision, like beancount', () => {
		expect(hints('2026-01-01 * "Ok"', '  Assets:A  1.00 USD', '  Assets:B  -1 USD')).toEqual([]);
		expect(hints('2026-01-01 * "Ok"', '  Assets:A  10.00 USD', '  Expenses:B  -10.00 USD')).toEqual([]);
		// `.00` allows ±0.005: 0.001 and exactly 0.005 balance, 0.006 does not.
		expect(hints('2026-01-01 * "Tol"', '  Assets:A  1.001 USD', '  Assets:B  -1.00 USD')).toEqual([]);
		expect(hints('2026-01-01 * "Tol"', '  Assets:A  1.005 USD', '  Assets:B  -1.00 USD')).toEqual([]);
		expect(hints('2026-01-01 * "Off"', '  Assets:A  1.006 USD', '  Assets:B  -1.00 USD')).toEqual([
			unbalanced(0, '≠ 0: 0.006 USD'),
		]);
		// Integer-only amounts carry no tolerance. A fractional amount does not
		// inherit tolerance from an integer leg, and an integer leg adds none:
		// 1.30 − 1 is 0.30, far outside half a cent.
		expect(hints('2026-01-01 * "Int"', '  Assets:A  2 USD', '  Assets:B  -1 USD')).toEqual([
			unbalanced(0, '≠ 0: 1 USD'),
		]);
		expect(hints('2026-01-01 * "Gap"', '  Assets:A  1.30 USD', '  Assets:B  -1 USD')).toEqual([
			unbalanced(0, '≠ 0: 0.30 USD'),
		]);
	});

	it('omits a balanced commodity from a mixed residual', () => {
		expect(
			hints(
				'2026-01-01 * "Mix"',
				'  Assets:A  10 USD',
				'  Assets:B  -10 USD',
				'  Assets:C  1 EUR',
				'  Assets:D  -1 EUR'
			)
		).toEqual([]);
		expect(
			hints(
				'2026-01-01 * "Mix"',
				'  Assets:A  10 USD',
				'  Assets:B  -10 USD',
				'  Assets:C  2 EUR',
				'  Assets:D  -1 EUR'
			)
		).toEqual([unbalanced(0, '≠ 0: 1 EUR')]);
	});

	it('reads posting flags, metadata, tags, and indented comments as not amounts', () => {
		expect(
			hints(
				'2026-01-01 ! "Payee"',
				'  * Assets:A  10.00 USD',
				'    invoice: "9"',
				'  Expenses:Food ! 5.00 USD #lunch',
				'  ; not a posting',
				'  Liabilities:Card *'
			)
		).toEqual([inferred(5, ' -15.00 USD')]);
		expect(
			hints(
				'2026-01-01 * "Tagged"',
				'  Assets:A  10.00 USD #food ^r1',
				'  Assets:B  -10.00 USD'
			)
		).toEqual([]);
	});

	it('strips trailing comments before deciding cost or price', () => {
		expect(
			hints(
				'2026-01-01 * "Note"',
				'  Assets:A  10.00 USD  ; cost {1 USD} @ 2 EUR',
				'  Assets:B  -9.00 USD ; still plain'
			)
		).toEqual([unbalanced(0, '≠ 0: 1.00 USD')]);
	});

	it('ends the entry at a blank line or a column-0 comment', () => {
		expect(hints('2026-01-01 * "A"', '  Assets:A  10.00 USD', '', '  Assets:B  -10.00 USD')).toEqual([
			unbalanced(0, '≠ 0: 10.00 USD'),
		]);
		expect(hints('2026-01-01 * "A"', '  Assets:A  10.00 USD', '; split', '  Assets:B  -10.00 USD')).toEqual([
			unbalanced(0, '≠ 0: 10.00 USD'),
		]);
	});

	it('does not hint two omitted amounts, an unknown line, or an overflowing sum', () => {
		expect(hints('2026-01-01 * "A"', '  Assets:A  10 USD', '  Assets:B', '  Assets:C')).toEqual([]);
		expect(hints('2026-01-01 * "A"', '  Assets:A  10.00 USD', '  not a posting', '  Assets:B  -10.00 USD')).toEqual(
			[]
		);
		expect(
			hints(
				'2026-01-01 * "A"',
				'  Assets:A  9007199254740991 USD',
				'  Assets:B  1 USD',
				'  Assets:C'
			)
		).toEqual([]);
		expect(hints('2026-01-01 * "A"', '  Assets:A  9007199254740992 USD', '  Assets:B  -1 USD')).toEqual([]);
	});

	it('still hints a transaction in a file that includes another ledger', () => {
		expect(
			hints('include "other.bean"', '2026/01/01 * "A"', '  Assets:A  10.00 USD', '  Assets:B  -9.00 USD\r')
		).toEqual([unbalanced(1, '≠ 0: 1.00 USD')]);
	});
});

describe('posting hints in the editor', () => {
	function editor(text: string, extension = 'bean') {
		const controller = new BalanceInlayController({
			settings: { inlayHints: true, entryLedger: '', separatorColumn: 50 },
		});
		const file = { path: `ledger.${extension}`, extension };
		let plugin: { decorations: DecorationSet };
		const view = { state: { doc: Text.of(text.split('\n')), field: () => ({ file }) } };
		const spec = controller.extension as unknown as MockViewPlugin<{
			decorations: DecorationSet;
			update(u: ViewUpdate): void;
		}>;
		plugin = new spec.cls(view as never);
		const widgets: Array<{ at: number; text: string; className: string }> = [];
		for (let cursor = plugin.decorations.iter(); cursor.value; cursor.next()) {
			const widget = cursor.value.spec.widget as { label: string; className: string };
			widgets.push({ at: cursor.from, text: widget.label, className: widget.className });
		}
		return widgets;
	}

	it('places the warning on the header and the inferred amount on the posting, including inside a fence', () => {
		const body = ['2026-01-01 * "Shop"', '  Assets:A  10.00 USD', '  Assets:B  20.00 USD', '  Assets:C'].join('\n');
		expect(editor(body)).toEqual([{ at: body.length, text: ' -30.00 USD', className: INFERRED_HINT_CLASS }]);
		const prefix = '# Note\n```bean\n';
		expect(editor(prefix + body + '\n```\nprose', 'md')).toEqual([
			{ at: prefix.length + body.length, text: ' -30.00 USD', className: INFERRED_HINT_CLASS },
		]);
		const leading = ['2026-01-01 * "Shop"', '  Assets:C', '  Assets:A  10.00 USD', '  Assets:B  20.00 USD'].join('\n');
		expect(editor(leading)).toEqual([
			{
				at: '2026-01-01 * "Shop"\n  Assets:C'.length,
				text: ' '.repeat(36) + '-30.00 USD',
				className: INFERRED_HINT_CLASS,
			},
		]);
		expect(editor('2026-01-01 * "Off"\n  Assets:A  10.00 USD\n  Assets:B  -9.00 USD')).toEqual([
			{ at: '2026-01-01 * "Off"'.length, text: '≠ 0: 1.00 USD', className: UNBALANCED_HINT_CLASS },
		]);
	});
});
