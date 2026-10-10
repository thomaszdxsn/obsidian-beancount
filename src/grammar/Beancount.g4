grammar Beancount;

@lexer::members {
    // True when the next char starts real content (not whitespace, newline or EOF).
    private isFollowedByContent(): boolean {
        const next = this.inputStream.LA(1);
        return next !== -1 && next !== 0x20 && next !== 0x09 && next !== 0x0d && next !== 0x0a;
    }
}

// Mirrors upstream beancount v2 (beancount/parser/grammar.y + lexer.l).
// Line structure matters: every directive ends with `eol`, and lines that
// belong to a directive (postings, metadata, tag/link lines) start with INDENT.

// ---------------------------------------------------------------------------
// Parser rules
// ---------------------------------------------------------------------------

beancountFile
    : (EOL | directive)* EOF
    ;

directive
    : transaction
    | price
    | balance
    | open
    | close
    | commodity_directive
    | pad
    | note
    | document
    | event
    | query
    | custom
    | options
    | plugin
    | include
    | pushtag
    | poptag
    | pushmeta
    | popmeta
    ;

eol
    : EOL
    | EOF
    ;

// Transaction: header line, then indented metadata / tag-link lines, then
// postings. Metadata lines directly under a posting belong to that posting.
// Tag/link lines after the first posting are rejected (upstream rejects them
// in its builder: "Tags or links not allowed after first Posting").
transaction
    : DATE txn_flag txn_strings? tags_links eol (key_value_line | tags_links_line)* posting*
    ;

txn_flag
    : TXN
    | flag
    ;

flag
    : ASTERISK
    | HASH
    | FLAG
    | CAPITAL
    ;

// One string is the narration; two are payee + narration (PIPE is the legacy separator).
txn_strings
    : (payee=STRING PIPE?)? narration=STRING
    ;

tags_links
    : (TAG | LINK)*
    ;

tags_links_line
    : INDENT (TAG | LINK)+ eol
    ;

posting
    : INDENT flag? account incomplete_amount? cost? price_annotation? eol metadata
    ;

// Posting amounts may omit the number or the currency (interpolated later).
incomplete_amount
    : number commodity?
    | commodity
    ;

amount
    : number commodity
    ;

// Arithmetic expression; precedence follows grammar.y.
number
    : NUMBER
    | LPAREN number RPAREN
    | (MINUS | PLUS) number
    | number (ASTERISK | SLASH) number
    | number (PLUS | MINUS) number
    ;

commodity
    : CURRENCY
    | CAPITAL
    ;

// `{...}` is per-unit cost, `{{...}}` is total cost.
cost
    : LCURL cost_comp_list? RCURL
    | LCURLCURL cost_comp_list? RCURLCURL
    ;

cost_comp_list
    : cost_comp (COMMA cost_comp)*
    ;

cost_comp
    : compound_amount
    | DATE
    | STRING
    | ASTERISK
    ;

// `per # total CUR` combines per-unit and total cost.
compound_amount
    : perUnit=number? HASH total=number? commodity
    | number commodity?
    | commodity
    ;

// `@` is per-unit price, `@@` is total price.
price_annotation
    : (AT | ATAT) incomplete_amount?
    ;

metadata
    : key_value_line*
    ;

key_value_line
    : INDENT key_value eol
    ;

key_value
    : KEY key_value_value?
    ;

key_value_value
    : STRING
    | account
    | DATE
    | commodity
    | TAG
    | BOOL
    | NONE
    | amount
    | number
    ;

price
    : DATE PRICE commodity amount eol metadata
    ;

// `100.00 ~ 0.01 USD` carries an explicit tolerance.
balance
    : DATE BALANCE account balanceNumber=number (TILDE tolerance=number)? commodity eol metadata
    ;

open
    : DATE OPEN account (commodity (COMMA commodity)*)? booking? eol metadata
    ;

booking
    : STRING
    ;

close
    : DATE CLOSE account eol metadata
    ;

commodity_directive
    : DATE COMMODITY commodity eol metadata
    ;

pad
    : DATE PAD account account eol metadata
    ;

note
    : DATE NOTE account STRING tags_links eol metadata
    ;

document
    : DATE DOCUMENT account STRING tags_links eol metadata
    ;

event
    : DATE EVENT STRING STRING eol metadata
    ;

query
    : DATE QUERY STRING STRING eol metadata
    ;

custom
    : DATE CUSTOM STRING custom_value* eol metadata
    ;

custom_value
    : STRING
    | DATE
    | BOOL
    | amount
    | number
    | account
    ;

options
    : OPTION STRING STRING eol
    ;

plugin
    : PLUGIN STRING STRING? eol
    ;

include
    : INCLUDE STRING eol
    ;

pushtag
    : PUSHTAG TAG eol
    ;

poptag
    : POPTAG TAG eol
    ;

pushmeta
    : PUSHMETA key_value eol
    ;

popmeta
    : POPMETA KEY eol
    ;

account
    : ACCOUNT
    ;

// ---------------------------------------------------------------------------
// Lexer rules
// ---------------------------------------------------------------------------
// Order matters for equal-length matches: earlier rules win.
//
// Column-0 checks use `currentTokenColumn` and sit after the first char:
// a predicate at the left edge of a rule stops ANTLR from caching the DFA
// start state, which made lexing ~10x slower.

EOL: '\r'? '\n';

// Leading whitespace at column 0 followed by content. Whitespace-only lines
// fall through to WS so they read as plain blank lines.
INDENT: [ \t]+ {this.currentTokenColumn === 0 && this.isFollowedByContent()}?;

// An indented comment line vanishes entirely (newline included) so it can
// sit between postings or metadata without ending the directive.
INDENTED_COMMENT_LINE: [ \t]+ {this.currentTokenColumn === 0}? ';' ~[\r\n]* ('\r'? '\n')? -> skip;

// Org-mode headings/drawers and flag-prefixed lines at column 0 are ignored.
IGNORED_LINE: [*:#!&?%] {this.currentTokenColumn === 0}? ~[\r\n]* -> skip;

WS: [ \t\r]+ -> skip;
COMMENT: ';' ~[\r\n]* -> skip;

// Keywords
TXN: 'txn';
BALANCE: 'balance';
OPEN: 'open';
CLOSE: 'close';
COMMODITY: 'commodity';
PAD: 'pad';
EVENT: 'event';
QUERY: 'query';
CUSTOM: 'custom';
PRICE: 'price';
NOTE: 'note';
DOCUMENT: 'document';
PUSHTAG: 'pushtag';
POPTAG: 'poptag';
PUSHMETA: 'pushmeta';
POPMETA: 'popmeta';
OPTION: 'option';
PLUGIN: 'plugin';
INCLUDE: 'include';

BOOL: 'TRUE' | 'FALSE';
NONE: 'NULL';

DATE: ('17' | '18' | '19' | '20') DIGIT DIGIT [-/] DIGIT+ [-/] DIGIT+;

ACCOUNT: ACCOUNT_TYPE (':' ACCOUNT_NAME)+;

// A lone capital letter is both a valid currency and a valid flag.
CAPITAL: [A-Z];

// Starts with a letter (or `/` for futures), ends with a letter or digit.
CURRENCY
    : [A-Z] CURRENCY_CHAR* [A-Z0-9]
    | '/' CURRENCY_CHAR* [A-Z] (CURRENCY_CHAR* [A-Z0-9])?
    ;

STRING: '"' (~["\\] | '\\' .)* '"';

NUMBER: ([0-9]+ | [0-9] [0-9,]+ [0-9]) ('.' [0-9]*)?;

TAG: '#' TAG_CHAR+;
LINK: '^' TAG_CHAR+;

// Metadata key including its trailing colon, e.g. `invoice:`.
KEY: [a-z] [a-zA-Z0-9_-]+ ':';

PIPE: '|';
ATAT: '@@';
AT: '@';
LCURLCURL: '{{';
RCURLCURL: '}}';
LCURL: '{';
RCURL: '}';
COMMA: ',';
TILDE: '~';
PLUS: '+';
MINUS: '-';
SLASH: '/';
LPAREN: '(';
RPAREN: ')';
HASH: '#';
ASTERISK: '*';
FLAG: [!&?%];

fragment DIGIT: [0-9];
fragment NON_ASCII: ~[\u0000-\u007F];
fragment ACCOUNT_TYPE: ([A-Z] | NON_ASCII) ([A-Za-z0-9-] | NON_ASCII)*;
fragment ACCOUNT_NAME: ([A-Z0-9] | NON_ASCII) ([A-Za-z0-9-] | NON_ASCII)*;
fragment CURRENCY_CHAR: [A-Z0-9'._-];
fragment TAG_CHAR: [A-Za-z0-9_/.-];
