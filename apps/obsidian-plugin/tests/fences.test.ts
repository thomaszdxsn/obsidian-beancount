/**
 * Markdown ```beancount / ```bean fences are the notes' ledger: extract the
 * bodies, then map bean-check's temp-file lines back onto the host document.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type * as CMState from '@codemirror/state';
import {
	buildFenceLedger,
	docFences,
	editorLineIsLedger,
	extractBeancountFences,
	ledgerLinesOf,
	isSafeIncludePath,
	ledgerSource,
} from '../fences';

const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;

/** CodeMirror `Text` plus a countable `toString`, so a cache hit cannot rescan. */
function cmDoc(lines: readonly string[]) {
	const text = Text.of(lines);
	let scans = 0;
	return {
		get scans() {
			return scans;
		},
		toString() {
			scans += 1;
			return text.toString();
		},
		iterLines: () => text.iterLines(),
	};
}

describe('ledgerSource', () => {
	it('keeps a ledger file whole, prose and comments included', () => {
		const text = 'PG_DATA_DIR:-x\n2020-01-01 open Assets:Cash\n';
		expect(ledgerSource('main.bean', text)).toBe(text);
		expect(ledgerSource('dir/x.beancount', text)).toBe(text);
	});

	it('reduces a note to its ledger fence bodies, joined in document order', () => {
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
		expect(ledgerSource('note.md', note)).toBe('2020-01-01 open Assets:Cash\n  Expenses:Food  1 USD');
	});

	it('reduces a note without ledger fences to nothing', () => {
		expect(ledgerSource('note.md', 'LangGraph长期记忆SDK:Semantic')).toBe('');
	});
});

describe('extractBeancountFences', () => {
	it('returns nothing for prose without a fence', () => {
		expect(extractBeancountFences('# Grocery\n\njust prose\n')).toEqual([]);
	});

	it('extracts a ```beancount body at its host start line', () => {
		const text = ['# Grocery', '', '```beancount', '2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD', '```', ''].join(
			'\n'
		);

		expect(extractBeancountFences(text)).toEqual([
			{ startLine: 3, lines: ['2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD'] },
		]);
	});

	it('accepts the bean alias, tildes, and an info-string suffix', () => {
		const text = ['~~~bean linenums', '2026-10-01 * "A"', '~~~', '', '```Beancount', '2026-10-02 * "B"', '```'].join(
			'\n'
		);

		expect(extractBeancountFences(text)).toEqual([
			{ startLine: 1, lines: ['2026-10-01 * "A"'] },
			{ startLine: 5, lines: ['2026-10-02 * "B"'] },
		]);
	});

	it('does not treat a different language as a ledger fence', () => {
		expect(extractBeancountFences('```javascript\nconst x = 1\n```\n')).toEqual([]);
		expect(extractBeancountFences('```beancounter\nnope\n```\n')).toEqual([]);
	});

	it('ignores ledger examples nested inside another fenced block', () => {
		const text = ['````text', '```bean', '2026-01-01 balance Assets:Cash 12 USD', '```', '````',
			'~~~bean', '2026-01-02 balance Assets:Cash 14 USD', '~~~'].join('\n');
		expect(extractBeancountFences(text)).toEqual([
			{ startLine: 6, lines: ['2026-01-02 balance Assets:Cash 14 USD'] },
		]);
	});

	it('does not let inline backtick code swallow a following ledger fence', () => {
		const text = ['```x```', '```bean', '2026-01-01 balance Assets:Cash 1 USD', '```'].join('\n');
		expect(extractBeancountFences(text)).toEqual([
			{ startLine: 2, lines: ['2026-01-01 balance Assets:Cash 1 USD'] },
		]);
	});

	it('takes the rest of the file when the closing fence is missing', () => {
		expect(extractBeancountFences('```beancount\n2026-10-01 * "Open"\n  Assets:Cash')).toEqual([
			{ startLine: 1, lines: ['2026-10-01 * "Open"', '  Assets:Cash'] },
		]);
	});

	it('splits CRLF the same way as LF', () => {
		expect(extractBeancountFences('```bean\r\n2026-10-01 * "A"\r\n```\r\n')).toEqual([
			{ startLine: 1, lines: ['2026-10-01 * "A"'] },
		]);
	});

	it('strips the opener indent from each body line', () => {
		expect(extractBeancountFences('  ```beancount\n  2026-10-01 open Assets:Cash\n  ```\n')).toEqual([
			{ startLine: 1, lines: ['2026-10-01 open Assets:Cash'] },
		]);
	});

	it('accepts a three-space opener and rejects a four-space one', () => {
		expect(extractBeancountFences('   ```bean\n   2026-01-01 open Assets:Cash\n   ```')).toEqual([
			{ startLine: 1, lines: ['2026-01-01 open Assets:Cash'] },
		]);
		expect(extractBeancountFences('    ```bean\n    2026-01-01 open Assets:Cash\n    ```')).toEqual([]);
	});
});

describe('buildFenceLedger', () => {
	const fences = [
		{ startLine: 3, lines: ['2026-10-01 * "Cafe"', '  Assets:Cash  -10.00 USD'] },
		{ startLine: 10, lines: ['2026-10-02 * "Shop"'] },
	];

	it('concatenates fence bodies and maps temp lines onto the host', () => {
		const ledger = buildFenceLedger(fences);

		expect(ledger.text).toBe('2026-10-01 * "Cafe"\n  Assets:Cash  -10.00 USD\n\n2026-10-02 * "Shop"\n');
		expect(ledger.hostLine(1)).toBe(4);
		expect(ledger.hostLine(2)).toBe(5);
		expect(ledger.hostLine(3)).toBeUndefined();
		expect(ledger.hostLine(4)).toBe(11);
		expect(ledger.hostLine(5)).toBeUndefined();
	});

	it('prepends an include of the entry ledger and skips those preamble lines', () => {
		const ledger = buildFenceLedger(fences, '/vault/main.bean');

		expect(ledger.text.startsWith('include "/vault/main.bean"\n\n')).toBe(true);
		expect(ledger.hostLine(1)).toBeUndefined();
		expect(ledger.hostLine(2)).toBeUndefined();
		expect(ledger.hostLine(3)).toBe(4);
		expect(ledger.hostLine(4)).toBe(5);
	});

	it('normalizes Windows include paths to forward slashes', () => {
		const ledger = buildFenceLedger([{ startLine: 0, lines: ['option "title" "X"'] }], 'C:\\vault\\main.bean');

		expect(ledger.text.startsWith('include "C:/vault/main.bean"\n\n')).toBe(true);
		expect(ledger.hostLine(3)).toBe(1);
	});

	it('omits an include path that would break out of the string', () => {
		const ledger = buildFenceLedger(fences, '/vault/main.bean\nplugin "os"');

		expect(ledger.text.startsWith('include ')).toBe(false);
		expect(ledger.hostLine(1)).toBe(4);
	});

	it('emits no trailing newline when there is no ledger text', () => {
		const empty = buildFenceLedger([]);
		expect(empty.text).toBe('');
		expect(empty.hostLine(1)).toBeUndefined();

		// A blank body line joins to '' — still not a non-empty file — but it is a host line.
		const blank = buildFenceLedger([{ startLine: 4, lines: [''] }]);
		expect(blank.text).toBe('');
		expect(blank.hostLine(1)).toBe(5);
		expect(blank.hostLine(2)).toBeUndefined();
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

describe('docFences', () => {
	it('strips trailing CR from non-last CodeMirror lines so fences match toString()', () => {
		const doc = cmDoc(['```bean\r', '2026-10-01 * "A"\r', '```\r', 'after']);
		const once = docFences(doc);
		expect(once.fences).toEqual(extractBeancountFences(doc.toString()));
		expect(once.masked).toEqual(['', '2026-10-01 * "A"', '', '']);
		// Read from iterLines, not a joined copy, and reuse that result.
		expect(doc.scans).toBe(1);
		expect(docFences(doc)).toBe(once);
		expect(doc.scans).toBe(1);
	});

	it('keeps an unclosed fence body at host indexes and does not share it with another document', () => {
		const open = cmDoc(['# note', '```bean', '2026-01-01 open Assets:Cash', 'still body']);
		const other = cmDoc(['prose only']);
		const fences = docFences(open);
		const none = docFences(other);
		expect(fences.fences).toEqual([
			{ startLine: 2, lines: ['2026-01-01 open Assets:Cash', 'still body'] },
		]);
		expect(fences.masked).toEqual(['', '', '2026-01-01 open Assets:Cash', 'still body']);
		expect(none.fences).toEqual([]);
		expect(none.masked).toBeNull();
		expect(docFences(open)).toBe(fences);
		expect(docFences(open).fences).not.toBe(none.fences);
	});

	it('answers whether a line is ledger text for a file or editor', () => {
		const fences = extractBeancountFences('# n\n```bean\n  Assets:Cash\n```\nprose');
		expect(ledgerLinesOf({ extension: 'bean' }, () => fences)).toBeUndefined();
		const note = ledgerLinesOf({ extension: 'md' }, () => fences);
		expect(note?.(0)).toBe(false);
		expect(note?.(2)).toBe(true);
		expect(ledgerLinesOf(null, () => fences)?.(2)).toBe(true);
		const editor = { getValue: () => '# n\n```beancount\nopen\n```' };
		expect(editorLineIsLedger(editor, 2, { extension: 'md' })).toBe(true);
		expect(editorLineIsLedger(editor, 0, { extension: 'md' })).toBe(false);
		expect(editorLineIsLedger(editor, 0, { extension: 'bean' })).toBe(true);
		// An editor with a live CodeMirror document answers from that document.
		const live = { getValue: () => 'prose only', cm: { state: { doc: cmDoc(['# n', '```bean', 'open', '```']) } } };
		expect(editorLineIsLedger(live, 2, { extension: 'md' })).toBe(true);
		expect(editorLineIsLedger(live, 0, { extension: 'md' })).toBe(false);
	});

	it('strips the opener indent in the masked body, not only in extractBeancountFences', () => {
		const doc = cmDoc(['  ```beancount', '  2026-10-01 open Assets:Cash', '  ```']);
		expect(docFences(doc)).toEqual({
			fences: [{ startLine: 1, lines: ['2026-10-01 open Assets:Cash'] }],
			masked: ['', '2026-10-01 open Assets:Cash', ''],
		});
	});
});
