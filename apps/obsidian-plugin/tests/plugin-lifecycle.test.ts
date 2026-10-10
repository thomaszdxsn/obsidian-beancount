/**
 * Plugin lifecycle the editor never sees on its own: opening a file that is
 * not yet in a leaf, dropping a check that has not finished, and settings
 * that must not let a stale bean-check report come back.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import type { BeanCheckRun, LineDiagnostic } from '../bean-check';
import { setLineDiagnostics } from '../diagnostics';
import BeancountPlugin from '../main';
import { VIEW_TYPE_OUTLINE } from '../outline-view';
import { BeancountProblemsView, VIEW_TYPE_PROBLEMS } from '../problems-view';
import { WARNING_LINE_CLASS } from '../flag-warnings';
import type { MockViewPlugin } from './mocks/codemirror';
import { notices } from './mocks/obsidian';
import type { Plugin as RecordingPlugin } from './mocks/obsidian';
import { createEditor, FakeVault, flush } from './fakes';
import type { FakeEditor, FakeFile } from './fakes';

vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});

const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;
const manifest = { id: 'beancount-obsidian' } as PluginManifest;

interface OpenLeaf {
	view: { file: FakeFile | null; editor: FakeEditor | null };
}

interface Loaded {
	plugin: BeancountPlugin & RecordingPlugin;
	vault: FakeVault;
	opened: Array<(file: unknown) => void>;
	leaves: OpenLeaf[];
	revealed: unknown[];
	viewStates: unknown[];
}

interface EffectLike {
	is: (spec: unknown) => boolean;
	value: unknown;
}

function isEffect(value: unknown): value is EffectLike {
	return (
		!!value &&
		typeof value === 'object' &&
		'is' in value &&
		'value' in value &&
		typeof value.is === 'function'
	);
}

function stampMtime(file: object, mtime: number): void {
	Object.assign(file, { stat: { mtime } });
}

function published(editor: FakeEditor): LineDiagnostic[] {
	const last = editor.cm.dispatched[editor.cm.dispatched.length - 1];
	const effect = last?.effects[0];
	if (!isEffect(effect) || !effect.is(setLineDiagnostics) || !Array.isArray(effect.value)) return [];
	return effect.value;
}

/** A loaded plugin whose file-open, vault, and sidebar commands the test drives. */
async function loadPlugin(vault: FakeVault = new FakeVault(), stored?: unknown): Promise<Loaded> {
	const opened: Array<(file: unknown) => void> = [];
	const leaves: OpenLeaf[] = [];
	const revealed: unknown[] = [];
	const viewStates: unknown[] = [];
	const plugin = new BeancountPlugin(
		{
			vault: vault.api,
			workspace: {
				getLeavesOfType: (type: string) => (type === 'markdown' ? leaves : []),
				get activeEditor() {
					return leaves[0]?.view ?? null;
				},
				on: (name: string, callback: (file: unknown) => void) => {
					if (name === 'file-open') opened.push(callback);
					return { name };
				},
				revealLeaf: (leaf: unknown) => {
					revealed.push(leaf);
				},
				getRightLeaf: () => ({
					setViewState: async (state: unknown) => {
						viewStates.push(state);
					},
				}),
			},
		} as unknown as App,
		manifest,
	) as BeancountPlugin & RecordingPlugin;
	if (stored !== undefined) plugin.loadedData = stored;
	await plugin.onload();
	return { plugin, vault, opened, leaves, revealed, viewStates };
}

function command(plugin: BeancountPlugin & RecordingPlugin, id: string): () => void | Promise<void> {
	const found = plugin.registrations.commands.find((entry) => entry.id === id);
	if (!found?.callback) throw new Error(`missing command ${id}`);
	return found.callback;
}

function rowText(child: unknown): string {
	if (!child || typeof child !== 'object' || !('text' in child) || typeof child.text !== 'string') {
		throw new Error('problems row has no text');
	}
	return child.text;
}

async function problemTexts(plugin: BeancountPlugin & RecordingPlugin): Promise<string[]> {
	const creator = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_PROBLEMS);
	const created = creator?.creator({ app: plugin.app });
	if (!(created instanceof BeancountProblemsView)) throw new Error('missing problems view');
	await created.onOpen();
	const el: unknown = created.contentEl;
	if (!el || typeof el !== 'object' || !('children' in el) || !Array.isArray(el.children)) {
		throw new Error('problems view has no mount');
	}
	return el.children.map(rowText);
}

interface HintPane {
	dispatches: number;
	classes(): string[];
	labels(): string[];
}

interface DecoratedPlugin {
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
}

/** Install one editor extension the way Obsidian would, and count setting refreshes. */
function attachPane(extension: unknown, text: string, extensionName: string): HintPane | null {
	if (!extension || typeof extension !== 'object' || !('cls' in extension)) return null;
	const spec = extension as MockViewPlugin<DecoratedPlugin>;
	const file = { path: `book.${extensionName}`, extension: extensionName };
	const pane: HintPane = {
		dispatches: 0,
		classes() {
			return classesOf(installed.decorations);
		},
		labels() {
			return labelsOf(installed.decorations);
		},
	};
	let installed!: DecoratedPlugin;
	const view = {
		state: { doc: Text.of(text.split('\n')), field: () => ({ file }) },
		dispatch(specDispatch: { effects?: unknown }) {
			if (!installed) return;
			pane.dispatches += 1;
			const effects = Array.isArray(specDispatch.effects)
				? specDispatch.effects
				: specDispatch.effects === undefined
					? []
					: [specDispatch.effects];
			installed.update({
				view,
				state: view.state,
				startState: view.state,
				docChanged: false,
				viewportChanged: false,
				transactions: [{ effects }],
			} as unknown as ViewUpdate);
		},
	};
	try {
		installed = new spec.cls(view as never);
	} catch {
		// The separator ruler touches `document`; node tests have no DOM.
		return null;
	}
	return pane;
}

function classesOf(set: DecorationSet): string[] {
	const out: string[] = [];
	const iter = set.iter();
	while (iter.value) {
		const spec = iter.value.spec;
		if (spec && typeof spec === 'object' && 'class' in spec && typeof spec.class === 'string') out.push(spec.class);
		iter.next();
	}
	return out;
}

function labelsOf(set: DecorationSet): string[] {
	const out: string[] = [];
	const iter = set.iter();
	while (iter.value) {
		const spec = iter.value.spec;
		if (spec && typeof spec === 'object' && 'widget' in spec && spec.widget && typeof spec.widget === 'object' && 'label' in spec.widget && typeof spec.widget.label === 'string') {
			out.push(spec.widget.label);
		}
		iter.next();
	}
	return out;
}

function* viewPlugins(extensions: readonly unknown[]): Generator<unknown> {
	for (const extension of extensions) {
		if (Array.isArray(extension)) yield* viewPlugins(extension);
		else if (extension && typeof extension === 'object' && 'cls' in extension) yield extension;
	}
}

afterEach(() => {
	notices.length = 0;
});

describe('sidebar commands', () => {
	it('opens the outline and problems views from their commands', async () => {
		const { plugin, revealed, viewStates } = await loadPlugin();
		const outline = plugin.registrations.views.find((entry) => entry.type === VIEW_TYPE_OUTLINE);
		const created = outline?.creator({ app: plugin.app });
		if (!created || typeof created !== 'object' || !('getViewType' in created) || !('getDisplayText' in created)) {
			throw new Error('missing outline view');
		}
		if (typeof created.getViewType !== 'function' || typeof created.getDisplayText !== 'function') {
			throw new Error('missing outline view');
		}
		expect(created.getViewType()).toBe(VIEW_TYPE_OUTLINE);
		expect(created.getDisplayText()).toBe('Beancount Outline');

		await command(plugin, 'show-outline')();
		await command(plugin, 'show-problems')();

		expect(viewStates).toEqual([
			{ type: VIEW_TYPE_OUTLINE, active: true },
			{ type: VIEW_TYPE_PROBLEMS, active: true },
		]);
		expect(revealed).toHaveLength(2);
	});
});

describe('payee autofill', () => {
	it('inserts the latest postings, skips an unknown payee, and stays off when the setting is', async () => {
		const vault = new FakeVault();
		vault.write(
			'ledger.bean',
			['2026-09-01 * "Cafe" "Latte"', '  Expenses:Food  4.50 USD', '  Assets:Cash'].join('\n'),
		);
		const { plugin } = await loadPlugin(vault);
		await flush();
		const suggest = plugin.registrations.editorSuggests[1];
		if (!suggest || typeof suggest !== 'object' || !('getSuggestions' in suggest) || !('selectSuggestion' in suggest)) {
			throw new Error('missing payee suggest');
		}
		if (typeof suggest.getSuggestions !== 'function' || typeof suggest.selectSuggestion !== 'function') {
			throw new Error('missing payee suggest');
		}
		expect(suggest.getSuggestions({ query: 'Ca' })).toContain('Cafe');

		const typing = createEditor(['2026-10-02 * "Ca']);
		Object.assign(suggest, {
			context: { start: { line: 0, ch: 13 }, end: { line: 0, ch: 15 }, editor: typing },
		});
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		expect(typing.replacements.map((entry) => entry.replacement).join('\n')).toContain('Expenses:Food');
		expect(typing.replacements.map((entry) => entry.replacement).join('\n')).toContain('Assets:Cash');

		const unknown = createEditor(['2026-10-02 * "No']);
		Object.assign(suggest, {
			context: { start: { line: 0, ch: 13 }, end: { line: 0, ch: 15 }, editor: unknown },
		});
		suggest.selectSuggestion('Nope', {} as MouseEvent);
		expect(unknown.replacements.map((entry) => entry.replacement)).toEqual(['Nope"']);

		plugin.settings.payeeAutofill = false;
		const silenced = createEditor(['2026-10-02 * "Ca']);
		Object.assign(suggest, {
			context: { start: { line: 0, ch: 13 }, end: { line: 0, ch: 15 }, editor: silenced },
		});
		suggest.selectSuggestion('Cafe', {} as MouseEvent);
		expect(silenced.replacements.map((entry) => entry.replacement)).toEqual(['Cafe"']);
	});
});

describe('saveSettings refresh', () => {
	it('rebuilds flag markers, balance hints, and ledger highlighting without an edit', async () => {
		const { plugin } = await loadPlugin();
		const flagged = '2026-10-01 ! "Cafe"';
		const balanced = ['2026-01-01 * "Deposit"', '  Assets:Cash  10.00 USD', '2026-01-02 balance Assets:Cash  12.50 USD'].join(
			'\n',
		);
		let flags: HintPane | null = null;
		let hints: HintPane | null = null;
		let ledger: HintPane | null = null;
		for (const extension of viewPlugins(plugin.registrations.editorExtensions)) {
			const flaggedPane = attachPane(extension, flagged, 'bean');
			if (flaggedPane?.classes().includes(WARNING_LINE_CLASS)) flags = flaggedPane;
			const hintCandidate = attachPane(extension, balanced, 'bean');
			if (hintCandidate && hintCandidate.labels().length > 0) hints = hintCandidate;
			const ledgerCandidate = attachPane(extension, '2026-10-01 * "Cafe"\n  Assets:Cash  1.00 USD\n', 'bean');
			if (ledgerCandidate && ledgerCandidate.classes().some((cls) => cls.startsWith('cm-'))) ledger = ledgerCandidate;
		}
		if (!flags || !hints || !ledger) throw new Error('open editors did not receive hint extensions');
		const ledgerClasses = ledger.classes();

		plugin.settings.flagWarnings = { ...plugin.settings.flagWarnings, '!': null };
		plugin.settings.inlayHints = false;
		await plugin.saveSettings();

		expect(flags.dispatches).toBeGreaterThan(0);
		expect(flags.classes()).toEqual([]);
		expect(hints.dispatches).toBeGreaterThan(0);
		expect(hints.labels()).toEqual([]);
		expect(ledger.dispatches).toBeGreaterThan(0);
		expect(ledger.classes()).toEqual(ledgerClasses);
	});
});

describe('fava start without a process', () => {
	it('does not open a URL or latch a running server when the runner returns no child', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', 'option "title" "Main"\n');
		const { plugin } = await loadPlugin(vault, { entryLedger: 'main.bean' });
		const runs: string[][] = [];
		const opened: string[] = [];
		plugin.favaRunner = async (_command, args) => {
			runs.push([...args]);
			return { missing: false };
		};
		plugin.favaOpener = (url) => {
			opened.push(url);
		};

		await command(plugin, 'start-fava')();
		await command(plugin, 'start-fava')();
		command(plugin, 'stop-fava')();

		expect(runs).toHaveLength(2);
		expect(opened).toEqual([]);
		expect(notices).toEqual(['Fava is not running.']);
	});
});

describe('open-triggered validation', () => {
	it('ignores a null open, a non-ledger file, and an open after unload', async () => {
		const vault = new FakeVault();
		const ledger = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const image = vault.write('shot.png', 'not text');
		const { plugin, opened } = await loadPlugin(vault);
		const runs: number[] = [];
		plugin.beanCheckRunner = async () => {
			runs.push(1);
			return { stderr: '', missing: false };
		};
		const reads = vault.reads.length;

		opened[0](null);
		opened[0](image);
		await delay(600);
		expect(runs).toEqual([]);
		expect(vault.reads.length).toBe(reads);

		for (const cleanup of plugin.registrations.cleanups) cleanup();
		opened[0](ledger);
		await delay(600);
		expect(runs).toEqual([]);
	});

	it('reads a note that has no editor yet, skips prose, and survives a failed read', async () => {
		const vault = new FakeVault();
		const prose = vault.write('prose.md', 'just prose');
		const fenced = vault.write('fenced.md', '```bean\n2026-10-01 * "A"\n```\n');
		const broken = vault.write('broken.md', '```bean\n2026-10-01 * "A"\n```\n');
		const { plugin, opened } = await loadPlugin(vault);
		const runs: string[] = [];
		plugin.beanCheckRunner = async (_command, args) => {
			runs.push(args[0]);
			return { stderr: `${args[0]}:1:       bad fence\n`, missing: false };
		};
		await flush();
		const reads = vault.reads.length;

		opened[0](prose);
		await flush();
		expect(vault.reads.slice(reads)).toEqual(['prose.md']);
		await delay(600);
		expect(runs).toEqual([]);

		vault.failures.add('broken.md');
		opened[0](broken);
		await delay(50);
		expect(runs).toEqual([]);

		opened[0](fenced);
		await delay(600);
		expect(runs).toHaveLength(1);
		expect(await problemTexts(plugin)).toContain('fenced.md:2  bad fence');
	});

	it('does not check a note whose read finishes after unload', async () => {
		const vault = new FakeVault();
		const fenced = vault.write('fenced.md', '```bean\n2026-10-01 * "A"\n```\n');
		const { plugin, opened } = await loadPlugin(vault);
		const runs: number[] = [];
		plugin.beanCheckRunner = async () => {
			runs.push(1);
			return { stderr: '', missing: false };
		};
		await flush();
		vault.delays.set('fenced.md', [200]);

		opened[0](fenced);
		for (const cleanup of plugin.registrations.cleanups) cleanup();
		await delay(400);

		expect(runs).toEqual([]);
		expect(await problemTexts(plugin)).toEqual(['No problems.']);
	});

	it('replays stored fence markers onto an editor that attaches during the open read', async () => {
		const note = ['```beancount', '2026-10-01 * "A"', '```'].join('\n');
		const vault = new FakeVault();
		const file = vault.write('note.md', note);
		stampMtime(file, 8);
		const first = createEditor(note.split('\n'));
		const { plugin, opened, leaves } = await loadPlugin(vault);
		let runs = 0;
		plugin.beanCheckRunner = async (_command, args) => {
			runs += 1;
			return { stderr: `${args[0]}:1:       bad fence\n`, missing: false };
		};

		leaves.push({ view: { file, editor: first } });
		opened[0](file);
		await delay(600);
		expect(runs).toBe(1);
		expect(published(first)).toEqual([{ line: 1, message: 'bad fence' }]);

		leaves.length = 0;
		vault.delays.set('note.md', [150]);
		const again = createEditor(note.split('\n'));
		opened[0](file);
		leaves.push({ view: { file, editor: again } });
		await delay(400);

		expect(runs).toBe(1);
		expect(published(again)).toEqual([{ line: 1, message: 'bad fence' }]);
	});
});

describe('stale validation', () => {
	it('drops a pending check when the target is deleted or renamed so the late run cannot restore rows', async () => {
		const vault = new FakeVault();
		const alpha = vault.write('alpha.bean', '2026-10-01 * "A"\n');
		const beta = vault.write('beta.bean', '2026-10-01 * "B"\n');
		const { plugin, opened, leaves } = await loadPlugin(vault);
		let runs = 0;
		plugin.beanCheckRunner = async (_command, args) => {
			runs += 1;
			const name = args[0].endsWith('beta.bean') ? 'beta.bean' : 'alpha.bean';
			return { stderr: `/vault/${name}:1:       bad ${name}\n`, missing: false };
		};
		leaves.push({ view: { file: alpha, editor: createEditor(['2026-10-01 * "A"']) } });
		leaves.push({ view: { file: beta, editor: createEditor(['2026-10-01 * "B"']) } });
		opened[0](alpha);
		opened[0](beta);
		await delay(600);
		expect(runs).toBe(2);
		expect(await problemTexts(plugin)).toEqual(
			expect.arrayContaining(['2 problems', 'alpha.bean:1  bad alpha.bean', 'beta.bean:1  bad beta.bean']),
		);

		await vault.emit('modify', alpha);
		await vault.emit('delete', vault.delete('alpha.bean'));
		await vault.emit('modify', beta);
		const renamed = vault.rename('beta.bean', 'gamma.bean');
		await vault.emit('rename', renamed, 'beta.bean');
		await delay(600);

		expect(runs).toBe(2);
		expect(await problemTexts(plugin)).toEqual(['No problems.']);
	});

	it('discards an in-flight ledger report when entryLedger changes, and keeps an in-flight note', async () => {
		const vault = new FakeVault();
		const ledger = vault.write('ledger.bean', '2026-10-01 * "A"\n');
		const note = vault.write('note.md', '```bean\n2026-10-01 * "A"\n```\n');
		const { plugin } = await loadPlugin(vault);
		const pending: Array<(run: BeanCheckRun) => void> = [];
		plugin.beanCheckRunner = async () =>
			await new Promise<BeanCheckRun>((resolve) => {
				pending.push(resolve);
			});

		await vault.emit('modify', ledger);
		await delay(600);
		await vault.emit('modify', note);
		await delay(600);
		expect(pending).toHaveLength(2);

		plugin.settings.entryLedger = 'main.bean';
		await plugin.saveSettings();
		expect(await problemTexts(plugin)).toEqual(['No problems.']);

		pending[0]({ stderr: '/vault/ledger.bean:1:       bad ledger\n', missing: false });
		await flush();
		expect(await problemTexts(plugin)).toEqual(['No problems.']);

		pending[1]({ stderr: 'fences.bean:1:       bad note\n', missing: false });
		await flush();
		const texts = await problemTexts(plugin);
		expect(texts).toContain('note.md:2  bad note');
		expect(texts.join('\n')).not.toContain('bad ledger');
	});

	it('does not publish a markdown check that was deleted while its body was still being read', async () => {
		const vault = new FakeVault();
		const note = vault.write('note.md', '```bean\n2026-10-01 * "A"\n```\n');
		const { plugin } = await loadPlugin(vault);
		const runs: number[] = [];
		plugin.beanCheckRunner = async () => {
			runs.push(1);
			return { stderr: 'fences.bean:1:       late\n', missing: false };
		};
		await flush();
		// The index consumes the first read on modify; bean-check's read is the second.
		vault.delays.set('note.md', [0, 300]);

		await vault.emit('modify', note);
		await delay(520);
		await vault.emit('delete', vault.delete('note.md'));
		await delay(400);

		expect(runs).toEqual([]);
		expect(await problemTexts(plugin)).toEqual(['No problems.']);
	});

	it('keeps another target’s bean-check mark when a stale flag is cleared', async () => {
		const vault = new FakeVault();
		vault.write('main.bean', 'include "journal.bean"\n');
		const journal = vault.write('journal.bean', '2026-10-01 ! "Cafe"\n  Assets:Cash  1.00 USD\n');
		const editor = createEditor(['2026-10-01 ! "Cafe"', '  Assets:Cash  1.00 USD']);
		const { plugin, leaves } = await loadPlugin(vault, null);
		leaves.push({ view: { file: journal, editor } });
		plugin.beanCheckRunner = async () => ({
			stderr: "/vault/journal.bean:2:       Invalid reference to unknown account 'Assets:Cash'\n",
			missing: false,
		});

		await vault.emit('modify', journal);
		await delay(600);
		const bean = { line: 1, message: "Invalid reference to unknown account 'Assets:Cash'" };
		expect(published(editor)).toEqual([{ line: 0, message: 'Transaction is flagged incomplete' }, bean]);

		plugin.settings.entryLedger = 'main.bean';
		await plugin.saveSettings();
		Object.assign(editor.cm, {
			state: { field: () => [bean, { line: 0, message: 'Transaction is flagged incomplete' }] },
		});
		plugin.beanCheckRunner = async () => ({ stderr: '', missing: false });
		await vault.emit('modify', journal);
		await delay(600);
		expect(published(editor)).toEqual([{ line: 0, message: 'Transaction is flagged incomplete' }, bean]);

		editor.lines[0] = '2026-10-01 * "Cafe"';
		await vault.emit('modify', journal);
		await delay(600);

		expect(published(editor)).toEqual([bean]);
	});
});

describe('entry ledger on disk', () => {
	it('includes the real entry-ledger path and drops a temp line that is not a fence body', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bean-entry-'));
		try {
			writeFileSync(join(dir, 'main.bean'), 'option "title" "Main"\n');
			const root = realpathSync(dir);
			const vault = new FakeVault(root);
			vault.write('main.bean', 'option "title" "Main"\n');
			const note = vault.write('note.md', '```bean\n2026-10-01 * "A"\n```\n');
			const editor = createEditor(['```bean', '2026-10-01 * "A"', '```', '']);
			const { plugin, leaves } = await loadPlugin(vault, { entryLedger: 'main.bean' });
			leaves.push({ view: { file: note, editor } });
			let body = '';
			plugin.beanCheckRunner = async (_command, args) => {
				body = readFileSync(args[0], 'utf8');
				return {
					stderr: [`${args[0]}:1:       include line`, `${args[0]}:3:       fence body`, ''].join('\n'),
					missing: false,
				};
			};

			await vault.emit('modify', note);
			await delay(600);

			expect(body.startsWith(`include "${root}/main.bean"`)).toBe(true);
			expect(published(editor)).toEqual([{ line: 1, message: 'fence body' }]);
			expect(notices).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('refuses a markdown check whose entry ledger is a symlink out of the vault', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bean-vault-'));
		const outside = mkdtempSync(join(tmpdir(), 'bean-out-'));
		try {
			writeFileSync(join(outside, 'secret.bean'), 'option "title" "Secret"\n');
			symlinkSync(join(outside, 'secret.bean'), join(dir, 'escape.bean'));
			const vault = new FakeVault(realpathSync(dir));
			vault.write('escape.bean', 'option "title" "Secret"\n');
			const note = vault.write('note.md', '```bean\n2026-10-01 * "A"\n```\n');
			const { plugin } = await loadPlugin(vault, { entryLedger: 'escape.bean' });
			const runs: number[] = [];
			plugin.beanCheckRunner = async () => {
				runs.push(1);
				return { stderr: '', missing: false };
			};

			await vault.emit('modify', note);
			await delay(600);

			expect(runs).toEqual([]);
			expect(notices[0]).toContain('entry ledger must be a vault file');
			expect(notices[0]).toContain('escape.bean');
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
