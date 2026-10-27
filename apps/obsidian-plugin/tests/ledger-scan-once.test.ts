/**
 * One CodeMirror document version is scanned once: fold, include, flag and
 * inlay all reuse `ledgerDoc`'s WeakMap instead of `toString()` or a second
 * `iterLines()`.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { EditorState } from '@codemirror/state';
import type * as CMState from '@codemirror/state';
import type { App } from 'obsidian';
import type { MockViewPlugin } from './mocks/codemirror';
import { ledgerDoc } from '../fences';
import { transactionFoldInState } from '../transaction-fold';
import { includeLinksExtension } from '../include-links';
import { FlagWarningController, DEFAULT_FLAG_WARNINGS } from '../flag-warnings';
import { BalanceInlayController } from '../inlay-hints';
import { fenceCommentPlan, regionFoldAt } from '../fence-language';

vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});

const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;

const LINES = [
	'```beancount',
	';#region',
	'2026-01-02 * "Store"',
	'  Assets:Cash  1 USD',
	'  Income:Job',
	'include "a.bean"',
	';#endregion',
	'```',
];

function countedDoc(lines: readonly string[]) {
	const text = Text.of(lines);
	let iters = 0;
	let strings = 0;
	return {
		get iters() {
			return iters;
		},
		get strings() {
			return strings;
		},
		get lines() {
			return text.lines;
		},
		get length() {
			return text.length;
		},
		line(n: number) {
			return text.line(n);
		},
		lineAt(pos: number) {
			return text.lineAt(pos);
		},
		sliceString(from: number, to?: number) {
			return text.sliceString(from, to);
		},
		toString() {
			strings += 1;
			return text.toString();
		},
		iterLines() {
			iters += 1;
			return text.iterLines();
		},
	};
}

describe('ledger scan once', () => {
	it('scans fence bodies once across ledgerDoc, fold, include, flag, inlay, region fold and comment', () => {
		const doc = countedDoc(LINES);
		const file = { path: 'note.md', extension: 'md' };
		const field = () => ({ file });

		ledgerDoc('fenced', doc);

		const foldState = { doc, field } as unknown as EditorState;
		transactionFoldInState(foldState, doc.line(3).from);

		const includeView = {
			state: { doc, field },
			visibleRanges: [],
		};
		const includeExt = includeLinksExtension({
			vault: { adapter: { getBasePath: () => '/vault' }, getFiles: () => [] },
			workspace: {},
		} as unknown as App) as unknown as MockViewPlugin<{ decorations: unknown }>;
		new includeExt.cls(includeView as never);

		const flagView = { state: { doc, field }, dispatch() {} };
		const flags = new FlagWarningController({ settings: { flagWarnings: { ...DEFAULT_FLAG_WARNINGS } } });
		new (flags.extension as unknown as MockViewPlugin<{ decorations: unknown }>).cls(flagView as never);

		const inlayView = {
			state: { doc, field },
			visibleRanges: [],
			dispatch() {},
		};
		const inlays = new BalanceInlayController({ settings: { inlayHints: true, entryLedger: '' } });
		new (inlays.extension as unknown as MockViewPlugin<{ decorations: unknown }>).cls(inlayView as never);

		const regionLine = doc.line(2);
		regionFoldAt(doc, regionLine.from, regionLine.to);
		const cash = doc.line(4);
		fenceCommentPlan(doc, [{ anchor: cash.from, head: cash.to }]);

		expect(doc.strings).toBe(0);
		expect(doc.iters).toBe(1);
	});
});
