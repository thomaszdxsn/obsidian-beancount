import { describe, expect, test } from "bun:test";
import { BeancountParser, BeancountSyntaxError, parseWithAntlr } from "../src";
import { Amount, Balance, Close, Open, Plugin, Price, Transaction } from "../src/model";
import type { BeancountFile } from "../src/model";
import type { SyntaxErrorInfo } from "../src/values";
import { StringCharStream } from "../src/char-stream";

// `parse()` runs a hand-written parser and falls back to the generated ANTLR
// parser on any syntax error. Both must agree on every input: the same
// model, or the same errors. The reference here always takes the ANTLR path.

type Outcome = { input: string; file: BeancountFile } | { input: string; errors: SyntaxErrorInfo[] };

function outcome(input: string, run: () => BeancountFile): Outcome {
  try {
    return { input, file: run() };
  } catch (e) {
    if (e instanceof BeancountSyntaxError) return { input, errors: e.errors };
    throw e;
  }
}

/** Asserts both paths agree; true when the input parsed. */
function expectSameAsAntlr(input: string): boolean {
  const actual = outcome(input, () => BeancountParser.parse(input));
  expect(actual).toStrictEqual(outcome(input, () => parseWithAntlr(new StringCharStream(input), null)));
  return "file" in actual;
}

let seed = 4242;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

const NUMBERS = ["1", "-2.50", "1,000.00", "(1 + 2)", "3 * -4", "10 / 4", "1/0", "- -5", "+7", "2 - 3 * 4", "1.", "((2))"];
const DATES = ["2022-01-01", "2022/2/28", "2022-02-30", "1999-12-31", "2020-1-1"];
const ACCOUNTS = ["Assets:Cash", "Expenses:餐饮:午餐", "Liabilities:CC:Visa", "Equity:Opening-Balances", "Income:A1"];
const CURRENCIES = ["USD", "CNY", "AAPL", "V", "/ES", "VEA.TO"];
const STRINGS = ['"x"', '"a \\" b"', '"line\\nbreak"', '"多\n行"', '""'];
const VALUES = () => [
  pick(STRINGS), pick(ACCOUNTS), pick(DATES), pick(CURRENCIES), "#tag", "TRUE", "FALSE", "NULL",
  `${pick(NUMBERS)} ${pick(CURRENCIES)}`, pick(NUMBERS), "",
];
const KEYS = ["key:", "invoice:", "a-b:", "key:"];

function metadataLines(indent: string): string[] {
  const lines: string[] = [];
  while (random() < 0.3) lines.push(`${indent}${pick(KEYS)} ${pick(VALUES())}`);
  return lines;
}

function cost(): string {
  const comps = [
    `${pick(NUMBERS)} ${pick(CURRENCIES)}`, pick(NUMBERS), pick(CURRENCIES), `${pick(NUMBERS)} # ${pick(NUMBERS)} USD`,
    "# USD", `# ${pick(NUMBERS)} USD`, pick(DATES), pick(STRINGS), "*",
  ];
  const parts: string[] = [];
  const n = Math.floor(random() * 4);
  for (let i = 0; i < n; i++) parts.push(pick(comps));
  return random() < 0.7 ? `{${parts.join(", ")}}` : `{{${parts.join(", ")}}}`;
}

function posting(): string[] {
  let line = "  ";
  if (random() < 0.15) line += pick(["* ", "! ", "P "]);
  line += pick(ACCOUNTS);
  if (random() < 0.8) line += random() < 0.2 ? ` ${pick(CURRENCIES)}` : ` ${pick(NUMBERS)}${random() < 0.85 ? ` ${pick(CURRENCIES)}` : ""}`;
  if (random() < 0.2) line += ` ${cost()}`;
  if (random() < 0.2) line += ` ${pick(["@", "@@"])}${random() < 0.9 ? ` ${pick(NUMBERS)} ${pick(CURRENCIES)}` : ""}`;
  if (random() < 0.2) line += " ; comment";
  return [line, ...metadataLines("    ")];
}

function directive(): string[] {
  const date = pick(DATES);
  switch (Math.floor(random() * 16)) {
    case 0:
    case 1:
    case 2:
    case 3: {
      const flag = pick(["*", "!", "txn", "#", "P"]);
      const strings = pick(["", ` ${pick(STRINGS)}`, ` ${pick(STRINGS)} ${pick(STRINGS)}`, ` ${pick(STRINGS)} | ${pick(STRINGS)}`]);
      const tags = pick(["", " #a", " ^l #b", " #a #a"]);
      const lines = [`${date} ${flag}${strings}${tags}`];
      while (random() < 0.3) lines.push(random() < 0.5 ? `  ${pick(KEYS)} ${pick(VALUES())}` : "  #t ^k");
      const n = Math.floor(random() * 4);
      for (let i = 0; i < n; i++) lines.push(...posting());
      if (random() < 0.1) lines.splice(1, 0, "  ; indented comment");
      return lines;
    }
    case 4:
      return [`${date} price ${pick(CURRENCIES)} ${pick(NUMBERS)} ${pick(CURRENCIES)}`, ...metadataLines("  ")];
    case 5:
      return [`${date} balance ${pick(ACCOUNTS)} ${pick(NUMBERS)}${random() < 0.3 ? ` ~ ${pick(NUMBERS)}` : ""} ${pick(CURRENCIES)}`, ...metadataLines("  ")];
    case 6:
      return [`${date} open ${pick(ACCOUNTS)}${pick(["", " USD", " USD,CNY", " USD, CNY"])}${random() < 0.3 ? ' "FIFO"' : ""}`, ...metadataLines("  ")];
    case 7:
      return [`${date} close ${pick(ACCOUNTS)}`, ...metadataLines("  ")];
    case 8:
      return [`${date} commodity ${pick(CURRENCIES)}`, ...metadataLines("  ")];
    case 9:
      return [`${date} pad ${pick(ACCOUNTS)} ${pick(ACCOUNTS)}`];
    case 10:
      return [`${date} ${pick(["note", "document"])} ${pick(ACCOUNTS)} ${pick(STRINGS)}${pick(["", " #x ^y"])}`, ...metadataLines("  ")];
    case 11:
      return [`${date} ${pick(["event", "query"])} ${pick(STRINGS)} ${pick(STRINGS)}`];
    case 12: {
      const values: string[] = [];
      while (random() < 0.5) values.push(pick([pick(STRINGS), pick(DATES), "TRUE", pick(ACCOUNTS), pick(NUMBERS), `${pick(NUMBERS)} USD`]));
      return [`${date} custom ${pick(STRINGS)} ${values.join(" ")}`, ...metadataLines("  ")];
    }
    case 13:
      return [pick(['option "title" "T"', 'plugin "p"', 'plugin "p" "cfg"', 'include "x.bean"'])];
    case 14:
      return [pick(["pushtag #a", "poptag #a", "pushtag #b", "poptag #b", "pushmeta k: 1", "popmeta k:"])];
    default:
      return [pick(["; comment", "* org heading", "", "  ", ":drawer"])];
  }
}

// Token-level damage, so the error paths (and near-valid input) are exercised too.
function mutate(text: string): string {
  const r = random();
  if (r < 0.6) return text;
  const at = Math.floor(random() * (text.length + 1));
  if (r < 0.75) return text.slice(0, at) + text.slice(at + 1 + Math.floor(random() * 4));
  if (r < 0.9) return text.slice(0, at) + pick([" ", "\n", "\n  ", '"', "-", "{", "}", ",", "#", "USD", "1", ":"]) + text.slice(at);
  return text.slice(0, at);
}

describe("fast parser matches the ANTLR parser", () => {
  test("generated ledgers, intact and damaged", () => {
    let valid = 0;
    for (let i = 0; i < 20_000; i++) {
      const lines: string[] = [];
      const n = 1 + Math.floor(random() * 6);
      for (let j = 0; j < n; j++) lines.push(...directive());
      const input = mutate(lines.join(random() < 0.1 ? "\r\n" : "\n") + pick(["\n", "", "\n\n"]));
      if (expectSameAsAntlr(input)) valid++;
    }
    // Both outcomes are exercised, not just errors.
    expect(valid).toBeGreaterThan(3_000);
  });

  test("deep nesting goes to the ANTLR path", () => {
    expectSameAsAntlr(`2022-01-01 price USD ${"(".repeat(200)}1${")".repeat(200)} CNY\n`);
    expectSameAsAntlr(`2022-01-01 price USD 1${" + 1".repeat(500)} CNY\n`);
    expectSameAsAntlr(`2022-01-01 price USD ${"-".repeat(300)}1 CNY\n`);
  });
});

function errorsOf(run: () => BeancountFile): SyntaxErrorInfo[] {
  try {
    run();
  } catch (e) {
    if (e instanceof BeancountSyntaxError) return e.errors;
    throw e;
  }
  throw new Error("expected syntax errors");
}

/** Fast path and a fresh ANTLR lex must report the same errors. */
function expectErrors(input: string, expected: SyntaxErrorInfo[]): void {
  const actual = errorsOf(() => BeancountParser.parse(input));
  expect(actual).toEqual(expected);
  expect(errorsOf(() => parseWithAntlr(new StringCharStream(input), null))).toEqual(actual);
}

describe("errors after astral characters", () => {
  test("a lexer error keeps ANTLR's message and a code-point column", () => {
    expectErrors("^\n", [{ line: 1, column: 0, message: "token recognition error at: '^\n'" }]);
    expectErrors("2022-01-01 open Assets:A\n\u0000\n", [
      { line: 2, column: 0, message: "token recognition error at: '\u0000'" },
    ]);
    // "😀" is one column, not two UTF-16 units: the caret sits at column 17.
    expectErrors('2022-01-01 * "😀" ^\n', [
      { line: 1, column: 17, message: "token recognition error at: '^\n'" },
    ]);
    expectErrors("\uD800^\n", [{ line: 1, column: 0, message: "token recognition error at: '\uD800^'" }]);
  });

  test("a parse error after an emoji uses the replayed token's code-point column", () => {
    expectErrors('2022-01-01 * "😀" Assets:A\n', [
      { line: 1, column: 17, message: "extraneous input 'Assets:A' expecting {<EOF>, EOL}" },
    ]);
    expectErrors('2022-01-01 price "😀" 1 USD\n', [
      { line: 1, column: 17, message: "mismatched input '\"😀\"' expecting {CAPITAL, CURRENCY}" },
    ]);
    expectErrors("2022-01-01 open Expenses:😀:午餐\n2022-01-02 close\n", [
      { line: 2, column: 16, message: "missing ACCOUNT at '\\n'" },
    ]);
  });
});

describe("value errors on the fast path", () => {
  test("popping the outer of two pushed tags leaves the inner one unbalanced", () => {
    expectErrors("pushtag #a\npushtag #b\npoptag #a\n", [
      { line: 2, column: 8, message: "unbalanced pushed tag 'b'" },
    ]);
  });

  test("one pop of a tag pushed twice reports the earlier push", () => {
    expectErrors("pushtag #t\npushtag #t\npoptag #t\n", [
      { line: 1, column: 8, message: "unbalanced pushed tag 't'" },
    ]);
  });

  test("an absent pop and an unpopped tag are both reported, after an emoji", () => {
    expectErrors('pushtag #a\n2022-01-01 * "😀"\npoptag #missing\n', [
      { line: 1, column: 8, message: "unbalanced pushed tag 'a'" },
      { line: 3, column: 7, message: "attempting to pop absent tag 'missing'" },
    ]);
  });

  test("a repeated prototype key is a duplicate only on the second line", () => {
    expectErrors("2022-01-01 open Assets:A\n  constructor: NULL\n  constructor: 1\n", [
      { line: 3, column: 2, message: "duplicate metadata key 'constructor'" },
    ]);
    expectErrors("2022-01-01 open Assets:A\n  toString: 1\n  toString: 2\n", [
      { line: 3, column: 2, message: "duplicate metadata key 'toString'" },
    ]);
  });

  test("the same invalid date is reported twice, and a slash spelling is kept", () => {
    expectErrors("2022-02-30 open Assets:A\n2022-02-30 close Assets:A\n", [
      { line: 1, column: 0, message: "invalid date '2022-02-30'" },
      { line: 2, column: 0, message: "invalid date '2022-02-30'" },
    ]);
    expectErrors("2022-01-01 open Assets:A\n  when: 2022/2/30\n", [
      { line: 2, column: 8, message: "invalid date '2022/2/30'" },
    ]);
    // 😀 is one column: the date token starts at 23, not 24.
    expectErrors('2022-01-01 * "a"\n  Expenses:😀:午  1 USD {2022-02-30}\n', [
      { line: 2, column: 23, message: "invalid date '2022-02-30'" },
    ]);
  });

  test("a leap day and its slash spelling are the same local midnight", () => {
    const input = "2020-2-29 open Assets:A\n2020/2/29 close Assets:A\n";
    expectSameAsAntlr(input);
    const [open, close] = BeancountParser.parse(input).directives;
    if (!(open instanceof Open) || !(close instanceof Close)) throw new Error("expected open then close");
    expect(open.date.getTime()).toBe(new Date(2020, 1, 29).getTime());
    expect(close.date.getTime()).toBe(open.date.getTime());
  });
});

describe("number expression spellings", () => {
  test("signs and thousands separators stay; parentheses and operators drop the spelling", () => {
    const amount = (expr: string): Amount => {
      const input = `2022-01-01 balance Assets:A ${expr} USD`;
      expectSameAsAntlr(input);
      const directive = BeancountParser.parse(input).directives[0];
      expect(directive).toBeInstanceOf(Balance);
      return (directive as Balance).amount;
    };
    expect(amount("-+1,000.50")).toEqual(new Amount(-1000.5, "USD", "-+1000.50"));
    expect(amount("+ + 3")).toEqual(new Amount(3, "USD", "++3"));
    expect(amount("((5))")).toEqual(new Amount(5, "USD"));
    expect(amount("1 + 2 * 3 - 4 / 2")).toEqual(new Amount(5, "USD"));
    expectErrors("2022-01-01 balance Assets:A (1/0) USD\n", [
      { line: 1, column: 28, message: "invalid number '(1/0)'" },
    ]);
  });

  test("metadata keeps a bare number, not its spelling, and an amount keeps both", () => {
    const input = "2022-01-01 open Assets:A\n  nn: -+1,000.50\n  mm: (1 + 2)\n  qq: 1 USD\n";
    expectSameAsAntlr(input);
    const open = BeancountParser.parse(input).directives[0];
    expect(open).toBeInstanceOf(Open);
    expect((open as Open).metadata).toEqual({
      nn: -1000.5,
      mm: 3,
      qq: new Amount(1, "USD", "1"),
    });
  });

  test("a backslash-newline in a narration is the newline, not a surviving backslash", () => {
    const input = '2022-01-01 * "a\\\nb"\n';
    expectSameAsAntlr(input);
    const txn = BeancountParser.parse(input).directives[0];
    expect(txn).toBeInstanceOf(Transaction);
    expect((txn as Transaction).narration).toBe("a\nb");
  });
});

describe("location at EOF", () => {
  test("a multi-line string with no trailing newline ends on the string's last line", () => {
    const note = '2022-01-01 note Assets:A "a\n😀c"';
    expectSameAsAntlr(note);
    expect(BeancountParser.parse(note).directives[0]!.location).toEqual({
      start: { line: 1, column: 0 },
      end: { line: 2, column: 4 },
    });

    const plugin = 'plugin "mod" "a\n😀"';
    expectSameAsAntlr(plugin);
    const parsed = BeancountParser.parse(plugin).directives[0];
    expect(parsed).toBeInstanceOf(Plugin);
    expect(parsed!.location).toEqual({ start: { line: 1, column: 0 }, end: { line: 2, column: 3 } });

    const open = '2022-01-01 open Assets:A\n  memo: "a\n    😀c"';
    expectSameAsAntlr(open);
    expect(BeancountParser.parse(open).directives[0]!.location).toEqual({
      start: { line: 1, column: 0 },
      end: { line: 3, column: 8 },
    });
  });
});

// MAX_NUMBER_DEPTH is 64. One past it must fall back to ANTLR, not invent an
// error or return a partially evaluated expression.
describe("number nesting at the fast-path depth limit", () => {
  function priceAmount(expr: string): Amount {
    const input = `2022-01-01 price USD ${expr} CNY`;
    expectSameAsAntlr(input);
    const directive = BeancountParser.parse(input).directives[0];
    expect(directive).toBeInstanceOf(Price);
    return (directive as Price).amount;
  }

  test("64 and 65 nested parens both evaluate the inner literal", () => {
    expect(priceAmount(`${"(".repeat(64)}1${")".repeat(64)}`)).toEqual(new Amount(1, "CNY"));
    expect(priceAmount(`${"(".repeat(65)}1${")".repeat(65)}`)).toEqual(new Amount(1, "CNY"));
  });

  test("64 unary minuses keep an even-sign spelling; the 65th flips the sign", () => {
    expect(priceAmount(`${"-".repeat(64)}1`)).toEqual(new Amount(1, "CNY", `${"-".repeat(64)}1`));
    expect(priceAmount(`${"-".repeat(65)}1`)).toEqual(new Amount(-1, "CNY", `${"-".repeat(65)}1`));
  });

  test("a chain inside 64 parens is fully evaluated, not cut at the depth check", () => {
    const expr = `${"(".repeat(64)}1 + 1 + 1${")".repeat(64)}`;
    expect(priceAmount(expr)).toEqual(new Amount(3, "CNY"));
  });
});

// The differential tests above compare the two paths of this version. These
// pin the errors the parser reported before the hand-written path existed:
// after a lexer error recovered at a newline, the next line still gets its
// column-0 handling (INDENT, ignored lines, indented comment lines).
describe("errors after a lexer error that ends a line", () => {
  const cases: Array<[string, SyntaxErrorInfo[]]> = [
    [
      '2022-01-01 * "a" ^\n  Assets:A 1 USD\n',
      [
        { line: 1, column: 17, message: "token recognition error at: '^\n'" },
        { line: 2, column: 0, message: "missing {<EOF>, EOL} at '  '" },
      ],
    ],
    ["x\n* Heading\n2022-01-01 open Assets:A\n", [{ line: 1, column: 0, message: "token recognition error at: 'x\n'" }]],
    [
      "2022-01-01 open Assets:A ^\n  ; note\n2022-01-02 close Assets:A\n",
      [
        { line: 1, column: 25, message: "token recognition error at: '^\n'" },
        { line: 3, column: 0, message: "mismatched input '2022-01-02' expecting {<EOF>, EOL, CAPITAL, CURRENCY, STRING}" },
      ],
    ],
    [
      '2020-01-01 * "x"\n  Assets:A 1 USD bar\n  Assets:B\n',
      [
        { line: 2, column: 17, message: "token recognition error at: 'bar\n'" },
        { line: 3, column: 0, message: "mismatched input '  ' expecting {<EOF>, EOL, '@@', '@', '{{', '{'}" },
      ],
    ],
    [
      "1999-12-31 pri\n  ce /ES 1. CNY\n",
      [
        { line: 1, column: 11, message: "token recognition error at: 'pri\n'" },
        { line: 2, column: 0, message: "no viable alternative at input '1999-12-31  '" },
        { line: 2, column: 2, message: "token recognition error at: 'ce '" },
      ],
    ],
  ];
  for (const [input, errors] of cases) {
    test(JSON.stringify(input), () => {
      expect(outcome(input, () => BeancountParser.parse(input))).toEqual({ input, errors });
    });
  }
});
