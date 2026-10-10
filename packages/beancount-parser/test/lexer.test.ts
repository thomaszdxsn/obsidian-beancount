import { describe, expect, test } from "bun:test";
import { lexRaw } from "./antlr";

// Token-level checks for the lexer rules whose precedence or line-position
// predicates are easy to break when editing Beancount.g4.

function tokens(input: string): string[] {
  const { tokens, errors } = lexRaw(input);
  expect(errors).toEqual([]);
  return tokens;
}

describe("line structure", () => {
  test("INDENT only at column 0 before content; inner runs of spaces are skipped", () => {
    expect(tokens("2022-01-01 *\n  Assets:A    1  USD\n")).toEqual([
      "DATE:2022-01-01", "ASTERISK", "EOL",
      "INDENT", "ACCOUNT:Assets:A", "NUMBER:1", "CURRENCY:USD", "EOL",
    ]);
  });

  test.each([
    ["one space", " Assets:A"],
    ["tab", "\tAssets:A"],
    ["mixed tab and spaces", " \t  Assets:A"],
  ])("any leading whitespace is an INDENT (%s)", (_name, line) => {
    expect(tokens(`${line}\n`)).toEqual(["INDENT", "ACCOUNT:Assets:A", "EOL"]);
  });

  test("whitespace-only lines are plain EOLs, including at end of input", () => {
    expect(tokens("  \n\t\t\r\n   ")).toEqual(["EOL", "EOL"]);
  });

  test("CRLF is a single EOL", () => {
    expect(tokens("2022-01-01\r\n")).toEqual(["DATE:2022-01-01", "EOL"]);
  });

  test("indented comment lines vanish together with their newline", () => {
    expect(tokens("  ; one\n\t; two\r\n  ; last")).toEqual([]);
  });

  test("column-0 and trailing comments are skipped but keep the EOL", () => {
    expect(tokens("; header\n2022-01-01 ; trailing\n")).toEqual(["EOL", "DATE:2022-01-01", "EOL"]);
  });

  test.each([
    ["org heading", "* Heading"],
    ["org sub-heading", "** Sub"],
    ["org drawer", ":PROPERTIES:"],
    ["hash line", "#+TITLE: x"],
    ["flag-prefixed line", "! anything 123"],
  ])("column-0 %s line is ignored", (_name, line) => {
    expect(tokens(`${line}\n`)).toEqual(["EOL"]);
  });

  test("the same characters mid-line are real tokens", () => {
    expect(tokens("2022-01-01 * # ! & ? %")).toEqual([
      "DATE:2022-01-01", "ASTERISK", "HASH", "FLAG:!", "FLAG:&", "FLAG:?", "FLAG:%",
    ]);
  });
});

describe("token precedence", () => {
  test.each([
    ["single capital", "V", "CAPITAL:V"],
    ["multi-char currency", "USD", "CURRENCY:USD"],
    ["currency with inner specials", "NT.TO", "CURRENCY:NT.TO"],
    ["currency with quote and underscore", "TLT_040921C'1", "CURRENCY:TLT_040921C'1"],
    ["futures currency", "/NQH21", "CURRENCY:/NQH21"],
    ["account", "Assets:Cash", "ACCOUNT:Assets:Cash"],
    ["account with digit-led component", "Assets:2024", "ACCOUNT:Assets:2024"],
    ["unicode account", "Assets:日本銀行", "ACCOUNT:Assets:日本銀行"],
    ["TRUE is BOOL, not currency", "TRUE", "BOOL:TRUE"],
    ["FALSE is BOOL", "FALSE", "BOOL:FALSE"],
    ["NULL is NONE", "NULL", "NONE"],
    ["longer word starting with TRUE is a currency", "TRUEX", "CURRENCY:TRUEX"],
    ["date with dashes", "2022-01-31", "DATE:2022-01-31"],
    ["date with slashes, short parts", "2022/1/2", "DATE:2022/1/2"],
    ["number with thousands separators", "1,234,567.89", "NUMBER:1,234,567.89"],
    ["number with trailing dot", "10.", "NUMBER:10."],
    ["link", "^inv_1", "LINK:^inv_1"],
    ["metadata key includes colon", "invoice-id:", "KEY:invoice-id:"],
    ["keyword-like key", "open:", "KEY:open:"],
    ["string with escaped quote", '"a \\"b\\""', 'STRING:"a \\"b\\""'],
    ["multi-line string", '"a\nb"', 'STRING:"a\nb"'],
  ])("%s", (_name, input, expected) => {
    expect(tokens(input)).toEqual([expected]);
  });

  test.each([
    ["txn", "TXN"], ["balance", "BALANCE"], ["open", "OPEN"], ["close", "CLOSE"],
    ["commodity", "COMMODITY"], ["pad", "PAD"], ["event", "EVENT"], ["query", "QUERY"],
    ["custom", "CUSTOM"], ["price", "PRICE"], ["note", "NOTE"], ["document", "DOCUMENT"],
    ["pushtag", "PUSHTAG"], ["poptag", "POPTAG"], ["pushmeta", "PUSHMETA"], ["popmeta", "POPMETA"],
    ["option", "OPTION"], ["plugin", "PLUGIN"], ["include", "INCLUDE"],
  ])("keyword %s", (input, expected) => {
    expect(tokens(input)).toEqual([expected]);
  });

  test.each([
    ["date requires a 17xx-20xx year", "1600-01-01", ["NUMBER:1600", "MINUS", "NUMBER:01", "MINUS", "NUMBER:01"]],
    ["sign is a separate token", "-85.00", ["MINUS", "NUMBER:85.00"]],
    ["division is not a futures currency", "10/2", ["NUMBER:10", "SLASH", "NUMBER:2"]],
    ["@@ beats two @", "@@ @", ["ATAT", "AT"]],
    ["{{ }} beat single braces", "{{ }} { }", ["LCURLCURL", "RCURLCURL", "LCURL", "RCURL"]],
    // Mid-line on purpose: a '#' at column 0 starts an ignored line.
    ["lone # is HASH, #x is TAG", "1 # #trip-2022/a.b", ["NUMBER:1", "HASH", "TAG:#trip-2022/a.b"]],
    ["currency list", "USD,EUR", ["CURRENCY:USD", "COMMA", "CURRENCY:EUR"]],
    ["tolerance", "1 ~ 0.01", ["NUMBER:1", "TILDE", "NUMBER:0.01"]],
    ["expression punctuation", "(1+2)*3|", ["LPAREN", "NUMBER:1", "PLUS", "NUMBER:2", "RPAREN", "ASTERISK", "NUMBER:3", "PIPE"]],
  ])("%s", (_name, input, expected) => {
    expect(tokens(input)).toEqual(expected);
  });
});

describe("lexer errors", () => {
  test.each([
    ["lowercase word without colon", "foo"],
    ["single-letter metadata key", "a:"],
    ["lowercase account component", "Assets:cash"],
  ])("%s is not a valid token", (_name, input) => {
    expect(lexRaw(input).errors).not.toEqual([]);
  });
});
