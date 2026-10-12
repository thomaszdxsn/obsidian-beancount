import { BaseErrorListener, CommonTokenStream, Token } from 'antlr4ng';
import type { ParserRuleContext, TerminalNode } from 'antlr4ng';

import { StringCharStream } from './char-stream';

import {
  BeancountFile,
  Transaction,
  Posting,
  Amount,
  IncompleteAmount,
  Cost,
  PriceAnnotation,
  Price,
  Balance,
  Open,
  Close,
  Commodity,
  Pad,
  Note,
  Document,
  Event,
  Query,
  Custom,
  Option,
  Plugin,
  Include,
} from './model';

import type {
  CustomValue,
  Directive,
  Metadata,
  MetadataValue,
  SourceLocation,
} from './model';

import { BeancountLexer } from './parser/BeancountLexer';
import { BeancountParser as AntlrBeancountParser } from './parser/BeancountParser';
import type {
  AmountContext,
  BalanceContext,
  BeancountFileContext,
  CloseContext,
  Commodity_directiveContext,
  CostContext,
  CustomContext,
  Custom_valueContext,
  DirectiveContext,
  DocumentContext,
  EventContext,
  IncludeContext,
  Incomplete_amountContext,
  Key_value_lineContext,
  Key_value_valueContext,
  NoteContext,
  NumberContext,
  OpenContext,
  OptionsContext,
  PadContext,
  PluginContext,
  PopmetaContext,
  PoptagContext,
  PostingContext,
  PriceContext,
  PushmetaContext,
  PushtagContext,
  QueryContext,
  Tags_linksContext,
  Tags_links_lineContext,
  TransactionContext,
} from './parser/BeancountParser';
import { BeancountVisitor } from './parser/BeancountVisitor';

/** One lexer, parser or value error; `line` is 1-based, `column` 0-based. */
export interface SyntaxErrorInfo {
  line: number;
  column: number;
  message: string;
}

/** Thrown by `BeancountParser.parse()` when the input is not valid Beancount. */
export class BeancountSyntaxError extends Error {
  readonly errors: SyntaxErrorInfo[];

  constructor(errors: SyntaxErrorInfo[]) {
    super(errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('\n'));
    this.name = 'BeancountSyntaxError';
    this.errors = errors;
  }
}

class CollectingErrorListener extends BaseErrorListener {
  constructor(private readonly errors: SyntaxErrorInfo[]) {
    super();
  }

  override syntaxError(_r: unknown, _s: unknown, line: number, column: number, message: string): void {
    this.errors.push({ line, column, message });
  }
}

const UNESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', b: '\b' };

/** A number and, when it is a plain literal, its source spelling. */
interface ParsedNumber {
  value: number;
  text?: string;
}

// Maps a syntactically valid parse tree to model objects. Errors in values the
// grammar cannot reject (e.g. 2022-02-30) are pushed to `errors`.
class BeancountParserVisitor extends BeancountVisitor<Directive | null> {
  // Tags opened by `pushtag`, applied to every following transaction. A list,
  // not a set: pushing a tag twice needs two pops, as upstream.
  private readonly pushedTags: { tag: string; at: Token }[] = [];

  constructor(private readonly errors: SyntaxErrorInfo[]) {
    super();
  }

  buildFile(ctx: BeancountFileContext): BeancountFile {
    const directives: Directive[] = [];
    for (const d of ctx.directive()) {
      const directive = this.visit(d);
      if (directive) directives.push(directive);
    }
    for (const { tag, at } of this.pushedTags) this.error(at, `unbalanced pushed tag '${tag}'`);
    return new BeancountFile(directives);
  }

  visitDirective = (ctx: DirectiveContext): Directive | null => {
    return this.visit(ctx.getChild(0)!);
  };

  visitTransaction = (ctx: TransactionContext): Transaction => {
    const flagCtx = ctx.txn_flag();
    // The `txn` keyword is an alias for the `*` flag.
    const flag = flagCtx.TXN() ? '*' : flagCtx.getText();
    const strings = ctx.txn_strings();
    const payee = strings?._payee ? this.unquote(strings._payee.text!) : null;
    const narration = strings?._narration ? this.unquote(strings._narration.text!) : null;

    const tags = new Set(this.pushedTags.map((p) => p.tag));
    const links = new Set<string>();
    for (const tl of [ctx.tags_links(), ...ctx.tags_links_line()]) {
      this.collectTagsLinks(tl, tags, links);
    }

    return new Transaction(
      this.date(ctx.DATE()),
      flag,
      payee,
      narration,
      ctx.posting().map(this.posting),
      this.location(ctx),
      this.metadata(ctx.key_value_line()),
      [...tags],
      [...links],
    );
  };

  private posting = (ctx: PostingContext): Posting => {
    const amount = ctx.incomplete_amount();
    const cost = ctx.cost();
    const price = ctx.price_annotation();
    const priceAmount = price?.incomplete_amount();
    return new Posting(
      ctx.account().getText(),
      amount ? this.incompleteAmount(amount) : undefined,
      cost ? this.cost(cost) : undefined,
      price ? new PriceAnnotation(priceAmount ? this.incompleteAmount(priceAmount) : undefined, price.ATAT() !== null) : undefined,
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
      ctx.flag()?.getText(),
    );
  };

  visitPrice = (ctx: PriceContext): Price => {
    return new Price(
      this.date(ctx.DATE()),
      ctx.commodity().getText(),
      this.amount(ctx.amount()),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitBalance = (ctx: BalanceContext): Balance => {
    const tolerance = ctx._tolerance ? this.parsedNumber(ctx._tolerance) : undefined;
    return new Balance(
      this.date(ctx.DATE()),
      ctx.account().getText(),
      this.amountFrom(this.parsedNumber(ctx._balanceNumber!), ctx.commodity().getText()),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
      tolerance?.value,
      tolerance?.text,
    );
  };

  visitOpen = (ctx: OpenContext): Open => {
    const booking = ctx.booking();
    return new Open(
      this.date(ctx.DATE()),
      ctx.account().getText(),
      ctx.commodity().map((c) => c.getText()),
      booking ? this.unquote(booking.STRING().getText()) : undefined,
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitClose = (ctx: CloseContext): Close => {
    return new Close(
      this.date(ctx.DATE()),
      ctx.account().getText(),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitCommodity_directive = (ctx: Commodity_directiveContext): Commodity => {
    return new Commodity(
      this.date(ctx.DATE()),
      ctx.commodity().getText(),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitPad = (ctx: PadContext): Pad => {
    return new Pad(
      this.date(ctx.DATE()),
      ctx.account(0)!.getText(),
      ctx.account(1)!.getText(),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitNote = (ctx: NoteContext): Note => {
    const tags = new Set<string>();
    const links = new Set<string>();
    this.collectTagsLinks(ctx.tags_links(), tags, links);
    return new Note(
      this.date(ctx.DATE()),
      ctx.account().getText(),
      this.unquote(ctx.STRING().getText()),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
      [...tags],
      [...links],
    );
  };

  visitDocument = (ctx: DocumentContext): Document => {
    const tags = new Set<string>();
    const links = new Set<string>();
    this.collectTagsLinks(ctx.tags_links(), tags, links);
    return new Document(
      this.date(ctx.DATE()),
      ctx.account().getText(),
      this.unquote(ctx.STRING().getText()),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
      [...tags],
      [...links],
    );
  };

  visitEvent = (ctx: EventContext): Event => {
    return new Event(
      this.date(ctx.DATE()),
      this.unquote(ctx.STRING(0)!.getText()),
      this.unquote(ctx.STRING(1)!.getText()),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitQuery = (ctx: QueryContext): Query => {
    return new Query(
      this.date(ctx.DATE()),
      this.unquote(ctx.STRING(0)!.getText()),
      this.unquote(ctx.STRING(1)!.getText()),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitCustom = (ctx: CustomContext): Custom => {
    return new Custom(
      this.date(ctx.DATE()),
      this.unquote(ctx.STRING().getText()),
      ctx.custom_value().map((v) => this.customValue(v)),
      this.location(ctx),
      this.metadata(ctx.metadata().key_value_line()),
    );
  };

  visitOptions = (ctx: OptionsContext): Option => {
    return new Option(
      this.unquote(ctx.STRING(0)!.getText()),
      this.unquote(ctx.STRING(1)!.getText()),
      this.location(ctx),
    );
  };

  visitPlugin = (ctx: PluginContext): Plugin => {
    const config = ctx.STRING(1);
    return new Plugin(
      this.unquote(ctx.STRING(0)!.getText()),
      config ? this.unquote(config.getText()) : undefined,
      this.location(ctx),
    );
  };

  visitInclude = (ctx: IncludeContext): Include => {
    return new Include(this.unquote(ctx.STRING().getText()), this.location(ctx));
  };

  visitPushtag = (ctx: PushtagContext): null => {
    this.pushedTags.push({ tag: ctx.TAG().getText().slice(1), at: ctx.TAG().symbol });
    return null;
  };

  visitPoptag = (ctx: PoptagContext): null => {
    const tag = ctx.TAG().getText().slice(1);
    const index = this.pushedTags.findLastIndex((p) => p.tag === tag);
    if (index === -1) this.error(ctx.TAG().symbol, `attempting to pop absent tag '${tag}'`);
    else this.pushedTags.splice(index, 1);
    return null;
  };

  // pushmeta/popmeta are accepted but not applied: the model has no slot for them yet.
  visitPushmeta = (_ctx: PushmetaContext): null => null;
  visitPopmeta = (_ctx: PopmetaContext): null => null;

  // -------------------------------------------------------------------------
  // Value helpers
  // -------------------------------------------------------------------------

  private amount(ctx: AmountContext): Amount {
    return this.amountFrom(this.parsedNumber(ctx.number()), ctx.commodity().getText());
  }

  private incompleteAmount(ctx: Incomplete_amountContext): Amount | IncompleteAmount {
    const num = ctx.number();
    return this.amountOrIncomplete(num ? this.parsedNumber(num) : null, ctx.commodity()?.getText() ?? null)!;
  }

  private amountFrom(parsed: ParsedNumber, currency: string): Amount {
    return new Amount(parsed.value, currency, parsed.text);
  }

  private amountOrIncomplete(
    num: ParsedNumber | null,
    currency: string | null,
  ): Amount | IncompleteAmount | undefined {
    if (num !== null && currency !== null) return this.amountFrom(num, currency);
    if (num === null && currency === null) return undefined;
    return new IncompleteAmount(num?.value ?? null, currency, num?.text);
  }

  // Arithmetic expression, evaluated as written. 1/0, 0/0 and overflow are
  // errors, as upstream's Decimal evaluation raises on them.
  private number(ctx: NumberContext): number {
    return this.parsedNumber(ctx).value;
  }

  private parsedNumber(ctx: NumberContext): ParsedNumber {
    const value = this.evaluate(ctx);
    if (!Number.isFinite(value)) this.error(ctx.start!, `invalid number '${ctx.getText()}'`);
    const text = this.literalText(ctx);
    return text === undefined ? { value } : { value, text };
  }

  /**
   * Sign plus the comma-stripped digits when the tree is only unary signs on a
   * NUMBER. Parentheses and binary operators are expressions, so they keep no spelling.
   */
  private literalText(ctx: NumberContext): string | undefined {
    const literal = ctx.NUMBER();
    if (literal) return literal.getText().replace(/,/g, '');
    if (ctx.LPAREN() || ctx.number_().length !== 1) return undefined;
    if (!ctx.MINUS() && !ctx.PLUS()) return undefined;
    const inner = this.literalText(ctx.number_(0)!);
    if (inner === undefined) return undefined;
    return (ctx.MINUS() ? '-' : '+') + inner;
  }

  private evaluate(ctx: NumberContext): number {
    const literal = ctx.NUMBER();
    if (literal) return Number(literal.getText().replace(/,/g, ''));
    const operands = ctx.number_().map((n) => this.evaluate(n));
    if (ctx.LPAREN()) return operands[0]!;
    if (operands.length === 1) return ctx.MINUS() ? -operands[0]! : operands[0]!;
    const [a, b] = operands as [number, number];
    if (ctx.ASTERISK()) return a * b;
    if (ctx.SLASH()) return a / b;
    if (ctx.PLUS()) return a + b;
    return a - b;
  }
  private cost(ctx: CostContext): Cost {
    const isTotal = ctx.LCURLCURL() !== null;
    const cost = new Cost();
    for (const comp of ctx.cost_comp_list()?.cost_comp() ?? []) {
      const date = comp.DATE();
      const label = comp.STRING();
      const compound = comp.compound_amount();
      const taken =
        date ? cost.date !== undefined
        : label ? cost.label !== undefined
        : compound ? cost.amount !== undefined || cost.total !== undefined
        : cost.merge;
      // Upstream rejects a repeated component instead of letting the last win.
      if (taken) this.error(comp.start!, `duplicate cost component '${comp.getText()}'`);
      if (date) cost.date = this.date(date);
      else if (label) cost.label = this.unquote(label.getText());
      else if (comp.ASTERISK()) cost.merge = true;
      else if (compound) {
        const currency = compound.commodity()?.getText() ?? null;
        if (compound.HASH()) {
          if (isTotal) this.error(compound.start!, 'per-unit cost not allowed in total cost {{...}}');
          const per = compound._perUnit ? this.parsedNumber(compound._perUnit) : null;
          const total = compound._total ? this.parsedNumber(compound._total) : null;
          cost.amount = per !== null ? this.amountFrom(per, currency!) : undefined;
          cost.total = total !== null ? this.amountFrom(total, currency!) : undefined;
          if (per === null && total === null) cost.amount = new IncompleteAmount(null, currency);
        } else {
          const num = compound.number_(0);
          const value = this.amountOrIncomplete(num ? this.parsedNumber(num) : null, currency);
          if (isTotal) cost.total = value;
          else cost.amount = value;
        }
      }
    }
    return cost;
  }

  private metadata(lines: Key_value_lineContext[]): Metadata {
    const meta: Metadata = {};
    for (const line of lines) {
      const kv = line.key_value();
      const value = kv.key_value_value();
      const key = kv.KEY().getText().slice(0, -1);
      // Not `Object.hasOwn`: the Obsidian plugin type-checks this source against ES2021.
      if (Object.prototype.hasOwnProperty.call(meta, key)) this.error(kv.KEY().symbol, `duplicate metadata key '${key}'`);
      meta[key] = value ? this.metadataValue(value) : null;
    }
    return meta;
  }

  private metadataValue(ctx: Key_value_valueContext): MetadataValue {
    const str = ctx.STRING();
    if (str) return this.unquote(str.getText());
    const date = ctx.DATE();
    if (date) return this.date(date);
    const tag = ctx.TAG();
    if (tag) return tag.getText().slice(1);
    const bool = ctx.BOOL();
    if (bool) return bool.getText() === 'TRUE';
    if (ctx.NONE()) return null;
    const amount = ctx.amount();
    if (amount) return this.amount(amount);
    const num = ctx.number();
    if (num) return this.number(num);
    // account or commodity
    return ctx.getText();
  }

  private customValue(ctx: Custom_valueContext): CustomValue {
    const str = ctx.STRING();
    if (str) return this.unquote(str.getText());
    const date = ctx.DATE();
    if (date) return this.date(date);
    const bool = ctx.BOOL();
    if (bool) return bool.getText() === 'TRUE';
    const amount = ctx.amount();
    if (amount) return this.amount(amount);
    const num = ctx.number();
    if (num) return this.number(num);
    // account
    return ctx.getText();
  }

  private collectTagsLinks(
    ctx: Tags_linksContext | Tags_links_lineContext,
    tags: Set<string>,
    links: Set<string>,
  ): void {
    for (const t of ctx.TAG()) tags.add(t.getText().slice(1));
    for (const l of ctx.LINK()) links.add(l.getText().slice(1));
  }

  // DATE accepts `-` or `/` separators and unpadded parts; the calendar check
  // happens here because the lexer cannot reject e.g. 2022-02-30.
  private date(node: TerminalNode): Date {
    const text = node.getText();
    const [year, month, day] = text.split(/[-/]/).map(Number) as [number, number, number];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      this.error(node.symbol, `invalid date '${text}'`);
    }
    return date;
  }

  // Escapes as upstream's cunescape; any other escaped char stands for itself.
  private unquote(str: string): string {
    return str.slice(1, -1).replace(/\\(.)/gs, (_m, c: string) => UNESCAPES[c] ?? c);
  }

  // Span of the rule's own text: ends before the newline that terminates it.
  // A directive that ends at EOF ends on its last token, which may be a
  // string spanning several lines.
  private location(ctx: ParserRuleContext): SourceLocation {
    const start = ctx.start!;
    const stop = ctx.stop ?? start;
    const atLineEnd = stop.type === AntlrBeancountParser.EOL || stop.type === Token.EOF;
    if (atLineEnd) {
      return { start: { line: start.line, column: start.column }, end: { line: stop.line, column: stop.column } };
    }
    const text = stop.text ?? '';
    const lastBreak = text.lastIndexOf('\n');
    const breaks = lastBreak === -1 ? 0 : text.split('\n').length - 1;
    return {
      start: { line: start.line, column: start.column },
      end: {
        line: stop.line + breaks,
        column: lastBreak === -1 ? stop.column + text.length : text.length - lastBreak - 1,
      },
    };
  }

  private error(at: { line: number; column: number }, message: string): void {
    this.errors.push({ line: at.line, column: at.column, message });
  }
}

export class BeancountParser {
  /**
   * Parse Beancount text into a BeancountFile object.
   *
   * @param input The Beancount file content
   * @returns BeancountFile object containing all parsed directives
   * @throws BeancountSyntaxError listing every lexer and parser error in source
   *   order; when there are none, every value error (bad date, duplicate key,
   *   unbalanced pushtag, ...) instead
   */
  static parse(input: string): BeancountFile {
    const errors: SyntaxErrorInfo[] = [];
    const listener = new CollectingErrorListener(errors);

    const lexer = new BeancountLexer(new StringCharStream(input));
    lexer.removeErrorListeners();
    lexer.addErrorListener(listener);
    const parser = new AntlrBeancountParser(new CommonTokenStream(lexer));
    parser.removeErrorListeners();
    parser.addErrorListener(listener);

    try {
      const tree = parser.beancountFile();
      // A tree built through error recovery holds phantom directives; never map it.
      if (errors.length === 0) {
        const file = new BeancountParserVisitor(errors).buildFile(tree);
        if (errors.length === 0) return file;
      }
    } catch (e) {
      // Both the ANTLR parser and the visitor recurse per nesting level.
      if (!(e instanceof RangeError)) throw e;
      throw new BeancountSyntaxError([{ line: 1, column: 0, message: 'input nested too deeply' }]);
    }
    // The token stream reads ahead, so lexer errors can arrive out of order.
    errors.sort((a, b) => a.line - b.line || a.column - b.column);
    throw new BeancountSyntaxError(errors);
  }
}
