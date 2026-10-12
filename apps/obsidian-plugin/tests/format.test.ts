/**
 * Ledger formatting: invalid input is refused, original text that the model
 * drops (comments, blanks, number spelling, arithmetic) survives, and indent,
 * header spacing, and decimal alignment land in one idempotent pass.
 */
import { describe, expect, it } from 'vitest';
import { BeancountParser } from '@repo/beancount-parser';
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
	it('does not treat a quote in a posting comment as an open string', () => {
		const input = [
			'2020-01-01 open Assets:Cash',
			'2020-02-01 * "x"',
			'  Assets:Cash  -1 USD ; "',
			'    memo: "a',
			'  b"',
			'  Assets:Cash  1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2020-01-01 open Assets:Cash',
				'2020-02-01 * "x"',
				'  Assets:Cash -1 USD ; "',
				'    memo: "a',
				'  b"',
				'  Assets:Cash  1 USD',
				'',
			].join('\n')
		);
	});

	it('keeps a multi-line string at EOF, including its continuation indent', () => {
		expect(formatted('2020-01-01 open Assets:Cash\n  memo: "a\n    b"')).toBe(
			'2020-01-01 open Assets:Cash\n  memo: "a\n    b"'
		);
		expect(formatted('2020-01-01 query "q" "SELECT\n    a   b"')).toBe('2020-01-01 query "q" "SELECT\n    a   b"');
		expect(formatted('2020-02-01 * "payee\n    kept   spaces"')).toBe('2020-02-01 * "payee\n    kept   spaces"');
		expect(formatted('2020-02-01 * "x"\n  Assets:Cash 1 USD\n    memo: "a\n    kept   spaces"')).toBe(
			'2020-02-01 * "x"\n  Assets:Cash 1 USD\n    memo: "a\n    kept   spaces"'
		);
	});

	it('does not align a posting-shaped line inside a multi-line string', () => {
		const input = [
			'2020-02-01 * "x',
			'  Assets:Cash    10.5 USD',
			'"',
			'  Expenses:Food 1 USD',
			'  Assets:Cash -1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2020-02-01 * "x',
				'  Assets:Cash    10.5 USD',
				'"',
				'  Expenses:Food 1 USD',
				'  Assets:Cash  -1 USD',
				'',
			].join('\n')
		);
		expect(formatted('2020-01-01 query "q" "SELECT\n  Assets:Cash    10.5 USD\n"')).toBe(
			'2020-01-01 query "q" "SELECT\n  Assets:Cash    10.5 USD\n"'
		);
	});

	it('keeps spaces after an escaped quote in a header string', () => {
		expect(formatted('2026-10-01 * "a \\"  b"\n')).toBe('2026-10-01 * "a \\"  b"\n');
	});

	it('keeps a multi-line string open across an already-collapsed continuation', () => {
		// The opening line and the empty middle line have nothing to collapse.
		// Dropping the open-string state there would squeeze the last line.
		expect(
			formatted(
				['2026-10-01 * "payee', '', '    kept    spaces"', '  Assets:A 1 USD', '  Assets:B -1 USD', ''].join('\n')
			)
		).toBe(
			['2026-10-01 * "payee', '', '    kept    spaces"', '  Assets:A  1 USD', '  Assets:B -1 USD', ''].join('\n')
		);
		expect(
			formatted(
				[
					'2026-10-01 * "payee',
					'say \\" still',
					'    kept    spaces"',
					'  Assets:A 1 USD',
					'  Assets:B -1 USD',
					'',
				].join('\n')
			)
		).toBe(
			[
				'2026-10-01 * "payee',
				'say \\" still',
				'    kept    spaces"',
				'  Assets:A  1 USD',
				'  Assets:B -1 USD',
				'',
			].join('\n')
		);
	});

	it('finds each posting when metadata and comments sit between their location lines', () => {
		const input = [
			'2026-10-01 * "x"',
			'  Assets:Broker    2 AAPL {"lot',
			'    note inside"}',
			'    ; after cost',
			'    statement: "kept  spaces"',
			'  Assets:Cash   -2 AAPL',
			'  Expenses:Fees 1 USD',
			'',
		].join('\n');
		expect(formatted(input)).toBe(
			[
				'2026-10-01 * "x"',
				'  Assets:Broker 2 AAPL {"lot',
				'    note inside"}',
				'  ; after cost',
				'    statement: "kept  spaces"',
				'  Assets:Cash  -2 AAPL',
				'  Expenses:Fees 1 USD',
				'',
			].join('\n')
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

	it('keeps a carriage return that a fence body line carried into a CRLF body', () => {
		// Each body line ends in CR, so joining on LF makes a CRLF body. Formatting
		// must put that CR back; dropping it would leave a plain LF body.
		const note = '```beancount\n2022-01-01   open   Assets:A\r\r\n2022-01-02   close   Assets:B\r\r\n```\n';
		expect(formatFencedDocument(note)).toEqual({
			ok: true,
			text: '```beancount\n2022-01-01 open Assets:A\r\n2022-01-02 close Assets:B\r\n```\n',
		});
	});

});

describe('lineChanges', () => {
	it('emits one edit per whitespace run so a token between them is untouched', () => {
		const before = '2022-01-01   open   Assets:A\n';
		const after = formatted(before);
		const changes = lineChanges(before, after);
		expect(changes).toEqual([
			{ fromLine: 0, fromCh: 11, toLine: 0, toCh: 13, text: '' },
			{ fromLine: 0, fromCh: 18, toLine: 0, toCh: 20, text: '' },
		]);
		const lines = before.split('\n');
		const ordered = [...changes].sort((a, b) => b.fromCh - a.fromCh);
		for (const change of ordered) {
			const line = lines[change.fromLine];
			lines[change.fromLine] = line.slice(0, change.fromCh) + change.text + line.slice(change.toCh);
		}
		expect(lines.join('\n')).toBe(after);
		expect(before.slice(13, 17)).toBe('open');
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

	it('takes the rest of the line at the first non-whitespace mismatch', () => {
		expect(lineChanges('foo   bar baz', 'foo  XXX baz')).toEqual([
			{ fromLine: 0, fromCh: 5, toLine: 0, toCh: 6, text: '' },
			{ fromLine: 0, fromCh: 6, toLine: 0, toCh: 13, text: 'XXX baz' },
		]);
		expect(lineChanges('keep tail', 'keep OTHER')).toEqual([
			{ fromLine: 0, fromCh: 5, toLine: 0, toCh: 9, text: 'OTHER' },
		]);
	});

});

/** Parsed directives, without source locations, as JSON-stable data. */
function parsedModel(text: string): unknown {
	return JSON.parse(
		JSON.stringify(BeancountParser.parse(text).directives, (key, value) => (key === 'location' ? undefined : value))
	);
}

function assertFormatStable(text: string): void {
	const result = formatLedger(text);
	expect(result.ok, text).toBe(true);
	if (!result.ok) return;
	expect(parsedModel(result.text), text).toEqual(parsedModel(text));
	expect(formatLedger(result.text), text).toEqual({ ok: true, text: result.text });
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Spacing variants of the edges the formatter must not reinterpret. */
function seededLedger(rand: () => number, n: number): string {
	const gap = rand() < 0.3 ? '\t' : ' '.repeat(1 + Math.floor(rand() * 4));
	const lines = ['2020-01-01 open Assets:Cash', '2020-01-01 open Expenses:Food'];
	const day = String(1 + (n % 27)).padStart(2, '0');
	const date = `2020-03-${day}`;
	const kind = rand();
	if (kind < 0.25) {
		lines.push(`${date}${gap}*${gap}"x`);
		lines.push('  Assets:Cash    10.5 USD');
		lines.push('"');
	} else if (kind < 0.5) {
		lines.push(`${date}${gap}*${gap}"a \\"  b"`);
	} else {
		lines.push(`${date}${gap}*${gap}"shop"${gap}; "keep  me"`);
	}
	if (rand() < 0.4) {
		lines.push(`  Assets:Cash${gap}-1 USD ; "`);
		lines.push('    memo: "a');
		lines.push('  b"');
		lines.push(`  Expenses:Food${gap}1 USD`);
	} else {
		lines.push(`  Expenses:Food${gap}1.00 USD`);
		lines.push('    note: "a\\tb; c"');
		lines.push(`  Assets:Cash${gap}-1.00 USD`);
	}
	if (rand() < 0.3) {
		lines.push('2020-01-02 query "q" "SELECT');
		lines.push('  Assets:Cash    10.5 USD');
		lines.push('"');
	}
	return lines.join('\n') + (rand() < 0.5 ? '\n' : '');
}

const FORMAT_CORPUS = [
	'',
	'\n',
	'2020-01-01 open Assets:Cash\n  memo: "a\n    b"',
	'2020-01-01 query "q" "SELECT\n  Assets:Cash    10.5 USD\n"',
	'2020-02-01 * "x\n  Assets:Cash    10.5 USD\n"',
	'2020-02-01 * "x"\n  Assets:Cash  1 USD\n    memo: "a\n    b"',
	'2020-01-01 open Assets:Cash\n2020-02-01 * "x"\n  Assets:Cash  -1 USD ; "\n    memo: "a\n  b"\n  Assets:Cash  1 USD\n',
	'2026-10-01 * "a \\"  b"\n',
	'2022-01-01   open   Assets:A USD,EUR   ;"not a string\n',
	'2022-01-15 * "x"\n  Assets:A 1 USD {"a\\"b\n  and\\\nc"}  \n  Assets:B -1 USD\n',
	';  keep   spaces\n\n*  Section\n\n2026-10-01 * "A"\n  Assets:Broker    2 * 3.00 USD\n  Assets:Cash  -1,000.50 USD\n',
	'2022-01-01 open Assets:A\r\n  name: "Main  "\r\n',
];

describe('formatLedger stability', () => {
	it('preserves the parsed model and is idempotent on a seeded corpus', () => {
		const rand = mulberry32(0x5eed2026);
		const ledgers = FORMAT_CORPUS.slice();
		for (let i = 0; i < 24; i += 1) ledgers.push(seededLedger(rand, i));
		for (const text of ledgers) assertFormatStable(text);
	});
});
