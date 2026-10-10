/**
 * Ledger formatting: invalid input is refused, original text that the model
 * drops (comments, blanks, number spelling, arithmetic) survives, and indent,
 * header spacing, and decimal alignment land in one idempotent pass.
 */
import { describe, expect, it } from 'vitest';
import { formatErrorNotice, formatFencedDocument, formatLedger, lineChanges } from '../format';

function formatted(text: string): string {
	const result = formatLedger(text);
	expect(result.ok, JSON.stringify(result)).toBe(true);
	if (!result.ok) return text;
	return result.text;
}

describe('formatLedger', () => {
	it('returns the first syntax error and no rewritten text', () => {
		const bad = '2022-01-01 open\n2022-13-40 open Assets:A\n';
		const result = formatLedger(bad);
		expect(result).toEqual({
			ok: false,
			error: { line: 1, column: 15, message: "missing ACCOUNT at '\\n'" },
		});
		expect(formatErrorNotice(result.ok ? { line: 0, column: 0, message: '' } : result.error)).toBe(
			"Line 1: missing ACCOUNT at '\\n'"
		);
	});

	it('preserves comments, blank lines, arithmetic, and number spelling', () => {
		const input = [
			';  keep   spaces',
			'',
			'*  Section',
			'',
			'2026-10-01 * "A"',
			'  Assets:Broker    2 * 3.00 USD',
			'  Assets:Cash  -1,000.50 USD',
			'  Expenses:Food  1,000.50 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				';  keep   spaces',
				'',
				'*  Section',
				'',
				'2026-10-01 * "A"',
				'  Assets:Broker    2 * 3.00 USD',
				'  Assets:Cash  -1,000.50 USD',
				'  Expenses:Food 1,000.50 USD',
				'',
			].join('\n')
		);
	});

	it('normalizes posting, metadata, and indented-comment indents', () => {
		const input = [
			'2026-10-01 * "Shop"',
			'      invoice: "ab  c"',
			'\t#trip',
			'\tAssets:Checking    -10.00 USD',
			'      statement: "x"',
			'    ; keep me',
			'  Expenses:Food 10.00 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2026-10-01 * "Shop"',
				'  invoice: "ab  c"',
				'  #trip',
				'  Assets:Checking -10.00 USD',
				'    statement: "x"',
				'  ; keep me',
				'  Expenses:Food    10.00 USD',
				'',
			].join('\n')
		);
	});

	it('reindents a comment between posting metadata, not one under an open', () => {
		const input = [
			'2022-01-01 open Assets:A',
			'    ; open note',
			'  name: "Main"',
			'2026-10-01 * "x"',
			'  Assets:A 1 USD',
			'    meta: 1',
			'      ; inner',
			'    meta2: 2',
			'  Assets:B -1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2022-01-01 open Assets:A',
				'    ; open note',
				'  name: "Main"',
				'2026-10-01 * "x"',
				'  Assets:A  1 USD',
				'    meta: 1',
				'  ; inner',
				'    meta2: 2',
				'  Assets:B -1 USD',
				'',
			].join('\n')
		);
	});


	it('leaves an indented comment outside a transaction at its own indent', () => {
		const input = '    ; outside\n2022-01-01 open Assets:A\n';
		expect(formatted(input)).toBe(input);
	});

	it('collapses header whitespace without touching strings or the trailing comment', () => {
		const input = [
			'2026-10-01\t*\t"Say \\"hi\\""   "Weekly  shop"   #tag    ;  keep   me   ',
			'2022-01-01   open    Assets:A USD,EUR   ;"not a string',
			'2022-01-01   balance   Assets:A   100.00   ~   0.01   USD',
			'option   "title"   "My  Ledger"',
			'include   "my  file.bean"',
			'pushtag   #trip',
			'pushmeta   kk:   "v"',
			'popmeta   kk:',
			'poptag   #trip',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2026-10-01 * "Say \\"hi\\"" "Weekly  shop" #tag ;  keep   me',
				'2022-01-01 open Assets:A USD,EUR ;"not a string',
				'2022-01-01 balance Assets:A 100.00 ~ 0.01 USD',
				'option "title" "My  Ledger"',
				'include "my  file.bean"',
				'pushtag #trip',
				'pushmeta kk: "v"',
				'popmeta kk:',
				'poptag #trip',
				'',
			].join('\n')
		);
	});

	it('keeps a multi-line string, including spaces inside it, and still aligns', () => {
		const input = [
			'2022-01-01 note Assets:A "line1   ',
			'  line2"',
			'2022-01-15 * "x"',
			'  Assets:A 1 USD {"lab',
			'el"}',
			'    meta: 1',
			'  Assets:B -1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2022-01-01 note Assets:A "line1   ',
				'  line2"',
				'2022-01-15 * "x"',
				'  Assets:A 1 USD {"lab',
				'el"}',
				'    meta: 1',
				'  Assets:B -1 USD',
				'',
			].join('\n')
		);
	});

	it('aligns costs and prices without rewriting them', () => {
		const input = [
			'2022-01-15 * "x"',
			'\t* Assets:Broker  -2 AAPL {150.00 USD, 2022-01-01, "lot"} @ 7.2 CNY',
			'  Assets:Cash   2 AAPL {{300.00 USD}} @@ 14.40 CNY',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2022-01-15 * "x"',
				'  * Assets:Broker -2 AAPL {150.00 USD, 2022-01-01, "lot"} @ 7.2 CNY',
				'  Assets:Cash      2 AAPL {{300.00 USD}} @@ 14.40 CNY',
				'',
			].join('\n')
		);
	});

	it('is idempotent', () => {
		const input = [
			'2026-10-01    *   "Shop"   ',
			'    Expenses:餐饮 12.5 CNY',
			'\tAssets:现金\t-12.5 CNY   ',
			'  ; note',
			'',
		].join('\n');
		const once = formatted(input);
		expect(formatted(once)).toBe(once);
		expect(once).toBe(
			['2026-10-01 * "Shop"', '  Expenses:餐饮 12.5 CNY', '  Assets:现金  -12.5 CNY', '  ; note', ''].join('\n')
		);
	});

	it('strips trailing whitespace but not a missing final newline', () => {
		expect(formatted('2022-01-01 close Assets:A   ')).toBe('2022-01-01 close Assets:A');
	});

	it('formats an empty ledger without inventing a newline', () => {
		expect(formatted('')).toBe('');
		expect(formatted('\n')).toBe('\n');
		expect(formatted('\r\n')).toBe('\r\n');
		expect(formatted('   \t  ')).toBe('');
	});

	it('keeps CRLF and does not add a trailing newline that was not there', () => {
		expect(formatted('2022-01-01   open   Assets:A\r\n2022-01-02 close Assets:B')).toBe(
			'2022-01-01 open Assets:A\r\n2022-01-02 close Assets:B'
		);
	});

	it('treats a mix of CRLF and LF as LF', () => {
		expect(formatted('2022-01-01 open Assets:A\r\n2022-01-02   close   Assets:B\n')).toBe(
			'2022-01-01 open Assets:A\n2022-01-02 close Assets:B\n'
		);
	});

	it('keeps tabs and semicolons inside a multi-line header string', () => {
		const input = [
			'2026-10-01\t*\t"a\tb;  c',
			'  more"   #tag   ;  note  ',
			'  Assets:A 1 USD',
			'  Assets:B -1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2026-10-01 * "a\tb;  c',
				'  more" #tag ;  note',
				'  Assets:A  1 USD',
				'  Assets:B -1 USD',
				'',
			].join('\n')
		);
	});

	it('keeps a posting string open across a trailing backslash and still strips closed trailing space', () => {
		const input = [
			'2022-01-15 * "x"',
			'  Assets:A 1 USD {"a\\"b',
			'  and\\',
			'c"}  ',
			'  Assets:B -1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2022-01-15 * "x"',
				'  Assets:A 1 USD {"a\\"b',
				'  and\\',
				'c"}',
				'  Assets:B -1 USD',
				'',
			].join('\n')
		);
	});

	it('keeps a tab and semicolon inside posting metadata and strips the trailing space', () => {
		const input = ['2022-01-15 * "x"', '  Assets:A 1 USD', '    note: "a\tb; c"  ', '  Assets:B -1 USD', ''].join('\n');
		expect(formatted(input)).toBe(
			['2022-01-15 * "x"', '  Assets:A  1 USD', '    note: "a\tb; c"', '  Assets:B -1 USD', ''].join('\n')
		);
	});
});

describe('formatFencedDocument', () => {
	it('formats each fence on its own and leaves prose untouched', () => {
		const note = [
			'# title  ',
			'',
			'```beancount',
			'2026-10-01    *   "A"',
			'    Expenses:Food 1.00 USD',
			'    Assets:Cash -1.00 USD',
			'```',
			'',
			'A sentence with 2026-10-01 * "not ledger".',
			'',
			'~~~bean',
			'2026-10-02 * "B"',
			'  Expenses:Car 1234.50 USD',
			'  Assets:Cash -1234.50 USD',
			'~~~',
			'',
		].join('\n');
		const result = formatFencedDocument(note);
		expect(result).toEqual({
			ok: true,
			text: [
				'# title  ',
				'',
				'```beancount',
				'2026-10-01 * "A"',
				'  Expenses:Food 1.00 USD',
				'  Assets:Cash  -1.00 USD',
				'```',
				'',
				'A sentence with 2026-10-01 * "not ledger".',
				'',
				'~~~bean',
				'2026-10-02 * "B"',
				'  Expenses:Car 1234.50 USD',
				'  Assets:Cash -1234.50 USD',
				'~~~',
				'',
			].join('\n'),
		});
	});

	it('restores the fence opener indent stripped from the body', () => {
		const note = [
			'  ```beancount',
			'  2026-10-01    *   "Cafe"',
			'      Expenses:Food 12.50 CNY',
			'      Assets:Cash -12.50 CNY',
			'  ```',
			'',
		].join('\n');
		expect(formatFencedDocument(note)).toEqual({
			ok: true,
			text: [
				'  ```beancount',
				'  2026-10-01 * "Cafe"',
				'    Expenses:Food 12.50 CNY',
				'    Assets:Cash  -12.50 CNY',
				'  ```',
				'',
			].join('\n'),
		});
	});

	it('maps an error onto the document line and changes nothing', () => {
		const note = ['intro', '', '```beancount', '2022-01-01 open', '```', ''].join('\n');
		const result = formatFencedDocument(note);
		expect(result).toEqual({
			ok: false,
			error: { line: 4, column: 15, message: "missing ACCOUNT at '\\n'" },
		});
	});

	it('maps the column through an indented fence and refuses every fence', () => {
		const note = [
			'  ```beancount',
			'  2026-10-01 * "ok"',
			'    Assets:A 1 USD',
			'    Assets:B -1 USD',
			'  ```',
			'',
			'```bean',
			'2022-01-01 open',
			'```',
			'',
		].join('\n');
		// The valid fence must not come back formatted: a failure yields no text.
		expect(formatFencedDocument(note)).toEqual({
			ok: false,
			error: { line: 8, column: 15, message: "missing ACCOUNT at '\\n'" },
		});
	});

	it('maps the column of an error inside an indented fence', () => {
		const note = ['  ```beancount', '  2022-01-01 open', '  ```', ''].join('\n');
		expect(formatFencedDocument(note)).toEqual({
			ok: false,
			error: { line: 2, column: 17, message: "missing ACCOUNT at '\\n'" },
		});
	});

	it('leaves a note with no ledger fence, and an empty fence, unchanged', () => {
		expect(formatFencedDocument('# prose  \n')).toEqual({ ok: true, text: '# prose  \n' });
		expect(formatFencedDocument('```beancount\n```\n')).toEqual({ ok: true, text: '```beancount\n```\n' });
	});

	it('formats a 3-space CommonMark fence and restores a shorter body indent', () => {
		const note = ['   ```beancount', ' 2022-01-01   open   Assets:A', '   ```', ''].join('\n');
		expect(formatFencedDocument(note)).toEqual({
			ok: true,
			text: ['   ```beancount', ' 2022-01-01 open Assets:A', '   ```', ''].join('\n'),
		});
	});

	it('does not treat a 4-space or tab-indented opener as a fence', () => {
		const indented = ['    ```beancount', '    2022-01-01   open   Assets:A', '    ```', ''].join('\n');
		expect(formatFencedDocument(indented)).toEqual({ ok: true, text: indented });
		const tabbed = '\t```beancount\n2022-01-01   open   Assets:A\n```\n';
		expect(formatFencedDocument(tabbed)).toEqual({ ok: true, text: tabbed });
	});

	it('formats an unclosed fence without a phantom blank line from the trailing newline', () => {
		expect(formatFencedDocument('intro\n```beancount\n2022-01-01   open   Assets:A\n')).toEqual({
			ok: true,
			text: 'intro\n```beancount\n2022-01-01 open Assets:A\n',
		});
		expect(formatFencedDocument('```bean\n2022-01-01   close   Assets:A')).toEqual({
			ok: true,
			text: '```bean\n2022-01-01 close Assets:A',
		});
		expect(formatFencedDocument('```beancount\n2022-01-01   open   Assets:A\n\n')).toEqual({
			ok: true,
			text: '```beancount\n2022-01-01 open Assets:A\n\n',
		});
	});

	it('keeps CRLF around a fence and a missing final newline', () => {
		expect(formatFencedDocument('```beancount\r\n2022-01-01   open   Assets:A\r\n```\r\n')).toEqual({
			ok: true,
			text: '```beancount\r\n2022-01-01 open Assets:A\r\n```\r\n',
		});
		expect(formatFencedDocument('```beancount\n2022-01-01   open   Assets:A\n```')).toEqual({
			ok: true,
			text: '```beancount\n2022-01-01 open Assets:A\n```',
		});
	});

	it('maps an error in an unclosed fence and changes nothing', () => {
		expect(formatFencedDocument('intro\n```beancount\n2022-01-01 open\n')).toEqual({
			ok: false,
			error: { line: 3, column: 15, message: "missing ACCOUNT at '\\n'" },
		});
	});
});

describe('lineChanges', () => {
	it('rewrites only the changed span of a formatted line', () => {
		const before = '2022-01-01   open   Assets:A\n';
		const after = formatted(before);
		const changes = lineChanges(before, after);
		expect(changes).toEqual([{ fromLine: 0, fromCh: 11, toLine: 0, toCh: 19, text: 'open' }]);
		const lines = before.split('\n');
		for (const change of changes) {
			const line = lines[change.fromLine];
			lines[change.fromLine] = line.slice(0, change.fromCh) + change.text + line.slice(change.toCh);
		}
		expect(lines.join('\n')).toBe(after);
	});

	it('returns no edits when the text is unchanged', () => {
		expect(lineChanges('2022-01-01 open Assets:A\n', '2022-01-01 open Assets:A\n')).toEqual([]);
	});

	it('replaces the whole document when the line count changes', () => {
		expect(lineChanges('2022-01-01 open Assets:A\n', '2022-01-01 open Assets:A')).toEqual([
			{ fromLine: 0, fromCh: 0, toLine: 1, toCh: 0, text: '2022-01-01 open Assets:A' },
		]);
		expect(lineChanges('a\nb', 'a')).toEqual([{ fromLine: 0, fromCh: 0, toLine: 1, toCh: 1, text: 'a' }]);
	});
});
