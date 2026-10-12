import type { Token } from 'antlr4ng';

import type { StringCharStream } from './char-stream';
import { BeancountLexer as L } from './parser/BeancountLexer';

/** Thrown when no lexer rule matches: the caller re-lexes with the ANTLR lexer for its exact errors. */
export class NeedsAntlrLexer extends Error {}

// Token.EOF: kept local so the hot loop compares against a constant.
const EOF = -1;

// Lowercase keywords and their token types; KEY (`word:`) is the only other
// rule starting with a lowercase letter.
const KEYWORDS: readonly (readonly [string, number])[] = [
  ['txn', L.TXN],
  ['balance', L.BALANCE],
  ['open', L.OPEN],
  ['close', L.CLOSE],
  ['commodity', L.COMMODITY],
  ['pad', L.PAD],
  ['event', L.EVENT],
  ['query', L.QUERY],
  ['custom', L.CUSTOM],
  ['price', L.PRICE],
  ['note', L.NOTE],
  ['document', L.DOCUMENT],
  ['pushtag', L.PUSHTAG],
  ['poptag', L.POPTAG],
  ['pushmeta', L.PUSHMETA],
  ['popmeta', L.POPMETA],
  ['option', L.OPTION],
  ['plugin', L.PLUGIN],
  ['include', L.INCLUDE],
];

const isUpper = (c: number) => c >= 0x41 && c <= 0x5a;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isLower = (c: number) => c >= 0x61 && c <= 0x7a;
// [A-Za-z0-9-] | NON_ASCII: the body of an account segment.
const isAccountChar = (c: number) => isUpper(c) || isLower(c) || isDigit(c) || c === 0x2d || c >= 0x80;
// CURRENCY_CHAR: [A-Z0-9'._-]
const isCurrencyChar = (c: number) => isUpper(c) || isDigit(c) || c === 0x27 || c === 0x2e || c === 0x5f || c === 0x2d;
// TAG_CHAR: [A-Za-z0-9_/.-]
const isTagChar = (c: number) =>
  isUpper(c) || isLower(c) || isDigit(c) || c === 0x5f || c === 0x2f || c === 0x2e || c === 0x2d;
// KEY body: [a-zA-Z0-9_-]
const isKeyChar = (c: number) => isUpper(c) || isLower(c) || isDigit(c) || c === 0x5f || c === 0x2d;

/**
 * A hand-written equivalent of the generated `BeancountLexer` for input it
 * lexes without errors: the same tokens (type, span, line, column), picked
 * the way ANTLR does — the longest match, ties to the rule listed first in
 * Beancount.g4 — and the same column-0 handling as its `nextToken()`. The
 * ANTLR lexer simulates a DFA per character; this scans code points
 * directly, several times faster.
 *
 * Where no rule matches, ANTLR reports an error and recovers; this throws
 * `NeedsAntlrLexer` instead, so error messages stay exactly ANTLR's.
 */
class Scanner {
  private p = 0;
  private line = 1;
  private column = 0;
  // The token `next()` read.
  tokType = 0;
  tokStart = 0;
  tokEnd = 0;
  tokLine = 1;
  tokColumn = 0;

  constructor(private readonly src: string) {}

  next(): void {
    const src = this.src;
    const n = src.length;
    for (;;) {
      const p = this.p;
      if (p >= n) return this.makeToken(EOF, p, p);
      const c = src.charCodeAt(p);

      if (this.column === 0) {
        // `[*:#!&?%]` at column 0: ignored line, up to the newline.
        if (c === 0x2a || c === 0x3a || c === 0x23 || c === 0x21 || c === 0x26 || c === 0x3f || c === 0x25) {
          this.skipTo(this.lineEnd(p));
          continue;
        }
        if (c === 0x20 || c === 0x09) {
          let k = p + 1;
          while (k < n && (src.charCodeAt(k) === 0x20 || src.charCodeAt(k) === 0x09)) k++;
          const next = k < n ? src.charCodeAt(k) : -1;
          if (next === 0x3b) {
            // Indented comment line, newline included.
            let end = this.lineEnd(k);
            if (src.charCodeAt(end) === 0x0d && src.charCodeAt(end + 1) === 0x0a) end += 2;
            else if (src.charCodeAt(end) === 0x0a) end += 1;
            this.skipTo(end);
            continue;
          }
          if (next !== -1 && next !== 0x0d && next !== 0x0a) return this.makeToken(L.INDENT, p, k);
        }
      }

      let type = 0;
      let end = p;
      switch (c) {
        case 0x0a:
          type = L.EOL;
          end = p + 1;
          break;
        case 0x0d:
        case 0x20:
        case 0x09: {
          // WS [ \t\r]+, unless `\r\n` makes a longer EOL.
          let k = p + 1;
          while (k < n && (src.charCodeAt(k) === 0x20 || src.charCodeAt(k) === 0x09 || src.charCodeAt(k) === 0x0d)) k++;
          if (c === 0x0d && src.charCodeAt(p + 1) === 0x0a) {
            type = L.EOL;
            end = p + 2;
            break;
          }
          // `[ \t\r]` only: one column each.
          this.column += k - p;
          this.p = k;
          continue;
        }
        case 0x3b:
          this.skipTo(this.lineEnd(p));
          continue;
        case 0x22:
          end = this.stringEnd(p);
          type = L.STRING;
          break;
        case 0x23: {
          let k = p + 1;
          while (k < n && isTagChar(src.charCodeAt(k))) k++;
          type = k > p + 1 ? L.TAG : L.HASH;
          end = k > p + 1 ? k : p + 1;
          break;
        }
        case 0x5e: {
          let k = p + 1;
          while (k < n && isTagChar(src.charCodeAt(k))) k++;
          if (k === p + 1) throw new NeedsAntlrLexer();
          type = L.LINK;
          end = k;
          break;
        }
        case 0x2f: {
          // '/' CURRENCY_CHAR* [A-Z] (CURRENCY_CHAR* [A-Z0-9])?: the longest
          // run ending in [A-Z0-9] that holds an [A-Z]; else SLASH.
          let best = -1;
          let upper = false;
          for (let k = p + 1; k < n && isCurrencyChar(src.charCodeAt(k)); k++) {
            if (isUpper(src.charCodeAt(k))) upper = true;
            if (upper && (isUpper(src.charCodeAt(k)) || isDigit(src.charCodeAt(k)))) best = k;
          }
          type = best === -1 ? L.SLASH : L.CURRENCY;
          end = best === -1 ? p + 1 : best + 1;
          break;
        }
        case 0x7c:
          type = L.PIPE;
          end = p + 1;
          break;
        case 0x40:
          type = src.charCodeAt(p + 1) === 0x40 ? L.ATAT : L.AT;
          end = src.charCodeAt(p + 1) === 0x40 ? p + 2 : p + 1;
          break;
        case 0x7b:
          type = src.charCodeAt(p + 1) === 0x7b ? L.LCURLCURL : L.LCURL;
          end = src.charCodeAt(p + 1) === 0x7b ? p + 2 : p + 1;
          break;
        case 0x7d:
          type = src.charCodeAt(p + 1) === 0x7d ? L.RCURLCURL : L.RCURL;
          end = src.charCodeAt(p + 1) === 0x7d ? p + 2 : p + 1;
          break;
        case 0x2c:
          type = L.COMMA;
          end = p + 1;
          break;
        case 0x7e:
          type = L.TILDE;
          end = p + 1;
          break;
        case 0x2b:
          type = L.PLUS;
          end = p + 1;
          break;
        case 0x2d:
          type = L.MINUS;
          end = p + 1;
          break;
        case 0x28:
          type = L.LPAREN;
          end = p + 1;
          break;
        case 0x29:
          type = L.RPAREN;
          end = p + 1;
          break;
        case 0x2a:
          type = L.ASTERISK;
          end = p + 1;
          break;
        case 0x21:
        case 0x26:
        case 0x3f:
        case 0x25:
          type = L.FLAG;
          end = p + 1;
          break;
        default:
          if (isDigit(c)) {
            end = this.dateEnd(p);
            if (end !== -1) {
              type = L.DATE;
            } else {
              end = this.numberEnd(p);
              type = L.NUMBER;
            }
          } else if (isLower(c)) {
            for (const [word, wordType] of KEYWORDS) {
              if (this.matches(p, word)) {
                type = wordType;
                end = p + word.length;
                break;
              }
            }
            // KEY: [a-z] [a-zA-Z0-9_-]+ ':', always longer than a keyword.
            let k = p + 1;
            while (k < n && isKeyChar(src.charCodeAt(k))) k++;
            if (k > p + 1 && src.charCodeAt(k) === 0x3a) {
              type = L.KEY;
              end = k + 1;
            }
          } else if (isUpper(c) || c >= 0x80) {
            // In rule order: BOOL, NONE, ACCOUNT, CAPITAL, CURRENCY. A later
            // rule wins only with a strictly longer match.
            if (this.matches(p, 'TRUE') || this.matches(p, 'NULL')) {
              type = src.charCodeAt(p) === 0x54 ? L.BOOL : L.NONE;
              end = p + 4;
            } else if (this.matches(p, 'FALSE')) {
              type = L.BOOL;
              end = p + 5;
            }
            const account = this.accountEnd(p);
            if (account > end) {
              type = L.ACCOUNT;
              end = account;
            }
            if (isUpper(c)) {
              if (p + 1 > end) {
                type = L.CAPITAL;
                end = p + 1;
              }
              // CURRENCY: [A-Z] CURRENCY_CHAR* [A-Z0-9]
              let last = -1;
              for (let k = p + 1; k < n && isCurrencyChar(src.charCodeAt(k)); k++) {
                if (isUpper(src.charCodeAt(k)) || isDigit(src.charCodeAt(k))) last = k;
              }
              if (last + 1 > end) {
                type = L.CURRENCY;
                end = last + 1;
              }
            }
          }
      }
      if (type === 0 || end === -1) throw new NeedsAntlrLexer();
      return this.makeToken(type, p, end);
    }
  }

  private makeToken(type: number, start: number, end: number): void {
    this.tokType = type;
    this.tokStart = start;
    this.tokEnd = end;
    this.tokLine = this.line;
    this.tokColumn = this.column;
    if (type === L.STRING || type === L.ACCOUNT) {
      // May hold newlines (strings) or surrogate pairs (non-ASCII).
      this.advance(start, end);
    } else if (type === L.EOL) {
      this.line++;
      this.column = 0;
      this.p = end;
    } else {
      // Every other token is ASCII on one line: one column per code unit.
      this.column += end - start;
      this.p = end;
    }
  }

  private skipTo(end: number): void {
    this.advance(this.p, end);
  }

  // Moves to `end`, tracking line and column as ANTLR does over code points:
  // a newline starts a line, any other code point is one column, so the low
  // half of a surrogate pair adds none.
  private advance(start: number, end: number): void {
    const src = this.src;
    let column = this.column;
    for (let k = start; k < end; k++) {
      const c = src.charCodeAt(k);
      if (c === 0x0a) {
        this.line++;
        column = 0;
      } else if ((c & 0xfc00) !== 0xdc00 || k === 0 || (src.charCodeAt(k - 1) & 0xfc00) !== 0xd800) {
        column++;
      }
    }
    this.column = column;
    this.p = end;
  }

  // Index of the first `\r`, `\n` or the end, from `p`.
  private lineEnd(p: number): number {
    const src = this.src;
    while (p < src.length && src.charCodeAt(p) !== 0x0d && src.charCodeAt(p) !== 0x0a) p++;
    return p;
  }

  private matches(p: number, word: string): boolean {
    const src = this.src;
    if (p + word.length > src.length) return false;
    for (let i = 0; i < word.length; i++) if (src.charCodeAt(p + i) !== word.charCodeAt(i)) return false;
    return true;
  }

  // STRING: '"' (~["\\] | '\\' .)* '"'; -1 when unterminated.
  private stringEnd(p: number): number {
    const src = this.src;
    const n = src.length;
    let k = p + 1;
    while (k < n) {
      const c = src.charCodeAt(k);
      if (c === 0x22) return k + 1;
      k += c === 0x5c ? 2 : 1;
    }
    return -1;
  }

  // DATE: ('17' | '18' | '19' | '20') DIGIT DIGIT [-/] DIGIT+ [-/] DIGIT+; -1 when absent.
  private dateEnd(p: number): number {
    const src = this.src;
    const n = src.length;
    if (p + 4 > n) return -1;
    const a = src.charCodeAt(p);
    const b = src.charCodeAt(p + 1);
    if (!((a === 0x31 && b >= 0x37 && b <= 0x39) || (a === 0x32 && b === 0x30))) return -1;
    if (!isDigit(src.charCodeAt(p + 2)) || !isDigit(src.charCodeAt(p + 3))) return -1;
    let k = p + 4;
    for (let part = 0; part < 2; part++) {
      if (k >= n || (src.charCodeAt(k) !== 0x2d && src.charCodeAt(k) !== 0x2f)) return -1;
      k++;
      const digits = k;
      while (k < n && isDigit(src.charCodeAt(k))) k++;
      if (k === digits) return -1;
    }
    return k;
  }

  // NUMBER: ([0-9]+ | [0-9] [0-9,]+ [0-9]) ('.' [0-9]*)?
  private numberEnd(p: number): number {
    const src = this.src;
    const n = src.length;
    let end = p + 1;
    for (let k = p + 1; k < n && (isDigit(src.charCodeAt(k)) || src.charCodeAt(k) === 0x2c); k++) {
      if (src.charCodeAt(k) !== 0x2c) end = k + 1;
    }
    if (src.charCodeAt(end) === 0x2e) {
      end++;
      while (end < n && isDigit(src.charCodeAt(end))) end++;
    }
    return end;
  }

  // ACCOUNT: ACCOUNT_TYPE (':' ACCOUNT_NAME)+; -1 when absent.
  private accountEnd(p: number): number {
    const src = this.src;
    const n = src.length;
    let k = p + 1;
    while (k < n && isAccountChar(src.charCodeAt(k))) k++;
    let end = -1;
    while (k + 1 < n && src.charCodeAt(k) === 0x3a) {
      const d = src.charCodeAt(k + 1);
      if (!(isUpper(d) || isDigit(d) || d >= 0x80)) break;
      k += 2;
      while (k < n && isAccountChar(src.charCodeAt(k))) k++;
      end = k;
    }
    return end;
  }
}

/**
 * Tokens as parallel arrays, ending with one EOF token. `start`/`end`
 * (exclusive) are UTF-16 offsets into the input; `line`/`column` count code
 * points, as ANTLR's.
 */
export interface RawTokens {
  count: number;
  type: Int8Array;
  start: Int32Array;
  end: Int32Array;
  line: Int32Array;
  column: Int32Array;
}

/**
 * Lexes the whole input; throws `NeedsAntlrLexer` where no rule matches.
 * Scans UTF-16 code units: every rule treats code points >= 0x80 alike, so
 * a token never ends inside a surrogate pair and the matches are those over
 * code points.
 */
export function lexAll(src: string): RawTokens {
  const scanner = new Scanner(src);
  // Roughly one token per 3 code points in a ledger; grown on demand.
  let capacity = (src.length >> 2) + 16;
  let type = new Int8Array(capacity);
  let start = new Int32Array(capacity);
  let end = new Int32Array(capacity);
  let line = new Int32Array(capacity);
  let column = new Int32Array(capacity);
  let count = 0;
  for (;;) {
    scanner.next();
    if (count === capacity) {
      capacity *= 2;
      type = grow(type, new Int8Array(capacity));
      start = grow(start, new Int32Array(capacity));
      end = grow(end, new Int32Array(capacity));
      line = grow(line, new Int32Array(capacity));
      column = grow(column, new Int32Array(capacity));
    }
    type[count] = scanner.tokType;
    start[count] = scanner.tokStart;
    end[count] = scanner.tokEnd;
    line[count] = scanner.tokLine;
    column[count] = scanner.tokColumn;
    count++;
    if (scanner.tokType === EOF) return { count, type, start, end, line, column };
  }
}

function grow<T extends Int8Array | Int32Array>(from: T, to: T): T {
  to.set(from);
  return to;
}

/**
 * Feeds tokens from `lexAll` to the ANTLR parser as the generated lexer
 * would emit them (same factory, source, spans, lines and columns).
 */
export class BeancountFastLexer extends L {
  private next = 0;

  constructor(
    private readonly stream: StringCharStream,
    private readonly tokens: RawTokens,
  ) {
    super(stream);
  }

  public override nextToken(): Token {
    const t = this.tokens;
    const i = Math.min(this.next++, t.count - 1);
    this.tokenStartCharIndex = this.stream.indexOfOffset(t.start[i]!);
    this.currentTokenStartLine = t.line[i]!;
    this.currentTokenColumn = t.column[i]!;
    this.channel = 0;
    this.type = t.type[i]!;
    this.stream.index = this.stream.indexOfOffset(t.end[i]!);
    return this.emit();
  }
}
