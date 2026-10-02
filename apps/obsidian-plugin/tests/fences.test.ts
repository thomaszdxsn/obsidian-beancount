/**
 * Markdown ```beancount / ```bean fences are the notes' ledger: extract the
 * bodies, then map bean-check's temp-file lines back onto the host document.
 */
import { describe, expect, it } from 'vitest';
import { buildFenceLedger, extractBeancountFences, isSafeIncludePath } from '../fences';

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
