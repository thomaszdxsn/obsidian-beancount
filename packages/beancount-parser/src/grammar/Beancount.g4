grammar Beancount;

@lexer::members {
    // Column-0 line structure is scanned here instead of by predicated lexer
    // rules: any semantic predicate reachable from a whitespace run keeps
    // ANTLR from caching DFA states, which made lexing ~5x slower.
    //
    // At column 0:
    // - `[*:#!&?%]` starts an ignored line (org-mode headings/drawers,
    //   flag-prefixed lines): skipped up to, not including, the newline.
    // - `[ \t]+ ';'` starts an indented comment line: skipped with its
    //   newline, so it can sit between postings or metadata without ending
    //   the directive.
    // - `[ \t]+` before other content is INDENT. Whitespace-only lines fall
    //   through to WS so they read as plain blank lines.
    public override nextToken(): Token {
        return this.lineStart() ? this.emit() : super.nextToken();
    }

    // A lexer error is recovered inside super.nextToken()'s own loop, which
    // then lexes on without coming back here. When recovery ends at a line
    // start, scan it the same way: an INDENT set up here is what that loop
    // emits next.
    public override recover(e: antlr.LexerNoViableAltException | antlr.RecognitionException): void {
        super.recover(e);
        this.lineStart();
    }

    // The column-0 scan. Skips ignored and indented comment lines; true when
    // it has consumed an INDENT and set it up as the current token.
    private lineStart(): boolean {
        const input = this.inputStream;
        while (this.interpreter.column === 0) {
            const c = input.LA(1);
            if (c === 0x2a || c === 0x3a || c === 0x23 || c === 0x21 || c === 0x26 || c === 0x3f || c === 0x25) {
                this.skipToLineEnd();
                continue;
            }
            if (c !== 0x20 && c !== 0x09) return false;
            let k = 2;
            while (input.LA(k) === 0x20 || input.LA(k) === 0x09) k++;
            const next = input.LA(k);
            if (next === 0x3b) {
                this.skipToLineEnd();
                if (input.LA(1) === 0x0d && input.LA(2) === 0x0a) this.interpreter.consume(input);
                if (input.LA(1) === 0x0a) this.interpreter.consume(input);
                continue;
            }
            if (next === -1 || next === 0x0d || next === 0x0a) return false;
            this.tokenStartCharIndex = input.index;
            this.currentTokenStartLine = this.interpreter.line;
            this.currentTokenColumn = 0;
            this.channel = Token.DEFAULT_CHANNEL;
            this.type = BeancountLexer.INDENT;
            for (let i = 1; i < k; i++) this.interpreter.consume(input);
            return true;
        }
        return false;
    }

    private skipToLineEnd(): void {
        const input = this.inputStream;
        for (let c = input.LA(1); c !== -1 && c !== 0x0d && c !== 0x0a; c = input.LA(1)) {
            this.interpreter.consume(input);
        }
    }
}

// Mirrors upstream beancount master / v3 (beancount/parser/grammar.y + lexer.l).
// v3 is a superset of v2 here: it adds single-letter (CAPITAL) and `/FUTURES`
// currencies; v2 flags `PSTCURM` are covered by CAPITAL.
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
    : DATE txnFlag=txn_flag strings=txn_strings? tagsLinks=tags_links eol (meta+=key_value_line | tagLines+=tags_links_line)* postings+=posting*
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
    : INDENT postingFlag=flag? acct=account units=incomplete_amount? costSpec=cost? priceSpec=price_annotation? eol meta=metadata
    ;

// Posting amounts may omit the number or the currency (interpolated later).
incomplete_amount
    : num=number cur=commodity?
    | cur=commodity
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
    : lines+=key_value_line*
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
// INDENT and the column-0 skips (ignored lines, indented comment lines) are
// produced by nextToken() in @lexer::members.

EOL: '\r'? '\n';

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

// Emitted by nextToken() in @lexer::members. As a rule it never wins: WS
// matches every `[ \t]+` run at least as long and comes first. It exists so
// INDENT has a token type and a name in the lexer's vocabulary.
INDENT: [ \t]+;

fragment DIGIT: [0-9];
fragment NON_ASCII: ~[\u0000-\u007F];
fragment ACCOUNT_TYPE: ([A-Z] | NON_ASCII) ([A-Za-z0-9-] | NON_ASCII)*;
fragment ACCOUNT_NAME: ([A-Z0-9] | NON_ASCII) ([A-Za-z0-9-] | NON_ASCII)*;
fragment CURRENCY_CHAR: [A-Z0-9'._-];
fragment TAG_CHAR: [A-Za-z0-9_/.-];
