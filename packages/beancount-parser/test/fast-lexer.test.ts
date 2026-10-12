import { describe, expect, test } from "bun:test";
import { BaseErrorListener, CommonTokenStream } from "antlr4ng";
import { StringCharStream } from "../src/char-stream";
import { BeancountFastLexer, NeedsAntlrLexer } from "../src/fast-lexer";
import { BeancountLexer } from "../src/parser/BeancountLexer";

// The hand-written lexer must produce exactly the generated lexer's tokens
// on every input the generated lexer accepts, and give up on every input it
// reports an error for. Editing a lexer rule in Beancount.g4 without
// mirroring it in fast-lexer.ts fails here.

function dump(tokens: CommonTokenStream): string[] {
  return tokens.getTokens().map((t) => `${t.type}|${t.start}|${t.stop}|${t.line}|${t.column}|${t.channel}`);
}

/** Generated lexer's tokens, or null when it reports an error. */
function antlrTokens(input: string): string[] | null {
  let failed = false;
  const lexer = new BeancountLexer(new StringCharStream(input));
  lexer.removeErrorListeners();
  lexer.addErrorListener(
    new (class extends BaseErrorListener {
      override syntaxError() {
        failed = true;
      }
    })(),
  );
  const tokens = new CommonTokenStream(lexer);
  tokens.fill();
  return failed ? null : dump(tokens);
}

/** Fast lexer's tokens, or null when it gives up. */
function fastTokens(input: string): string[] | null {
  const tokens = new CommonTokenStream(new BeancountFastLexer(new StringCharStream(input)));
  try {
    tokens.fill();
  } catch (e) {
    if (e instanceof NeedsAntlrLexer) return null;
    throw e;
  }
  return dump(tokens);
}

// Rule boundaries: every token's first chars, near-misses (`TRU`, `Assets:`,
// `2022-01`), column-0 forms, CRLF, non-ASCII and astral code points.
const PIECES = [
  " ", "  ", "\t", "\r", "\n", "\n", "\r\n", ";", '"', "\\", "#", "^", "/", "|", "@", "{", "}", ",", "~",
  "+", "-", "(", ")", "*", "!", "&", "?", "%", ":", ".", "'", "_", "0", "1", "2", "7", "9", "A", "B", "T",
  "R", "U", "E", "F", "N", "L", "S", "a", "x", "o", "餐", "😀", "\uD800", "\0", "\u0300", "é",
  "txn", "open", "close", "pushtag", "pushmeta", "popmeta", "poptag", "price", "pad", "note", "balance",
  "commodity", "custom", "query", "event", "document", "option", "plugin", "include", "TRUE", "FALSE",
  "NULL", "TRU", "2022-01-01", "1999/1/2", "2022-01", "17", "20", "1,000.5", "1,", "12.", "Assets:Cash",
  "Assets:", "A:B", ":Cash", "key:", "k:", "USD", "U.S", "A'", "/ES", "/1", "#tag", "^link", '"str"',
  '"a\\"b"', "@@", "{{", "}}", "Expenses:餐饮", "餐:饮", "\n  ", "\n\t", "\n  ;c\n", "\n* h\n", "\n:x",
];

describe("fast lexer matches the generated lexer", () => {
  test("random concatenations of rule boundaries", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let accepted = 0;
    for (let i = 0; i < 100_000; i++) {
      const count = 1 + Math.floor(random() * 20);
      let input = "";
      for (let j = 0; j < count; j++) input += PIECES[Math.floor(random() * PIECES.length)];
      const expected = antlrTokens(input);
      if (expected !== null) accepted++;
      expect({ input, tokens: fastTokens(input) }).toEqual({ input, tokens: expected });
    }
    // Both outcomes are exercised, not just errors.
    expect(accepted).toBeGreaterThan(20_000);
  });

  test("a ledger", () => {
    const ledger = [
      'option "title" "T"',
      "2022-01-01 open Assets:Cash USD,CNY",
      "2022-01-02 * \"Shop\" \"Lunch\" #food ^r1",
      "  receipt: \"x.pdf\"",
      "  Expenses:餐饮:午餐   12.50 CNY @ 0.14 USD ; note",
      "  ; indented comment",
      "  Assets:Broker   10 AAPL {150.00 USD, 2022-01-01, \"lot\"}",
      "  Assets:Cash",
      "* org heading",
      "2022-01-03 balance Assets:Cash  -1,234.5 ~ 0.01 USD",
      "2022-01-04 custom \"budget\" Assets:Cash TRUE 10 USD",
      "pushtag #trip",
      "",
    ].join("\r\n");
    const expected = antlrTokens(ledger);
    expect(expected).not.toBeNull();
    expect(fastTokens(ledger)).toEqual(expected);
  });
});
