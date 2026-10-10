import { describe, expect, test } from "bun:test";
import { readdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeancountParser } from "../src";
import { parseRaw } from "./antlr";
import {
  Balance,
  Close,
  Commodity,
  Custom,
  Document,
  Event,
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
