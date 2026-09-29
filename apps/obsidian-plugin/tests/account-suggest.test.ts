import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import type { App, Editor, EditorSuggestContext, Plugin, PluginManifest, TFile } from 'obsidian';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { AccountIndex } from '../account-index';
import { AccountSuggest, registerAccountSuggest } from '../account-suggest';
import { createEditor, FakeVault, flush } from './fakes';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

function trigger(suggest: AccountSuggest, line: string, ch = line.length) {
	const editor = createEditor([line]);
	return suggest.onTrigger({ line: 0, ch }, editor as unknown as Editor, null);
}

function contextFor(query: string): EditorSuggestContext {
	return { query } as EditorSuggestContext;
}

interface Fixture {
	vault: FakeVault;
	index: AccountIndex;
	suggest: AccountSuggest;
	plugin: RecordingPlugin;
}

function setup(files: Record<string, string> = {}): Fixture {
	const vault = new FakeVault();
	for (const [path, content] of Object.entries(files)) vault.write(path, content);
	const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
	const index = registerAccountSuggest(plugin as unknown as Plugin);
	return { vault, index, suggest: new AccountSuggest({} as App, index), plugin };
}

describe('AccountSuggest.onTrigger', () => {
	it('triggers on a complete account ending at the cursor', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'Assets:Cash')).toEqual({
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 11 },
			query: 'Assets:Cash',
		});
	});

	it('triggers on a partial segment and reports its start', () => {
		const { suggest } = setup();
		const info = trigger(suggest, '  Assets:Ca');
		expect(info).toEqual({
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 11 },
			query: 'Assets:Ca',
		});
	});

	it('triggers right after a trailing colon', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'Assets:')).toMatchObject({ query: 'Assets:' });
	});

	it('triggers after any non-word boundary character', () => {
		const { suggest } = setup();
		expect(trigger(suggest, '* (Assets:Ca')).toMatchObject({ query: 'Assets:Ca', start: { line: 0, ch: 3 } });
	});

	it('keeps the query anchored to the cursor, not the line end', () => {
		const { suggest } = setup();
		const info = trigger(suggest, '  Assets:Ca 10.00 USD', 11);
		expect(info).toMatchObject({ query: 'Assets:Ca', start: { line: 0, ch: 2 }, end: { line: 0, ch: 11 } });
	});

	it('stays quiet when editing inside a token', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'Assets:Cash', 3)).toBeNull();
		expect(trigger(suggest, 'Assets:CashUSD', 11)).toBeNull();
	});

	it('stays quiet on lowercase prose, dates and amounts', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'see assets here')).toBeNull();
		expect(trigger(suggest, '2026-09-30')).toBeNull();
		expect(trigger(suggest, 'paid 100.00')).toBeNull();
	});

	it('stays quiet when the tail is not a whole token', () => {
		const { suggest } = setup();
		// The tail `Assets:Ca` sits after a colon, dash or slash inside a
		// longer token or URL path.
		expect(trigger(suggest, 'x:Assets:Ca')).toBeNull();
		expect(trigger(suggest, 'sAssets:Ca')).toBeNull();
		expect(trigger(suggest, 'pre-Assets:Ca')).toBeNull();
		expect(trigger(suggest, 'https://github.com/User:Re')).toBeNull();
	});

	it('triggers on bare capitalized words as completion queries', async () => {
		const { suggest } = setup({ 'a.md': 'Assets:Cash:Wallet' });
		await flush();
		// Root-only and single-letter queries complete against real accounts.
		expect(suggest.getSuggestions(contextFor('Assets'))).toEqual(['Assets:Cash:Wallet']);
		expect(suggest.getSuggestions(contextFor('A'))).toEqual(['Assets:Cash:Wallet']);
		expect(trigger(suggest, 'Assets')).toMatchObject({ query: 'Assets' });
	});

	it('matches nothing for capitalized words without an account prefix hit', async () => {
		const { suggest } = setup({ 'a.md': 'Assets:Cash' });
		await flush();
		expect(trigger(suggest, '100.00 USD')).toMatchObject({ query: 'USD' });
		expect(suggest.getSuggestions(contextFor('USD'))).toEqual([]);
	});
});

describe('AccountSuggest suggestions', () => {
	it('returns prefix matches from the vault index', async () => {
		const { suggest } = setup({
			'a.md': 'Assets:Cash:Wallet Assets:Broker:IBKR',
			'b.md': 'Expenses:Food:Restaurants',
		});
		await flush();
		expect(suggest.getSuggestions(contextFor('Assets:Ca'))).toEqual(['Assets:Cash:Wallet']);
		expect(suggest.getSuggestions(contextFor('assets:broker'))).toEqual(['Assets:Broker:IBKR']);
		expect(suggest.getSuggestions(contextFor('zzz'))).toEqual([]);
	});

	it('never suggests the exact token being typed', async () => {
		// The live buffer feeds the index, so the typed token is a "known"
		// account; offering it back would make Enter accept a no-op.
		const { suggest } = setup({ 'a.md': '  Assets:Cash' });
		await flush();
		expect(suggest.getSuggestions(contextFor('Assets:Cash'))).toEqual([]);
		expect(suggest.getSuggestions(contextFor('Assets:Ca'))).toEqual(['Assets:Cash']);
	});

	it('renders a suggestion as its account text', () => {
		const { suggest } = setup();
		let rendered: string | DocumentFragment | null = null;
		const setText = (text: string | DocumentFragment) => {
			rendered = text;
		};
		suggest.renderSuggestion('Assets:Cash', { setText } as unknown as HTMLElement);
		expect(rendered).toBe('Assets:Cash');
	});

	it('replaces the trigger range with the selected account and closes', () => {
		const { suggest } = setup();
		const editor = createEditor(['  Assets:Ca']);
		suggest.context = {
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 11 },
			query: 'Assets:Ca',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Assets:Cash:Wallet', {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: 'Assets:Cash:Wallet', from: { line: 0, ch: 2 }, to: { line: 0, ch: 11 } },
		]);
		// The chooser leaves the popover open; without close() a second pick
		// would reuse the stale range over the replacement.
		expect(close).toHaveBeenCalledOnce();
	});

	it('does nothing when no context is active', () => {
		const { suggest } = setup();
		const editor = createEditor(['  Assets:Ca']);
		suggest.context = null;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion('Assets:Cash', {} as MouseEvent);
		expect(editor.replacements).toEqual([]);
		expect(close).not.toHaveBeenCalled();
	});
});

describe('registerAccountSuggest', () => {
	it('scans indexed extensions once and skips everything else', async () => {
		const vault = new FakeVault();
		vault.folder('notes');
		vault.write('a.md', 'Assets:Cash');
		vault.write('b.bean', 'Expenses:Food');
		vault.write('c.beancount', 'Income:Salary');
		vault.write('d.png', 'Assets:Ignored');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = registerAccountSuggest(plugin as unknown as Plugin);
		await flush();

		expect(index.accounts()).toEqual(['Assets:Cash', 'Expenses:Food', 'Income:Salary'].sort());
		expect([...vault.reads].sort()).toEqual(['a.md', 'b.bean', 'c.beancount']);
	});

	it('registers one editor suggest and the four vault events', () => {
		const { plugin, vault } = setup();
		expect(plugin.registrations.editorSuggests).toHaveLength(1);
		expect(plugin.registrations.events).toHaveLength(4);
		expect([...vault.handlers.keys()].sort()).toEqual(['create', 'delete', 'modify', 'rename']);
	});

	it('re-indexes a modified file', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		const file = vault.write('a.md', 'Assets:New Expenses:Food');
		await vault.emit('modify', file);
		expect(index.accounts()).toEqual(['Assets:New', 'Expenses:Food']);
	});

	it('indexes files created after load', async () => {
		const { vault, index } = setup();
		await flush();
		const file = vault.write('new.md', 'Liabilities:Card');
		await vault.emit('create', file);
		expect(index.accounts()).toEqual(['Liabilities:Card']);
	});

	it('drops accounts when a file is deleted', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Cash', 'b.md': 'Expenses:Food' });
		await flush();
		await vault.emit('delete', vault.delete('a.md'));
		expect(index.accounts()).toEqual(['Expenses:Food']);
	});

	it('ignores events for files outside the indexed extensions', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Cash' });
		await flush();
		const file = vault.write('d.png', 'Assets:Ignored');
		await vault.emit('modify', file);
		expect(index.accounts()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['a.md']);
	});

	it('keeps cached accounts on rename without re-reading', async () => {
		const { vault, index } = setup({ 'dir/a.md': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('dir/a.md', 'dir/b.md');
		await vault.emit('rename', renamed, 'dir/a.md');
		expect(index.accounts()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['dir/a.md']);
		index.removeFile('dir/b.md');
		expect(index.accounts()).toEqual([]);
	});

	it('moves every child entry on a folder rename', async () => {
		const { vault, index } = setup({ 'dir/a.md': 'Assets:Cash', 'other.md': 'Expenses:Food' });
		await flush();
		const renamed = vault.rename('dir', 'moved');
		await vault.emit('rename', renamed, 'dir');
		expect(index.accounts()).toEqual(['Assets:Cash', 'Expenses:Food']);
		index.removeFile('moved/a.md');
		expect(index.accounts()).toEqual(['Expenses:Food']);
	});

	it('reads the file when a rename makes it indexable', async () => {
		const { vault, index } = setup({ 'note.txt': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('note.txt', 'note.md');
		await vault.emit('rename', renamed, 'note.txt');
		expect(index.accounts()).toEqual(['Assets:Cash']);
		expect(vault.reads).toEqual(['note.md']);
	});

	it('drops the entry when a rename makes the file unindexable', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Cash' });
		await flush();
		const renamed = vault.rename('a.md', 'a.txt');
		await vault.emit('rename', renamed, 'a.md');
		expect(index.accounts()).toEqual([]);
	});

	it('replaces a dropped in-flight read after rename', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		// A modify read is in flight when the rename arrives; the rename drops
		// it, so a read of the new path must take over.
		vault.delays.set('a.md', [50]);
		const file = vault.write('a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		const renamed = vault.rename('a.md', 'b.md');
		await vault.emit('rename', renamed, 'a.md');
		expect(index.accounts()).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(index.accounts()).toEqual(['Assets:Fresh']);
		index.removeFile('b.md');
		expect(index.accounts()).toEqual([]);
	});

	it('does not let a stale read overwrite a recreated file', async () => {
		const vault = new FakeVault();
		vault.delays.set('a.md', [50]);
		vault.write('a.md', 'Assets:Stale');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = registerAccountSuggest(plugin as unknown as Plugin);
		// Delete and recreate while the first read is still on disk; the path's
		// first-life read must not clobber the recreated content.
		await vault.emit('delete', vault.delete('a.md'));
		const recreated = vault.write('a.md', 'Assets:Fresh');
		await vault.emit('create', recreated);
		expect(index.accounts()).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(index.accounts()).toEqual(['Assets:Fresh']);
	});

	it('drops stale out-of-order reads instead of applying them', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old' });
		await flush();
		// The first read is slow and captures `Assets:Old`; the second read
		// lands first with `Assets:Fresh`. The stale one must not win.
		vault.delays.set('a.md', [50, 0]);
		const file = vault.write('a.md', 'Assets:Old');
		await vault.emit('modify', file);
		vault.write('a.md', 'Assets:Fresh');
		await vault.emit('modify', file);
		expect(index.accounts()).toEqual(['Assets:Fresh']);
		await delay(100);
		expect(index.accounts()).toEqual(['Assets:Fresh']);
	});

	it('keeps the last good cache entry when a read fails', async () => {
		const { vault, index } = setup({ 'a.md': 'Assets:Old', 'b.md': 'Expenses:Food' });
		await flush();
		vault.failures.add('a.md');
		const file = vault.write('a.md', 'Assets:New');
		await vault.emit('modify', file);
		expect(index.accounts()).toEqual(['Assets:Old', 'Expenses:Food']);
	});

	it('skips unreadable files during the initial scan', async () => {
		const vault = new FakeVault();
		vault.write('a.md', 'Assets:Cash');
		vault.write('b.md', 'Expenses:Food');
		vault.failures.add('a.md');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = registerAccountSuggest(plugin as unknown as Plugin);
		await flush();
		expect(index.accounts()).toEqual(['Expenses:Food']);
	});
});
