import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import type { MockViewPlugin } from './mocks/codemirror';
import { BalanceInlayController } from '../inlay-hints';
import type { App, PluginManifest } from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { FakeSettingContainer, Plugin as RecordingPlugin } from './mocks/obsidian';
import { FakeVault } from './fakes';
import BeancountPlugin from '../main';
import { BeancountSettingTab } from '../settings';

// Keep the host's view-factory seam, but use actual CM text and decoration
// ranges. No DOM emulator: the real browser smoke covers widget rendering.
vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});
const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;
const ledger = ['2026-01-01 * "Deposit"', '  Assets:Cash 10.00 USD', '2026-01-02 balance Assets:Cash 12.50 USD'].join('\n');
interface InlayPlugin {
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
	destroy(): void;
}

function editor(controller: Pick<BalanceInlayController, 'extension'>, text: string, extension: string | null = 'bean') {
	let file = extension === null ? null : { path: `ledger.${extension}`, extension };
	let plugin: InlayPlugin;
	const view = {
		state: { doc: Text.of(text.split('\n')), field: () => ({ file }) },
		dispatch(spec: { effects: unknown }) {
			plugin.update({ state: view.state, view, docChanged: false, transactions: [{ effects: [spec.effects] }] } as unknown as ViewUpdate);
		},
	};
	// The test host captures the class instead of installing it in a DOM view.
	const extensionSpec = controller.extension as unknown as MockViewPlugin<InlayPlugin>;
	plugin = new extensionSpec.cls(view as never);
	return {
		view, plugin,
		change(text: string, extension?: string) {
			view.state.doc = Text.of(text.split('\n'));
			if (extension) file = { path: `ledger.${extension}`, extension };
			plugin.update({ state: view.state, view, docChanged: true, transactions: [] } as unknown as ViewUpdate);
		},
		labels() {
			const result: Array<{ at: number; text: string }> = [];
			for (let cursor = plugin.decorations.iter(); cursor.value; cursor.next()) {
				result.push({ at: cursor.from, text: cursor.value.spec.widget.label });
			}
			return result;
		},
	};
}

describe('balance inlay editor lifecycle', () => {
	it('updates every open pane when disabled or an external ledger becomes configured', () => {
		const host = { settings: { inlayHints: true, entryLedger: '' } };
		const controller = new BalanceInlayController(host);
		const a = editor(controller, ledger);
		const b = editor(controller, ledger);
		expect(a.labels()).toEqual([{ at: ledger.length, text: 'Δ +2.50 USD' }]);
		host.settings.inlayHints = false;
		controller.refresh();
		expect(a.labels()).toEqual([]);
		expect(b.labels()).toEqual([]);
		host.settings.inlayHints = true;
		host.settings.entryLedger = 'main.bean';
		controller.refresh();
		expect(a.labels()).toEqual([]);
		host.settings.entryLedger = '';
		controller.refresh();
		expect(b.labels()).toEqual([{ at: ledger.length, text: 'Δ +2.50 USD' }]);
		a.plugin.destroy();
		a.view.dispatch = () => { throw Error('dispatch into destroyed editor'); };
		controller.refresh();
		controller.destroy();
		b.view.dispatch = () => { throw Error('dispatch after unload'); };
		controller.refresh();
	});

	it('recomputes an edited balance and removes hints for incomplete assertions', () => {
		const controller = new BalanceInlayController({ settings: { inlayHints: true, entryLedger: '' } });
		const pane = editor(controller, ledger);
		const edited = ledger.replace('10.00', '11.00');
		pane.change(edited);
		expect(pane.labels()).toEqual([{ at: edited.length, text: 'Δ +1.50 USD' }]);
		pane.change(edited.replace('12.50 USD', '-'));
		expect(pane.labels()).toEqual([]);
	});

	it('scopes Markdown to real ledger fences and keeps host positions across file changes', () => {
		const controller = new BalanceInlayController({ settings: { inlayHints: true, entryLedger: '' } });
		const pane = editor(controller, ledger, 'txt');
		expect(pane.labels()).toEqual([]);
		const markdown = '# Note\n```bean\n' + ledger + '\n```\n2026-01-03 balance Assets:Cash 100 USD';
		pane.change(markdown, 'md');
		expect(pane.labels()).toEqual([{ at: '# Note\n```bean\n'.length + ledger.length, text: 'Δ +2.50 USD' }]);
		pane.change('````text\n```bean\n' + ledger + '\n```\n````');
		expect(pane.labels()).toEqual([]);
		pane.change('Just prose');
		expect(pane.labels()).toEqual([]);
		expect(editor(controller, ledger, null).labels()).toEqual([]);
	});

	it('applies and persists the user setting through the loaded plugin, and stops refreshing after unload', async () => {
		const app = { vault: new FakeVault().api } as unknown as App;
		const manifest = { id: 'beancount-obsidian' } as PluginManifest;
		const plugin = new BeancountPlugin(app, manifest) as BeancountPlugin & RecordingPlugin;
		await plugin.onload();
		const extension = plugin.registrations.editorExtensions.find(
			(value) => value !== null && typeof value === 'object' && 'cls' in value
		) as Extension;
		const pane = editor({ extension }, ledger);
		expect(pane.labels()).toEqual([{ at: ledger.length, text: 'Δ +2.50 USD' }]);
		const tab = new BeancountSettingTab(app, plugin);
		tab.display();
		// User-visible label selects the control; assert its effect, not its wording.
		const container = tab.containerEl as unknown as FakeSettingContainer;
		const toggle = container.settings.find((setting) => setting.name === 'Balance inlay hints')!.toggle!;
		await toggle.onChangeHandler!(false);
		expect(pane.labels()).toEqual([]);

		const reloaded = new BeancountPlugin(app, manifest) as BeancountPlugin & RecordingPlugin;
		reloaded.loadedData = plugin.savedData[plugin.savedData.length - 1];
		await reloaded.onload();
		const reloadedExtension = reloaded.registrations.editorExtensions.find(
			(value) => value !== null && typeof value === 'object' && 'cls' in value
		) as Extension;
		expect(editor({ extension: reloadedExtension }, ledger).labels()).toEqual([]);
		await toggle.onChangeHandler!(true);
		expect(pane.labels()).toEqual([{ at: ledger.length, text: 'Δ +2.50 USD' }]);
		for (const cleanup of plugin.registrations.cleanups) cleanup();
		pane.view.dispatch = () => { throw Error('refresh dispatched into unloaded editor'); };
		await plugin.saveSettings();
		for (const cleanup of reloaded.registrations.cleanups) cleanup();
	});
});
