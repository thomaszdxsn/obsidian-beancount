import { CharStream, CommonTokenStream } from 'antlr4ng';

import {
  BeancountFile,
  Transaction,
  Posting,
  Amount,
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
  Directive,
  Metadata,
} from './model';

import { BeancountLexer } from './parser/BeancountLexer';
import { BeancountParser as AntlrBeancountParser } from './parser/BeancountParser';
import type {
  AccountContext,
  AmountContext,
  BalanceContext,
  BeancountFileContext,
  CloseContext,
  CommodityContext,
  Commodity_directiveContext,
  CostContext,
  CustomContext,
  DirectiveContext,
  DocumentContext,
  EventContext,
  IncludeContext,
  MetadataContext,
  NoteContext,
  NumberContext,
  OpenContext,
  OptionsContext,
  PadContext,
  PluginContext,
  PostingContext,
  Price_annotationContext,
  PriceContext,
  QueryContext,
  TransactionContext,
} from './parser/BeancountParser';
import { BeancountVisitor } from './parser/BeancountVisitor';

class BeancountParserVisitor extends BeancountVisitor<any> {

  // File visitor
  visitBeancountFile = (ctx: BeancountFileContext): BeancountFile => {
    const directives = ctx
      .directive()
      .map((d) => this.visit(d) as Directive | null)
      .filter((d): d is Directive => d !== null);
    return new BeancountFile(directives);
  };

  visitDirective = (ctx: DirectiveContext): Directive | null => {
    const child = ctx.getChild(0);
    return child ? (this.visit(child) as Directive | null) : null;
  };

  // These methods would be implemented in a real parser
  visitTransaction = (ctx: TransactionContext): Transaction => {
    return new Transaction(new Date(), "*", null, null, []);
  };
  visitPosting = (ctx: PostingContext): Posting => {
    return new Posting("Assets:Demo");
  };
  visitAmount = (ctx: AmountContext): Amount => {
    return new Amount(0, "USD");
  };
  visitNumber = (ctx: NumberContext): number => {
    return 0;
  };
  visitCommodity = (ctx: CommodityContext): string => {
    return "USD";
  };
  visitCost = (ctx: CostContext): Cost => {
    return new Cost();
  };
  visitPrice_annotation = (ctx: Price_annotationContext): PriceAnnotation => {
    return new PriceAnnotation(new Amount(0, "USD"));
  };
  visitMetadata = (ctx: MetadataContext): Metadata => {
    return {};
  };
  visitPrice = (ctx: PriceContext): Price => {
    return new Price(new Date(), "USD", new Amount(0, "USD"));
  };
  visitBalance = (ctx: BalanceContext): Balance => {
    return new Balance(new Date(), "Assets:Demo", new Amount(0, "USD"));
  };
  visitOpen = (ctx: OpenContext): Open => {
    return new Open(new Date(), "Assets:Demo", ["USD"]);
  };
  visitClose = (ctx: CloseContext): Close => {
    return new Close(new Date(), "Assets:Demo");
  };
  visitCommodity_directive = (ctx: Commodity_directiveContext): Commodity => {
    return new Commodity(new Date(), "USD");
  };
  visitPad = (ctx: PadContext): Pad => {
    return new Pad(new Date(), "Assets:Demo", "Assets:Other");
  };
  visitNote = (ctx: NoteContext): Note => {
    return new Note(new Date(), "Assets:Demo", "Demo note");
  };
  visitDocument = (ctx: DocumentContext): Document => {
    return new Document(new Date(), "Assets:Demo", "path/to/doc.pdf");
  };
  visitEvent = (ctx: EventContext): Event => {
    return new Event(new Date(), "demo", "Demo event");
  };
  visitQuery = (ctx: QueryContext): Query => {
    return new Query(new Date(), "demo", "SELECT * FROM accounts");
  };
  visitCustom = (ctx: CustomContext): Custom => {
    return new Custom(new Date(), "demo", []);
  };
  visitOptions = (ctx: OptionsContext): Option => {
    return new Option("operating_currency", "USD");
  };
  visitPlugin = (ctx: PluginContext): Plugin => {
    return new Plugin("demo_plugin");
  };
  visitInclude = (ctx: IncludeContext): Include => {
    return new Include("path/to/include.bean");
  };
  visitAccount = (ctx: AccountContext): string => {
    return "Assets:Demo";
  };

  // Helper method to convert date string to Date object
  private parseDate(dateStr: string): Date {
    const parts = dateStr.split('-').map(Number);
    const year = parts[0] || 2023;
    const month = parts[1] || 1;
    const day = parts[2] || 1;
    return new Date(year, month - 1, day);
  }

  // Helper method to remove quotes from string
  private unquote(str: string): string {
    return str.slice(1, -1).replace(/\\"/g, '"');
  }
}

// Main parser class that will be exported
export class BeancountParser {
  /**
   * Parse Beancount text into a BeancountFile object
   *
   * @param input The Beancount file content
   * @returns BeancountFile object containing all parsed directives
   */
  static parse(input: string): BeancountFile {
    const lexer = new BeancountLexer(CharStream.fromString(input));
    const parser = new AntlrBeancountParser(new CommonTokenStream(lexer));
    const tree = parser.beancountFile();
    return new BeancountParserVisitor().visitBeancountFile(tree);
  }
}
