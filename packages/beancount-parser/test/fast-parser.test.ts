import { describe, expect, test } from "bun:test";
import { BeancountParser, BeancountSyntaxError, parseWithAntlr } from "../src";
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
