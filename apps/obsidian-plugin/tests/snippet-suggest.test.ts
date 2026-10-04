import type { App, Editor, EditorSuggestContext, TFile } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { extractPayees } from '../payee-index';
import { PayeeSuggest } from '../payee-suggest';
import { SnippetSession, SnippetSuggest, snippetTabExtension } from '../snippet-suggest';
import { expandSnippet, SNIPPETS } from '../snippets';
import { registerVaultIndex, VaultIndex } from '../vault-index';
import type { MockKeymapExtension } from './mocks/codemirror';
import { createView } from './mocks/codemirror';
import { Plugin as RecordingPlugin } from './mocks/obsidian';
import { createEditor, FakeVault, flush } from './fakes';
import type { Plugin, PluginManifest } from 'obsidian';

const manifest = { id: 'beancount-obsidian' } as PluginManifest;

afterEach(() => {
	vi.useRealTimers();
});

function setup() {
	const session = new SnippetSession();
	return { session, suggest: new SnippetSuggest({} as App, session) };
}

const LEDGER = { extension: 'bean' } as TFile;

function trigger(suggest: SnippetSuggest, line: string, ch = line.length, file: TFile | null = LEDGER) {
	const editor = createEditor([line]);
	return suggest.onTrigger({ line: 0, ch }, editor as unknown as Editor, file);
}

function txnSnippet() {
	const found = SNIPPETS.find((entry) => entry.prefix === 'txn');
	if (!found) throw new Error('missing txn snippet');
	return found;
}

describe('SnippetSuggest.onTrigger', () => {
	it('triggers on a snippet prefix at column 0', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'txn')).toEqual({
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 3 },
			query: 'txn',
		});
		expect(trigger(suggest, 'tx')).toMatchObject({ query: 'tx' });
	});

	it('stays quiet on an empty line, indent, prose and unknown prefixes', () => {
		const { suggest } = setup();
		expect(trigger(suggest, '')).toBeNull();
		expect(trigger(suggest, '  txn')).toBeNull();
		expect(trigger(suggest, '2026-10-04 txn')).toBeNull();
		expect(trigger(suggest, 'zzz')).toBeNull();
	});

	it('stays quiet when editing inside the prefix', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'txn', 2)).toBeNull();
	});

	it('triggers when the caret sits before trailing whitespace', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'txn ', 3)).toMatchObject({ query: 'txn' });
	});

	it('stays quiet in markdown prose and outside fences', () => {
		const { suggest } = setup();
		expect(trigger(suggest, 'txn', 3, { extension: 'md' } as TFile)).toBeNull();
		expect(trigger(suggest, 'txn', 3, null)).toBeNull();
	});

	it('triggers inside a beancount fence in markdown', () => {
		const { suggest } = setup();
		const editor = createEditor(['```beancount', 'txn', '```']);
		const file = { extension: 'md' } as TFile;
		expect(suggest.onTrigger({ line: 1, ch: 3 }, editor as unknown as Editor, file)).toMatchObject({
			query: 'txn',
		});
		expect(suggest.onTrigger({ line: 0, ch: 3 }, editor as unknown as Editor, file)).toBeNull();
	});
});

describe('SnippetSuggest suggestions', () => {
	it('returns matching snippets for the typed prefix', () => {
		const { suggest } = setup();
		expect(suggest.getSuggestions({ query: 'txn' }).map((entry) => entry.prefix)).toEqual([
			'txn',
			'txn!',
			'txn*',
		]);
	});

	it('renders the prefix and description', () => {
		const { suggest } = setup();
		let title: string | DocumentFragment | null = null;
		let meta: { text?: string; cls?: string } | undefined;
		suggest.renderSuggestion(txnSnippet(), {
			setText: (text: string | DocumentFragment) => {
				title = text;
			},
			createDiv: (opts: { text?: string; cls?: string }) => {
				meta = opts;
				return {};
			},
		} as unknown as HTMLElement);
		expect(title).toBe('txn');
		expect(meta).toEqual({
			text: 'Add a transaction.',
			cls: 'beancount-snippet-suggest-meta',
		});
	});

	it('expands txn, parks the caret in the payee quotes, and closes', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		const { suggest, session } = setup();
		const editor = createEditor(['txn']);
		suggest.context = {
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 3 },
			query: 'txn',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion(txnSnippet(), {} as MouseEvent);
		expect(editor.replacements).toEqual([
			{ replacement: '2026-10-04 * "" ""', from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
		]);
		expect(editor.selections).toEqual([{ anchor: { line: 0, ch: 14 }, head: { line: 0, ch: 14 } }]);
		expect(session.active).toBe(true);
		expect(close).toHaveBeenCalledOnce();
	});

	it('does nothing when no context is active', () => {
		const { suggest } = setup();
		const editor = createEditor(['txn']);
		suggest.context = null;
		const close = vi.spyOn(suggest, 'close');
		suggest.selectSuggestion(txnSnippet(), {} as MouseEvent);
		expect(editor.replacements).toEqual([]);
		expect(close).not.toHaveBeenCalled();
	});

	it('selects the ISO/Ticker placeholder on commodity', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		const { suggest } = setup();
		const editor = createEditor(['commodity']);
		suggest.context = {
			start: { line: 0, ch: 0 },
			end: { line: 0, ch: 9 },
			query: 'commodity',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		const commodity = SNIPPETS.find((entry) => entry.prefix === 'commodity');
		if (!commodity) throw new Error('missing commodity snippet');
		suggest.selectSuggestion(commodity, {} as MouseEvent);
		expect(editor.selections).toEqual([{ anchor: { line: 0, ch: 21 }, head: { line: 0, ch: 31 } }]);
	});

	it('places $1 on the next line of a multiline body', () => {
		const { suggest } = setup();
		const editor = createEditor(['note', 'x']);
		suggest.context = {
			start: { line: 1, ch: 0 },
			end: { line: 1, ch: 1 },
			query: 'x',
			editor: editor as unknown as Editor,
			file: {} as TFile,
		} as EditorSuggestContext;
		suggest.selectSuggestion(
			{ prefix: 'x', description: '', body: 'head\n${1:body}' },
			{} as MouseEvent
		);
		expect(editor.selections).toEqual([{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 4 } }]);
	});
});

describe('payee completion after txn', () => {
	it('still triggers inside the expanded payee field', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 4));
		const vault = new FakeVault();
		vault.write('a.md', '2026-09-30 * "Whole Foods" "Groceries"');
		const plugin = new RecordingPlugin({ vault: vault.api }, manifest);
		const index = new VaultIndex(extractPayees);
		registerVaultIndex(plugin as unknown as Plugin, index);
		const payees = new PayeeSuggest({} as App, index);
		await flush();
		const expansion = expandSnippet(txnSnippet().body);
		const editor = createEditor([expansion.text]);
		const cursor = { line: 0, ch: expansion.stops[0].from };
		expect(payees.onTrigger(cursor, editor as unknown as Editor, null)).toEqual({
			start: { line: 0, ch: 14 },
			end: { line: 0, ch: 14 },
			query: '',
		});
		expect(payees.getSuggestions({ query: '' } as EditorSuggestContext)).toEqual(['Whole Foods']);
	});
});

type Run = (view: EditorView) => boolean;

function tabRun(session: SnippetSession, suggests: Array<{ context: unknown }> = []): Run {
	const extension = snippetTabExtension(session, suggests) as unknown as MockKeymapExtension;
	return extension.bindings[0].run as unknown as Run;
}

describe('snippetTabExtension', () => {
	it('jumps to the next stop and maps typing in the current one', () => {
		const session = new SnippetSession();
		session.start(0, {
			text: '2026-10-04 * "" ""',
			stops: [
				{ index: 1, from: 14, to: 14 },
				{ index: 2, from: 17, to: 17 },
			],
		});
		const run = tabRun(session);
		const view = createView('2026-10-04 * "Cafe" ""', [{ anchor: 18 }]);
		expect(run(view as unknown as EditorView)).toBe(true);
		expect(view.dispatched).toEqual([{ selection: { ranges: [{ anchor: 21, head: 21 }] } }]);
	});

	it('selects a non-empty placeholder', () => {
		const session = new SnippetSession();
		session.start(0, {
			text: 'open Assets: ',
			stops: [
				{ index: 1, from: 5, to: 12 },
				{ index: 2, from: 13, to: 13 },
			],
		});
		const run = tabRun(session);
		const view = createView('open Assets: ', [{ anchor: 12 }]);
		expect(run(view as unknown as EditorView)).toBe(true);
		expect(view.dispatched).toEqual([{ selection: { ranges: [{ anchor: 13, head: 13 }] } }]);
	});

	it('leaves Tab to an open completion popover', () => {
		const session = new SnippetSession();
		session.start(0, { text: 'x', stops: [{ index: 1, from: 0, to: 0 }] });
		const run = tabRun(session, [{ context: {} }]);
		const view = createView('x', [{ anchor: 0 }]);
		expect(run(view as unknown as EditorView)).toBe(false);
		expect(view.dispatched).toEqual([]);
	});

	it('falls through when no session is active', () => {
		const run = tabRun(new SnippetSession());
		expect(run(createView('txn', [{ anchor: 3 }]) as unknown as EditorView)).toBe(false);
	});

	it('ends the session after the last stop', () => {
		const session = new SnippetSession();
		session.start(0, { text: 'x', stops: [{ index: 1, from: 0, to: 0 }] });
		const run = tabRun(session);
		expect(run(createView('x', [{ anchor: 0 }]) as unknown as EditorView)).toBe(false);
		expect(session.active).toBe(false);
	});

	it('ends the session when the caret moved before the current stop', () => {
		const session = new SnippetSession();
		session.start(0, {
			text: 'ab',
			stops: [
				{ index: 1, from: 1, to: 1 },
				{ index: 2, from: 2, to: 2 },
			],
		});
		const run = tabRun(session);
		expect(run(createView('ab', [{ anchor: 0 }]) as unknown as EditorView)).toBe(false);
		expect(session.active).toBe(false);
	});

	it('selects a non-empty stop that sits after a newline', () => {
		const session = new SnippetSession();
		session.start(0, {
			text: 'head\nbody',
			stops: [
				{ index: 1, from: 0, to: 4 },
				{ index: 2, from: 5, to: 9 },
			],
		});
		const run = tabRun(session);
		const view = createView('head\nbody', [{ anchor: 4 }]);
		expect(run(view as unknown as EditorView)).toBe(true);
		expect(view.dispatched).toEqual([{ selection: { ranges: [{ anchor: 5, head: 9 }] } }]);
	});

	it('ignores Tab in a different editor and keeps the session', () => {
		const session = new SnippetSession();
		session.start(
			0,
			{ text: 'x y', stops: [{ index: 1, from: 0, to: 1 }, { index: 2, from: 2, to: 3 }] },
			'ledger-editor'
		);
		const run = tabRun(session);
		const view = createView('x y', [{ anchor: 1 }]);
		expect(run(view as unknown as EditorView)).toBe(false);
		expect(view.dispatched).toEqual([]);
		expect(session.active).toBe(true);
	});
});
