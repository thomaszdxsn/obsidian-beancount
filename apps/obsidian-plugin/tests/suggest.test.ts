import { describe, expect, it } from 'vitest';
import type { Editor, TFile } from 'obsidian';
import { ownSlot } from '../suggest';
import { createEditor } from './fakes';

const LEDGER = { path: 'ledger.bean', extension: 'bean' } as TFile;
const NOTE = { path: 'note.md', extension: 'md' } as TFile;

describe('ownSlot cache', () => {
	it('recomputes when the line text changes at the same caret', () => {
		const editor = createEditor(['#fo']);
		const cursor = { line: 0, ch: 3 };
		expect(ownSlot('tag', cursor, editor as unknown as Editor, LEDGER, true)?.kind).toBe('tag');
		// Selecting the last character and typing `/` keeps `ch` at 3.
		editor.lines[0] = '#fo/x';
		expect(ownSlot('tag', cursor, editor as unknown as Editor, LEDGER, true)).toBeNull();
	});

	it('recomputes when the same editor is reused for another file', () => {
		const editor = createEditor(['#fo']);
		const cursor = { line: 0, ch: 3 };
		expect(ownSlot('tag', cursor, editor as unknown as Editor, LEDGER, true)?.kind).toBe('tag');
		expect(ownSlot('tag', cursor, editor as unknown as Editor, NOTE, true)).toBeNull();
	});
});
