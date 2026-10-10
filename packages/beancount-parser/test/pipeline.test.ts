import { describe, expect, test } from "bun:test";
import { readdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeancountParser, BeancountSyntaxError } from "../src";
import { parseRaw } from "./antlr";
import {
  Amount,
  Balance,
  Close,
  Commodity,
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
  Price,
  Query,
  Transaction,
} from "../src/model";

// Covers the antlr4ng lexer → parser → visitor wiring: every directive rule
// must reach its model class. Field values are out of scope here.
describe("antlr4ng pipeline: directive dispatch", () => {
  const cases: [string, string, Function][] = [
    ["open", '2022-01-01 open Assets:Checking USD,EUR', Open],
    ["close", "2022-12-31 close Assets:Checking", Close],
    ["price", "2022-01-01 price EUR 1.10 USD", Price],
    ["balance", "2022-01-01 balance Assets:Checking 100.00 USD", Balance],
    ["pad", "2022-01-01 pad Assets:Checking Equity:Opening-Balances", Pad],
    ["note", '2022-01-01 note Assets:Checking "called bank"', Note],
    ["document", '2022-01-01 document Assets:Checking "a.pdf"', Document],
    ["event", '2022-01-01 event "location" "Paris"', Event],
    ["query", '2022-01-01 query "q" "SELECT 1"', Query],
    ["custom", '2022-01-01 custom "budget" Assets:Checking 10 USD', Custom],
    ["commodity", "2022-01-01 commodity USD", Commodity],
    ["option", 'option "title" "Ledger"', Option],
    ["plugin", 'plugin "beancount.plugins.auto" "cfg"', Plugin],
    ["include", 'include "other.bean"', Include],
    ["transaction header", '2022-01-15 txn "Payee" "Narration"', Transaction],
  ];

  test.each(cases)("%s directive becomes its model class", (_name, input, cls) => {
    expect(parseRaw(`${input}\n`).errors).toEqual([]);
    const { directives } = BeancountParser.parse(`${input}\n`);
    expect(directives).toHaveLength(1);
    expect(directives[0]).toBeInstanceOf(cls);
  });

  test("keeps source order across mixed directives", () => {
    const input = [
      'option "title" "Ledger"',
      "2022-01-01 open Assets:Checking USD",
      "2022-01-01 commodity USD",
      '2022-06-01 note Assets:Checking "mid-year"',
      "2022-12-31 close Assets:Checking",
      "",
    ].join("\n");
    expect(parseRaw(input).errors).toEqual([]);
    const { directives } = BeancountParser.parse(input);
    expect(directives.map((d) => d.constructor)).toEqual([Option, Open, Commodity, Note, Close]);
  });

  test("pushtag/poptag/pushmeta/popmeta have no model and are dropped without losing neighbours", () => {
    const input = [
      "pushtag #trip",
      'pushmeta location: "Paris"',
      "2022-01-01 open Assets:Checking",
      "popmeta location:",
      "poptag #trip",
      "2022-12-31 close Assets:Checking",
      "",
    ].join("\n");
    expect(parseRaw(input).errors).toEqual([]);
    const { directives } = BeancountParser.parse(input);
    expect(directives.map((d) => d.constructor)).toEqual([Open, Close]);
  });

  test.each([
    ["empty input", ""],
    ["whitespace only", "  \n\t\n"],
    ["comment only", "; just a comment\n"],
  ])("%s yields no directives", (_name, input) => {
    expect(parseRaw(input).errors).toEqual([]);
    expect(BeancountParser.parse(input).directives).toEqual([]);
  });
});

describe("parse errors", () => {
  const errorsOf = (input: string) => {
    try {
      BeancountParser.parse(input);
    } catch (e) {
      expect(e).toBeInstanceOf(BeancountSyntaxError);
      return (e as BeancountSyntaxError).errors;
    }
    throw new Error(`parse(${JSON.stringify(input)}) did not throw`);
  };

  const at = (errors: { line: number; column: number }[]) => errors.map((e) => [e.line, e.column]);

  test("missing account throws instead of recovering a phantom Open", () => {
    const errors = errorsOf("2022-01-01 open\n");
    expect(at(errors)).toEqual([[1, 15]]);
    expect(errors[0]!.message).toContain("ACCOUNT");
  });

  test("unknown keyword line throws instead of becoming a Transaction", () => {
    const errors = errorsOf("2022-01-01 open Assets:A\n2022-01-01 foo Assets:A\n");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.line === 2)).toBe(true);
  });

  // The parser never sees a character the lexer drops, so only the lexer
  // listener can catch this.
  test("lexer-only error throws", () => {
    const errors = errorsOf("2022-01-01 open Assets:A `\n");
    expect(at(errors)).toEqual([[1, 25]]);
    expect(errors[0]!.message).toContain("`");
  });

  test("collects every error in source order", () => {
    const errors = errorsOf('option "a"\n2022-01-01 open Assets:A\n2022-01-01 close\n');
    expect(errors.map((e) => e.line)).toEqual([1, 3]);
  });

  test("lexer errors read ahead by the token stream are sorted into place", () => {
    expect(at(errorsOf("2022-01-01 close\n`\n"))).toEqual([[1, 16], [2, 0]]);
  });

  test("calendar-invalid date is reported at the date token", () => {
    expect(errorsOf('2022-01-02 * "x"\n  Assets:A  1 AAPL {1 USD, 2022-02-30}\n')).toEqual([
      { line: 2, column: 27, message: "invalid date '2022-02-30'" },
    ]);
  });

  test("every value error is reported", () => {
    expect(at(errorsOf("2022-02-30 open Assets:A\n2022-13-01 close Assets:A\n"))).toEqual([[1, 0], [2, 0]]);
  });

  test("value errors are not reported alongside syntax errors", () => {
    expect(at(errorsOf("2022-02-30 open Assets:A\n2022-01-01 close\n"))).toEqual([[2, 16]]);
  });

  test("per # total inside a total cost is rejected", () => {
    expect(errorsOf('2022-01-02 * "x"\n  Assets:A  1 AAPL {{1 # 2 USD}}\n')).toEqual([
      { line: 2, column: 21, message: "per-unit cost not allowed in total cost {{...}}" },
    ]);
  });

  test.each([
    ["absent poptag", "poptag #x\n", [{ line: 1, column: 7, message: "attempting to pop absent tag 'x'" }]],
    ["unpopped pushtag", "pushtag #x\n", [{ line: 1, column: 8, message: "unbalanced pushed tag 'x'" }]],
    [
      "duplicate metadata key",
      "2022-01-01 open Assets:A\n  kk: 1\n  kk: 2\n",
      [{ line: 3, column: 2, message: "duplicate metadata key 'kk'" }],
    ],
    [
      "duplicate posting metadata key",
      '2022-01-01 * "x"\n  Assets:A  1 USD\n    kk: 1\n    kk: 2\n',
      [{ line: 4, column: 4, message: "duplicate metadata key 'kk'" }],
    ],
    [
      "division by zero",
      "2022-01-01 balance Assets:A 1/0 USD\n",
      [{ line: 1, column: 28, message: "invalid number '1/0'" }],
    ],
    [
      "0/0",
      '2022-01-01 * "x"\n  Assets:A  0/0 USD\n',
      [{ line: 2, column: 12, message: "invalid number '0/0'" }],
    ],
  ])("%s", (_name, input, expected) => {
    expect(errorsOf(input)).toEqual(expected);
  });

  test.each([
    ["amount", "{1 USD, 2 USD}", 27],
    ["date", "{2022-01-01, 2022-01-02}", 32],
    ["label", '{"a", "b"}', 25],
    ["merge", "{*, *}", 23],
  ])("duplicate cost %s is rejected", (_name, cost, column) => {
    const errors = errorsOf(`2022-01-02 * "x"\n  Assets:A  1 AAPL ${cost}\n`);
    expect(at(errors)).toEqual([[2, column]]);
    expect(errors[0]!.message).toStartWith("duplicate cost component");
  });
});

describe("field mapping", () => {
  test("transaction carries tags, links, pushed tags, metadata and postings", () => {
    const input = [
      "pushtag #trip",
      '2022/1/5 ! "Shop" "Buy \\"x\\"" #a ^l1',
      "  id: 12",
      "  #b ^l2",
      "  ! Assets:Broker  10 AAPL {1 # 5 USD, 2022-01-01, \"lot\", *} @@ 100 USD",
      "    ok: TRUE",
      "  Assets:Cash  (2 + 3) * -2 USD",
      "  Assets:X  USD @",
      "  Expenses:Misc",
      "poptag #trip",
      '2022-01-06 * "after"',
      "",
    ].join("\n");
    const [txn, after] = BeancountParser.parse(input).directives as [Transaction, Transaction];
    expect(txn.date).toEqual(new Date(2022, 0, 5));
    expect(txn.flag).toBe("!");
    expect(txn.narration).toBe('Buy "x"');
    expect(txn.tags).toEqual(["trip", "a", "b"]);
    expect(txn.links).toEqual(["l1", "l2"]);
    expect(txn.metadata).toEqual({ id: 12 });
    expect(after.tags).toEqual([]);

    const [broker, cash, partial, bare] = txn.postings;
    expect(broker!.flag).toBe("!");
    expect(broker!.metadata).toEqual({ ok: true });
    expect(broker!.cost).toMatchObject({
      amount: new Amount(1, "USD"),
      total: new Amount(5, "USD"),
      date: new Date(2022, 0, 1),
      label: "lot",
      merge: true,
    });
    expect(broker!.priceAnnotation).toMatchObject({ amount: new Amount(100, "USD"), isTotal: true });
    expect(cash!.amount).toStrictEqual(new Amount(-10, "USD"));
    expect(partial!.amount).toStrictEqual(new IncompleteAmount(null, "USD"));
    expect(partial!.priceAnnotation).toMatchObject({ amount: undefined, isTotal: false });
    expect(bare!.amount).toBeUndefined();
  });

  test("location spans the directive's lines and stops before the final newline", () => {
    const input = '2022-01-01 * "x"\n  Assets:A  1 USD\n    k1: "v"\n  Assets:B\n\n';
    const txn = BeancountParser.parse(input).directives[0]!;
    expect(txn.location).toEqual({ start: { line: 1, column: 0 }, end: { line: 4, column: 10 } });
    expect((txn as Transaction).postings[0]!.location).toEqual({
      start: { line: 2, column: 0 },
      end: { line: 3, column: 11 },
    });
  });

  test("balance keeps tolerance and metadata value types", () => {
    const input = "2022-01-03 balance Assets:Cash 1,000.5 ~ 0.01 USD\n  empty:\n  amt: 3 EUR\n  on: 2022-01-01\n";
    const balance = BeancountParser.parse(input).directives[0] as Balance;
    expect(balance.amount).toEqual(new Amount(1000.5, "USD"));
    expect(balance.tolerance).toBe(0.01);
    expect(balance.metadata).toEqual({ empty: null, amt: new Amount(3, "EUR"), on: new Date(2022, 0, 1) });
  });
});

// src/parser/* is committed; it must match what `bun run generate` produces,
// or grammar/script edits silently fail to take effect.
test("committed src/parser matches regenerated output of Beancount.g4", () => {
  const root = join(import.meta.dir, "..");
  const out = mkdtempSync(join(tmpdir(), "beancount-antlr-"));
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const args: string[] = pkg.scripts.generate.split(/\s+/);
    const outFlag = args.indexOf("-o");
    expect(outFlag).toBeGreaterThan(0);
    args[outFlag + 1] = out;
    const gen = Bun.spawnSync([process.execPath, "x", ...args], { cwd: root });
    expect(gen.exitCode).toBe(0);
    const generated = readdirSync(out).filter((f) => f.endsWith(".ts")).sort();
    const committed = readdirSync(join(root, "src/parser")).filter((f) => f.endsWith(".ts")).sort();
    expect(committed).toEqual(generated);
    for (const file of generated) {
      expect(readFileSync(join(root, "src/parser", file), "utf8")).toBe(
        readFileSync(join(out, file), "utf8"),
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
