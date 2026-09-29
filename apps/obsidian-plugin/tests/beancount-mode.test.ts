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
		if (span.text.trim().length > 0) result.push([span.text, span.style]);
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
		expect(pairs('; just a note')).toEqual([['; just a note', 'lineComment']]);
		expect(
			pairs('2024-03-15 * "Coffee Shop" "flat white" #food ^trip\n  Expenses:Food:Drink  -4.50 USD\n  Assets:Cash\n  ; inner note')
		).toEqual([
			['2024', 'number'],
			['-', 'punctuation'],
			['03', 'number'],
			['-', 'punctuation'],
			['15', 'number'],
			['*', 'variableName.function'],
			['"Coffee Shop"', 'string'],
			['"flat white"', 'string'],
			['#', 'operator'],
			['food', 'tagName'],
			['^', 'operator'],
			['trip', 'link'],
			['Expenses', 'variableName.special'],
			[':', 'punctuation'],
			['Food', 'variableName'],
			[':', 'punctuation'],
			['Drink', 'variableName'],
			['-', 'operator'],
			['4.50', 'number'],
			['USD', 'typeName'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['; inner note', 'lineComment'],
		]);
	});

	it('styles tag directives', () => {
		expect(pairs('pushtag #trip')).toEqual([
			['pushtag', 'variableName.function'],
			['#', 'operator'],
			['trip', 'tagName'],
		]);
		expect(pairs('poptag #trip')).toEqual([
			['poptag', 'variableName.function'],
			['#', 'operator'],
			['trip', 'tagName'],
		]);
	});

	it('styles include, option and plugin directives', () => {
		expect(pairs('include "ledger/main.bean"')).toEqual([
			['include', 'variableName.function'],
			['"ledger/main.bean"', 'string'],
		]);
		expect(pairs('option "title" "My Ledger"')).toEqual([
			['option', 'variableName.function'],
			['"title"', 'string'],
			['"My Ledger"', 'string'],
		]);
		expect(pairs('plugin "beancount.plugins.auto" "cfg"')).toEqual([
			['plugin', 'variableName.function'],
			['"beancount.plugins.auto"', 'string'],
			['"cfg"', 'string'],
		]);
	});

	it('styles dated open/close/pad entries', () => {
		expect(pairs('2024-01-01 open Assets:Cash USD, EUR')).toEqual([
			...DATE,
			['open', 'variableName.function'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['USD', 'typeName'],
			[',', 'punctuation'],
			['EUR', 'typeName'],
		]);
		expect(pairs('2024-01-01 pad Assets:Cash Equity:Opening-Balances')).toEqual([
			...DATE,
			['pad', 'variableName.function'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['Equity', 'variableName.special'],
			[':', 'punctuation'],
			['Opening-Balances', 'variableName'],
		]);
		expect(pairs('2024/01/01 open Assets:Cash USD')).toEqual([
			['2024', 'number'],
			['/', 'punctuation'],
			['01', 'number'],
			['/', 'punctuation'],
			['01', 'number'],
			['open', 'variableName.function'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['USD', 'typeName'],
		]);
	});

	it('styles custom entries with strings, bools and numbers', () => {
		expect(pairs('2024-01-01 custom "budget" "Food budget" TRUE 1,000.50')).toEqual([
			...DATE,
			['custom', 'variableName.function'],
			['"budget"', 'string'],
			['"Food budget"', 'string'],
			['TRUE', 'bool'],
			['1,000.50', 'number'],
		]);
	});

	it('styles event, commodity, note and document entries', () => {
		expect(pairs('2024-01-01 event "location" "Beijing"')).toEqual([
			...DATE,
			['event', 'variableName.function'],
			['"location"', 'string'],
			['"Beijing"', 'string'],
		]);
		expect(pairs('2024-01-01 commodity USD')).toEqual([
			...DATE,
			['commodity', 'variableName.function'],
			['USD', 'typeName'],
		]);
		expect(pairs('2024-01-01 note Assets:Cash "bought coffee"')).toEqual([
			...DATE,
			['note', 'variableName.function'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['"bought coffee"', 'string'],
		]);
		expect(pairs('2024-01-01 document Assets:Cash "receipt.pdf"')).toEqual([
			...DATE,
			['document', 'variableName.function'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['"receipt.pdf"', 'string'],
		]);
	});

	it('styles price and balance entries', () => {
		expect(pairs('2024-01-01 price USD 11.00 CNY')).toEqual([
			...DATE,
			['price', 'variableName.function'],
			['USD', 'typeName'],
			['11.00', 'number'],
			['CNY', 'typeName'],
		]);
		expect(pairs('2024-01-01 balance Assets:Cash 100.00 USD')).toEqual([
			...DATE,
			['balance', 'variableName.function'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['100.00', 'number'],
			['USD', 'typeName'],
		]);
	});

	it('styles transaction flags and strings', () => {
		expect(pairs('2024-01-01 txn "Store" "Groceries"')).toEqual([
			...DATE,
			['txn', 'variableName.function'],
			['"Store"', 'string'],
			['"Groceries"', 'string'],
		]);
		for (const flag of ['*', '!', 'P']) {
			expect(pairs(`2024-01-01 ${flag} "Store" "Groceries"`)).toContainEqual([
				flag,
				'variableName.function',
			]);
		}
	});

	it('styles posting flags, amounts, costs and price annotations', () => {
		expect(pairs('  Expenses:Food  -100.00 USD {2024-01-01, 100 USD} @ 7.00 CNY')).toEqual([
			['Expenses', 'variableName.special'],
			[':', 'punctuation'],
			['Food', 'variableName'],
			['-', 'operator'],
			['100.00', 'number'],
			['USD', 'typeName'],
			['{', 'operator'],
			['2024', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
			[',', 'punctuation'],
			['100', 'number'],
			['USD', 'typeName'],
			['}', 'operator'],
			['@', 'operator'],
			['7.00', 'number'],
			['CNY', 'typeName'],
		]);
		expect(pairs('  Expenses:Food  100.00 USD {{50.00 USD}}')).toEqual([
			['Expenses', 'variableName.special'],
			[':', 'punctuation'],
			['Food', 'variableName'],
			['100.00', 'number'],
			['USD', 'typeName'],
			['{{', 'operator'],
			['50.00', 'number'],
			['USD', 'typeName'],
			['}}', 'operator'],
		]);
		expect(pairs('  ! Assets:Gift  +1.00 USD')).toEqual([
			['!', 'keyword'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Gift', 'variableName'],
			['+', 'operator'],
			['1.00', 'number'],
			['USD', 'typeName'],
		]);
		expect(tail('  Assets:Cash  1.00 USD @@ 2.00 USD', 5)).toEqual([
			['@@', 'operator'],
			['2.00', 'number'],
			['USD', 'typeName'],
		]);
	});

	it('styles metadata keys and their values', () => {
		expect(pairs('  location: "Beijing"')).toEqual([
			['location', 'propertyName'],
			[':', 'punctuation'],
			['"Beijing"', 'string'],
		]);
		expect(pairs('  account: Assets:Cash')).toEqual([
			['account', 'propertyName'],
			[':', 'punctuation'],
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
		]);
		expect(pairs('  flag: TRUE')).toEqual([
			['flag', 'propertyName'],
			[':', 'punctuation'],
			['TRUE', 'bool'],
		]);
		expect(pairs('  flag: FALSE')).toEqual([
			['flag', 'propertyName'],
			[':', 'punctuation'],
			['FALSE', 'bool'],
		]);
		expect(pairs('  due: 2024-01-01')).toEqual([
			['due', 'propertyName'],
			[':', 'punctuation'],
			['2024', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
			['-', 'punctuation'],
			['01', 'number'],
		]);
		expect(pairs('  max: 1,234.56')).toEqual([
			['max', 'propertyName'],
			[':', 'punctuation'],
			['1,234.56', 'number'],
		]);
	});

	it('styles string escapes and keeps strings open across lines', () => {
		expect(pairs('  note: "coffee \\"special\\""')).toEqual([
			['note', 'propertyName'],
			[':', 'punctuation'],
			['"coffee ', 'string'],
			['\\"', 'escape'],
			['special', 'string'],
			['\\"', 'escape'],
			['"', 'string'],
		]);
		expect(pairs('2024-01-01 * "Store\nmore" "narration"')).toEqual([
			...DATE,
			['*', 'variableName.function'],
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
			['query', 'variableName.function'],
			['"monthly"', 'string'],
			['"', 'punctuation'],
			['SELECT', 'controlKeyword'],
			['account', 'variableName'],
			[',', 'punctuation'],
			['sum', 'variableName.function'],
			['(', 'punctuation'],
			['number', 'variableName'],
			[')', 'punctuation'],
			['WHERE', 'controlKeyword'],
			['date', 'variableName'],
			['>=', 'operator'],
			['2024-01-01', 'number'],
			['/* c */', 'blockComment'],
			['GROUP', 'controlKeyword'],
			['BY', 'controlKeyword'],
			['account', 'variableName'],
			['"', 'punctuation'],
		]);
		expect(
			pairs("2024-01-01 query \"q\" \"SELECT account WHERE payee = 'It''s' LIMIT 1 + 2 <= 3\"")
		).toEqual([
			...DATE,
			['query', 'variableName.function'],
			['"q"', 'string'],
			['"', 'punctuation'],
			['SELECT', 'controlKeyword'],
			['account', 'variableName'],
			['WHERE', 'controlKeyword'],
			['payee', 'variableName'],
			['=', 'operator'],
			["'It''s'", 'string'],
			['LIMIT', 'controlKeyword'],
			['1', 'number'],
			['+', 'operator'],
			['2', 'number'],
			['<=', 'operator'],
			['3', 'number'],
			['"', 'punctuation'],
		]);
	});

	it('keeps BQL quirks of the original grammar', () => {
		// `;` swallows the rest of the line, closing quote included.
		expect(tail('2024-01-01 query "q" "SELECT account ; note"', 9)).toEqual([
			['account', 'variableName'],
			['; note"', 'lineComment'],
		]);
		// A bare `*` inside a block comment is a one-char token.
		expect(tail('2024-01-01 query "q" "SELECT /* *x */ x"', 9)).toEqual([
			['/* *x */', 'blockComment'],
			['x', 'invalid'],
			['"', 'punctuation'],
		]);
		// Unrecognized characters inside BQL are invalid.
		expect(tail('2024-01-01 query "q" "SELECT #"', 9)).toEqual([
			['#', 'invalid'],
			['"', 'punctuation'],
		]);
	});

	it('marks unrecognized characters as invalid', () => {
		expect(pairs('~~')).toEqual([['~~', 'invalid']]);
		expect(pairs('!')).toEqual([['!', 'invalid']]);
		expect(pairs('  note: "abc\\')).toEqual([
			['note', 'propertyName'],
			[':', 'punctuation'],
			['"abc\\', 'string'],
		]);
	});

	it('rejects | as date separator or amount sign (upstream char class bug)', () => {
		// Upstream `[\-|/]`/`[\-\|\+]` accidentally accept `|`; beancount
		// dates are `YYYY-MM-DD` and signs are `+`/`-` only.
		const badDate = pairs('2024|01|01 open Assets:Cash USD');
		expect(badDate).toContainEqual(['|', 'invalid']);
		expect(badDate).not.toContainEqual(['open', 'variableName.function']);
		expect(pairs('  Assets:Cash  |5 USD')).toEqual([
			['Assets', 'variableName.special'],
			[':', 'punctuation'],
			['Cash', 'variableName'],
			['|', 'invalid'],
			['5', 'number'],
			['USD', 'typeName'],
		]);
	});

	it('ends an entry at blank lines and column 0 comments', () => {
		const withComment = pairs('; note\n  Assets:Cash 1 USD');
		expect(withComment[0]).toEqual(['; note', 'lineComment']);
		expect(withComment).toContainEqual(['Assets', 'variableName.special']);
		const withBlank = pairs('2024-01-01 * "S" "n"\n\n  Assets:Cash 1 USD');
		expect(withBlank).toContainEqual(['Assets', 'variableName.special']);
		expect(withBlank).toContainEqual(['1', 'number']);
		const withBlankSpaces = pairs('2024-01-01 * "S" "n"\n   \n  Assets:Cash 1 USD');
		expect(withBlankSpaces).toContainEqual(['Assets', 'variableName.special']);
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
