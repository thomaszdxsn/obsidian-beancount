import { describe, expect, it, vi } from 'vitest';
import type { App, Editor, EditorSuggestContext, Plugin, PluginManifest, TFile } from 'obsidian';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { CompletionUsage } from '../completion-rank';
import { extractCommodities, extractLinks, extractNarrations, extractTags } from '../token-index';
import { CommoditySuggest, LinkSuggest, NarrationSuggest, TagSuggest } from '../token-suggest';
import { registerVaultIndex, VaultIndex } from '../vault-index';
import { createEditor, FakeVault, flush } from './fakes';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

/** A ledger file whose extension the context check accepts outright. */
const LEDGER_FILE = { path: 'ledger.bean', extension: 'bean' } as TFile;

/** An unclosed fence in a vault note: its body holds a completable tag. */
const FENCED_VAULT = ['```beancount', '#trip'];

/** The same fence being edited: the partial tag is the live buffer. */
const FENCED_EDITOR = ['```beancount', '#tr'];

function at(line: string, ch = line.length) {
	const editor = createEditor([line]);
	return { editor: editor as unknown as Editor, cursor: { line: 0, ch } };
}

function contextFor(query: string): EditorSuggestContext {
	return { query } as EditorSuggestContext;
}

function setup(extract: (content: string) => ReadonlySet<string>, files: Record<string, string> = {}) {
	const vault = new FakeVault();
	for (const [path, content] of Object.entries(files)) vault.write(path, content);
	const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
	const index = new VaultIndex(extract);
	registerVaultIndex(plugin as unknown as Plugin, index);
	return { vault, index, plugin };
}

describe('TagSuggest.onTrigger', () => {
	it('triggers on a partial tag inside a ledger file', async () => {
		const { index } = setup(extractTags, { 'a.md': '#trip' });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		const { editor, cursor } = at('#tr');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toEqual({
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 3 },
			query: '#tr',
		});
	});

	it('triggers inside a beancount fence of a markdown note', async () => {
		const { index } = setup(extractTags, { 'a.md': FENCED_VAULT.join('\n') });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		const editor = createEditor([...FENCED_EDITOR]);
		expect(suggest.onTrigger({ line: 1, ch: 3 }, editor as unknown as Editor, null)).toMatchObject({
			query: '#tr',
		});
	});

	it('stays quiet on markdown prose outside a fence', async () => {
		const { index } = setup(extractTags, { 'a.md': '#trip' });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		const { editor, cursor } = at('#tr');
		expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
	});

	it('triggers right after the sigil with every tag on offer', async () => {
		const { index } = setup(extractTags, { 'a.md': 'x #trip #truce' });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		const { editor, cursor } = at('  #');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toEqual({
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 3 },
			query: '#',
		});
		expect(suggest.getSuggestions(contextFor('#'))).toEqual(['#trip', '#truce']);
	});

	it('stays quiet when editing inside the tag', async () => {
		const { index } = setup(extractTags, { 'a.md': '#trip' });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		// A token character after the cursor would be garbled by the pick.
		const { editor, cursor } = at('#tr', 2);
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toBeNull();
	});

	it('stays quiet when the tail is not a tag token', async () => {
		const { index } = setup(extractTags, { 'a.md': '#trip' });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		// `2 # 3`: the caret ends after a space, so the tail is no `#name`.
		const { editor, cursor } = at('2 # 3');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toBeNull();
	});

	it('stays quiet when the vault has no tags', async () => {
		const { index } = setup(extractTags);
		await flush();
		const suggest = new TagSuggest({} as App, index);
		const { editor, cursor } = at('#tr');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toBeNull();
	});

	it('stays quiet inside quoted strings', async () => {
		const { index } = setup(extractTags, { 'a.md': 'x #trip' });
		await flush();
		const tag = new TagSuggest({} as App, index);
		// The payee/narration fields own quoted text: `Fix #` is not a tag
		// position — the popup must not hijack the string.
		expect(tag.onTrigger(at('"Shell" "Fix #').cursor, at('"Shell" "Fix #').editor, LEDGER_FILE)).toBeNull();
	});

	it('respects escaped quotes when deciding string state', async () => {
		const { index } = setup(extractTags, { 'a.md': 'x #trip' });
		await flush();
		const tag = new TagSuggest({} as App, index);
		// `\"` inside the payee is an escaped quote: the string ends at the
		// last quote, and the sigil after it is a real tag position.
		const line = '2026-09-30 * "Say \\"hi" #tr';
		expect(tag.onTrigger(at(line).cursor, at(line).editor, LEDGER_FILE)).toMatchObject({ query: '#tr' });
	});

	it('stays quiet on the bare # transaction flag', async () => {
		const { index } = setup(extractTags, { 'a.md': '#trip' });
		await flush();
		const tag = new TagSuggest({} as App, index);
		// `#` is a transaction flag: `2026-09-30 #` must not open the tag list.
		expect(tag.onTrigger(at('2026-09-30 #').cursor, at('2026-09-30 #').editor, LEDGER_FILE)).toBeNull();
		// After a flag character the sigil is a tag again.
		expect(tag.onTrigger(at('2026-09-30 * #').cursor, at('2026-09-30 * #').editor, LEDGER_FILE)).toMatchObject({
			query: '#',
		});
	});

	it('caps suggestions at MAX_SUGGESTIONS', async () => {
		const { index } = setup(
			extractTags,
			Object.fromEntries(
				Array.from({ length: 60 }, (_, i) => [`n${i}.md`, `#tag${String(i).padStart(2, '0')}`])
			)
		);
		await flush();
		const suggest = new TagSuggest({} as App, index);
		expect(suggest.getSuggestions(contextFor('#'))).toHaveLength(50);
	});
});

describe('LinkSuggest.onTrigger', () => {
	it('triggers on a partial link inside ledger text', async () => {
		const { index } = setup(extractLinks, { 'a.md': '^receipt' });
		await flush();
		const suggest = new LinkSuggest({} as App, index);
		const { editor, cursor } = at('^re');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toEqual({
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 3 },
			query: '^re',
		});
		expect(suggest.getSuggestions(contextFor('^'))).toEqual(['^receipt']);
	});

	it('stays quiet on markdown prose outside a fence', async () => {
		const { index } = setup(extractLinks, { 'a.md': '^receipt' });
		await flush();
		const suggest = new LinkSuggest({} as App, index);
		const { editor, cursor } = at('^re');
		expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
	});

	it('stays quiet when editing inside the link', async () => {
		const { index } = setup(extractLinks, { 'a.md': '^receipt' });
		await flush();
		const suggest = new LinkSuggest({} as App, index);
		const { editor, cursor } = at('^re', 2);
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toBeNull();
	});

	it('stays quiet when the tail is not a link token', async () => {
		const { index } = setup(extractLinks, { 'a.md': '^receipt' });
		await flush();
		const suggest = new LinkSuggest({} as App, index);
		// `2 ^ 3`: the caret ends after a space, so the tail is no `^name`.
		const { editor, cursor } = at('2 ^ 3');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toBeNull();
	});

	it('triggers in a fence even when the file is a markdown note', async () => {
		const { index } = setup(extractLinks, { 'a.md': '^receipt' });
		await flush();
		const suggest = new LinkSuggest({} as App, index);
		const editor = createEditor(['```bean', '^re']);
		const noteFile = { path: 'note.md', extension: 'md' } as TFile;
		expect(suggest.onTrigger({ line: 1, ch: 3 }, editor as unknown as Editor, noteFile)).toMatchObject({
			query: '^re',
		});
	});

	it('keeps the closed fence bounds: prose above and below stays quiet', async () => {
		const { index } = setup(extractTags, { 'a.md': 'x #trip' });
		await flush();
		const suggest = new TagSuggest({} as App, index);
		// Line 1 is the fence body; lines 0, 2 (the closing fence) and 3 are
		// prose — a typo'd bounds check would pop the tag list over them.
		const editor = createEditor(['#tr', '```beancount', '#trip', '```', '#tr']);
		expect(suggest.onTrigger({ line: 0, ch: 3 }, editor as unknown as Editor, null)).toBeNull();
		expect(suggest.onTrigger({ line: 2, ch: 5 }, editor as unknown as Editor, null)).toBeNull();
		expect(suggest.onTrigger({ line: 3, ch: 3 }, editor as unknown as Editor, null)).toBeNull();
		expect(suggest.onTrigger({ line: 4, ch: 3 }, editor as unknown as Editor, null)).toBeNull();
	});
});

describe('CommoditySuggest.onTrigger', () => {
	it('triggers on a partial posting unit', async () => {
		const { index } = setup(extractCommodities, { 'a.md': '  Assets:Cash  10.00 USD' });
		await flush();
		const suggest = new CommoditySuggest({} as App, index);
		const { editor, cursor } = at('  Assets:Cash  10.00 US');
		expect(suggest.onTrigger(cursor, editor, LEDGER_FILE)).toEqual({
			start: { line: 0, ch: 21 },
			end: { line: 0, ch: 23 },
			query: 'US',
		});
	});

	it('triggers after the price and commodity keywords', async () => {
		const { index } = setup(
			extractCommodities,
			{ 'a.md': '2026-09-30 price USD 1.10 CAD\n2026-09-30 commodity AAPL' }
		);
		await flush();
		const suggest = new CommoditySuggest({} as App, index);
		expect(suggest.onTrigger(at('2026-09-30 price US').cursor, at('2026-09-30 price US').editor, LEDGER_FILE)?.query).toBe('US');
		expect(
			suggest.onTrigger(at('2026-09-30 commodity AA').cursor, at('2026-09-30 commodity AA').editor, LEDGER_FILE)?.query
		).toBe('AA');
		expect(suggest.getSuggestions(contextFor('AA'))).toEqual(['AAPL']);
	});

	it('stays quiet on an account tail and between the number and token', async () => {
		const { index } = setup(extractCommodities, { 'a.md': '  Assets:Cash  10.00 USD' });
		await flush();
		const suggest = new CommoditySuggest({} as App, index);
		expect(suggest.onTrigger(at('  Expenses:Fo').cursor, at('  Expenses:Fo').editor, LEDGER_FILE)).toBeNull();
		const space = at('  Assets:Cash  10.00 ', 21);
		expect(suggest.onTrigger(space.cursor, space.editor, LEDGER_FILE)).toBeNull();
	});

	it('stays quiet when editing inside the commodity', async () => {
		const { index } = setup(extractCommodities, { 'a.md': '  Assets:Cash  10.00 USD' });
		await flush();
		const suggest = new CommoditySuggest({} as App, index);
		// A token character after the cursor (`US|D`) would be garbled by the pick.
		const mid = at('  Assets:Cash  10.00 US', 22);
		expect(suggest.onTrigger(mid.cursor, mid.editor, LEDGER_FILE)).toBeNull();
	});

	it('stays quiet on markdown prose outside a fence', async () => {
		const { index } = setup(extractCommodities, { 'a.md': '  Assets:Cash  10.00 USD' });
		await flush();
		const suggest = new CommoditySuggest({} as App, index);
		const { editor, cursor } = at('  Assets:Cash  10.00 US');
		expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
	});

	it('stays quiet inside quoted strings and comments', async () => {
		const { index } = setup(extractCommodities, { 'a.md': '  Assets:Cash  10.00 USD' });
		await flush();
		const suggest = new CommoditySuggest({} as App, index);
		// The payee field owns quoted text; a `;` comment owns the tail.
		expect(
			suggest.onTrigger(at('2026-09-30 * "Paid 5 E').cursor, at('2026-09-30 * "Paid 5 E').editor, LEDGER_FILE)
		).toBeNull();
		const comment = at('; bought 10 U');
		expect(suggest.onTrigger(comment.cursor, comment.editor, LEDGER_FILE)).toBeNull();
	});
});

describe('NarrationSuggest', () => {
	const NARRATIONS = { 'a.md': '2026-09-30 * "Shell" "Fuel"' };

	function setupNarrations(enabled: boolean) {
		const fixture = setup(extractNarrations, NARRATIONS);
		return new NarrationSuggest({} as App, fixture.index, () => enabled);
	}

	it('triggers inside the second quoted field when enabled', async () => {
		const suggest = setupNarrations(true);
		await flush();
		const { editor, cursor } = at('2026-09-30 * "Shell" "Fu');
		expect(suggest.onTrigger(cursor, editor, null)).toEqual({
			start: { line: 0, ch: 22 },
			end: { line: 0, ch: 24 },
			query: 'Fu',
		});
	});

	it('stays quiet when the setting is off', async () => {
		const suggest = setupNarrations(false);
		await flush();
		const { editor, cursor } = at('2026-09-30 * "Shell" "Fu');
		expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
	});

	it('stays quiet in the payee field', async () => {
		const suggest = setupNarrations(true);
		await flush();
		const { editor, cursor } = at('2026-09-30 * "Shel');
		expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
	});

	it('triggers before a typed closing quote', async () => {
		const suggest = setupNarrations(true);
		await flush();
		// CodeMirror auto-pairs quotes: `"Shell" "Fu|"` is the common state.
		const { editor, cursor } = at('2026-09-30 * "Shell" "Fu"', 24);
		expect(suggest.onTrigger(cursor, editor, null)).toEqual({
			start: { line: 0, ch: 22 },
			end: { line: 0, ch: 24 },
			query: 'Fu',
		});
	});

	it('stays quiet when editing inside the narration', async () => {
		const suggest = setupNarrations(true);
		await flush();
		// Any character but the closing quote after the cursor would be garbled.
		const { editor, cursor } = at('2026-09-30 * "Shell" "Fue', 23);
		expect(suggest.onTrigger(cursor, editor, null)).toBeNull();
	});

	it('picking does nothing when no context is active', async () => {
		const suggest = setupNarrations(true);
		const editor = createEditor(['2026-09-30 * "Shell" "Fu']);
		suggest.context = null;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Fuel', {} as MouseEvent);
		expect(editor.replacements).toEqual([]);
		expect(close).not.toHaveBeenCalled();
	});

	it('picking closes an unclosed field', async () => {
		const suggest = setupNarrations(true);
		const editor = createEditor(['2026-09-30 * "Shell" "Fu']);
		suggest.context = {
			start: { line: 0, ch: 22 },
			end: { line: 0, ch: 24 },
			editor: editor as unknown as Editor,
		} as EditorSuggestContext;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Fuel', {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: 'Fuel" ', from: { line: 0, ch: 22 }, to: { line: 0, ch: 24 } },
		]);
		expect(close).toHaveBeenCalledOnce();
	});

	it('picking before a typed closing quote leaves it alone', async () => {
		const suggest = setupNarrations(true);
		const editor = createEditor(['2026-09-30 * "Shell" "Fu" 10 USD']);
		suggest.context = {
			start: { line: 0, ch: 22 },
			end: { line: 0, ch: 24 },
			editor: editor as unknown as Editor,
		} as EditorSuggestContext;
		suggest.selectSuggestion('Fuel', {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: 'Fuel', from: { line: 0, ch: 22 }, to: { line: 0, ch: 24 } },
		]);
	});

	it('remembers a pick so later matches rank it first', () => {
		const usage = CompletionUsage.parse({}, () => 1);
		const index = new VaultIndex(extractNarrations, usage);
		index.setFileContent(
			'a.bean',
			['2026-09-30 * "A" "Fuel"', '2026-09-30 * "B" "Groceries"'].join('\n')
		);
		const suggest = new NarrationSuggest({} as App, index, () => true);
		const editor = createEditor(['2026-09-30 * "A" "']);
		suggest.context = {
			start: { line: 0, ch: 17 },
			end: { line: 0, ch: 17 },
			editor: editor as unknown as Editor,
		} as EditorSuggestContext;
		expect(index.match('')).toEqual(['Fuel', 'Groceries']);
		suggest.selectSuggestion('Groceries', {} as MouseEvent);
		expect(index.match('')).toEqual(['Groceries', 'Fuel']);
	});
});
