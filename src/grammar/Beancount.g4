grammar Beancount;

// Parser rules
beancountFile
    : directive* EOF
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
    | COMMENT
    ;

// Transaction directive
transaction
    : DATE txn_flag? (STRING STRING?)? posting*
    ;

txn_flag
    : TXN
    | FLAG
    ;

// Postings under a transaction
posting
    : INDENT account (amount)? cost? price_annotation? metadata?
    ;

amount
    : number commodity
    ;

number
    : NUMBER
    ;

commodity
    : COMMODITY
    ;

cost
    : '{' (amount)? ( ',' (DATE | STRING))* '}'
    | '{{' (amount)? '}}'
    ;

price_annotation
    : AT (amount | ('(' amount ')'))
    ;

metadata
    : (INDENT TAG_KEY (STRING | DATE | number))*
    ;

// Price directive
price
    : DATE 'price' commodity amount
    ;

// Balance assertion directive
balance
    : DATE 'balance' account amount
    ;

// Account open directive
open
    : DATE 'open' account (commodity (',' commodity)*)? booking?
    ;

booking
    : STRING
    ;

// Account close directive
close
    : DATE 'close' account
    ;

// Commodity directive
commodity_directive
    : DATE 'commodity' COMMODITY metadata?
    ;

// Pad directive
pad
    : DATE 'pad' account account
    ;

// Note directive
note
    : DATE 'note' account STRING
    ;

// Document directive
document
    : DATE 'document' account STRING metadata?
    ;

// Event directive
event
    : DATE 'event' STRING STRING
    ;

// Query directive
query
    : DATE 'query' STRING STRING
    ;

// Custom directive
custom
    : DATE 'custom' STRING (STRING | DATE | number | amount | account | TAG | LINK)*
    ;

// Options directive
options
    : 'option' STRING STRING
    ;

// Plugin directive
plugin
    : 'plugin' STRING (STRING)?
    ;

// Include directive
include
    : 'include' STRING
    ;

// Account name (Assets:Checking, etc.)
account
    : ACCOUNT
    ;

// Lexer rules
TXN: 'txn';
FLAG: '*' | '!' | '#' | '?' | '&' | '/' | '^' | '(' | ')' | '%' | '"' | '\'';
DATE: [0-9][0-9][0-9][0-9]'-'[0-9][0-9]'-'[0-9][0-9];
NUMBER: '-'? [0-9]+ ('.' [0-9]+)?;
ACCOUNT: [A-Z][A-Za-z0-9-]+ (':' [A-Z][A-Za-z0-9-]+)+;
COMMODITY: [A-Z][A-Z0-9'.'-]*;
TAG: '#' [A-Za-z0-9-_/.]+;
LINK: '^' [A-Za-z0-9-_/.]+;
TAG_KEY: [a-z][a-z0-9-_]+ ':';
AT: '@';
INDENT: '  ';  // Two spaces for indentation

STRING: '"' (~["\r\n] | '\\"')* '"';

COMMENT: (';' | '*' | '#') ~[\r\n]* -> skip;
WS: [ \t\r\n]+ -> skip;