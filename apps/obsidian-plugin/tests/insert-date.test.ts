import type { Editor } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor } from './fakes';
import { insertTodayDate, todayDate } from '../insert-date';

afterEach(() => {
	vi.useRealTimers();
});

describe('todayDate', () => {
	it('formats the local date as zero-padded YYYY-MM-DD', () => {
		expect(todayDate(new Date(2026, 8, 30))).toBe('2026-09-30');
		// Month and day both need padding.
		expect(todayDate(new Date(2026, 0, 5))).toBe('2026-01-05');
	});

	it('covers year, month and leap-day boundaries', () => {
		expect(todayDate(new Date(2027, 0, 1))).toBe('2027-01-01');
		expect(todayDate(new Date(2026, 11, 31))).toBe('2026-12-31');
		expect(todayDate(new Date(2028, 1, 29))).toBe('2028-02-29');
	});

	it('defaults to the current local date', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 30, 23, 59));
		expect(todayDate()).toBe('2026-09-30');
	});
});

describe('insertTodayDate', () => {
	it('inserts the date at the caret and leaves the caret after it', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 30));
		const editor = createEditor(['2026-09-29 * "Cafe"', '  Assets:Cash']);
		editor.setCursor({ line: 0, ch: 0 });

		insertTodayDate(editor as unknown as Editor);

		expect(editor.selectionReplacements).toEqual(['2026-09-30']);
		expect(editor.getValue()).toBe('2026-09-302026-09-29 * "Cafe"\n  Assets:Cash');
		expect(editor.getCursor()).toEqual({ line: 0, ch: 10 });
	});

	it('replaces the selection with the date', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 30));
		const editor = createEditor(['2026-09-29 * "Cafe"']);
		editor.selections = [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 10 } },
		];

		insertTodayDate(editor as unknown as Editor);

		expect(editor.getValue()).toBe('2026-09-30 * "Cafe"');
		expect(editor.getCursor()).toEqual({ line: 0, ch: 10 });
	});

	it('replaces every selection of a multi-caret edit', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 8, 30));
		const editor = createEditor(['old1 middle old2']);
		editor.selections = [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 4 } },
			{ anchor: { line: 0, ch: 12 }, head: { line: 0, ch: 16 } },
		];

		insertTodayDate(editor as unknown as Editor);

		expect(editor.selectionReplacements).toEqual(['2026-09-30']);
		expect(editor.getValue()).toBe('2026-09-30 middle 2026-09-30');
		expect(editor.listSelections().map((selection) => selection.head)).toEqual([
			{ line: 0, ch: 10 },
			{ line: 0, ch: 28 },
		]);
	});
});
