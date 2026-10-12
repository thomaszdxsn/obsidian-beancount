import { describe, expect, test } from "bun:test";
import { CharStream, Interval } from "antlr4ng";
import { StringCharStream } from "../src/char-stream";

// One symbol per code point, matching CharStream.fromString: a surrogate pair
// is one symbol, a lone surrogate is its own. Token text is a slice of the
// source, so a wrong UTF-16 cut shows up as different text, not just a bad index.

const INPUTS: [string, string][] = [
  ["empty", ""],
  ["ascii", "abc"],
  ["one pair", "😀"],
  ["pair between ascii", "a😀b"],
  ["lone high surrogate", "\uD800"],
  ["lone low surrogate", "\uDFFF"],
  ["lone high between ascii", "a\uD800b"],
  ["pair at both ends", "😀x🎉"],
  ["lone high then a pair", "\uD800😀"],
  ["pair, lone low, ascii", "a\uD800\uDC00b\uDFFFc"],
  ["many pairs then a lone low", "🎉".repeat(33) + "\uDFFF" + "z"],
];

describe("StringCharStream matches CharStream.fromString", () => {
  test.each(INPUTS)("%s", (_name, input) => {
    const ours = new StringCharStream(input);
    const ref = CharStream.fromString(input);
    expect(ours.size).toBe(ref.size);
    expect(ours.toString()).toBe(ref.toString());
    expect(ours.getSourceName()).toBe(ref.getSourceName());
    expect(ours.mark()).toBe(ref.mark());

    for (let start = 0; start <= ours.size; start++) {
      for (let stop = -1; stop <= ours.size; stop++) {
        expect(ours.getTextFromRange(start, stop)).toBe(ref.getTextFromRange(start, stop));
        expect(ours.getTextFromInterval(new Interval(start, stop))).toBe(ref.getTextFromInterval(new Interval(start, stop)));
      }
    }

    for (let i = 0; i <= ours.size; i++) {
      ours.seek(i);
      ref.seek(i);
      expect(ours.index).toBe(ref.index);
      for (const offset of [-2, -1, 0, 1, 2]) expect(ours.LA(offset)).toBe(ref.LA(offset));
    }

    ours.seek(1_000);
    ref.seek(1_000);
    expect(ours.index).toBe(ref.index);
    expect(() => ours.consume()).toThrow("cannot consume EOF");
    expect(() => ref.consume()).toThrow("cannot consume EOF");

    ours.reset();
    ref.reset();
    expect(ours.index).toBe(0);
    expect(ours.LA(1)).toBe(ref.LA(1));
  });

  test("a set name is the source name", () => {
    const ours = new StringCharStream("a😀");
    const ref = CharStream.fromString("a😀");
    ours.name = "ledger.beancount";
    ref.name = "ledger.beancount";
    expect(ours.getSourceName()).toBe(ref.getSourceName());
  });
});

/** UTF-16 offset of each code point, plus one past the end. */
function codePointStarts(input: string): number[] {
  const starts = [0];
  for (let i = 0; i < input.length; ) {
    const c = input.charCodeAt(i);
    const pair =
      c >= 0xd800 &&
      c <= 0xdbff &&
      i + 1 < input.length &&
      input.charCodeAt(i + 1) >= 0xdc00 &&
      input.charCodeAt(i + 1) <= 0xdfff;
    i += pair ? 2 : 1;
    starts.push(i);
  }
  return starts;
}

describe("indexOfOffset", () => {
  test("with no pairs, a UTF-16 offset is already a code point index", () => {
    const ascii = new StringCharStream("abcd");
    expect(ascii.indexOfOffset(0)).toBe(0);
    expect(ascii.indexOfOffset(4)).toBe(4);
    // A lone surrogate is its own symbol, so the offset table stays absent.
    const lone = new StringCharStream("a\uD800b");
    expect(lone.size).toBe(3);
    expect(lone.indexOfOffset(0)).toBe(0);
    expect(lone.indexOfOffset(1)).toBe(1);
    expect(lone.indexOfOffset(3)).toBe(3);
  });

  test("binary search finds every code-point start across pairs and lone surrogates", () => {
    const input = "a😀b\uD800c\uDFFFd" + "🎉".repeat(20) + "z";
    const stream = new StringCharStream(input);
    const starts = codePointStarts(input);
    expect(stream.size).toBe(starts.length - 1);
    for (let i = 0; i < starts.length; i++) expect(stream.indexOfOffset(starts[i]!)).toBe(i);
    // Low half of the first emoji (UTF-16 index 2) starts no code point: the
    // result is the following symbol, not the emoji and not -1.
    expect(input.charCodeAt(2)).toBeGreaterThanOrEqual(0xdc00);
    expect(stream.indexOfOffset(2)).toBe(2);
  });
});
