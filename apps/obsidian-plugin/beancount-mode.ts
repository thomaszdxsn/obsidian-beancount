/**
 * Beancount syntax mode for CodeMirror 6 — a port of the TextMate grammar
 * `syntaxes/beancount.tmLanguage` from github.com/Lencerf/vscode-beancount.
 *
 * `beancountMode` is a CodeMirror 5 style stream parser spec:
 * `StreamLanguage.define(beancountMode)` turns it into a CM6 language
 * (`beancountStreamLanguage`), and Obsidian's fenced code block highlighting
 * consumes the very same spec through the CM5 mode registry it bridges into
 * its editor (`window.CodeMirror.defineMode`, see `main.ts`).
 *
 * Token names are CodeMirror 5 legacy style names. Obsidian's editor bridge
 * renders each token word directly as a `cm-<token>` class (only the legacy
 * names are styled in its app.css), and `StreamLanguage`'s default token
 * table maps the same legacy names to `@lezer/highlight` tags — so one name
 * set serves both consumers. Mapping from the TextMate scopes of the
 * original grammar:
 *
 * | TextMate scope                          | token name  |
 * |-----------------------------------------|-------------|
 * | comment.line / comment.block.bql        | comment     |
 * | string.quoted.double(.bql)              | string      |
 * | constant.character.escape               | string-2    |
 * | constant.numeric.* (dates, amounts)     | number      |
 * | punctuation.*                           | punctuation |
 * | keyword.operator.* (markers, signs)     | operator    |
 * | keyword.other (posting flag)            | keyword     |
 * | keyword.control.bql / constant.language.bool | keyword |
 * | support.function* (directives, txn fl., BQL fns) | builtin |
 * | variable.language (account root)        | variable-2  |
 * | variable.other.account / .column.bql    | variable    |
 * | entity.name.type.commodity              | type        |
 * | entity.name.tag                         | tag         |
 * | markup.underline.link                   | link        |
 * | keyword.operator.directive (meta keys)  | property    |
 * | invalid.illegal.unrecognized            | error       |
 *
 * Two TextMate semantics are kept verbatim for VS Code parity: a region's
 * `end` pattern is matched before its nested patterns, so a query's BQL
 * region (end `"`) closes at the first double quote — BQL string literals
 * effectively use single quotes — and `''` inside them closes and reopens a
 * string instead of escaping.
 *
 * One upstream quirk is NOT kept: its date/amount separator classes
 * `[\-|/]`/`[\-\|\+]` contain a stray literal `|` (alternation written into
 * a character class). Real beancount never writes `|` there, and accepting
 * it causes bogus spans, so this port rejects `|` like any other garbage.
 *
 * Source grammar: Lencerf/vscode-beancount `syntaxes/beancount.tmLanguage`,
 * pinned at commit 60dcdbd3af273aca0ff628220f2828483101ca47 (MIT). Ported by
 * hand: StreamLanguage is a stateful line tokenizer, so the grammar's
 * begin/end regions are re-expressed as per-line state in `BeancountState`.
 */
import { StreamLanguage, type StringStream } from '@codemirror/language';

export type BeancountEntry = 'none' | 'txn' | 'query' | 'directive';

interface PendingToken {
	readonly re: RegExp;
	readonly style: string | null;
}

export interface BeancountState {
	/** Kind of the entry (directive/transaction) the current line belongs to. */
	entry: BeancountEntry;
	/** Styles for composite matches (dates, accounts, tags, …) still to emit. */
	pending: PendingToken[];
	/** The next word is the entry's directive keyword or transaction flag. */
	directiveWord: boolean;
	/** Query entries: quoted strings consumed so far (0 = name, 2 = BQL open). */
	queryStrings: number;
	/** Inside a query's BQL region (between its opening and closing quote). */
	bql: boolean;
	/** Inside a single-quoted BQL string. */
	bqlString: boolean;
	/** Inside a BQL `/* *\/` block comment. */
	bqlComment: boolean;
	/** Inside a double-quoted beancount string (which may span lines). */
	inString: boolean;
	/** The current string is an `option` key (scoped support.variable). */
	optionKey: boolean;
	/** Column-0 line matching no directive: upstream leaves it fully unscoped. */
	looseLine: boolean;
}

const DATE_RE = /^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}/;
const DATE_PARTS: readonly PendingToken[] = [
	{ re: /^[0-9]{4}/, style: 'number' },
	{ re: /^[-/]/, style: 'punctuation' },
	{ re: /^[0-9]{2}/, style: 'number' },
	{ re: /^[-/]/, style: 'punctuation' },
	{ re: /^[0-9]{2}/, style: 'number' },
];
const ACCOUNT_RE = /^[A-Z][a-z]+(?::[^\s:]+)+/;
const TAG_RE = /^#[A-Za-z0-9\-_/.]+/;
const LINK_RE = /^\^[A-Za-z0-9\-_/.]+/;
const TAG_PARTS: readonly PendingToken[] = [
	{ re: /^#/, style: 'operator' },
	{ re: /^[A-Za-z0-9\-_/.]+/, style: 'tag' },
];
const LINK_PARTS: readonly PendingToken[] = [
	{ re: /^\^/, style: 'operator' },
	{ re: /^[A-Za-z0-9\-_/.]+/, style: 'link' },
];
const SIGN_RE = /^[-+](?=[0-9])/;
const NUMBER_RE = /^[0-9]+(?:,[0-9]{3})*(?:\.[0-9]*)?/;
const BOOL_RE = /^(?:TRUE|FALSE)\b/;
const COMMODITY_RE = /^[A-Z][A-Z0-9'\-._]{0,22}[A-Z0-9]/;
const FLAG_CHARS = '*!&#?%PSTCURM';
const FLAG_RE = /^[*!&#?%PSTCURM](?=[ \t])/;
const DATED_ENTRY_RE = /^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}(?:[ \t]*(txn|[*!&#?%PSTCURM])|[ \t]+(open|close|pad|custom|event|commodity|note|document|query|price|balance))(?![A-Za-z0-9])/;
const DIRECTIVE_RE = /^[ \t]*(pushtag|poptag|include|option|plugin)(?![A-Za-z0-9])/;
const META_RE = /^[ \t]+[a-z][A-Za-z0-9\-_]+:/;

const BQL_KEYWORD_RE = /^(?:SELECT|FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|PIVOT|AND|OR|NOT|IN|IS|BETWEEN|AS|DISTINCT|ASC|DESC|TRUE|FALSE|NULL|CREATE|TABLE|USING|INSERT|INTO|BALANCES|JOURNAL|PRINT|BY)(?![A-Za-z0-9_])/i;
const BQL_FUNCTION_RE = /^(?:abs|bool|int|decimal|str|date|year|month|day|yearmonth|quarter|weekday|today|root|parent|leaf|grep|grepn|subst|upper|lower|maxwidth|substr|splitcomp|length|repr|round|safediv|neg|open_date|close_date|open_meta|meta|entry_meta|any_meta|currency_meta|commodity_meta|account_sortkey|has_account|units|cost|value|getprice|number|currency|commodity|findfirst|joinstr|only|empty|filter_currency|convert|parse_date|date_diff|date_add|date_trunc|date_part|interval|date_bin|getitem|possign|sum|count|first|last|min|max)(?=\s*\()/i;
const BQL_COLUMN_RE = /^(?:id|type|filename|lineno|location|date|year|month|day|flag|payee|narration|description|tags|links|meta|accounts|account|other_accounts|posting_flag|number|currency|cost_number|cost_currency|cost_date|cost_label|position|price|weight|balance|entry)(?![A-Za-z0-9_])/i;
const BQL_DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?![A-Za-z0-9_])/;
const BQL_NUMBER_RE = /^[0-9]+(?:\.[0-9]+)?(?![A-Za-z0-9_])/;
const BQL_COMPARE_RE = /^(?:<=|>=|!=|<|>|=|\?~|!~|~)/;
const BQL_ARITH_RE = /^[+\-*/%]/;

function takePending(stream: StringStream, state: BeancountState): string | null {
	const item = state.pending.shift() as PendingToken;
	stream.match(item.re);
	return item.style;
}

function accountPieces(): PendingToken[] {
	// Upstream scopes the root plus its colon, then hands the whole rest of
	// the account (`US:BofA:Checking`, internal colons included) to a single
	// variable.other.account span.
	return [
		{ re: /^[A-Z][a-z]+/, style: 'variable-2' },
		{ re: /^:/, style: 'punctuation' },
		{ re: /^[^\s]+/, style: 'variable' },
	];
}

function stringToken(stream: StringStream, state: BeancountState): string {
	// `option`'s first string is scoped support.variable upstream, not string.
	const style = state.optionKey ? 'variable' : 'string';
	if (!state.inString) {
		stream.next();
		state.inString = true;
		return style;
	}
	if (stream.match(/^\\./)) return state.optionKey ? 'variable' : 'string-2';
	if (stream.eat('"')) {
		state.inString = false;
		state.optionKey = false;
		return style;
	}
	if (!stream.match(/^[^"\\]+/)) stream.next();
	return style;
}

/**
 * Classify the line when the parser reaches its start. Returns true when
 * tokens for the line start were pushed onto `state.pending`.
 */
function classifyLine(stream: StringStream, state: BeancountState): boolean {
	const line = stream.string;
	state.directiveWord = false;
	state.looseLine = false;
	if (/^[ \t]*$/.test(line)) {
		state.entry = 'none';
		return false;
	}
	// A comment at column 0 starts no entry (and ends the current one).
	if (line.charAt(0) === ';') {
		state.entry = 'none';
		return false;
	}
	if (META_RE.test(line)) {
		state.pending = [
			{ re: /^[ \t]+/, style: null },
			{ re: /^[a-z][A-Za-z0-9\-_]+/, style: 'property' },
			{ re: /^:/, style: 'punctuation' },
		];
		return true;
	}
	const dated = DATED_ENTRY_RE.exec(line);
	if (dated) {
		const keyword = dated[1] || dated[2];
		if (keyword === 'query') state.entry = 'query';
		else if (keyword === 'txn' || FLAG_CHARS.indexOf(keyword) >= 0) state.entry = 'txn';
		else state.entry = 'directive';
		state.directiveWord = true;
		state.queryStrings = 0;
		return false;
	}
	if (DIRECTIVE_RE.test(line)) {
		state.entry = 'directive';
		state.directiveWord = true;
		return false;
	}
	// Indented lines continue the current entry; anything else at column 0
	// (org headings, stray prose) matches no upstream pattern and is left
	// unscoped for the whole line.
	if (/^[ \t]/.test(line)) return false;
	state.entry = 'none';
	state.looseLine = true;
	return false;
}

function bqlToken(stream: StringStream, state: BeancountState): string | null {
	if (state.bqlComment) {
		if (stream.match(/^\*\//)) state.bqlComment = false;
		else if (!stream.match(/^[^*]+/)) stream.next();
		return 'comment';
	}
	if (state.bqlString) {
		if (stream.eat("'")) state.bqlString = false;
		else stream.match(/^[^']+/);
		return 'string';
	}
	if (stream.eatSpace()) return null;
	if (stream.peek() === ';') {
		stream.skipToEnd();
		return 'comment';
	}
	if (stream.match(/^\/\*/)) {
		state.bqlComment = true;
		return 'comment';
	}
	const ch = stream.peek();
	if (ch === '"') {
		// The region's end pattern beats nested patterns: a double quote
		// always closes the BQL region.
		stream.next();
		state.bql = false;
		return 'punctuation';
	}
	if (ch === "'") {
		stream.next();
		state.bqlString = true;
		return 'string';
	}
	const rest = stream.string.slice(stream.pos);
	// Upstream's BQL patterns are `\b`-anchored: identifier suffixes must not
	// restart a keyword/column/number match (`fooSELECT`, `total_number`).
	const atWordStart = stream.pos === 0 || !/[A-Za-z0-9_]/.test(stream.string.charAt(stream.pos - 1));
	if (atWordStart && BQL_DATE_RE.test(rest)) {
		stream.match(BQL_DATE_RE);
		return 'number';
	}
	if (atWordStart && BQL_KEYWORD_RE.test(rest)) {
		stream.match(BQL_KEYWORD_RE);
		return 'keyword';
	}
	if (atWordStart && BQL_FUNCTION_RE.test(rest)) {
		stream.match(BQL_FUNCTION_RE);
		return 'builtin';
	}
	if (atWordStart && BQL_COLUMN_RE.test(rest)) {
		stream.match(BQL_COLUMN_RE);
		return 'variable';
	}
	if (atWordStart && BQL_NUMBER_RE.test(rest)) {
		stream.match(BQL_NUMBER_RE);
		return 'number';
	}
	if (BQL_COMPARE_RE.test(rest) || BQL_ARITH_RE.test(rest)) {
		if (!stream.match(BQL_COMPARE_RE)) stream.match(BQL_ARITH_RE);
		return 'operator';
	}
	if (stream.match(/^[(),]/)) return 'punctuation';
	// The upstream query region has no illegal rule: unknown BQL text is
	// left unscoped instead of being marked invalid.
	stream.next();
	return null;
}

function blankLine(state: BeancountState): void {
	state.entry = 'none';
	state.directiveWord = false;
	state.pending = [];
}

function token(stream: StringStream, state: BeancountState): string | null {
	if (state.pending.length > 0) return takePending(stream, state);
	if (state.bql) return bqlToken(stream, state);
	if (state.inString) return stringToken(stream, state);
	if (stream.sol() && classifyLine(stream, state)) return takePending(stream, state);
	if (state.looseLine) {
		// No upstream pattern matches this line; leave it entirely unscoped.
		stream.skipToEnd();
		return null;
	}
	if (stream.eatSpace()) return null;
	const rest = stream.string.slice(stream.pos);
	if (stream.peek() === ';') {
		stream.skipToEnd();
		return 'comment';
	}
	if (stream.peek() === '"') {
		if (state.entry === 'query') {
			if (state.queryStrings === 1) {
				// The quote after a query's name opens its BQL region.
				stream.next();
				state.queryStrings = 2;
				state.bql = true;
				return 'punctuation';
			}
			state.queryStrings++;
		}
		return stringToken(stream, state);
	}
	if (DATE_RE.test(rest)) {
		state.pending = DATE_PARTS.slice();
		return takePending(stream, state);
	}
	if (state.directiveWord) {
		state.directiveWord = false;
		if (stream.match(/^[A-Za-z]+/) || stream.match(/^[*!&#?%PSTCURM]/)) {
			state.optionKey = state.entry === 'directive' && stream.current() === 'option';
			return 'builtin';
		}
	}
	if (TAG_RE.test(rest)) {
		state.pending = TAG_PARTS.slice();
		return takePending(stream, state);
	}
	if (LINK_RE.test(rest)) {
		state.pending = LINK_PARTS.slice();
		return takePending(stream, state);
	}
	if (stream.match(/^@@?/)) return 'operator';
	if (stream.match(/^\{\{?/) || stream.match(/^\}\}?/)) return 'operator';
	if (SIGN_RE.test(rest)) {
		stream.match(SIGN_RE);
		return 'operator';
	}
	if (ACCOUNT_RE.test(rest)) {
		state.pending = accountPieces();
		return takePending(stream, state);
	}
	if (BOOL_RE.test(rest)) {
		stream.match(BOOL_RE);
		return 'keyword';
	}
	if (NUMBER_RE.test(rest)) {
		stream.match(NUMBER_RE);
		return 'number';
	}
	if (stream.pos > 0 && /[ \t]/.test(stream.string.charAt(stream.pos - 1)) && FLAG_RE.test(rest)) {
		stream.next();
		return 'keyword';
	}
	if (COMMODITY_RE.test(rest)) {
		stream.match(COMMODITY_RE);
		return 'type';
	}
	if (stream.eat(',')) return 'punctuation';
	stream.next();
	// Outside entries (e.g. org headings in ledger files) upstream leaves
	// text unscoped; inside entries its `#illegal` rule marks it invalid.
	return state.entry === 'none' ? null : 'error';
}

export const beancountMode = {
	name: 'beancount',
	startState: (): BeancountState => ({
		entry: 'none',
		pending: [],
		directiveWord: false,
		queryStrings: 0,
		bql: false,
		bqlString: false,
		bqlComment: false,
		inString: false,
		optionKey: false,
		looseLine: false,
	}),
	blankLine,
	token,
	languageData: { commentTokens: { line: ';' } },
};

/** The port as a CM6 `Language`, for consumers that parse whole documents. */
export const beancountStreamLanguage = StreamLanguage.define(beancountMode);
