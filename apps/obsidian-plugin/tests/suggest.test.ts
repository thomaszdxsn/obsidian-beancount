import { describe, expect, it } from 'vitest';
import type { App, Editor, TFile } from 'obsidian';
import { ownSlot } from '../suggest';
import { TagSuggest } from '../token-suggest';
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

	it('recomputes when a fence opener elsewhere in the document is removed', () => {
		const suggest = new TagSuggest({} as App, { match: () => ['#food'] });
		const editor = createEditor(['```beancount', '#fo']);
		const cursor = { line: 1, ch: 3 };
		expect(suggest.onTrigger(cursor, editor as unknown as Editor, NOTE)).toMatchObject({ query: '#fo' });
		editor.lines[0] = 'not a fence';
		expect(suggest.onTrigger(cursor, editor as unknown as Editor, NOTE)).toBeNull();
	});
});
