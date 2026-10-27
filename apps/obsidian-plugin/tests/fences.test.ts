/**
 * Markdown ```beancount / ```bean fences are the notes' ledger: extract the
 * bodies, then map bean-check's temp-file lines back onto the host document.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type * as CMState from '@codemirror/state';
import { editorLedger, ledgerDoc, ledgerKind, ledgerKindFromPath, isSafeIncludePath } from '../fences';

const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;

/** CodeMirror `Text` with separate `iterLines` / `toString` counters. */
function cmDoc(lines: readonly string[]) {
	const text = Text.of(lines);
	let iters = 0;
	let strings = 0;
	return {
		get iters() {
			return iters;
		},
		get strings() {
			return strings;
		},
		toString() {
			strings += 1;
			return text.toString();
		},
		iterLines() {
			iters += 1;
			return text.iterLines();
		},
	};
}

describe('ledgerKind', () => {
	it('classifies bean and beancount as ledger-file and everything else as fenced', () => {
		expect(ledgerKind({ extension: 'bean' })).toBe('ledger-file');
		expect(ledgerKind({ extension: 'beancount' })).toBe('ledger-file');
		expect(ledgerKind({ extension: 'md' })).toBe('fenced');
		expect(ledgerKind({ extension: 'txt' })).toBe('fenced');
		expect(ledgerKind({ extension: undefined })).toBe('fenced');
		expect(ledgerKind(null)).toBe('fenced');
		expect(ledgerKind(undefined)).toBe('fenced');
	});

	it('classifies a vault path by its basename extension including Windows separators', () => {
		expect(ledgerKindFromPath('main.bean')).toBe('ledger-file');
		expect(ledgerKindFromPath('dir/x.beancount')).toBe('ledger-file');
		expect(ledgerKindFromPath('C:\\vault\\note.md')).toBe('fenced');
		expect(ledgerKindFromPath('readme.txt')).toBe('fenced');
	});
});

describe('ledgerDoc', () => {
	it('treats a ledger file as one region of the whole buffer', () => {
		const text = 'PG_DATA_DIR:-x\n; comment\n2020-01-01 open Assets:Cash\n';
		const doc = ledgerDoc('ledger-file', text);
		expect(doc.kind).toBe('ledger-file');
		expect(doc.regions).toEqual([
			{
				hostStartLine: 0,
				hostIndent: 0,
				lines: ['PG_DATA_DIR:-x', '; comment', '2020-01-01 open Assets:Cash', ''],
			},
		]);
		expect(doc.ledgerSource()).toBe(text);
		expect(doc.lineIsLedger(0)).toBe(true);
		expect(doc.lineIsLedger(2)).toBe(true);
		const temp = doc.tempLedger();
		expect(temp.text).toBe('PG_DATA_DIR:-x\n; comment\n2020-01-01 open Assets:Cash\n\n');
		expect(temp.hostLine(1)).toBe(1);
		expect(temp.hostLine(3)).toBe(3);
	});

	it('joins two fence bodies in ledgerSource and blanks between them in tempLedger', () => {
		const note = [
			'Prose Notes:Here',
			'```beancount',
			'2020-01-01 open Assets:Cash',
			'```',
			'```python',
			'Python:Code = 1',
			'```',
			'~~~bean',
			'  Expenses:Food  1 USD',
			'~~~',
		].join('\n');
		const doc = ledgerDoc('fenced', note);
		expect(doc.ledgerSource()).toBe('2020-01-01 open Assets:Cash\n  Expenses:Food  1 USD');
		const temp = doc.tempLedger();
		expect(temp.text).toBe('2020-01-01 open Assets:Cash\n\n  Expenses:Food  1 USD\n');
		expect(temp.hostLine(1)).toBe(3);
		expect(temp.hostLine(2)).toBeUndefined();
		expect(temp.hostLine(3)).toBe(9);
	});

	it('keeps an empty fence body as a region whose opener and closer are not ledger text', () => {
		const doc = ledgerDoc('fenced', '```beancount\n```\n');
		expect(doc.regions).toEqual([{ hostStartLine: 1, hostIndent: 0, lines: [] }]);
		expect(doc.lineIsLedger(0)).toBe(false);
		expect(doc.lineIsLedger(1)).toBe(false);
		expect(doc.ledgerSource()).toBe('');
	});

	it('is not ledger text on the prose line after a closing fence', () => {
		const text = ['```beancount', '2026-01-01 open Assets:Cash', '```', 'prose after'].join('\n');
		const doc = ledgerDoc('fenced', text);
		expect(doc.lineIsLedger(1)).toBe(true);
		expect(doc.lineIsLedger(2)).toBe(false);
		expect(doc.lineIsLedger(3)).toBe(false);
	});

	it('records opener indent 0–3 and rejects a four-space or tab opener', () => {
		expect(ledgerDoc('fenced', '  ```beancount\n  2026-10-01 open Assets:Cash\n  ```\n').regions).toEqual([
			{ hostStartLine: 1, hostIndent: 2, lines: ['2026-10-01 open Assets:Cash'] },
		]);
		expect(ledgerDoc('fenced', '   ```bean\n   2026-01-01 open Assets:Cash\n   ```').regions).toEqual([
			{ hostStartLine: 1, hostIndent: 3, lines: ['2026-01-01 open Assets:Cash'] },
		]);
		expect(ledgerDoc('fenced', '    ```bean\n    2026-01-01 open Assets:Cash\n    ```').regions).toEqual([]);
		expect(ledgerDoc('fenced', '\t```bean\n\t2026-01-01 open Assets:Cash\n\t```').regions).toEqual([]);
	});

	it('accepts bean/beancount info strings, tildes, unclosed fences, nested four-backtick, and inline ticks', () => {
		const info = ['~~~bean linenums', '2026-10-01 * "A"', '~~~', '', '```Beancount', '2026-10-02 * "B"', '```'].join('\n');
		expect(ledgerDoc('fenced', info).regions.map((region) => region.lines)).toEqual([
			['2026-10-01 * "A"'],
			['2026-10-02 * "B"'],
		]);
		expect(ledgerDoc('fenced', '```javascript\nconst x = 1\n```\n').regions).toEqual([]);
		expect(ledgerDoc('fenced', '```beancounter\nnope\n```\n').regions).toEqual([]);
		const nested = [
			'````text',
			'```bean',
			'2026-01-01 balance Assets:Cash 12 USD',
			'```',
			'````',
			'~~~bean',
			'2026-01-02 balance Assets:Cash 14 USD',
			'~~~',
		].join('\n');
		expect(ledgerDoc('fenced', nested).regions).toEqual([
			{ hostStartLine: 6, hostIndent: 0, lines: ['2026-01-02 balance Assets:Cash 14 USD'] },
		]);
		expect(ledgerDoc('fenced', ['```x```', '```bean', '2026-01-01 balance Assets:Cash 1 USD', '```'].join('\n')).regions).toEqual([
			{ hostStartLine: 2, hostIndent: 0, lines: ['2026-01-01 balance Assets:Cash 1 USD'] },
		]);
		const unclosed = ledgerDoc('fenced', '```beancount\n2026-10-01 * "Open"\n  Assets:Cash');
		expect(unclosed.regions).toEqual([
			{ hostStartLine: 1, hostIndent: 0, lines: ['2026-10-01 * "Open"', '  Assets:Cash'] },
		]);
		expect(unclosed.lineIsLedger(0)).toBe(false);
		expect(unclosed.lineIsLedger(1)).toBe(true);
		expect(
			ledgerDoc('fenced', '````beancount\n2026-01-01 open Assets:Cash\n`````\n').regions
		).toEqual([{ hostStartLine: 1, hostIndent: 0, lines: ['2026-01-01 open Assets:Cash'] }]);
		expect(ledgerDoc('fenced', '````beancount\n2026-01-01 open Assets:Cash\n```').regions).toEqual([
			{ hostStartLine: 1, hostIndent: 0, lines: ['2026-01-01 open Assets:Cash', '```'] },
		]);
	});

	it('is true for containsPos only inside a fence body', () => {
		const text = ['prose', '```beancount', '2026-01-01 open Assets:Cash', '```', 'after'].join('\n');
		const doc = ledgerDoc('fenced', text);
		expect(doc.containsPos(text.indexOf('prose'))).toBe(false);
		expect(doc.containsPos(text.indexOf('```beancount'))).toBe(false);
		expect(doc.containsPos(text.indexOf('2026-01-01'))).toBe(true);
		expect(doc.containsPos(text.indexOf('```\nafter'))).toBe(false);
		expect(doc.containsPos(text.indexOf('after'))).toBe(false);
		expect(doc.containsPos(-1)).toBe(false);
	});

	it('masks fence bodies onto host lines and is null without a region', () => {
		const text = ['# note', '```bean', '2026-01-01 open Assets:Cash', 'still body'].join('\n');
		expect(ledgerDoc('fenced', text).masked()).toEqual(['', '', '2026-01-01 open Assets:Cash', 'still body']);
		expect(ledgerDoc('fenced', 'prose only').masked()).toBeNull();
		expect(ledgerDoc('fenced', '  ```beancount\n  2026-10-01 open Assets:Cash\n  ```').masked()).toEqual([
			'',
			'2026-10-01 open Assets:Cash',
			'',
		]);
	});

	it('reuses one LedgerDoc per CodeMirror document without toString', () => {
		const text = Text.of(['```bean', 'open', '```']);
		let iters = 0;
		let strings = 0;
		const doc = {
			toString() {
				strings += 1;
				return text.toString();
			},
			iterLines() {
				iters += 1;
				return text.iterLines();
			},
		};
		const once = ledgerDoc('fenced', doc);
		expect(ledgerDoc('fenced', doc)).toBe(once);
		expect(once.regions).toEqual([{ hostStartLine: 1, hostIndent: 0, lines: ['open'] }]);
		expect(iters).toBe(1);
		expect(strings).toBe(0);
	});

	it('keeps fenced and ledger-file docs of the same Text without rescanning', () => {
		const text = Text.of(['```bean', 'open', '```']);
		let iters = 0;
		const doc = {
			toString() {
				return text.toString();
			},
			iterLines() {
				iters += 1;
				return text.iterLines();
			},
		};
		const fenced = ledgerDoc('fenced', doc);
		expect(iters).toBe(1);
		const fileDoc = ledgerDoc('ledger-file', doc);
		expect(iters).toBe(1);
		expect(ledgerDoc('fenced', doc)).toBe(fenced);
		expect(ledgerDoc('ledger-file', doc)).toBe(fileDoc);
		expect(fileDoc.lineIsLedger(0)).toBe(true);
		expect(iters).toBe(1);
		expect(fileDoc.regions[0]?.lines).toEqual(['```bean', 'open', '```']);
		expect(fileDoc.ledgerSource()).toBe('```bean\nopen\n```');
		expect(fileDoc.masked()).toEqual(['```bean', 'open', '```']);
		expect(fileDoc.tempLedger().text).toBe('```bean\nopen\n```\n');
		expect(iters).toBe(2);
		expect(fileDoc).not.toBe(fenced);
	});

	it('prepends a safe include in tempLedger and omits an unsafe path', () => {
		const doc = ledgerDoc('fenced', '```beancount\noption "title" "X"\n```');
		const included = doc.tempLedger('/vault/main.bean');
		expect(included.text.startsWith('include "/vault/main.bean"\n\n')).toBe(true);
		expect(included.hostLine(1)).toBeUndefined();
		expect(included.hostLine(2)).toBeUndefined();
		expect(included.hostLine(3)).toBe(2);
		const windows = doc.tempLedger('C:\\vault\\main.bean');
		expect(windows.text.startsWith('include "C:/vault/main.bean"\n\n')).toBe(true);
		const unsafe = doc.tempLedger('/vault/main.bean\nplugin "os"');
		expect(unsafe.text.startsWith('include ')).toBe(false);
		expect(unsafe.hostLine(1)).toBe(2);
		expect(ledgerDoc('fenced', 'prose').tempLedger().text).toBe('');
	});
});

describe('editorLedger', () => {
	it('reads kind from the file and fences from the live document when present', () => {
		const editor = { getValue: () => '# n\n```beancount\nopen\n```' };
		expect(editorLedger(editor, { extension: 'md' }).lineIsLedger(2)).toBe(true);
		expect(editorLedger(editor, { extension: 'md' }).lineIsLedger(0)).toBe(false);
		expect(editorLedger(editor, { extension: 'bean' }).lineIsLedger(0)).toBe(true);
		const live = {
			getValue: () => 'prose only',
			cm: { state: { doc: cmDoc(['# n', '```bean', 'open', '```']) } },
		};
		expect(editorLedger(live, { extension: 'md' }).lineIsLedger(2)).toBe(true);
		expect(editorLedger(live, { extension: 'md' }).lineIsLedger(0)).toBe(false);
		expect(editorLedger(live, null).kind).toBe('fenced');
	});
});

describe('ledgerDoc host mapping', () => {
	it('returns no regions for prose without a fence', () => {
		expect(ledgerDoc('fenced', '# Grocery\n\njust prose\n').regions).toEqual([]);
	});

	it('extracts a beancount body at its host start line', () => {
		const text = ['# Grocery', '', '```beancount', '2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD', '```', ''].join('\n');
		expect(ledgerDoc('fenced', text).regions).toEqual([
			{ hostStartLine: 3, hostIndent: 0, lines: ['2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD'] },
		]);
	});


	it('reduces a note without ledger fences to nothing', () => {
		expect(ledgerDoc('fenced', 'LangGraph长期记忆SDK:Semantic').ledgerSource()).toBe('');
	});
});

describe('ledgerDoc CodeMirror and CRLF', () => {
	it('splits CRLF the same way as LF', () => {
		expect(ledgerDoc('fenced', '```bean\r\n2026-10-01 * "A"\r\n```\r\n').regions).toEqual([
			{ hostStartLine: 1, hostIndent: 0, lines: ['2026-10-01 * "A"'] },
		]);
	});

	it('strips trailing CR from non-last CodeMirror lines without toString', () => {
		const doc = cmDoc(['```bean\r', '2026-10-01 * "A"\r', '```\r', 'after']);
		const once = ledgerDoc('fenced', doc);
		expect(once.regions).toEqual([{ hostStartLine: 1, hostIndent: 0, lines: ['2026-10-01 * "A"'] }]);
		expect(once.masked()).toEqual(['', '2026-10-01 * "A"', '', '']);
		expect(doc.strings).toBe(0);
		expect(ledgerDoc('fenced', doc)).toBe(once);
	});

	it('maps a blank fence body line in tempLedger without emitting a file', () => {
		const temp = ledgerDoc('fenced', '```beancount\n\n```').tempLedger();
		expect(temp.text).toBe('');
		expect(temp.hostLine(1)).toBe(2);
		expect(temp.hostLine(2)).toBeUndefined();
	});

	it('reduces a .txt buffer to fence bodies, not the whole file', () => {
		const text = 'prose\n```bean\nopen\n```\n';
		expect(ledgerDoc(ledgerKind({ extension: 'txt' }), text).ledgerSource()).toBe('open');
	});
});

describe('isSafeIncludePath', () => {
	it('rejects quotes, newlines, and NULs', () => {
		expect(isSafeIncludePath('/vault/main.bean')).toBe(true);
		expect(isSafeIncludePath('/v/a"b.bean')).toBe(false);
		expect(isSafeIncludePath('main.bean\ninclude "/etc/passwd"')).toBe(false);
		expect(isSafeIncludePath('main.bean\0x')).toBe(false);
		expect(isSafeIncludePath('')).toBe(false);
	});
});
