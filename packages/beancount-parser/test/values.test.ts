import { describe, expect, test } from "bun:test";
import { calendarDate, unquote } from "../src/values";

describe("unquote", () => {
  test("returns the body unchanged when it has no escape, including an astral character", () => {
    expect(unquote('""')).toBe("");
    expect(unquote('"plain"')).toBe("plain");
    expect(unquote('"😀"')).toBe("😀");
  });

  test("decodes cunescape sequences and lets any other escaped character stand for itself", () => {
    expect(unquote('"\\n\\t\\r\\f\\b"')).toBe("\n\t\r\f\b");
    expect(unquote('"a\\\\b\\"c\\q"')).toBe('a\\b"cq');
    // `.` must match the newline, or the backslash survives.
    expect(unquote('"a\\\nb"')).toBe("a\nb");
  });
});

describe("calendarDate", () => {
  test("rejects a calendar-invalid date and does not later treat that text as valid", () => {
    const cache = new Map<string, number>();
    expect(calendarDate("2022-02-30", cache)).toBeNull();
    expect(calendarDate("2019-2-29", cache)).toBeNull();
    expect(calendarDate("2022/2/30", cache)).toBeNull();
    expect(calendarDate("2022-00-01", cache)).toBeNull();
    expect(calendarDate("2022-02-30", cache)).toBeNull();
  });

  test("accepts a leap day and a slash spelling, and a later call is a fresh Date", () => {
    const cache = new Map<string, number>();
    const first = calendarDate("2020-2-29", cache);
    expect(first).not.toBeNull();
    first!.setFullYear(1999);
    const second = calendarDate("2020-2-29", cache);
    expect(second!.getFullYear()).toBe(2020);
    expect(second!.getMonth()).toBe(1);
    expect(second!.getDate()).toBe(29);
    expect(second).not.toBe(first);
    const slash = calendarDate("2020/2/29", cache);
    expect(slash!.getTime()).toBe(new Date(2020, 1, 29).getTime());
    expect(slash).not.toBe(second);
  });
});
