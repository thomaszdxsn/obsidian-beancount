import { describe, expect, it, vi } from 'vitest';
import type { App, Editor, EditorSuggestContext, Plugin, PluginManifest, TFile } from 'obsidian';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { extractPayees } from '../payee-index';
import { PayeeSuggest } from '../payee-suggest';
import { registerVaultIndex, VaultIndex } from '../vault-index';
import { createEditor, FakeVault, flush } from './fakes';

const manifest = { id: 'beancount' } as PluginManifest;

/** A vault with completable payees, for trigger expectations. */
const PAYEES = {
	'a.md': ['2026-09-30 * "Whole Foods" "Groceries"', '2026-10-01 * "Shell" "Fuel"'].join('\n'),
};

function trigger(suggest: PayeeSuggest, line: string, ch = line.length) {
	const editor = createEditor([line]);
	return suggest.onTrigger({ line: 0, ch }, editor as unknown as Editor, null);
}

function contextFor(query: string): EditorSuggestContext {
	return { query } as EditorSuggestContext;
}

interface Fixture {
	vault: FakeVault;
	index: VaultIndex;
	suggest: PayeeSuggest;
	plugin: RecordingPlugin;
}

function setup(files: Record<string, string> = {}): Fixture {
	const vault = new FakeVault();
	for (const [path, content] of Object.entries(files)) vault.write(path, content);
	const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
	const index = new VaultIndex(extractPayees);
	registerVaultIndex(plugin as unknown as Plugin, index);
	return { vault, index, suggest: new PayeeSuggest({} as App, index), plugin };
}

describe('PayeeSuggest.onTrigger', () => {
	it('triggers on a partial payee ending at the cursor', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		expect(trigger(suggest, '2026-09-30 * "Whole Fo')).toEqual({
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 22 },
			query: 'Whole Fo',
		});
	});

	it('triggers right after the opening quote with every payee on offer', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		expect(trigger(suggest, '2026-09-30 * "')).toEqual({
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 14 },
			query: '',
		});
		expect(suggest.getSuggestions(contextFor(''))).toEqual(['Shell', 'Whole Foods']);
	});

	it('triggers when the cursor sits before the closing quote', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		expect(trigger(suggest, '2026-09-30 * "Shel"', 18)).toEqual({
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 18 },
			query: 'Shel',
		});
	});

	it('keeps the query anchored to the cursor, not the line end', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		// The narration and its quotes trail the cursor and stay untouched.
		expect(trigger(suggest, '2026-09-30 * "Whole" "Narration"', 19)).toEqual({
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 19 },
			query: 'Whole',
		});
	});

	it('stays quiet when editing inside the field', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		// Any character but the closing quote after the cursor would garble
		// the rest of the field when the pick replaces the typed prefix.
		expect(trigger(suggest, '2026-09-30 * "Whole Foods"', 17)).toBeNull();
		expect(trigger(suggest, '2026-09-30 * "Whole Foods"', 19)).toBeNull();
	});

	it('stays quiet in the narration field', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		// The narration may well type out a known payee; the field, not the
		// text, decides.
		expect(trigger(suggest, '2026-09-30 * "Shell" "Whole')).toBeNull();
		expect(trigger(suggest, '2026-09-30 * "Whole Foods" "Who')).toBeNull();
	});

	it('stays quiet on lines that are not transactions', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		expect(trigger(suggest, '2026-09-30 open Assets:Cash "Whole')).toBeNull();
		expect(trigger(suggest, '2026-09-30 note Assets:Cash "Whole')).toBeNull();
		expect(trigger(suggest, '  Expenses:Food  10.00 USD "Whole')).toBeNull();
		expect(trigger(suggest, 'paid at "Whole')).toBeNull();
	});

	it('never suggests the exact payee being typed', async () => {
		// The live buffer feeds the index, so the typed payee is a "known"
		// one; offering it back would make Enter accept a no-op.
		const { suggest } = setup(PAYEES);
		await flush();
		expect(suggest.getSuggestions(contextFor('Shell'))).toEqual([]);
		expect(trigger(suggest, '2026-09-30 * "Shell"', 19)).toBeNull();
	});

	it('stays quiet when the typed text prefixes no cached payee', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		expect(trigger(suggest, '2026-09-30 * "Zzz')).toBeNull();
	});
});

describe('PayeeSuggest suggestions', () => {
	it('returns prefix matches from the vault index', async () => {
		const { suggest } = setup(PAYEES);
		await flush();
		expect(suggest.getSuggestions(contextFor('Whole'))).toEqual(['Whole Foods']);
		expect(suggest.getSuggestions(contextFor('sh'))).toEqual(['Shell']);
		expect(suggest.getSuggestions(contextFor('zzz'))).toEqual([]);
	});

	it('renders a suggestion as its payee text', () => {
		const { suggest } = setup();
		let rendered: string | DocumentFragment | null = null;
		const setText = (text: string | DocumentFragment) => {
			rendered = text;
		};
		suggest.renderSuggestion('Whole Foods', { setText } as unknown as HTMLElement);
		expect(rendered).toBe('Whole Foods');
	});

	it('replaces the trigger range with the selected payee and closes', () => {
		const { suggest } = setup();
		const editor = createEditor(['2026-09-30 * "Whole']);
		suggest.context = {
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 19 },
			query: 'Whole',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Whole Foods', {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: 'Whole Foods', from: { line: 0, ch: 14 }, to: { line: 0, ch: 19 } },
		]);
		// The chooser leaves the popover open; without close() a second pick
		// would reuse the stale range over the replacement.
		expect(close).toHaveBeenCalledOnce();
	});

	it('does nothing when no context is active', () => {
		const { suggest } = setup();
		const editor = createEditor(['2026-09-30 * "Whole']);
		suggest.context = null;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Whole Foods', {} as MouseEvent);
		expect(editor.replacements).toEqual([]);
		expect(close).not.toHaveBeenCalled();
	});
});
