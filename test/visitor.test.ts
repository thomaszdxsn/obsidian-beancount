import { describe, expect, test } from "bun:test";
import { BeancountParser, BeancountSyntaxError } from "../src";
import {
  Amount,
  Cost,
  Custom,
  Document,
  Event,
  IncompleteAmount,
  Include,
  Open,
  Option,
  Pad,
  Plugin,
  Query,
  Transaction,
} from "../src/model";

const only = <T>(input: string): T => {
  const { directives } = BeancountParser.parse(input);
  expect(directives).toHaveLength(1);
  return directives[0] as T;
};

const postingOf = (line: string) =>
  only<Transaction>(`2022-01-01 * "x"\n  Assets:A  ${line}\n`).postings[0]!;

describe("transaction header", () => {
  test.each([
    ["txn keyword maps to *", '2022-01-01 txn "n"', "*", null, "n"],
    ["single string is the narration", '2022-01-01 * "n"', "*", null, "n"],
    ["two strings are payee + narration", '2022-01-01 * "p" "n"', "*", "p", "n"],
    ["legacy pipe separator", '2022-01-01 * "p" | "n"', "*", "p", "n"],
    ["no strings", "2022-01-01 !", "!", null, null],
    ["capital letter flag", '2022-01-01 P "n"', "P", null, "n"],
  ])("%s", (_name, header, flag, payee, narration) => {
    const txn = only<Transaction>(`${header}\n`);
    expect([txn.flag, txn.payee, txn.narration]).toEqual([flag, payee, narration]);
  });

  test("duplicate tags collapse; pushtag stack tags only transactions inside it", () => {
    const input = [
      "pushtag #t",
      '2022-01-01 * "a" #t #u',
      "poptag #t",
      '2022-01-02 * "b"',
      "",
    ].join("\n");
    const [a, b] = BeancountParser.parse(input).directives as Transaction[];
    expect(a!.tags).toEqual(["t", "u"]);
    expect(b!.tags).toEqual([]);
  });

  test("string escapes are decoded", () => {
    const txn = only<Transaction>('2022-01-01 * "a\\tb\\nc\\\\d\\"e"\n');
    expect(txn.narration).toBe('a\tb\nc\\d"e');
  });
});

describe("posting amounts", () => {
  test.each([
    ["integer", "10 USD", new Amount(10, "USD")],
    ["thousands separator", "1,234.50 USD", new Amount(1234.5, "USD")],
    ["trailing dot", "5. USD", new Amount(5, "USD")],
    ["unary plus", "+3 USD", new Amount(3, "USD")],
    ["division", "10 / 4 USD", new Amount(2.5, "USD")],
    ["precedence: * before +", "1 + 2 * 3 USD", new Amount(7, "USD")],
    ["precedence: left-assoc minus", "10 - 3 - 2 USD", new Amount(5, "USD")],
    ["parentheses", "-(1 + 2) USD", new Amount(-3, "USD")],
    ["number only", "10", new IncompleteAmount(10, null)],
    ["currency only", "USD", new IncompleteAmount(null, "USD")],
  ])("%s", (_name, text, expected) => {
    expect(postingOf(text).amount).toEqual(expected);
  });
});

describe("cost", () => {
  test.each([
    ["empty per-unit", "1 AAPL {}", new Cost()],
    ["per-unit", "1 AAPL {10 USD}", new Cost(new Amount(10, "USD"))],
    ["total", "1 AAPL {{10 USD}}", new Cost(undefined, undefined, undefined, new Amount(10, "USD"))],
    ["currency only", "1 AAPL {USD}", new Cost(new IncompleteAmount(null, "USD"))],
    ["number only", "1 AAPL {10}", new Cost(new IncompleteAmount(10, null))],
    ["total via #", "1 AAPL {# 5 USD}", new Cost(undefined, undefined, undefined, new Amount(5, "USD"))],
    ["per via #", "1 AAPL {2 # USD}", new Cost(new Amount(2, "USD"))],
    ["# without numbers", "1 AAPL {# USD}", new Cost(new IncompleteAmount(null, "USD"))],
    ["merge only", "1 AAPL {*}", new Cost(undefined, undefined, undefined, undefined, true)],
    [
      "date and label",
      '1 AAPL {10 USD, 2022-01-01, "lot"}',
      new Cost(new Amount(10, "USD"), new Date(2022, 0, 1), "lot"),
    ],
  ])("%s", (_name, text, expected) => {
    expect(postingOf(text).cost).toEqual(expected);
  });
});

describe("price annotation", () => {
  test.each([
    ["per-unit", "1 EUR @ 1.1 USD", new Amount(1.1, "USD"), false],
    ["total", "1 EUR @@ 1.1 USD", new Amount(1.1, "USD"), true],
    ["bare @", "1 EUR @", undefined, false],
    ["currency only", "1 EUR @ USD", new IncompleteAmount(null, "USD"), false],
  ])("%s", (_name, text, amount, isTotal) => {
    expect(postingOf(text).priceAnnotation).toEqual({ amount, isTotal });
  });
});

describe("metadata values", () => {
  test.each([
    ["string", '"s"', "s"],
    ["account", "Assets:A", "Assets:A"],
    ["date", "2022-01-02", new Date(2022, 0, 2)],
    ["currency", "USD", "USD"],
    ["tag", "#t", "t"],
    ["TRUE", "TRUE", true],
    ["FALSE", "FALSE", false],
    ["NULL", "NULL", null],
    ["amount", "3 EUR", new Amount(3, "EUR")],
    ["number expression", "2 * 3", 6],
  ])("%s", (_name, text, expected) => {
    const open = only<Open>(`2022-01-01 open Assets:A\n  kk: ${text}\n`);
    expect(open.metadata).toEqual({ kk: expected });
  });

  test("later duplicate key wins", () => {
    const open = only<Open>("2022-01-01 open Assets:A\n  kk: 1\n  kk: 2\n");
    expect(open.metadata).toEqual({ kk: 2 });
  });
});

describe("other directives", () => {
  test("open with booking method", () => {
    const open = only<Open>('2022-01-01 open Assets:A USD "STRICT"\n');
    expect([open.currencies, open.booking]).toEqual([["USD"], "STRICT"]);
  });

  test("open without currencies", () => {
    const open = only<Open>("2022-01-01 open Assets:A\n");
    expect([open.currencies, open.booking]).toEqual([[], undefined]);
  });

  test("pad", () => {
    expect(only<Pad>("2022-01-01 pad Assets:A Equity:B\n")).toMatchObject({
      account: "Assets:A",
      sourceAccount: "Equity:B",
    });
  });

  test("document with tags and links", () => {
    expect(only<Document>('2022-01-01 document Assets:A "a.pdf" #t ^l\n')).toMatchObject({
      account: "Assets:A",
      path: "a.pdf",
      tags: ["t"],
      links: ["l"],
    });
  });

  test("event and query", () => {
    expect(only<Event>('2022-01-01 event "loc" "Paris"\n')).toMatchObject({ type: "loc", description: "Paris" });
    expect(only<Query>('2022-01-01 query "q" "SELECT 1"\n')).toMatchObject({ name: "q", query: "SELECT 1" });
  });

  test("custom values keep their types in order", () => {
    const custom = only<Custom>('2022-01-01 custom "b" "s" 2022-01-02 TRUE 10 USD 7 Assets:A\n');
    expect(custom.type).toBe("b");
    expect(custom.values).toEqual(["s", new Date(2022, 0, 2), true, new Amount(10, "USD"), 7, "Assets:A"]);
  });

  test("option, plugin with and without config, include", () => {
    const [opt, p1, p2, inc] = BeancountParser.parse(
      'option "title" "T"\nplugin "a" "cfg"\nplugin "b"\ninclude "x.bean"\n',
    ).directives as [Option, Plugin, Plugin, Include];
    expect([opt.name, opt.value]).toEqual(["title", "T"]);
    expect([p1.name, p1.config]).toEqual(["a", "cfg"]);
    expect([p2.name, p2.config]).toEqual(["b", undefined]);
    expect(inc.filename).toBe("x.bean");
  });

  test("pushmeta/popmeta parse but do not change metadata", () => {
    const input = 'pushmeta kk: "v"\n2022-01-01 open Assets:A\npopmeta kk:\n';
    expect(only<Open>(input).metadata).toEqual({});
  });
});

describe("dates", () => {
  test.each([
    ["slash separator", "2022/03/04", new Date(2022, 2, 4)],
    ["unpadded parts", "2022-3-4", new Date(2022, 2, 4)],
    ["leap day", "2024-02-29", new Date(2024, 1, 29)],
  ])("%s", (_name, text, expected) => {
    expect(only<Open>(`${text} open Assets:A\n`).date).toEqual(expected);
  });

  test.each([["2023-02-29"], ["2022-13-01"], ["2022-00-10"], ["2022-01-32"]])("%s is rejected", (text) => {
    expect(() => BeancountParser.parse(`${text} open Assets:A\n`)).toThrow(`invalid date '${text}'`);
  });
});

describe("location", () => {
  test("last directive without trailing newline ends at EOF", () => {
    const input = "2022-01-01 open Assets:A\n2022-01-02 close Assets:A";
    const close = BeancountParser.parse(input).directives[1]!;
    expect(close.location).toEqual({ start: { line: 2, column: 0 }, end: { line: 2, column: 25 } });
  });

  test("CRLF line endings end before the \\r\\n", () => {
    const open = only<Open>("2022-01-01 open Assets:A\r\n");
    expect(open.location).toEqual({ start: { line: 1, column: 0 }, end: { line: 1, column: 24 } });
  });

  test("comment and blank lines inside a transaction do not break it", () => {
    const input = '2022-01-01 * "x"\n  ; note\n  Assets:A  1 USD\n\n2022-01-02 close Assets:A\n';
    const [txn] = BeancountParser.parse(input).directives as [Transaction];
    expect(txn.postings).toHaveLength(1);
    expect(txn.location!.end).toEqual({ line: 3, column: 17 });
  });
});

describe("BeancountSyntaxError", () => {
  test("message lists every error as line:column", () => {
    try {
      BeancountParser.parse("2022-01-01 open\n2022-01-01 close\n");
      throw new Error("did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BeancountSyntaxError);
      const err = e as BeancountSyntaxError;
      expect(err.name).toBe("BeancountSyntaxError");
      expect(err.message.split("\n")).toEqual(err.errors.map((x) => `${x.line}:${x.column} ${x.message}`));
      expect(err.errors.map((x) => x.line)).toEqual([1, 2]);
    }
  });

  test("tag line after the first posting is a syntax error", () => {
    expect(() => BeancountParser.parse('2022-01-01 * "x"\n  Assets:A  1 USD\n  #late\n')).toThrow(
      BeancountSyntaxError,
    );
  });
});
