import { BaseErrorListener, CharStream, CommonTokenStream } from "antlr4ng";
import { BeancountLexer } from "../src/parser/BeancountLexer";
import {
  BeancountParser as AntlrBeancountParser,
  type BeancountFileContext,
} from "../src/parser/BeancountParser";

// Runs the generated lexer + parser directly. BeancountParser.parse() recovers
// from syntax errors silently, so grammar assertions must go through here.
export function parseRaw(input: string): {
  errors: string[];
  tree: BeancountFileContext;
  parser: AntlrBeancountParser;
} {
  const errors: string[] = [];
  const listener = new (class extends BaseErrorListener {
    override syntaxError(_r: unknown, _s: unknown, line: number, column: number, msg: string) {
      errors.push(`${line}:${column} ${msg}`);
    }
  })();
  const lexer = new BeancountLexer(CharStream.fromString(input));
  lexer.removeErrorListeners();
  lexer.addErrorListener(listener);
  const parser = new AntlrBeancountParser(new CommonTokenStream(lexer));
  parser.removeErrorListeners();
  parser.addErrorListener(listener);
  const tree = parser.beancountFile();
  return { errors, tree, parser };
}

// Token stream as `NAME` or `NAME:text` (text only for value-carrying tokens),
// with lexer errors collected separately. EOF is omitted.
export function lexRaw(input: string): { tokens: string[]; errors: string[] } {
  const errors: string[] = [];
  const lexer = new BeancountLexer(CharStream.fromString(input));
  lexer.removeErrorListeners();
  lexer.addErrorListener(
    new (class extends BaseErrorListener {
      override syntaxError(_r: unknown, _s: unknown, line: number, column: number, msg: string) {
        errors.push(`${line}:${column} ${msg}`);
      }
    })(),
  );
  const tokens = lexer.getAllTokens().map((t) => {
    const name = lexer.vocabulary.getSymbolicName(t.type) ?? String(t.type);
    return VALUE_TOKENS[name] ? `${name}:${t.text}` : name;
  });
  return { tokens, errors };
}

const VALUE_TOKENS: Record<string, true> = {
  DATE: true, ACCOUNT: true, CURRENCY: true, CAPITAL: true, STRING: true, NUMBER: true,
  TAG: true, LINK: true, KEY: true, BOOL: true, FLAG: true,
};
