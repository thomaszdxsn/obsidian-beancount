import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import type { MockViewPlugin } from './mocks/codemirror';
import {
	BALANCE_HINT_CLASS,
	BalanceInlayController,
	HINT_GAP_CLASS,
	INFERRED_HINT_CLASS,
	UNBALANCED_HINT_CLASS,
} from '../inlay-hints';
import type { App, PluginManifest } from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { FakeSettingContainer, Plugin as RecordingPlugin } from './mocks/obsidian';
import { FakeVault } from './fakes';
import BeancountPlugin from '../main';
import { BeancountSettingTab } from '../settings';

// Keep the host's view-factory seam, but use actual CM text and decoration
// ranges. Widget drawing is asserted against a tiny createElement stand-in;
// there is no browser layout here.
vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});
const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;
const ledger = ['2026-01-01 * "Deposit"', '  Assets:Cash 10.00 USD', '2026-01-02 balance Assets:Cash 12.50 USD'].join('\n');
const residualAt = '2026-01-01 * "Deposit"'.length;
const residual = (amount: string, at = residualAt) => ({ at, text: `≠ 0: ${amount} USD` });
interface InlayPlugin {
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
	destroy(): void;
}
interface HintDom {
	tagName: string;
	className: string;
	textContent: string | null;
}
interface HintWidget {
	label: string;
	className?: string;
	eq(other: { label: string; className?: string }): boolean;
	toDOM(): HintDom;
	updateDOM(dom: HintDom): boolean;
	ignoreEvent(): boolean;
}

function editor(
	controller: Pick<BalanceInlayController, 'extension'>,
	text: string,
	extension: string | null = 'bean',
	viewport?: ReadonlyArray<{ from: number; to: number }>
) {
	let file = extension === null ? null : { path: `ledger.${extension}`, extension };
	let plugin: InlayPlugin;
	let ranges: ReadonlyArray<{ from: number; to: number }> | undefined = viewport;
	const view = {
		state: { doc: Text.of(text.split('\n')), field: () => ({ file }) },
		get visibleRanges() {
			return ranges;
		},
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
		setFile(next: { path: string; extension: string } | null) {
			file = next;
		},
		/** Scroll. A selection-only update must not be used for this. */
		setViewport(next: ReadonlyArray<{ from: number; to: number }> | undefined) {
			ranges = next;
			plugin.update({
				state: view.state,
				view,
				docChanged: false,
				viewportChanged: true,
				transactions: [],
			} as unknown as ViewUpdate);
		},
		/** Selection or other non-document noise: must not rebuild hints. */
		unchanged() {
			plugin.update({ state: view.state, view, docChanged: false, transactions: [{ effects: [] }] } as unknown as ViewUpdate);
		},
		labels() {
			return this.widgets().map((widget: HintWidget, index: number) => ({ at: this.positions()[index], text: widget.label }));
		},
		positions() {
			const result: number[] = [];
			for (let cursor = plugin.decorations.iter(); cursor.value; cursor.next()) result.push(cursor.from);
			return result;
		},
		widgets(): HintWidget[] {
			const result: HintWidget[] = [];
			for (let cursor = plugin.decorations.iter(); cursor.value; cursor.next()) {
				result.push(cursor.value.spec.widget as HintWidget);
			}
			return result;
		},
	};
}
function installDocument(): () => void {
	const previous = globalThis.document;
	globalThis.document = {
		createElement: (tag: string) => ({ tagName: tag, className: '', textContent: null }),
	} as unknown as Document;
	return () => {
		if (previous === undefined) Reflect.deleteProperty(globalThis, 'document');
		else globalThis.document = previous;
	};
}

/** Visible contract: span text/class, events pass through, and a stale node is rewritten in place. */
function expectDrawn(widget: HintWidget, label: string, className: string): void {
	const dom = widget.toDOM();
	expect(dom).toMatchObject({ tagName: 'span', className, textContent: label });
	expect(widget.ignoreEvent()).toBe(false);
	expect(widget.updateDOM(dom)).toBe(true);
	expect(dom.textContent).toBe(label);
	expect(dom.className).toBe(className);
	dom.textContent = 'stale';
	expect(widget.updateDOM(dom)).toBe(true);
	expect(dom.textContent).toBe(label);
	expect(dom.className).toBe(className);
	dom.className = 'stale-class';
	expect(widget.updateDOM(dom)).toBe(true);
	expect(dom.className).toBe(className);
	expect(dom.textContent).toBe(label);
}


describe('balance inlay editor lifecycle', () => {
	it('updates every open pane when disabled or an external ledger becomes configured', () => {
		const host = { settings: { inlayHints: true, entryLedger: '' } };
		const controller = new BalanceInlayController(host);
		const a = editor(controller, ledger);
		const b = editor(controller, ledger);
		expect(a.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
		host.settings.inlayHints = false;
		controller.refresh();
		expect(a.labels()).toEqual([]);
		expect(b.labels()).toEqual([]);
		host.settings.inlayHints = true;
		host.settings.entryLedger = 'main.bean';
		controller.refresh();
		// The assertion delta needs the whole ledger; the one-leg residual does not.
		expect(a.labels()).toEqual([residual('10.00')]);
		host.settings.entryLedger = '';
		controller.refresh();
		expect(b.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
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
		expect(pane.labels()).toEqual([residual('11.00'), { at: edited.length, text: 'Δ +1.50 USD' }]);
		pane.change(edited.replace('12.50 USD', '-'));
		expect(pane.labels()).toEqual([residual('11.00')]);
	});

	it('scopes Markdown to real ledger fences and keeps host positions across file changes', () => {
		const controller = new BalanceInlayController({ settings: { inlayHints: true, entryLedger: '' } });
		const pane = editor(controller, ledger, 'txt');
		expect(pane.labels()).toEqual([]);
		const markdown = '# Note\n```bean\n' + ledger + '\n```\n2026-01-03 balance Assets:Cash 100 USD';
		pane.change(markdown, 'md');
		const fenceAt = '# Note\n```bean\n'.length;
		expect(pane.labels()).toEqual([
			residual('10.00', fenceAt + residualAt),
			{ at: fenceAt + ledger.length, text: 'Δ +2.50 USD' },
		]);
		pane.change('````text\n```bean\n' + ledger + '\n```\n````');
		expect(pane.labels()).toEqual([]);
		pane.change('Just prose');
		expect(pane.labels()).toEqual([]);
		expect(editor(controller, ledger, null).labels()).toEqual([]);
	});

	it('applies and persists the user setting through the loaded plugin, and stops refreshing after unload', async () => {
		const app = { vault: new FakeVault().api, workspace: { on: () => ({}) } } as unknown as App;
		const manifest = { id: 'beancount-obsidian' } as PluginManifest;
		const plugin = new BeancountPlugin(app, manifest) as BeancountPlugin & RecordingPlugin;
		await plugin.onload();
		const extension = plugin.registrations.editorExtensions.find(
			(value) => value !== null && typeof value === 'object' && 'cls' in value
		) as Extension;
		const pane = editor({ extension }, ledger);
		expect(pane.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
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
		expect(pane.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
		for (const cleanup of plugin.registrations.cleanups) cleanup();
		pane.view.dispatch = () => { throw Error('refresh dispatched into unloaded editor'); };
		await plugin.saveSettings();
		for (const cleanup of reloaded.registrations.cleanups) cleanup();
	});
	it('draws balance, inferred, and unbalanced hints and rewrites a stale element instead of replacing it', () => {
		const restore = installDocument();
		try {
			const host = { settings: { inlayHints: true, entryLedger: '', separatorColumn: undefined as number | undefined } };
			const controller = new BalanceInlayController(host);
			const pane = editor(controller, ledger);
			const provider = (controller.extension as unknown as MockViewPlugin<InlayPlugin>).spec.decorations;
			expect(provider(pane.plugin)).toBe(pane.plugin.decorations);
			const [unbalanced, balance] = pane.widgets();
			expect(pane.positions()).toEqual([residualAt, ledger.length]);
			expectDrawn(unbalanced, '≠ 0: 10.00 USD', UNBALANCED_HINT_CLASS);
			expectDrawn(balance, 'Δ +2.50 USD', BALANCE_HINT_CLASS);
			expect(balance.eq({ label: balance.label })).toBe(true);
			expect(balance.eq({ label: 'Δ +0 USD' })).toBe(false);
			expect(unbalanced.eq(balance)).toBe(false);

			const aligned = ['2026-01-01 * "Shop"', '  Assets:A  10.00 USD', '  Assets:B  20.00 USD', '  Assets:C'].join('\n');
			const alignedPane = editor(controller, aligned);
			const inferred = alignedPane.widgets()[0];
			expect(alignedPane.positions()).toEqual([aligned.length]);
			expectDrawn(inferred, ' -30.00 USD', INFERRED_HINT_CLASS);
			const twin = editor(controller, aligned).widgets()[0];
			expect(inferred.eq(twin)).toBe(true);
			alignedPane.change(aligned.replace('10.00', '11.00'));
			const edited = alignedPane.widgets()[0];
			expect(inferred.eq(edited)).toBe(false);
			expect(edited.label).toBe(' -31.00 USD');
			// Same label with a different class must not compare equal, or CM keeps the old DOM.
			expect(inferred.eq({ label: inferred.label, className: INFERRED_HINT_CLASS + ' ' + HINT_GAP_CLASS })).toBe(false);
			expect(inferred.eq({ label: inferred.label, className: inferred.className })).toBe(true);
			const before = alignedPane.plugin.decorations;
			alignedPane.change(alignedPane.view.state.doc.toString() + '\n; note');
			expect(provider(alignedPane.plugin)).toBe(alignedPane.plugin.decorations);
			expect(alignedPane.plugin.decorations).not.toBe(before);

			const leading = ['2026-01-01 * "Shop"', '  Assets:C', '  Assets:A  10.00 USD', '  Assets:B  20.00 USD'].join('\n');
			const gapPane = editor(controller, leading);
			const gap = gapPane.widgets()[0];
			expect(gapPane.positions()).toEqual(['2026-01-01 * "Shop"\n  Assets:C'.length]);
			expectDrawn(gap, '-30.00 USD', INFERRED_HINT_CLASS + ' ' + HINT_GAP_CLASS);
			expect(gap.eq(inferred)).toBe(false);

			host.settings.separatorColumn = 20;
			const padded = editor(controller, leading).widgets()[0];
			expectDrawn(padded, '      -30.00 USD', INFERRED_HINT_CLASS);
		} finally {
			restore();
		}
	});

	it('keeps posting hints when an entry ledger is set and drops every hint when inlays are off', () => {
		const host = { settings: { inlayHints: true, entryLedger: '   ' } };
		const controller = new BalanceInlayController(host);
		const pane = editor(controller, ledger);
		// Spaces are not a configured ledger, so the local assertion delta still shows.
		expect(pane.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
		host.settings.entryLedger = ' main.bean ';
		controller.refresh();
		expect(pane.widgets().map((widget) => ({ label: widget.label, className: widget.className }))).toEqual([
			{ label: '≠ 0: 10.00 USD', className: UNBALANCED_HINT_CLASS },
		]);
		host.settings.inlayHints = false;
		controller.refresh();
		expect(pane.widgets()).toEqual([]);
		host.settings.inlayHints = true;
		host.settings.entryLedger = '';
		controller.refresh();
		expect(pane.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
	});

	it('ignores a selection change and rebuilds when the open file changes without an edit', () => {
		const host = { settings: { inlayHints: true, entryLedger: '' } };
		const controller = new BalanceInlayController(host);
		const pane = editor(controller, ledger);
		const rendered = pane.plugin.decorations;
		host.settings.inlayHints = false;
		pane.unchanged();
		expect(pane.plugin.decorations).toBe(rendered);
		expect(pane.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
		host.settings.inlayHints = true;
		pane.setFile({ path: 'ledger.bean', extension: 'bean' });
		pane.unchanged();
		expect(pane.plugin.decorations).toBe(rendered);

		pane.setFile({ path: 'note.md', extension: 'md' });
		pane.unchanged();
		expect(pane.labels()).toEqual([]);
		pane.setFile({ path: 'ledger.bean', extension: 'bean' });
		pane.unchanged();
		expect(pane.labels()).toEqual([residual('10.00'), { at: ledger.length, text: 'Δ +2.50 USD' }]);
		pane.setFile({ path: 'notes.txt', extension: 'txt' });
		pane.unchanged();
		expect(pane.labels()).toEqual([]);
		pane.setFile(null);
		pane.unchanged();
		expect(pane.labels()).toEqual([]);
	});

	it('draws nothing on a balanced transaction in a ledger file', () => {
		const controller = new BalanceInlayController({ settings: { inlayHints: true, entryLedger: '' } });
		const balanced = ['2026-01-01 * "Ok"', '  Assets:A  10.00 USD', '  Assets:B  -10.00 USD'].join('\n');
		const pane = editor(controller, balanced);
		expect(pane.widgets()).toEqual([]);
		expect((controller.extension as unknown as MockViewPlugin<InlayPlugin>).spec.decorations(pane.plugin)).toBe(
			pane.plugin.decorations
		);
	});

	it('limits posting hints to viewport transactions and keeps balance hints file-wide', () => {
		const head = ['2026-01-01 * "Near"', '  Assets:Cash  10.00 USD', '2026-01-02 balance Assets:Cash 12.50 USD'];
		const mid = ['2026-02-01 * "Mid"', '  Assets:A  8.00 USD', '  Assets:B  -1.00 USD'];
		const far = ['2026-03-01 * "Far"', '  Assets:A  10.00 USD', '  Assets:B  20.00 USD', '  Assets:C'];
		const gap = Array.from({ length: 40 }, () => '; gap');
		const lines = [...head, ...gap, ...mid, ...gap, ...far];
		const doc = Text.of(lines);
		const lineTo = (line: number) => doc.line(line).to;
		const span = (line: number) => ({ from: doc.line(line).from, to: doc.line(line).to });
		const nearLine = 1;
		const balanceLine = 3;
		const midHeader = head.length + gap.length + 1;
		const farCash = lines.length;
		const host = { settings: { inlayHints: true, entryLedger: '' } };
		const controller = new BalanceInlayController(host);
		const pane = editor(controller, lines.join('\n'), 'bean', [span(farCash)]);
		// The balance line is above the viewport; its delta still needs the file from the top.
		expect(pane.labels()).toEqual([
			{ at: lineTo(balanceLine), text: 'Δ +2.50 USD' },
			{ at: lineTo(farCash), text: ' -30.00 USD' },
		]);
		host.settings.entryLedger = 'main.bean';
		controller.refresh();
		expect(pane.labels()).toEqual([{ at: lineTo(farCash), text: ' -30.00 USD' }]);
		// The visible line is a posting; the warning sits on the header above it.
		pane.setViewport([span(midHeader + 1)]);
		expect(pane.labels()).toEqual([{ at: lineTo(midHeader), text: '≠ 0: 7.00 USD' }]);
		pane.setViewport([span(nearLine + 1), span(farCash), span(farCash - 1)]);
		expect(pane.labels()).toEqual([
			{ at: lineTo(nearLine), text: '≠ 0: 10.00 USD' },
			{ at: lineTo(farCash), text: ' -30.00 USD' },
		]);
		pane.setViewport([]);
		expect(pane.labels()).toEqual([
			{ at: lineTo(nearLine), text: '≠ 0: 10.00 USD' },
			{ at: lineTo(midHeader), text: '≠ 0: 7.00 USD' },
			{ at: lineTo(farCash), text: ' -30.00 USD' },
		]);
	});

	it('limits fence posting hints to the viewport and does not hint prose', () => {
		const lines = [
			'# Note',
			'```bean',
			'2026-01-01 * "A"',
			'  Assets:A  10.00 USD',
			'  Assets:B  -9.00 USD',
			'',
			'2026-02-01 * "B"',
			'  Assets:A  4.00 USD',
			'  Assets:B  -1.00 USD',
			'```',
			'2026-03-01 * "Prose"',
			'  Assets:A  9.00 USD',
			'  Assets:B  -1.00 USD',
		];
		const doc = Text.of(lines);
		const span = (line: number) => ({ from: doc.line(line).from, to: doc.line(line).to });
		const controller = new BalanceInlayController({ settings: { inlayHints: true, entryLedger: 'main.bean' } });
		const pane = editor(controller, lines.join('\n'), 'md', [span(9)]);
		expect(pane.labels()).toEqual([{ at: doc.line(7).to, text: '≠ 0: 3.00 USD' }]);
		pane.setViewport([span(11), span(12), span(13)]);
		expect(pane.labels()).toEqual([]);
	});
});
