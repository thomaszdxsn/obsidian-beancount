import { IntStream, Token } from 'antlr4ng';
import type { CharStream, Interval } from 'antlr4ng';

/**
 * A `CharStream` over a string, equivalent to `CharStream.fromString` (one
 * symbol per code point; a lone surrogate is its own symbol) but built
 * without a per-character iterator and reading token text by slicing the
 * source string instead of rebuilding it code point by code point.
 */
export class StringCharStream implements CharStream {
  name = '';
  index = 0;
  readonly size: number;
  private readonly data: Uint32Array;
  // UTF-16 offset of each code point, plus one past the end; null when the
  // input has no surrogate pairs, so code point and UTF-16 offsets agree.
  private readonly offsets: Uint32Array | null;

  constructor(private readonly input: string) {
    const length = input.length;
    const data = new Uint32Array(length);
    let offsets: Uint32Array | null = null;
    let n = 0;
    for (let i = 0; i < length; i++) {
      const c = input.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < length) {
        const d = input.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          if (offsets === null) {
            offsets = new Uint32Array(length + 1);
            for (let k = 0; k <= n; k++) offsets[k] = k;
          }
          data[n] = ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
          n++;
          i++;
          offsets[n] = i + 1;
          continue;
        }
      }
      data[n] = c;
      n++;
      if (offsets !== null) offsets[n] = i + 1;
    }
    this.data = n === length ? data : data.subarray(0, n);
    this.offsets = offsets;
    this.size = n;
  }

  reset(): void {
    this.index = 0;
  }

  consume(): void {
    if (this.index >= this.size) throw new Error('cannot consume EOF');
    this.index += 1;
  }

  LA(offset: number): number {
    if (offset === 0) return 0;
    if (offset < 0) offset += 1;
    const pos = this.index + offset - 1;
    if (pos < 0 || pos >= this.size) return Token.EOF;
    return this.data[pos]!;
  }

  // The whole input is buffered: mark/release do nothing.
  mark(): number {
    return -1;
  }

  release(_marker: number): void {}

  seek(index: number): void {
    this.index = index <= this.index ? index : Math.min(index, this.size);
  }

  getTextFromRange(start: number, stop: number): string {
    if (stop >= this.size) stop = this.size - 1;
    if (start >= this.size || stop < start) return '';
    const offsets = this.offsets;
    return offsets === null
      ? this.input.slice(start, stop + 1)
      : this.input.slice(offsets[start], offsets[stop + 1]);
  }

  /** Code point index of UTF-16 offset `offset`, which starts a code point (or is the end). */
  indexOfOffset(offset: number): number {
    const offsets = this.offsets;
    if (offsets === null) return offset;
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid]! < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  getTextFromInterval(interval: Interval): string {
    return this.getTextFromRange(interval.start, interval.stop);
  }

  toString(): string {
    return this.input;
  }

  getSourceName(): string {
    return this.name || IntStream.UNKNOWN_SOURCE_NAME;
  }
}
