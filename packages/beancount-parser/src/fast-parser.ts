import type { RawTokens } from './fast-lexer';
import {
  Amount,
  Balance,
  BeancountFile,
  Close,
  Commodity,
  Cost,
  Custom,
  Document,
  Event,
  IncompleteAmount,
  Include,
  Note,
  Open,
  Option,
  Pad,
  Plugin,
  Posting,
  Price,
  PriceAnnotation,
  Query,
  Transaction,
} from './model';
import type { CustomValue, Directive, Metadata, MetadataValue, SourceLocation } from './model';
import { BeancountLexer as L } from './parser/BeancountLexer';
import { calendarDate, unquote } from './values';
import type { ParsedNumber, SyntaxErrorInfo } from './values';

const EOF = -1;
const {
  EOL,
  INDENT,
  TXN,
  BALANCE,
  OPEN,
  CLOSE,
  COMMODITY,
  PAD,
  EVENT,
  QUERY,
  CUSTOM,
  PRICE,
  NOTE,
  DOCUMENT,
  PUSHTAG,
  POPTAG,
  PUSHMETA,
  POPMETA,
  OPTION,
  PLUGIN,
  INCLUDE,
  BOOL,
  NONE,
  DATE,
  ACCOUNT,
  CAPITAL,
  CURRENCY,
  STRING,
  NUMBER,
  TAG,
  LINK,
  KEY,
  PIPE,
  ATAT,
  AT,
  LCURLCURL,
  RCURLCURL,
  LCURL,
  RCURL,
  COMMA,
  TILDE,
  PLUS,
  MINUS,
  SLASH,
  LPAREN,
  RPAREN,
  HASH,
  ASTERISK,
  FLAG,
} = L;

// Deeper arithmetic nesting or longer operator chains go to the ANTLR path,
// which decides between a result and "input nested too deeply".
const MAX_NUMBER_DEPTH = 64;

/** Signals input this parser does not accept; the ANTLR parser then reports its exact errors. */
const NEEDS_ANTLR = Symbol('needs ANTLR');

/** A number expression before its finiteness check: value, literal spelling, token span. */
interface Num {
  value: number;
  text: string | undefined;
  first: number;
  last: number;
}

/**
 * Recursive-descent equivalent of the Beancount.g4 parser rules plus the
 * tree visitor in index.ts, over tokens from `lexAll`, without building
 * an ANTLR parse tree. Returns the file, with value errors (bad dates,
 * duplicate keys, ...) pushed to `errors` exactly as the visitor pushes
 * them; returns null on any syntax error, so the ANTLR parser can report
 * it with its own messages and recovery.
 */
export function fastParse(input: string, tokens: RawTokens, errors: SyntaxErrorInfo[]): BeancountFile | null {
  try {
    return new FastParser(input, tokens, errors).file();
  } catch (e) {
    if (e === NEEDS_ANTLR || e instanceof RangeError) return null;
    throw e;
  }
}

class FastParser {
  private p = 0;
  private readonly type: Int8Array;
  private readonly line: Int32Array;
  private readonly column: Int32Array;
  // Tags opened by `pushtag`; a list, as two pushes need two pops.
  private readonly pushedTags: { tag: string; token: number }[] = [];
  private readonly dateTimes = new Map<string, number>();

  constructor(
    private readonly input: string,
    private readonly tokens: RawTokens,
    private readonly errors: SyntaxErrorInfo[],
  ) {
    this.type = tokens.type;
    this.line = tokens.line;
    this.column = tokens.column;
  }

  file(): BeancountFile {
    const directives: Directive[] = [];
    for (;;) {
      const t = this.type[this.p];
      if (t === EOL) {
        this.p++;
      } else if (t === EOF) {
        break;
      } else {
        const directive = this.directive();
        if (directive !== null) directives.push(directive);
      }
    }
    for (const { tag, token } of this.pushedTags) this.error(token, `unbalanced pushed tag '${tag}'`);
    return new BeancountFile(directives);
  }

  // ---------------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------------

  private la(k: number): number {
    const i = this.p + k;
    return i < this.tokens.count ? this.type[i]! : EOF;
  }

  private text(i: number): string {
    return this.input.slice(this.tokens.start[i]!, this.tokens.end[i]!);
  }

  // Concatenated token texts of [first, last], as ParserRuleContext.getText().
  private spanText(first: number, last: number): string {
    let out = '';
    for (let i = first; i <= last; i++) out += this.text(i);
    return out;
  }

  private expect(type: number): number {
    if (this.type[this.p] !== type) throw NEEDS_ANTLR;
    return this.p++;
  }

  private expectText(type: number): string {
    return this.text(this.expect(type));
  }

  private commodity(): string {
    const t = this.type[this.p];
    if (t !== CURRENCY && t !== CAPITAL) throw NEEDS_ANTLR;
    return this.text(this.p++);
  }

  // eol: EOL | EOF. EOF is matched, not consumed.
  private eol(): void {
    const t = this.type[this.p];
    if (t === EOL) this.p++;
    else if (t !== EOF) throw NEEDS_ANTLR;
  }

  // As the visitor's location() over ANTLR's ctx.stop: the rule's last
  // consumed token. `eol` matches EOF as a token set, not via match(EOF), so
  // a rule ending at EOF stops on its last real token, which may be a
  // string spanning several lines.
  private location(start: number): SourceLocation {
    const stop = this.p - 1;
    const begin = { line: this.line[start]!, column: this.column[start]! };
    if (this.type[stop] === EOL) return { start: begin, end: { line: this.line[stop]!, column: this.column[stop]! } };
    const text = this.text(stop);
    const lastBreak = text.lastIndexOf('\n');
    const breaks = lastBreak === -1 ? 0 : text.split('\n').length - 1;
    return {
      start: begin,
      end: {
        line: this.line[stop]! + breaks,
        column: lastBreak === -1 ? this.column[stop]! + text.length : text.length - lastBreak - 1,
      },
    };
  }

  private error(token: number, message: string): void {
    this.errors.push({ line: this.line[token]!, column: this.column[token]!, message });
  }

  private date(token: number): Date {
    const text = this.text(token);
    const date = calendarDate(text, this.dateTimes);
    if (date !== null) return date;
    this.error(token, `invalid date '${text}'`);
    return new Date(NaN);
  }

  // ---------------------------------------------------------------------------
  // Directives
  // ---------------------------------------------------------------------------

  private directive(): Directive | null {
    switch (this.type[this.p]) {
      case DATE:
        switch (this.la(1)) {
          case TXN:
          case ASTERISK:
          case HASH:
          case FLAG:
          case CAPITAL:
            return this.transaction();
          case PRICE:
            return this.price();
          case BALANCE:
            return this.balance();
          case OPEN:
            return this.open();
          case CLOSE:
            return this.close();
          case COMMODITY:
            return this.commodityDirective();
          case PAD:
            return this.pad();
          case NOTE:
          case DOCUMENT:
            return this.noteOrDocument();
          case EVENT:
          case QUERY:
            return this.eventOrQuery();
          case CUSTOM:
            return this.custom();
        }
        throw NEEDS_ANTLR;
      case OPTION:
        return this.option();
      case PLUGIN:
        return this.plugin();
      case INCLUDE:
        return this.include();
      case PUSHTAG:
        return this.pushtag();
      case POPTAG:
        return this.poptag();
      case PUSHMETA:
        // `PUSHMETA key_value eol`: accepted, not applied, values not evaluated.
        this.p++;
        this.keyValue(null);
        this.eol();
        return null;
      case POPMETA:
        this.p++;
        this.expect(KEY);
        this.eol();
        return null;
    }
    throw NEEDS_ANTLR;
  }

  // DATE txn_flag txn_strings? tags_links eol (key_value_line | tags_links_line)* posting*
  private transaction(): Transaction {
    const start = this.p++;
    const flagToken = this.p++;
    // The `txn` keyword is an alias for the `*` flag.
    const flag = this.type[flagToken] === TXN ? '*' : this.text(flagToken);

    // (payee=STRING PIPE?)? narration=STRING
    let payee: string | null = null;
    let narration: string | null = null;
    if (this.type[this.p] === STRING) {
      const next = this.la(1);
      if (next === STRING || next === PIPE) {
        payee = unquote(this.text(this.p++));
        if (this.type[this.p] === PIPE) this.p++;
        narration = unquote(this.expectText(STRING));
      } else {
        narration = unquote(this.text(this.p++));
      }
    }

    const tags = new Set<string>();
    for (const pushed of this.pushedTags) tags.add(pushed.tag);
    const links = new Set<string>();
    this.tagsLinks(tags, links);
    this.eol();
    const date = this.date(start);

    const metadata: Metadata = {};
    while (this.type[this.p] === INDENT) {
      const next = this.la(1);
      if (next === KEY) {
        this.p++;
        this.keyValue(metadata);
        this.eol();
      } else if (next === TAG || next === LINK) {
        this.p++;
        this.tagsLinks(tags, links);
        this.eol();
      } else {
        break;
      }
    }

    const postings: Posting[] = [];
    while (this.type[this.p] === INDENT && this.startsPosting(this.la(1))) postings.push(this.posting());

    return new Transaction(date, flag, payee, narration, postings, this.location(start), metadata, [...tags], [...links]);
  }

  private startsPosting(t: number): boolean {
    return t === ACCOUNT || t === ASTERISK || t === HASH || t === FLAG || t === CAPITAL;
  }

  // (TAG | LINK)*
  private tagsLinks(tags: Set<string>, links: Set<string>): void {
    for (;;) {
      const t = this.type[this.p];
      if (t === TAG) tags.add(this.text(this.p++).slice(1));
      else if (t === LINK) links.add(this.text(this.p++).slice(1));
      else return;
    }
  }

  // INDENT flag? account incomplete_amount? cost? price_annotation? eol metadata
  private posting(): Posting {
    const start = this.p++;
    let flag: string | undefined;
    const first = this.type[this.p];
    if (first === ASTERISK || first === HASH || first === FLAG || first === CAPITAL) flag = this.text(this.p++);
    const account = this.expectText(ACCOUNT);
    let t = this.type[this.p]!;
    const amount = this.startsNumber(t) || t === CURRENCY || t === CAPITAL ? this.incompleteAmount() : undefined;
    t = this.type[this.p]!;
    const cost = t === LCURL || t === LCURLCURL ? this.cost() : undefined;
    t = this.type[this.p]!;
    let price: PriceAnnotation | undefined;
    if (t === AT || t === ATAT) {
      this.p++;
      const next = this.type[this.p]!;
      const priceAmount = this.startsNumber(next) || next === CURRENCY || next === CAPITAL ? this.incompleteAmount() : undefined;
      price = new PriceAnnotation(priceAmount, t === ATAT);
    }
    this.eol();
    const metadata = this.metadata();
    return new Posting(account, amount, cost, price, this.location(start), metadata, flag);
  }

  // DATE PRICE commodity amount eol metadata
  private price(): Price {
    const start = this.p;
    this.p += 2;
    const commodity = this.commodity();
    const amount = this.amount();
    this.eol();
    const metadata = this.metadata();
    return new Price(this.date(start), commodity, amount, this.location(start), metadata);
  }

  // DATE BALANCE account number (TILDE number)? commodity eol metadata
  private balance(): Balance {
    const start = this.p;
    this.p += 2;
    const account = this.expectText(ACCOUNT);
    const number = this.number(0, 0);
    let toleranceNumber: Num | null = null;
    if (this.type[this.p] === TILDE) {
      this.p++;
      toleranceNumber = this.number(0, 0);
    }
    const currency = this.commodity();
    this.eol();
    const metadata = this.metadata();
    const tolerance = toleranceNumber !== null ? this.checked(toleranceNumber) : undefined;
    const date = this.date(start);
    const checked = this.checked(number);
    return new Balance(
      date,
      account,
      new Amount(checked.value, currency, checked.text),
      this.location(start),
      metadata,
      tolerance?.value,
      tolerance?.text,
    );
  }

  // DATE OPEN account (commodity (COMMA commodity)*)? booking? eol metadata
  private open(): Open {
    const start = this.p;
    this.p += 2;
    const account = this.expectText(ACCOUNT);
    const currencies: string[] = [];
    const t = this.type[this.p];
    if (t === CURRENCY || t === CAPITAL) {
      currencies.push(this.commodity());
      while (this.type[this.p] === COMMA) {
        this.p++;
        currencies.push(this.commodity());
      }
    }
    const booking = this.type[this.p] === STRING ? unquote(this.text(this.p++)) : undefined;
    this.eol();
    const metadata = this.metadata();
    return new Open(this.date(start), account, currencies, booking, this.location(start), metadata);
  }

  // DATE CLOSE account eol metadata
  private close(): Close {
    const start = this.p;
    this.p += 2;
    const account = this.expectText(ACCOUNT);
    this.eol();
    const metadata = this.metadata();
    return new Close(this.date(start), account, this.location(start), metadata);
  }

  // DATE COMMODITY commodity eol metadata
  private commodityDirective(): Commodity {
    const start = this.p;
    this.p += 2;
    const currency = this.commodity();
    this.eol();
    const metadata = this.metadata();
    return new Commodity(this.date(start), currency, this.location(start), metadata);
  }

  // DATE PAD account account eol metadata
  private pad(): Pad {
    const start = this.p;
    this.p += 2;
    const account = this.expectText(ACCOUNT);
    const source = this.expectText(ACCOUNT);
    this.eol();
    const metadata = this.metadata();
    return new Pad(this.date(start), account, source, this.location(start), metadata);
  }

  // DATE (NOTE | DOCUMENT) account STRING tags_links eol metadata
  private noteOrDocument(): Note | Document {
    const start = this.p;
    const isNote = this.la(1) === NOTE;
    this.p += 2;
    const account = this.expectText(ACCOUNT);
    const text = unquote(this.expectText(STRING));
    const tags = new Set<string>();
    const links = new Set<string>();
    this.tagsLinks(tags, links);
    this.eol();
    const metadata = this.metadata();
    const date = this.date(start);
    return isNote
      ? new Note(date, account, text, this.location(start), metadata, [...tags], [...links])
      : new Document(date, account, text, this.location(start), metadata, [...tags], [...links]);
  }

  // DATE (EVENT | QUERY) STRING STRING eol metadata
  private eventOrQuery(): Event | Query {
    const start = this.p;
    const isEvent = this.la(1) === EVENT;
    this.p += 2;
    const first = unquote(this.expectText(STRING));
    const second = unquote(this.expectText(STRING));
    this.eol();
    const metadata = this.metadata();
    const date = this.date(start);
    return isEvent
      ? new Event(date, first, second, this.location(start), metadata)
      : new Query(date, first, second, this.location(start), metadata);
  }

  // DATE CUSTOM STRING custom_value* eol metadata
  // custom_value: STRING | DATE | BOOL | amount | number | account
  private custom(): Custom {
    const start = this.p;
    this.p += 2;
    const name = unquote(this.expectText(STRING));
    const date = this.date(start);
    const values: CustomValue[] = [];
    for (;;) {
      const t = this.type[this.p]!;
      if (t === STRING) {
        values.push(unquote(this.text(this.p++)));
      } else if (t === DATE) {
        values.push(this.date(this.p++));
      } else if (t === BOOL) {
        values.push(this.text(this.p++) === 'TRUE');
      } else if (t === ACCOUNT) {
        values.push(this.text(this.p++));
      } else if (this.startsNumber(t)) {
        values.push(this.numberOrAmount());
      } else {
        break;
      }
    }
    this.eol();
    const metadata = this.metadata();
    return new Custom(date, name, values, this.location(start), metadata);
  }

  // OPTION STRING STRING eol
  private option(): Option {
    const start = this.p++;
    const name = unquote(this.expectText(STRING));
    const value = unquote(this.expectText(STRING));
    this.eol();
    return new Option(name, value, this.location(start));
  }

  // PLUGIN STRING STRING? eol
  private plugin(): Plugin {
    const start = this.p++;
    const name = unquote(this.expectText(STRING));
    const config = this.type[this.p] === STRING ? unquote(this.text(this.p++)) : undefined;
    this.eol();
    return new Plugin(name, config, this.location(start));
  }

  // INCLUDE STRING eol
  private include(): Include {
    const start = this.p++;
    const filename = unquote(this.expectText(STRING));
    this.eol();
    return new Include(filename, this.location(start));
  }

  // PUSHTAG TAG eol
  private pushtag(): null {
    this.p++;
    const token = this.expect(TAG);
    this.eol();
    this.pushedTags.push({ tag: this.text(token).slice(1), token });
    return null;
  }

  // POPTAG TAG eol
  private poptag(): null {
    this.p++;
    const token = this.expect(TAG);
    this.eol();
    const tag = this.text(token).slice(1);
    const index = this.pushedTags.findLastIndex((p) => p.tag === tag);
    if (index === -1) this.error(token, `attempting to pop absent tag '${tag}'`);
    else this.pushedTags.splice(index, 1);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  // metadata: key_value_line*; key_value_line: INDENT key_value eol
  private metadata(): Metadata {
    const metadata: Metadata = {};
    while (this.type[this.p] === INDENT && this.la(1) === KEY) {
      this.p++;
      this.keyValue(metadata);
      this.eol();
    }
    return metadata;
  }

  // key_value: KEY key_value_value?, stored in `metadata`; null only checks syntax.
  // key_value_value: STRING | account | DATE | commodity | TAG | BOOL | NONE | amount | number
  private keyValue(metadata: Metadata | null): void {
    const keyToken = this.expect(KEY);
    const t = this.type[this.p]!;
    if (metadata === null) {
      if (this.startsNumber(t)) {
        this.number(0, 0);
        if (this.type[this.p] === CURRENCY || this.type[this.p] === CAPITAL) this.p++;
      } else if (
        t === STRING ||
        t === ACCOUNT ||
        t === DATE ||
        t === CURRENCY ||
        t === CAPITAL ||
        t === TAG ||
        t === BOOL ||
        t === NONE
      ) {
        this.p++;
      }
      return;
    }
    const key = this.text(keyToken).slice(0, -1);
    // Not `Object.hasOwn`: the Obsidian plugin type-checks this source against ES2021.
    if (Object.prototype.hasOwnProperty.call(metadata, key)) this.error(keyToken, `duplicate metadata key '${key}'`);
    let value: MetadataValue = null;
    if (t === STRING) value = unquote(this.text(this.p++));
    else if (t === ACCOUNT || t === CURRENCY || t === CAPITAL) value = this.text(this.p++);
    else if (t === DATE) value = this.date(this.p++);
    else if (t === TAG) value = this.text(this.p++).slice(1);
    else if (t === BOOL) value = this.text(this.p++) === 'TRUE';
    else if (t === NONE) this.p++;
    else if (this.startsNumber(t)) value = this.numberOrAmount();
    metadata[key] = value;
  }

  // ---------------------------------------------------------------------------
  // Amounts and numbers
  // ---------------------------------------------------------------------------

  // `number commodity?` where a following commodity makes it an amount.
  private numberOrAmount(): number | Amount {
    const number = this.number(0, 0);
    const t = this.type[this.p];
    if (t === CURRENCY || t === CAPITAL) {
      const currency = this.text(this.p++);
      const checked = this.checked(number);
      return new Amount(checked.value, currency, checked.text);
    }
    return this.checked(number).value;
  }

  // amount: number commodity
  private amount(): Amount {
    const number = this.number(0, 0);
    const currency = this.commodity();
    const checked = this.checked(number);
    return new Amount(checked.value, currency, checked.text);
  }

  // incomplete_amount: number commodity? | commodity
  private incompleteAmount(): Amount | IncompleteAmount {
    const number = this.startsNumber(this.type[this.p]!) ? this.checked(this.number(0, 0)) : null;
    const t = this.type[this.p];
    const currency = t === CURRENCY || t === CAPITAL ? this.text(this.p++) : null;
    return amountOrIncomplete(number, currency)!;
  }

  // LCURL cost_comp_list? RCURL | LCURLCURL cost_comp_list? RCURLCURL
  private cost(): Cost {
    const isTotal = this.type[this.p] === LCURLCURL;
    this.p++;
    const close = isTotal ? RCURLCURL : RCURL;
    const cost = new Cost();
    if (this.type[this.p] !== close) {
      this.costComponent(cost, isTotal);
      while (this.type[this.p] === COMMA) {
        this.p++;
        this.costComponent(cost, isTotal);
      }
    }
    this.expect(close);
    return cost;
  }

  // cost_comp: compound_amount | DATE | STRING | ASTERISK
  // compound_amount: number? HASH number? commodity | number commodity? | commodity
  // Errors in the visitor's order: duplicate, per-unit in total, then values.
  private costComponent(cost: Cost, isTotal: boolean): void {
    const first = this.p;
    const t = this.type[first]!;
    if (t === DATE || t === STRING || t === ASTERISK) {
      this.p++;
      const taken = t === DATE ? cost.date !== undefined : t === STRING ? cost.label !== undefined : cost.merge;
      if (taken) this.error(first, `duplicate cost component '${this.text(first)}'`);
      if (t === DATE) cost.date = this.date(first);
      else if (t === STRING) cost.label = unquote(this.text(first));
      else cost.merge = true;
      return;
    }

    let number: Num | null = null;
    let hash = false;
    let perUnit: Num | null = null;
    let total: Num | null = null;
    let currency: string | null = null;
    if (this.startsNumber(t)) number = this.number(0, 0);
    if (this.type[this.p] === HASH) {
      this.p++;
      hash = true;
      perUnit = number;
      if (this.startsNumber(this.type[this.p]!)) total = this.number(0, 0);
      currency = this.commodity();
    } else if (number !== null) {
      const c = this.type[this.p];
      if (c === CURRENCY || c === CAPITAL) currency = this.text(this.p++);
    } else {
      currency = this.commodity();
    }

    if (cost.amount !== undefined || cost.total !== undefined) {
      this.error(first, `duplicate cost component '${this.spanText(first, this.p - 1)}'`);
    }
    if (hash) {
      if (isTotal) this.error(first, 'per-unit cost not allowed in total cost {{...}}');
      const per = perUnit !== null ? this.checked(perUnit) : null;
      const tot = total !== null ? this.checked(total) : null;
      cost.amount = per !== null ? new Amount(per.value, currency!, per.text) : undefined;
      cost.total = tot !== null ? new Amount(tot.value, currency!, tot.text) : undefined;
      if (per === null && tot === null) cost.amount = new IncompleteAmount(null, currency);
    } else {
      const value = amountOrIncomplete(number !== null ? this.checked(number) : null, currency);
      if (isTotal) cost.total = value;
      else cost.amount = value;
    }
  }

  private startsNumber(t: number): boolean {
    return t === NUMBER || t === LPAREN || t === MINUS || t === PLUS;
  }

  /**
   * number[prec], as ANTLR rewrites the left-recursive rule:
   *   primary: NUMBER | LPAREN number[0] RPAREN | (MINUS | PLUS) number[3]
   *   then, while allowed: (ASTERISK | SLASH) number[3] if 2 >= prec,
   *                        (PLUS | MINUS) number[2] if 1 >= prec
   * Values and spellings follow the visitor: a literal or signs on a literal
   * keep their spelling, anything else is an expression without one.
   */
  private number(prec: number, depth: number): Num {
    if (depth > MAX_NUMBER_DEPTH) throw NEEDS_ANTLR;
    const first = this.p;
    const t = this.type[first];
    let value: number;
    let text: string | undefined;
    if (t === NUMBER) {
      const raw = this.text(this.p++);
      text = raw.includes(',') ? raw.replace(/,/g, '') : raw;
      value = Number(text);
    } else if (t === LPAREN) {
      this.p++;
      value = this.number(0, depth + 1).value;
      this.expect(RPAREN);
    } else if (t === MINUS || t === PLUS) {
      this.p++;
      const inner = this.number(3, depth + 1);
      value = t === MINUS ? -inner.value : inner.value;
      text = inner.text === undefined ? undefined : (t === MINUS ? '-' : '+') + inner.text;
    } else {
      throw NEEDS_ANTLR;
    }
    for (let operators = 0; ; operators++) {
      const op = this.type[this.p];
      let right: Num;
      if ((op === ASTERISK || op === SLASH) && prec <= 2) {
        this.p++;
        right = this.number(3, depth + 1);
        value = op === ASTERISK ? value * right.value : value / right.value;
      } else if ((op === PLUS || op === MINUS) && prec <= 1) {
        this.p++;
        right = this.number(2, depth + 1);
        value = op === PLUS ? value + right.value : value - right.value;
      } else {
        break;
      }
      // The visitor evaluates a chain recursively, one level per operator.
      if (depth + operators > MAX_NUMBER_DEPTH) throw NEEDS_ANTLR;
      text = undefined;
    }
    return { value, text, first, last: this.p - 1 };
  }

  // Non-finite results (1/0, overflow) are errors, as upstream's Decimal raises on them.
  private checked(number: Num): ParsedNumber {
    if (!Number.isFinite(number.value)) {
      this.error(number.first, `invalid number '${this.spanText(number.first, number.last)}'`);
    }
    return number.text === undefined ? { value: number.value } : { value: number.value, text: number.text };
  }
}

function amountOrIncomplete(number: ParsedNumber | null, currency: string | null): Amount | IncompleteAmount | undefined {
  if (number !== null && currency !== null) return new Amount(number.value, currency, number.text);
  if (number === null && currency === null) return undefined;
  return new IncompleteAmount(number?.value ?? null, currency, number?.text);
}
