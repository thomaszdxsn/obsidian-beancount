/**
 * Flag warnings: `!` vs `*` get different marker styles from the configured
 * map, independently of bean-check.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import type { MockViewPlugin } from './mocks/codemirror';
import {
	collectFlagDiagnostics,
	DEFAULT_FLAG_WARNINGS,
	flagDecorationRanges,
	FlagWarningController,
	WARNING_LINE_CLASS,
	WARNING_UNDERLINE_CLASS,
} from '../flag-warnings';
import type { FlagWarningHost } from '../flag-warnings';
import { ERROR_LINE_CLASS, ERROR_UNDERLINE_CLASS } from '../diagnostics';
vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});
const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;

interface FlagPlugin {
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
	destroy(): void;
}

function editor(
	controller: Pick<FlagWarningController, 'extension'>,
	text: string,
	extension: string | null = 'bean'
) {
	let file = extension === null ? null : { path: `ledger.${extension}`, extension };
	let plugin: FlagPlugin;
	const view = {
		state: {
			doc: Text.of(text.split('\n')),
			field: () => ({ file }),
		},
		dispatch(spec: { effects?: unknown }) {
			plugin.update({
				view: view as never,
				state: view.state,
				startState: view.state,
				docChanged: false,
				transactions: [{ effects: spec.effects ?? [] }],
			} as never);
		},
	};
	const extensionSpec = controller.extension as unknown as MockViewPlugin<FlagPlugin>;
	plugin = new extensionSpec.cls(view as never);
	const ranges = (): Array<{ from: number; to: number; className: string }> => {
		const out: Array<{ from: number; to: number; className: string }> = [];
		const iter = plugin.decorations.iter();
		while (iter.value) {
			const spec = (iter.value as { spec?: { class?: string } }).spec;
			out.push({ from: iter.from, to: iter.to, className: spec?.class ?? '' });
			iter.next();
		}
		return out;
	};
	return {
		view,
		plugin,
		setText(next: string, nextExt: string | null = extension) {
			file = nextExt === null ? null : { path: `ledger.${nextExt}`, extension: nextExt };
			view.state.doc = Text.of(next.split('\n'));
			plugin.update({
				view: view as never,
				state: view.state,
				startState: view.state,
				docChanged: true,
				transactions: [{ effects: [] }],
			} as never);
		},
		classes: (): string[] => ranges().map((range) => range.className),
		ranges,
	};
}

describe('collectFlagDiagnostics', () => {
	const mixed = [
		'2026-10-01 * "Cleared" "Coffee"',
		'  Expenses:Food  12.00 CNY',
		'2026-10-01 ! "Pending" "Taxi"',
		'  Expenses:Taxi  30.00 CNY',
	].join('\n');

	it('marks ! as warning and leaves * unmarked under the vscode defaults', () => {
		expect(collectFlagDiagnostics(mixed, DEFAULT_FLAG_WARNINGS)).toEqual([
			{ line: 2, flag: '!', severity: 'warning', message: 'Transaction flagged !' },
		]);
	});

	it('can raise * to error so mixed flags get two styles', () => {
		const warnings = { ...DEFAULT_FLAG_WARNINGS, '*': 'error' as const, '!': 'warning' as const };
		expect(collectFlagDiagnostics(mixed, warnings).map((row) => [row.line, row.flag, row.severity])).toEqual([
			[0, '*', 'error'],
			[2, '!', 'warning'],
		]);
	});

	it('treats txn as the * flag', () => {
		expect(collectFlagDiagnostics('2026-10-01 txn "A" "B"', { '*': 'error', '!': 'warning' })).toEqual([
			{ line: 0, flag: '*', severity: 'error', message: 'Transaction flagged *' },
		]);
	});

	it('marks no-space flags the same as spaced ones', () => {
		const warnings = { '*': 'error' as const, '!': 'warning' as const };
		expect(collectFlagDiagnostics('2026-10-01! "x"', warnings)).toEqual([
			{ line: 0, flag: '!', severity: 'warning', message: 'Transaction flagged !' },
		]);
		expect(collectFlagDiagnostics('2026-10-01* "x"', warnings)).toEqual([
			{ line: 0, flag: '*', severity: 'error', message: 'Transaction flagged *' },
		]);
		expect(collectFlagDiagnostics('2026-10-01txn "x"', warnings)).toEqual([
			{ line: 0, flag: '*', severity: 'error', message: 'Transaction flagged *' },
		]);
	});

	it('ignores org headings, postings, and silenced flags', () => {
		const text = ['* Food', '  ! Assets:Cash  1.00 USD', '2026-10-01 P "Pad" "Note"'].join('\n');
		expect(collectFlagDiagnostics(text, DEFAULT_FLAG_WARNINGS)).toEqual([]);
	});
});

describe('flagDecorationRanges', () => {
	it('uses warning classes for ! and error classes for * when both are on', () => {
		const doc = Text.of(['2026-10-01 * "A"', '2026-10-01 ! "B"']);
		const ranges = flagDecorationRanges(doc, [
			{ line: 0, flag: '*', severity: 'error', message: 'Transaction flagged *' },
			{ line: 1, flag: '!', severity: 'warning', message: 'Transaction flagged !' },
		]);
		expect(ranges.map((range) => range.value.spec.class)).toEqual([
			ERROR_LINE_CLASS,
			ERROR_UNDERLINE_CLASS,
			WARNING_LINE_CLASS,
			WARNING_UNDERLINE_CLASS,
		]);
	});
});

describe('FlagWarningController', () => {
	it('marks mixed ! and * ledgers with distinct classes and follows setting changes', () => {
		const host: FlagWarningHost = { settings: { flagWarnings: { ...DEFAULT_FLAG_WARNINGS, '*': 'error' } } };
		const controller = new FlagWarningController(host);
		const pane = editor(controller, '2026-10-01 * "A"\n2026-10-01 ! "B"');
		expect(pane.classes()).toEqual([
			ERROR_LINE_CLASS,
			ERROR_UNDERLINE_CLASS,
			WARNING_LINE_CLASS,
			WARNING_UNDERLINE_CLASS,
		]);

		host.settings.flagWarnings = { ...DEFAULT_FLAG_WARNINGS };
		controller.refresh();
		expect(pane.classes()).toEqual([WARNING_LINE_CLASS, WARNING_UNDERLINE_CLASS]);

		pane.setText('prose\n```beancount\n2026-10-01 ! "Fence"\n```\n', 'md');
		expect(pane.classes()).toEqual([WARNING_LINE_CLASS, WARNING_UNDERLINE_CLASS]);

		controller.destroy();
		controller.refresh();
	});

	it('flags a markdown note only inside fences, at the host line, and still flags a ledger', () => {
		const host: FlagWarningHost = { settings: { flagWarnings: { ...DEFAULT_FLAG_WARNINGS, '*': 'error' } } };
		const controller = new FlagWarningController(host);
		const text = [
			'2026-10-01 ! "Prose"',
			'* heading',
			'```beancount',
			'! not a date',
			'2026-10-01 ! "Fence"',
			'2026-10-01 * "Cleared"',
			'```',
			'9 ! digit but not a date',
		].join('\n');
		const pane = editor(controller, text, 'md');
		const doc = pane.view.state.doc;
		const marked = (line: number, className: string, underline: string) => {
			const row = doc.line(line);
			return [
				{ from: row.from, to: row.from, className },
				{ from: row.from, to: row.to, className: underline },
			];
		};
		expect(pane.ranges()).toEqual([
			...marked(5, WARNING_LINE_CLASS, WARNING_UNDERLINE_CLASS),
			...marked(6, ERROR_LINE_CLASS, ERROR_UNDERLINE_CLASS),
		]);

		pane.setText('2026-10-01 ! "No fence"\n* Food', 'md');
		expect(pane.ranges()).toEqual([]);

		const ledger = editor(controller, '2026-10-01 ! "Ledger"\n* Food\n! 2026-10-01 "Backwards"', 'bean');
		const ledgerDoc = ledger.view.state.doc;
		expect(ledger.ranges()).toEqual([
			{ from: ledgerDoc.line(1).from, to: ledgerDoc.line(1).from, className: WARNING_LINE_CLASS },
			{ from: ledgerDoc.line(1).from, to: ledgerDoc.line(1).to, className: WARNING_UNDERLINE_CLASS },
		]);

		const unattached = editor(controller, '2026-10-01 ! "Alone"', null);
		expect(unattached.classes()).toEqual([WARNING_LINE_CLASS, WARNING_UNDERLINE_CLASS]);
	});

	it('does not dispatch a refresh into an editor that has been destroyed', () => {
		const controller = new FlagWarningController({ settings: { flagWarnings: { ...DEFAULT_FLAG_WARNINGS } } });
		const pane = editor(controller, '2026-10-01 ! "A"');
		const spec = controller.extension as unknown as MockViewPlugin<FlagPlugin>;
		expect(spec.spec.decorations(pane.plugin)).toBe(pane.plugin.decorations);
		pane.plugin.destroy();
		pane.view.dispatch = () => {
			throw new Error('dispatch into destroyed editor');
		};
		controller.refresh();
	});
});
