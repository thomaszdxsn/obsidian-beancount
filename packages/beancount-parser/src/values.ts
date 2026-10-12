// Token-to-value conversions shared by both parse paths (fast-parser.ts and
// the ANTLR tree visitor in index.ts), so they cannot drift apart.

/** One lexer, parser or value error; `line` is 1-based, `column` 0-based. */
export interface SyntaxErrorInfo {
  line: number;
  column: number;
  message: string;
}

/** A number and, when it is a plain literal, its source spelling. */
export interface ParsedNumber {
  value: number;
  text?: string;
}

const UNESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', b: '\b' };

/** STRING token text without its quotes; escapes as upstream's cunescape, any other escaped char stands for itself. */
export function unquote(str: string): string {
  const body = str.slice(1, -1);
  return body.includes('\\') ? body.replace(/\\(.)/gs, (_m, c: string) => UNESCAPES[c] ?? c) : body;
}

/**
 * The local-midnight Date of DATE token text, or null when the calendar
 * rejects it (e.g. 2022-02-30: the lexer cannot). DATE accepts `-` or `/`
 * separators and unpadded parts. A ledger repeats each date many times, so
 * `cache` keeps the time value of every valid text seen.
 */
export function calendarDate(text: string, cache: Map<string, number>): Date | null {
  const cached = cache.get(text);
  if (cached !== undefined) return new Date(cached);
  const [year, month, day] = text.split(/[-/]/).map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  cache.set(text, date.getTime());
  return date;
}
