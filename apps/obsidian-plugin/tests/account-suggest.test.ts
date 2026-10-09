import { describe, expect, it, vi } from 'vitest';
import type { App, Editor, EditorSuggestContext, Plugin, PluginManifest, TFile } from 'obsidian';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { AccountIndex } from '../account-index';
import { AccountSuggest } from '../account-suggest';
import { CompletionUsage } from '../completion-rank';
import { registerVaultIndex } from '../vault-index';
import { createEditor, FakeVault, flush } from './fakes';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

/** A vault with completable accounts, for trigger expectations. */
const ACCOUNTS = { 'a.bean': 'Assets:Cash:Wallet Expenses:Food' };

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
	const index = new AccountIndex();
	registerVaultIndex(plugin as unknown as Plugin, index);
	return { vault, index, suggest: new AccountSuggest({} as App, index), plugin };
}

describe('AccountSuggest.onTrigger', () => {
	it('triggers on a complete account ending at the cursor', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		expect(trigger(suggest, 'Assets:Cash')).toEqual({
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 11 },
			query: 'Assets:Cash',
		});
	});

	it('triggers on a partial segment and reports its start', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		const info = trigger(suggest, '  Assets:Ca');
		expect(info).toEqual({
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 11 },
			query: 'Assets:Ca',
		});
	});

	it('triggers right after a trailing colon', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		expect(trigger(suggest, 'Assets:')).toMatchObject({ query: 'Assets:' });
	});

	it('triggers after any non-word boundary character', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		expect(trigger(suggest, '* (Assets:Ca')).toMatchObject({ query: 'Assets:Ca', start: { line: 0, ch: 3 } });
	});

	it('keeps the query anchored to the cursor, not the line end', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		const info = trigger(suggest, '  Assets:Ca 10.00 USD', 11);
		expect(info).toMatchObject({ query: 'Assets:Ca', start: { line: 0, ch: 2 }, end: { line: 0, ch: 11 } });
	});

	it('triggers on and completes accounts with non-ASCII segments', async () => {
		const { suggest } = setup({ 'a.bean': '  Expenses:餐饮:午饭  30.00 CNY\n  Expenses:餐饮:晚饭  50.00 CNY' });
		await flush();
		expect(trigger(suggest, '  Expenses:餐饮:午')).toEqual({
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 15 },
			query: 'Expenses:餐饮:午',
		});
		expect(suggest.getSuggestions(contextFor('Expenses:餐饮:'))).toEqual(['Expenses:餐饮:午饭', 'Expenses:餐饮:晚饭']);
		expect(trigger(suggest, '见Expenses:餐')).toBeNull();
		// CJK punctuation is a boundary like ASCII punctuation; a CJK letter is not.
		expect(trigger(suggest, '（Expenses:餐')).toMatchObject({ query: 'Expenses:餐', start: { line: 0, ch: 1 } });
	});

	it('stays quiet when the cursor sits inside a non-ASCII segment', async () => {
		const { suggest } = setup({ 'a.bean': '  Expenses:餐饮:午饭  30.00 CNY' });
		await flush();
		// Picking a suggestion here would replace `Expenses:餐` and leave `饮` behind.
		expect(trigger(suggest, '  Expenses:餐饮  30 CNY', 12)).toBeNull();
		expect(trigger(suggest, '  Expenses:カード・ローン', 14)).toBeNull();
	});

	it('stays quiet when editing inside a token', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		expect(trigger(suggest, 'Assets:Cash', 3)).toBeNull();
		expect(trigger(suggest, 'Assets:CashUSD', 11)).toBeNull();
	});

	it('stays quiet inside a transaction payee field', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		// The payee suggest owns that field: `"Exp` prefixes `Expenses:Food`,
		// yet account completion must not pop up over the payee popup.
		expect(trigger(suggest, '2026-09-30 * "Exp')).toBeNull();
		expect(trigger(suggest, '2026-09-30 * "As')).toBeNull();
		// Cursor before the closing quote of an account-shaped payee.
		expect(trigger(suggest, '2026-09-30 * "Expenses:Foo"', 26)).toBeNull();
	});

	it('stays quiet in the narration field', async () => {
		const { suggest } = setup({ 'a.bean': 'Assets:Cash:Wallet Expenses:Food Narnia:Bank' });
		await flush();
		// The narration suggest owns that field: `"Nar` prefixes the cached
		// `Narnia:Bank` just the same — the ownership guard must decide.
		expect(trigger(suggest, '2026-09-30 * "Shell" "Nar')).toBeNull();
	});

	it('stays quiet in tag and link positions', async () => {
		const { suggest } = setup({ 'a.bean': 'Assets:Cash:Wallet Expenses:Food Travel:Air' });
		await flush();
		// The tag/link suggests own those tokens: `#Tr`/`^Tr` prefix the
		// cached `Travel:Air` just the same.
		expect(trigger(suggest, '#Tr')).toBeNull();
		expect(trigger(suggest, '^Tr')).toBeNull();
	});

	it('stays quiet in a posting commodity slot', async () => {
		const { suggest } = setup({ 'a.bean': 'Assets:Cash:Wallet Expenses:Food Uber:Rides' });
		await flush();
		// The commodity suggest owns the unit position: `10.00 U` prefixes
		// the cached `Uber:Rides` just the same.
		expect(trigger(suggest, '  Assets:Cash  10.00 U')).toBeNull();
	});

	it('stays quiet on lowercase prose, dates and amounts', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		expect(trigger(suggest, 'see assets here')).toBeNull();
		expect(trigger(suggest, '2026-09-30')).toBeNull();
		expect(trigger(suggest, 'paid 100.00')).toBeNull();
	});

	it('stays quiet when the tail is not a whole token', async () => {
		const { suggest } = setup(ACCOUNTS);
		await flush();
		// The tail `Assets:Ca` sits after a colon, dash or slash inside a
		// longer token or URL path.
		expect(trigger(suggest, 'x:Assets:Ca')).toBeNull();
		expect(trigger(suggest, 'sAssets:Ca')).toBeNull();
		expect(trigger(suggest, 'pre-Assets:Ca')).toBeNull();
		expect(trigger(suggest, 'https://github.com/User:Re')).toBeNull();
	});

	it('triggers on bare capitalized words as completion queries', async () => {
		const { suggest } = setup({ 'a.bean': 'Assets:Cash:Wallet' });
		await flush();
		// Root-only and single-letter queries complete against real accounts.
		expect(suggest.getSuggestions(contextFor('Assets'))).toEqual(['Assets:Cash:Wallet']);
		expect(suggest.getSuggestions(contextFor('A'))).toEqual(['Assets:Cash:Wallet']);
		expect(trigger(suggest, 'Assets')).toMatchObject({ query: 'Assets' });
	});

	it('stays quiet on capitalized words that prefix no cached account', async () => {
		const { suggest } = setup({ 'a.bean': 'Assets:Cash' });
		await flush();
		expect(trigger(suggest, '100.00 USD')).toBeNull();
		expect(suggest.getSuggestions(contextFor('USD'))).toEqual([]);
	});
});

describe('AccountSuggest suggestions', () => {
	it('returns prefix matches from the vault index', async () => {
		const { suggest } = setup({
			'a.bean': 'Assets:Cash:Wallet Assets:Broker:IBKR',
			'b.bean': 'Expenses:Food:Restaurants',
		});
		await flush();
		expect(suggest.getSuggestions(contextFor('Assets:Ca'))).toEqual(['Assets:Cash:Wallet']);
		expect(suggest.getSuggestions(contextFor('assets:broker'))).toEqual(['Assets:Broker:IBKR']);
		expect(suggest.getSuggestions(contextFor('zzz'))).toEqual([]);
	});

	it('never suggests the exact token being typed', async () => {
		// The live buffer feeds the index, so the typed token is a "known"
		// account; offering it back would make Enter accept a no-op.
		const { suggest } = setup({ 'a.bean': '  Assets:Cash' });
		await flush();
		expect(suggest.getSuggestions(contextFor('Assets:Cash'))).toEqual([]);
		expect(suggest.getSuggestions(contextFor('Assets:Ca'))).toEqual(['Assets:Cash']);
		expect(trigger(suggest, 'Assets:Cash')).toBeNull();
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

	it('omits closed accounts and stays quiet when they are the only match', async () => {
		const { suggest } = setup({
			'a.bean': [
				'2020-01-01 open Assets:Cash USD',
				'2021-01-01 close Assets:Cash',
				'2020-01-01 open Assets:Broker',
			].join('\n'),
		});
		await flush();
		expect(suggest.getSuggestions(contextFor('Assets:'))).toEqual(['Assets:Broker']);
		expect(suggest.getSuggestions(contextFor('Assets:Cash'))).toEqual([]);
		expect(trigger(suggest, 'Assets:Cash')).toBeNull();
	});

	it('renders open date and currencies under the account name', async () => {
		const { suggest } = setup({
			'a.bean': '2020-01-01 open Assets:Cash USD, CNY',
		});
		await flush();
		let title: string | DocumentFragment | null = null;
		let meta: { text?: string; cls?: string } | undefined;
		suggest.renderSuggestion('Assets:Cash', {
			setText: (text: string | DocumentFragment) => {
				title = text;
			},
			createDiv: (opts: { text?: string; cls?: string }) => {
				meta = opts;
				return {};
			},
		} as unknown as HTMLElement);
		expect(title).toBe('Assets:Cash');
		expect(meta).toEqual({
			text: 'opened on 2020-01-01\ncurrencies: USD, CNY',
			cls: 'beancount-account-suggest-meta',
		});
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

	it('remembers a pick so later prefix ties rank it first', () => {
		const usage = CompletionUsage.parse({}, () => 1);
		const index = new AccountIndex(usage);
		index.setFileContent('a.bean', '2020-01-01 open Assets:Broker\n2020-01-01 open Assets:Cash');
		const suggest = new AccountSuggest({} as App, index);
		const editor = createEditor(['  Assets:']);
		suggest.context = {
			start: { line: 0, ch: 2 },
			end: { line: 0, ch: 10 },
			query: 'Assets:',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		expect(index.match('Assets:')).toEqual(['Assets:Broker', 'Assets:Cash']);
		suggest.selectSuggestion('Assets:Cash', {} as MouseEvent);
		expect(index.match('Assets:')).toEqual(['Assets:Cash', 'Assets:Broker']);
	});

	it('does not remember a pick when no context is active', () => {
		const usage = CompletionUsage.parse({}, () => 1);
		const index = new AccountIndex(usage);
		index.setFileContent('a.bean', '2020-01-01 open Assets:Broker\n2020-01-01 open Assets:Cash');
		const suggest = new AccountSuggest({} as App, index);
		suggest.context = null;
		suggest.selectSuggestion('Assets:Cash', {} as MouseEvent);
		expect(index.match('Assets:')).toEqual(['Assets:Broker', 'Assets:Cash']);
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
