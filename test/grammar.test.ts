import { describe, expect, test } from "bun:test";
import type { ParserRuleContext } from "antlr4ng";
import { BeancountParser as P } from "../src/parser/BeancountParser";
import { parseRaw } from "./antlr";

// Grammar + lexer behaviour, checked on the raw ANTLR tree (no visitor).

function onlyTransaction(input: string) {
  const { errors, tree } = parseRaw(input);
  expect(errors).toEqual([]);
  const txn = tree.directive(0)?.transaction();
  if (!txn) throw new Error("expected a transaction directive");
  return txn;
}

describe("grammar accepts Beancount syntax", () => {
  test.each([
    ["txn flag '*' (not a comment)", '2022-01-15 * "Payee" "Narr"\n  Assets:A  -1 USD\n  Assets:B\n'],
    ["txn flag '!' and 'txn' keyword", '2022-01-15 ! "x"\n2022-01-15 txn "y"\n'],
    ["single-letter flag", '2022-01-15 P "x"\n  Assets:A 1 V\n'],
    ["legacy pipe separator", '2022-01-15 * "Payee" | "Narr"\n'],
    ["header tags and links", '2022-01-15 * "x" #trip ^inv-1\n'],
    ["tag/link line under txn", '2022-01-15 * "x"\n  #trip ^inv-1\n  Assets:A 1 USD\n'],
    ["posting flag", '2022-01-15 * "x"\n  ! Assets:A 1 USD\n'],
    ["thousands separators", '2022-01-15 * "x"\n  Assets:A 3,000.50 USD\n'],
    ["arithmetic amount", '2022-01-15 * "x"\n  Assets:A (1 + 2) * 3 / 4 USD\n'],
    ["amount without number", '2022-01-15 * "x"\n  Assets:A USD\n'],
    ["per-unit cost and price", '2022-01-15 * "x"\n  Assets:A 10 AAPL {250.00 USD, 2022-01-01, "lot"} @ 260 USD\n'],
    ["total cost and price", '2022-01-15 * "x"\n  Assets:A 10 AAPL {{2500 USD}} @@ 2600 USD\n'],
    ["empty cost, merge cost, compound cost", '2022-01-15 * "x"\n  Assets:A -1 A1 {}\n  Assets:B 1 A1 {*}\n  Assets:C 1 A1 {10 # 5 USD}\n'],
    ["metadata on txn and posting", '2022-01-15 * "x"\n  k1: "v"\n  Assets:A 1 USD\n    k2: 2022-01-01\n    k3: TRUE\n    k4: NULL\n    k5: 1.5 USD\n    k6: Assets:B\n    k7: #tag\n    k8:\n'],
    ["indented comment between postings", '2022-01-15 * "x"\n  Assets:A 1 USD\n  ; note\n  Assets:B\n'],
    ["CRLF line endings", '2022-01-15 * "x"\r\n  Assets:A 1 USD\r\n  Assets:B\r\n'],
    ["no trailing newline", "2022-01-01 close Assets:A"],
    ["org-mode headings", "* Section\n** Sub\n2022-01-01 close Assets:A\n"],
    ["slash dates", "2022/1/2 close Assets:A\n"],
    ["unicode account components", "2022-01-01 open Assets:日本:銀行 JPY\n"],
    ["account component starting with digit", "2022-01-01 open Assets:2024-Savings\n"],
    ["currency with special chars", "2022-01-01 commodity NT.TO\n2022-01-01 commodity /NQH21\n"],
    ["open with booking and metadata", '2022-01-01 open Assets:A USD,EUR "FIFO"\n  name: "Main"\n'],
    ["balance with tolerance", "2022-01-01 balance Assets:A 100.00 ~ 0.01 USD\n"],
    ["note/document with tags and links", '2022-01-01 note Assets:A "n" #t\n2022-01-01 document Assets:A "a.pdf" ^l\n'],
    ["multi-line string", '2022-01-01 note Assets:A "line1\nline2"\n'],
    ["escaped quote in string", '2022-01-01 note Assets:A "say \\"hi\\""\n'],
    ["custom value kinds", '2022-01-01 custom "budget" Assets:A 10 USD "s" TRUE 2022-01-01 3\n'],
    ["pushtag/poptag", "pushtag #trip\npoptag #trip\n"],
    ["pushmeta/popmeta", 'pushmeta location: "Paris"\npopmeta location:\n'],
    ["whitespace-only and indented-comment lines at top level", "  \n  ; c\n\t\n2022-01-01 close Assets:A\n"],
  ])("%s", (_name, input) => {
    expect(parseRaw(input).errors).toEqual([]);
  });
});

describe("grammar rejects invalid syntax", () => {
  test.each([
    ["transaction without flag", '2022-01-15 "Payee" "Narr"\n'],
    ["lowercase account component", '2022-01-15 * "x"\n  Assets:lower 1 USD\n'],
    ["blank line inside a transaction", '2022-01-15 * "x"\n  Assets:A 1 USD\n\n  Assets:B\n'],
    ["unindented posting", '2022-01-15 * "x"\nAssets:A 1 USD\n'],
    ["two directives on one line", "2022-01-01 close Assets:A 2022-01-01 close Assets:B\n"],
    ["mismatched cost braces {..}}", '2022-01-15 * "x"\n  Assets:A 1 X {1 USD}}\n'],
    ["mismatched cost braces {{..}", '2022-01-15 * "x"\n  Assets:A 1 X {{1 USD}\n'],
    ["tag/link line after the first posting", '2022-01-15 * "x"\n  Assets:A 1 USD\n  #late\n'],
  ])("%s", (_name, input) => {
    expect(parseRaw(input).errors).not.toEqual([]);
  });
});

describe("parse tree shape", () => {
  test("a realistic mixed ledger splits into the expected directive sequence", () => {
    const ledger = [
      ";; -*- mode: beancount -*-",
      "* Options",
      'option "title" "Household"',
      'option "operating_currency" "USD"',
      'plugin "beancount.plugins.implicit_prices"',
      "",
      "* Accounts",
      '2022-01-01 open Assets:Bank:Checking USD "STRICT"',
      "  institution: \"Bank\"",
      "2022-01-01 open Expenses:Food",
      "2022-01-01 commodity HOOL",
      "",
      "pushtag #2022",
      '2022-01-15 * "Employer" "Salary" ^payslip-01',
      "  Assets:Bank:Checking   3,000.00 USD",
      "  Income:Salary",
      "  ; rounding handled by interpolation",
      '2022-01-20 ! "Grocery" "Weekly" #food',
      "  Expenses:Food          85.40 USD",
      "    receipt: \"r-1.pdf\"",
      "  Assets:Bank:Checking",
      "poptag #2022",
      "",
      "2022-02-01 balance Assets:Bank:Checking 2914.60 USD",
      "2022-02-01 price HOOL 520.10 USD",
      '2022-02-01 custom "budget" Expenses:Food "monthly" 400.00 USD',
    ].join("\n");
    const { errors, tree } = parseRaw(ledger);
    expect(errors).toEqual([]);
    expect(tree.directive().map((d) => (d.getChild(0) as ParserRuleContext | null)?.ruleIndex)).toEqual([
      P.RULE_options, P.RULE_options, P.RULE_plugin,
      P.RULE_open, P.RULE_open, P.RULE_commodity_directive,
      P.RULE_pushtag, P.RULE_transaction, P.RULE_transaction, P.RULE_poptag,
      P.RULE_balance, P.RULE_price, P.RULE_custom,
    ]);
    expect(tree.directive(7)?.transaction()?.posting().length).toBe(2);
    expect(tree.directive(8)?.transaction()?.posting(0)?.metadata().key_value_line().length).toBe(1);
  });

  test("double spaces inside a posting line do not split the posting", () => {
    const txn = onlyTransaction('2022-01-15 * "x"\n  Assets:A    -85.00   USD\n  Assets:B\n');
    expect(txn.posting().map((p) => p.account().getText())).toEqual(["Assets:A", "Assets:B"]);
    expect(txn.posting(0)?.incomplete_amount()?.getText()).toBe("-85.00USD");
  });

  test("one string is the narration, two are payee + narration", () => {
    expect(onlyTransaction('2022-01-15 * "only"\n').txn_strings()?._payee).toBeUndefined();
    const both = onlyTransaction('2022-01-15 * "P" "N"\n').txn_strings();
    expect([both?._payee?.text, both?._narration?.text]).toEqual(['"P"', '"N"']);
  });

  test("metadata before postings belongs to the txn, after a posting to that posting", () => {
    const txn = onlyTransaction('2022-01-15 * "x"\n  ka: 1\n  Assets:A 1 USD\n    kb: 2\n  Assets:B\n    kc: 3\n');
    expect(txn.key_value_line().map((l) => l.key_value().KEY().getText())).toEqual(["ka:"]);
    expect(
      txn.posting().map((p) => p.metadata().key_value_line().map((l) => l.key_value().KEY().getText())),
    ).toEqual([["kb:"], ["kc:"]]);
  });

  test("indented comment lines do not end the transaction", () => {
    const { errors, tree } = parseRaw('2022-01-15 * "x"\n  Assets:A 1 USD\n  ; c\n  Assets:B\n2022-01-16 close Assets:A\n');
    expect(errors).toEqual([]);
    expect(tree.directive().length).toBe(2);
    expect(tree.directive(0)?.transaction()?.posting().length).toBe(2);
  });

  test("number expressions follow arithmetic precedence", () => {
    const { errors, tree, parser } = parseRaw('2022-01-01 custom "x" 1 - 2 * 3 - 4\n');
    expect(errors).toEqual([]);
    const value = tree.directive(0)?.custom()?.custom_value(0)?.number();
    expect(value?.toStringTree(parser)).toBe(
      "(number (number (number 1) - (number (number 2) * (number 3))) - (number 4))",
    );
  });

  test("cost and price annotations distinguish per-unit from total", () => {
    const txn = onlyTransaction('2022-01-15 * "x"\n  Assets:A 1 X {1 USD} @ 2 USD\n  Assets:B 1 X {{1 USD}} @@ 2 USD\n');
    const [perUnit, total] = txn.posting();
    expect(perUnit?.cost()?.LCURL()).toBeTruthy();
    expect(perUnit?.price_annotation()?.AT()).toBeTruthy();
    expect([perUnit?.cost()?.LCURLCURL(), perUnit?.price_annotation()?.ATAT()]).toEqual([null, null]);
    expect(total?.cost()?.LCURLCURL()).toBeTruthy();
    expect(total?.price_annotation()?.ATAT()).toBeTruthy();
    expect([total?.cost()?.LCURL(), total?.price_annotation()?.AT()]).toEqual([null, null]);
  });
});
