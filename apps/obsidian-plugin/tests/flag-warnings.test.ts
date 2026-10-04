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
	return {
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
		classes(): string[] {
			const out: string[] = [];
			const set = plugin.decorations;
			const iter = set.iter();
			while (iter.value) {
				const spec = (iter.value as { spec?: { class?: string } }).spec;
				if (spec?.class) out.push(spec.class);
				iter.next();
			}
			return out;
		},
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
});
