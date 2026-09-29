import { StringStream } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beancountMode, beancountStreamLanguage } from '../beancount-mode';

interface Token {
	text: string;
	style: string | null;
	start: number;
	end: number;
}

function tokenize(text: string): Token[] {
	const state = beancountMode.startState();
	const tokens: Token[] = [];
	let offset = 0;
	for (const line of text.split('\n')) {
		const stream = new StringStream(line, 4, 2);
		if (stream.eol()) {
			beancountMode.blankLine(state);
		} else {
			while (!stream.eol()) {
				stream.start = stream.pos;
				const style = beancountMode.token(stream, state);
				tokens.push({ text: stream.current(), style, start: offset + stream.start, end: offset + stream.pos });
			}
		}
		offset += line.length + 1;
	}
	return tokens;
}

/**
 * Token pairs as CodeMirror renders them: contiguous same-style tokens merged
 * into one span (StreamLanguage's default `mergeTokens`), whitespace-only
 * spans dropped.
 */
function pairs(text: string): Array<[string, string | null]> {
	const spans: Token[] = [];
	for (const token of tokenize(text)) {
		// Unstyled whitespace is noise: drop it before merging so it cannot
		// bridge two spans (positions still gate merges).
		if (token.style === null && token.text.trim().length === 0) continue;
		const prev = spans.length > 0 ? spans[spans.length - 1] : undefined;
		if (prev && prev.style === token.style && prev.end === token.start) {
			prev.text += token.text;
			prev.end = token.end;
		} else {
			spans.push(token);
		}
	}
	const result: Array<[string, string | null]> = [];
	for (const span of spans) {
		result.push([span.text, span.style]);
	}
	return result;
}

const DATE = [
	['2024', 'number'],
	['-', 'punctuation'],
	['01', 'number'],
	['-', 'punctuation'],
	['01', 'number'],
] as Array<[string, string]>;

function tail(text: string, from: number): Array<[string, string | null]> {
	return pairs(text).slice(from);
}

describe('beancountMode tokens', () => {
	it('styles comments, including indented ones inside entries', () => {
		expect(pairs('; just a note')).toEqual([['; just a note', 'comment']]);
		expect(
			pairs('2024-03-15 * "Coffee Shop" "flat white" #food ^trip\n  Expenses:Food:Drink  -4.50 USD\n  Assets:Cash\n  ; inner note')
		).toEqual([
			['2024', 'number'],
			['-', 'punctuation'],
			['03', 'number'],
			['-', 'punctuation'],
			['15', 'number'],
			['*', 'builtin'],
			['"Coffee Shop"', 'string'],
			['"flat white"', 'string'],
			['#', 'operator'],
			['food', 'tag'],
			['^', 'operator'],
			['trip', 'link'],
			['Expenses', 'variable-2'],
			[':', 'punctuation'],
			['Food', 'variable'],
			[':', 'punctuation'],
			['Drink', 'variable'],
			['-', 'operator'],
			['4.50', 'number'],
			['USD', 'type'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['; inner note', 'comment'],
		]);
	});

	it('styles tag directives', () => {
		expect(pairs('pushtag #trip')).toEqual([
			['pushtag', 'builtin'],
			['#', 'operator'],
			['trip', 'tag'],
		]);
		expect(pairs('poptag #trip')).toEqual([
			['poptag', 'builtin'],
			['#', 'operator'],
			['trip', 'tag'],
		]);
	});

	it('styles include, option and plugin directives', () => {
		expect(pairs('include "ledger/main.bean"')).toEqual([
			['include', 'builtin'],
			['"ledger/main.bean"', 'string'],
		]);
		expect(pairs('option "title" "My Ledger"')).toEqual([
			['option', 'builtin'],
			['"title"', 'string'],
			['"My Ledger"', 'string'],
		]);
		expect(pairs('plugin "beancount.plugins.auto" "cfg"')).toEqual([
			['plugin', 'builtin'],
			['"beancount.plugins.auto"', 'string'],
			['"cfg"', 'string'],
		]);
	});

	it('styles dated open/close/pad entries', () => {
		expect(pairs('2024-01-01 open Assets:Cash USD, EUR')).toEqual([
			...DATE,
			['open', 'builtin'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['USD', 'type'],
			[',', 'punctuation'],
			['EUR', 'type'],
		]);
		expect(pairs('2024-01-01 pad Assets:Cash Equity:Opening-Balances')).toEqual([
			...DATE,
			['pad', 'builtin'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['Equity', 'variable-2'],
			[':', 'punctuation'],
			['Opening-Balances', 'variable'],
		]);
		expect(pairs('2024/01/01 open Assets:Cash USD')).toEqual([
			['2024', 'number'],
			['/', 'punctuation'],
			['01', 'number'],
			['/', 'punctuation'],
			['01', 'number'],
			['open', 'builtin'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['USD', 'type'],
		]);
	});

	it('styles custom entries with strings, bools and numbers', () => {
		expect(pairs('2024-01-01 custom "budget" "Food budget" TRUE 1,000.50')).toEqual([
			...DATE,
			['custom', 'builtin'],
			['"budget"', 'string'],
			['"Food budget"', 'string'],
			['TRUE', 'keyword'],
			['1,000.50', 'number'],
		]);
	});

	it('styles event, commodity, note and document entries', () => {
		expect(pairs('2024-01-01 event "location" "Beijing"')).toEqual([
			...DATE,
			['event', 'builtin'],
			['"location"', 'string'],
			['"Beijing"', 'string'],
		]);
		expect(pairs('2024-01-01 commodity USD')).toEqual([
			...DATE,
			['commodity', 'builtin'],
			['USD', 'type'],
		]);
		expect(pairs('2024-01-01 note Assets:Cash "bought coffee"')).toEqual([
			...DATE,
			['note', 'builtin'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['"bought coffee"', 'string'],
		]);
		expect(pairs('2024-01-01 document Assets:Cash "receipt.pdf"')).toEqual([
			...DATE,
			['document', 'builtin'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['"receipt.pdf"', 'string'],
		]);
	});

	it('styles price and balance entries', () => {
		expect(pairs('2024-01-01 price USD 11.00 CNY')).toEqual([
			...DATE,
			['price', 'builtin'],
			['USD', 'type'],
			['11.00', 'number'],
			['CNY', 'type'],
		]);
		expect(pairs('2024-01-01 balance Assets:Cash 100.00 USD')).toEqual([
			...DATE,
			['balance', 'builtin'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['100.00', 'number'],
			['USD', 'type'],
		]);
	});

	it('styles transaction flags and strings', () => {
		expect(pairs('2024-01-01 txn "Store" "Groceries"')).toEqual([
			...DATE,
			['txn', 'builtin'],
			['"Store"', 'string'],
			['"Groceries"', 'string'],
		]);
		for (const flag of ['*', '!', 'P']) {
			expect(pairs(`2024-01-01 ${flag} "Store" "Groceries"`)).toContainEqual([
				flag,
				'builtin',
			]);
		}
	});

	it('styles posting flags, amounts, costs and price annotations', () => {
		expect(pairs('  Expenses:Food  -100.00 USD {2024-01-01, 100 USD} @ 7.00 CNY')).toEqual([
			['Expenses', 'variable-2'],
			[':', 'punctuation'],
			['Food', 'variable'],
			['-', 'operator'],
			['100.00', 'number'],
			['USD', 'type'],
			['{', 'operator'],
			['2024', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
			[',', 'punctuation'],
			['100', 'number'],
			['USD', 'type'],
			['}', 'operator'],
			['@', 'operator'],
			['7.00', 'number'],
			['CNY', 'type'],
		]);
		expect(pairs('  Expenses:Food  100.00 USD {{50.00 USD}}')).toEqual([
			['Expenses', 'variable-2'],
			[':', 'punctuation'],
			['Food', 'variable'],
			['100.00', 'number'],
			['USD', 'type'],
			['{{', 'operator'],
			['50.00', 'number'],
			['USD', 'type'],
			['}}', 'operator'],
		]);
		expect(pairs('  ! Assets:Gift  +1.00 USD')).toEqual([
			['!', 'keyword'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Gift', 'variable'],
			['+', 'operator'],
			['1.00', 'number'],
			['USD', 'type'],
		]);
		expect(tail('  Assets:Cash  1.00 USD @@ 2.00 USD', 5)).toEqual([
			['@@', 'operator'],
			['2.00', 'number'],
			['USD', 'type'],
		]);
	});

	it('styles metadata keys and their values', () => {
		expect(pairs('  location: "Beijing"')).toEqual([
			['location', 'property'],
			[':', 'punctuation'],
			['"Beijing"', 'string'],
		]);
		expect(pairs('  account: Assets:Cash')).toEqual([
			['account', 'property'],
			[':', 'punctuation'],
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
		]);
		expect(pairs('  flag: TRUE')).toEqual([
			['flag', 'property'],
			[':', 'punctuation'],
			['TRUE', 'keyword'],
		]);
		expect(pairs('  flag: FALSE')).toEqual([
			['flag', 'property'],
			[':', 'punctuation'],
			['FALSE', 'keyword'],
		]);
		expect(pairs('  due: 2024-01-01')).toEqual([
			['due', 'property'],
			[':', 'punctuation'],
			['2024', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
		]);
		expect(pairs('  max: 1,234.56')).toEqual([
			['max', 'property'],
			[':', 'punctuation'],
			['1,234.56', 'number'],
		]);
	});

	it('styles string escapes and keeps strings open across lines', () => {
		expect(pairs('  note: "coffee \\"special\\""')).toEqual([
			['note', 'property'],
			[':', 'punctuation'],
			['"coffee ', 'string'],
			['\\"', 'string-2'],
			['special', 'string'],
			['\\"', 'string-2'],
			['"', 'string'],
		]);
		expect(pairs('2024-01-01 * "Store\nmore" "narration"')).toEqual([
			...DATE,
			['*', 'builtin'],
			['"Store', 'string'],
			['more"', 'string'],
			['"narration"', 'string'],
		]);
	});

	it('styles query entries and their BQL regions', () => {
		expect(
			pairs('2024-01-01 query "monthly" "SELECT account, sum(number) WHERE date >= 2024-01-01 /* c */ GROUP BY account"')
		).toEqual([
			...DATE,
			['query', 'builtin'],
			['"monthly"', 'string'],
			['"', 'punctuation'],
			['SELECT', 'keyword'],
			['account', 'variable'],
			[',', 'punctuation'],
			['sum', 'builtin'],
			['(', 'punctuation'],
			['number', 'variable'],
			[')', 'punctuation'],
			['WHERE', 'keyword'],
			['date', 'variable'],
			['>=', 'operator'],
			['2024-01-01', 'number'],
			['/* c */', 'comment'],
			['GROUP', 'keyword'],
			['BY', 'keyword'],
			['account', 'variable'],
			['"', 'punctuation'],
		]);
		expect(
			pairs("2024-01-01 query \"q\" \"SELECT account WHERE payee = 'It''s' LIMIT 1 + 2 <= 3\"")
		).toEqual([
			...DATE,
			['query', 'builtin'],
			['"q"', 'string'],
			['"', 'punctuation'],
			['SELECT', 'keyword'],
			['account', 'variable'],
			['WHERE', 'keyword'],
			['payee', 'variable'],
			['=', 'operator'],
			["'It''s'", 'string'],
			['LIMIT', 'keyword'],
			['1', 'number'],
			['+', 'operator'],
			['2', 'number'],
			['<=', 'operator'],
			['3', 'number'],
			['"', 'punctuation'],
		]);
	});

	it('keeps BQL quirks of the original grammar', () => {
		// `;` swallows the rest of the line, closing quote included; the
		// upstream query region has no illegal rule, so unrecognized BQL
		// characters are left unscoped instead of being marked invalid.
		expect(tail('2024-01-01 query "q" "SELECT account ; note"', 9)).toEqual([
			['account', 'variable'],
			['; note"', 'comment'],
		]);
		// A bare `*` inside a block comment is a one-char token.
		expect(tail('2024-01-01 query "q" "SELECT /* *x */ x"', 9)).toEqual([
			['/* *x */', 'comment'],
			['x', null],
			['"', 'punctuation'],
		]);
		expect(tail('2024-01-01 query "q" "SELECT #"', 9)).toEqual([
			['#', null],
			['"', 'punctuation'],
		]);
	});

	it('accepts a transaction flag adjacent to the date (upstream \\s*)', () => {
		expect(pairs('2024-01-01* "Store" "x"')).toEqual([
			...DATE,
			['*', 'builtin'],
			['"Store"', 'string'],
			['"x"', 'string'],
		]);
		expect(pairs('2024-01-01txn "Store" "x"')).toContainEqual(['txn', 'builtin']);
		// Other dated keywords still require whitespace.
		expect(pairs('2024-01-01open Assets:Cash USD')[5]).toEqual(['open', 'error']);
	});

	it('does not restart BQL patterns inside identifiers', () => {
		expect(tail('2024-01-01 query "q" "SELECT total_number FROM fooSELECT"', 8)).toEqual([
			['SELECT', 'keyword'],
			['total_number', null],
			['FROM', 'keyword'],
			['fooSELECT', null],
			['"', 'punctuation'],
		]);
	});

	it('marks unrecognized characters as invalid', () => {
		expect(pairs('~~')).toEqual([['~~', 'error']]);
		expect(pairs('!')).toEqual([['!', 'error']]);
		expect(pairs('  note: "abc\\')).toEqual([
			['note', 'property'],
			[':', 'punctuation'],
			['"abc\\', 'string'],
		]);
	});

	it('rejects | as date separator or amount sign (upstream char class bug)', () => {
		// Upstream `[\-|/]`/`[\-\|\+]` accidentally accept `|`; beancount
		// dates are `YYYY-MM-DD` and signs are `+`/`-` only.
		const badDate = pairs('2024|01|01 open Assets:Cash USD');
		expect(badDate).toContainEqual(['|', 'error']);
		expect(badDate).not.toContainEqual(['open', 'builtin']);
		expect(pairs('  Assets:Cash  |5 USD')).toEqual([
			['Assets', 'variable-2'],
			[':', 'punctuation'],
			['Cash', 'variable'],
			['|', 'error'],
			['5', 'number'],
			['USD', 'type'],
		]);
	});

	it('styles non-ASCII account components', () => {
		expect(pairs('  Expenses:餐饮  -30.00 CNY')).toEqual([
			['Expenses', 'variable-2'],
			[':', 'punctuation'],
			['餐饮', 'variable'],
			['-', 'operator'],
			['30.00', 'number'],
			['CNY', 'type'],
		]);
		expect(pairs('2024-01-01 open Assets:Café:Checking CNY')[6]).toEqual(['Assets', 'variable-2']);
		expect(pairs('2024-01-01 open Assets:Café:Checking CNY')[8]).toEqual(['Café', 'variable']);
	});

	it('ends an entry at blank lines and column 0 comments', () => {
		const withComment = pairs('; note\n  Assets:Cash 1 USD');
		expect(withComment[0]).toEqual(['; note', 'comment']);
		expect(withComment).toContainEqual(['Assets', 'variable-2']);
		const withBlank = pairs('2024-01-01 * "S" "n"\n\n  Assets:Cash 1 USD');
		expect(withBlank).toContainEqual(['Assets', 'variable-2']);
		expect(withBlank).toContainEqual(['1', 'number']);
		const withBlankSpaces = pairs('2024-01-01 * "S" "n"\n   \n  Assets:Cash 1 USD');
		expect(withBlankSpaces).toContainEqual(['Assets', 'variable-2']);
		// A column-0 comment ends a query entry: without the reset the next
		// line's quote would open a BQL region instead of a plain string.
		const afterQueryComment = pairs('2024-01-01 query "q"\n; separator\n  note: "hello world"');
		expect(afterQueryComment).toContainEqual(['"hello world"', 'string']);
	});

	it('emits only style names Obsidian themes style (cm-* whitelist)', () => {
		// Obsidian renders raw token words as `cm-<token>` classes; its
		// app.css only styles the CM5 legacy names. Any other name silently
		// renders as plain text — lock the contract to the whitelist.
		const OBSIDIAN_STYLED_STYLES: Record<string, true> = {
			comment: true, string: true, 'string-2': true, number: true, keyword: true,
			variable: true, 'variable-2': true, type: true, property: true, builtin: true,
			tag: true, operator: true, punctuation: true, link: true, meta: true, error: true,
		};
		const ledger = [
			'option "title" "T"',
			'pushtag #trip',
			'2024-01-01 open Assets:Cash CNY',
			'2024-01-01 custom "budget" "b" TRUE 1,000.50',
			'2024-03-15 * "Shop" "flat" #food ^trip',
			'  Expenses:餐饮  -4.50 CNY {2024-01-01, 4.50 CNY} @ 7.10 CNY',
			'  Assets:Café:Checking',
			'  location: "Beijing"',
			'  note: "a \\"b\\""',
			'2024-03-16 balance Assets:Cash 100.00 CNY',
			'2024-03-17 query "q" "SELECT account, sum(number) >= 1 WHERE payee = \'x\' /* c */"',
			'; comment',
			'~~',
		].join('\n');
		const styles = new Set<string>();
		for (const token of tokenize(ledger)) {
			if (token.style !== null) styles.add(token.style);
		}
		for (const style of styles) {
			expect(OBSIDIAN_STYLED_STYLES[style], `token style "${style}" has no cm-* rule in Obsidian`).toBe(true);
		}
		// Sanity: the corpus really exercised every category we style.
		for (const expected of [
			'comment', 'string', 'string-2', 'number', 'keyword', 'variable', 'variable-2',
			'type', 'property', 'builtin', 'tag', 'link', 'operator', 'punctuation', 'error',
		]) {
			expect(styles).toContain(expected);
		}
	});
});

describe('beancountStreamLanguage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('resolves every token style against the CM6 highlight tags', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const ledger = [
			'option "title" "Test"',
			'pushtag #trip',
			'2024-01-01 open Assets:Cash USD',
			'2024-01-01 commodity USD',
			'2024-03-15 * "Coffee Shop" "flat white" #food ^trip',
			'  Expenses:Food:Drink  -4.50 USD {2023-01-01} @@ 10.00 USD',
			'  Assets:Cash',
			'  location: "Beijing"',
			'2024-01-01 query "q" "SELECT account WHERE payee = \'x\'"',
			'; done',
		].join('\n');
		highlightTree(beancountStreamLanguage.parser.parse(ledger), classHighlighter, () => undefined);
		expect(warn).not.toHaveBeenCalled();
	});

	it('highlights tokens through the class highlighter', () => {
		const spans: Array<[number, number, string]> = [];
		highlightTree(
			beancountStreamLanguage.parser.parse('; note\n2024-01-01 open Assets:Cash USD'),
			classHighlighter,
			(from, to, classes) => {
				spans.push([from, to, classes]);
			}
		);
		expect(spans).toContainEqual([0, 6, 'tok-comment']);
		expect(spans.map((span) => span[2])).toContain('tok-number');
	});
});
