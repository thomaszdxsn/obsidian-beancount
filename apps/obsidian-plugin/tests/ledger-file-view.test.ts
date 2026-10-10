/**
 * Whole-file ledger presentation: beancount token classes on `.bean`
 * documents, nothing on markdown, the separator-column ruler, and the
 * editor plugins that paint marks and measure that ruler.
 */
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration } from '@codemirror/view';
import type * as CMState from '@codemirror/state';
import type { MockViewPlugin } from './mocks/codemirror';
import {
	LEDGER_FILE_CLASS,
	LedgerFileController,
	LedgerStateCache,
	RULER_CLASS,
	ledgerMarkRanges,
	rulerLineOffset,
} from '../ledger-file-view';
import type { LedgerDoc, LedgerFileHost, LedgerLineSpan } from '../ledger-file-view';

// The host double captures plugin classes. Decoration sets come from the
// real package so `Decoration.none` and range iteration match the editor.
vi.mock('@codemirror/view', async (original) => {
	const mock = await original<Record<string, unknown>>();
	const require = createRequire(import.meta.url);
	return { ...mock, Decoration: require('@codemirror/view').Decoration };
});

const { Text } = createRequire(import.meta.url)('@codemirror/state') as typeof CMState;

const bean = { path: 'ledger.bean', extension: 'bean' };
const beancount = { path: 'ledger.beancount', extension: 'beancount' };

describe('ledgerMarkRanges', () => {
	it('maps a transaction to the same cm- classes fences use', () => {
		// 2024-01-01 * "Shop"
		// 0123456789012345678
		const marks = ledgerMarkRanges(bean, ['2024-01-01 * "Shop"']);
		expect(marks).toEqual([
			{ from: 0, to: 4, class: 'cm-number' },
			{ from: 4, to: 5, class: 'cm-punctuation' },
			{ from: 5, to: 7, class: 'cm-number' },
			{ from: 7, to: 8, class: 'cm-punctuation' },
			{ from: 8, to: 10, class: 'cm-number' },
			{ from: 11, to: 12, class: 'cm-builtin' },
			{ from: 13, to: 19, class: 'cm-string' },
		]);
	});

	it('styles accounts, amounts, and comments, and leaves a column-0 org heading unmarked', () => {
		// "* Section\\n" is 10 chars. The heading itself is loose text: no mark.
		// Line 2 starts at 30; line 3 at 55.
		const lines = ['* Section', '2024-01-01 * "Shop"', '  Assets:Cash  -4.50 USD', '  ; note'];
		expect(ledgerMarkRanges(beancount, lines)).toEqual([
			{ from: 10, to: 14, class: 'cm-number' },
			{ from: 14, to: 15, class: 'cm-punctuation' },
			{ from: 15, to: 17, class: 'cm-number' },
			{ from: 17, to: 18, class: 'cm-punctuation' },
			{ from: 18, to: 20, class: 'cm-number' },
			{ from: 21, to: 22, class: 'cm-builtin' },
			{ from: 23, to: 29, class: 'cm-string' },
			{ from: 32, to: 38, class: 'cm-variable-2' },
			{ from: 38, to: 39, class: 'cm-punctuation' },
			{ from: 39, to: 43, class: 'cm-variable' },
			{ from: 45, to: 46, class: 'cm-operator' },
			{ from: 46, to: 50, class: 'cm-number' },
			{ from: 51, to: 54, class: 'cm-type' },
			{ from: 57, to: 63, class: 'cm-comment' },
		]);
	});

	it('carries string state into a later span, and does not style that line alone', () => {
		const lines = ['2024-01-01 * "open', 'still open"', '  Assets:Cash'];
		// Line 0 is 18 chars; the continuation starts at offset 19.
		const spanned = ledgerMarkRanges(bean, lines, [{ fromLine: 1, toLine: 1 }]);
		expect(spanned).toEqual([{ from: 19, to: 30, class: 'cm-string' }]);
		// Without the opening line the continuation is a loose column-0 line.
		expect(ledgerMarkRanges(bean, ['still open"'])).toEqual([]);
	});

	it('carries a BQL block comment across a blank line into the visible slice', () => {
		const lines = ['2024-01-01 query "q" "SELECT /*', '', 'still comment', '*/ account"'];
		const spanned = ledgerMarkRanges(bean, lines, [{ fromLine: 2, toLine: 2 }]);
		// 31 chars, newline, empty line, newline → offset 33.
		expect(spanned).toEqual([{ from: 33, to: 46, class: 'cm-comment' }]);
	});

	it('marks an indented illegal token inside an entry and not the same text at column 0', () => {
		const inside = ledgerMarkRanges(bean, ['2024-01-01 *', '  ???']);
		expect(inside).toContainEqual({ from: 15, to: 18, class: 'cm-error' });
		expect(ledgerMarkRanges(bean, ['???'])).toEqual([]);
	});

	it('produces nothing for markdown, a missing file, an empty document, or an empty viewport', () => {
		const lines = ['2024-01-01 * "Shop"', '  Assets:Cash  1 USD'];
		expect(ledgerMarkRanges({ path: 'note.md', extension: 'md' }, lines)).toEqual([]);
		expect(ledgerMarkRanges({ path: 'note.Bean', extension: 'Bean' }, lines)).toEqual([]);
		expect(ledgerMarkRanges(null, lines)).toEqual([]);
		expect(ledgerMarkRanges(undefined, lines)).toEqual([]);
		expect(ledgerMarkRanges({ path: 'no-extension' }, lines)).toEqual([]);
		expect(ledgerMarkRanges(bean, [])).toEqual([]);
		expect(ledgerMarkRanges(bean, lines, [])).toEqual([]);
		expect(ledgerMarkRanges(bean, lines, [{ fromLine: 5, toLine: 9 }])).toEqual([]);
	});
});

describe('LedgerStateCache', () => {
	function docOf(lines: readonly string[]): LedgerDoc {
		const starts: number[] = [];
		let offset = 0;
		for (const text of lines) {
			starts.push(offset);
			offset += text.length + 1;
		}
		return { lines: lines.length, line: (n) => ({ text: lines[n - 1], from: starts[n - 1] }) };
	}

	it('matches a from-scratch walk after an edit opens a string far above the viewport', () => {
		const lines: string[] = [];
		for (let i = 0; i < 1200; i++) lines.push(i % 3 === 0 ? '2024-01-01 * "Shop"' : '  Assets:Cash  -4.50 USD');
		const view = [{ fromLine: 1100, toLine: 1110 }];
		const cache = new LedgerStateCache();
		expect(cache.marks(docOf(lines), view)).toEqual(ledgerMarkRanges(bean, lines, view));

		// An unterminated query string at line 300 changes the state of every
		// later line; the cached checkpoints past it must not survive.
		const edited = [...lines];
		edited[300] = '2024-01-01 query "q" "SELECT';
		cache.invalidateFrom(300);
		const after = cache.marks(docOf(edited), view);
		expect(after).toEqual(ledgerMarkRanges(bean, edited, view));
		expect(after).not.toEqual(ledgerMarkRanges(bean, lines, view));
	});
});

describe('rulerLineOffset', () => {
	it('places the line on the left edge of the 1-based separator column', () => {
		// Column 1 is the content origin: gutter + padding, no characters.
		expect(rulerLineOffset(1, 8, 20, 4)).toBe(24);
		// Column 50 is 49 character widths past that origin (default setting).
		expect(rulerLineOffset(50, 8, 16, 4)).toBe(412);
		expect(rulerLineOffset(50, 7.5, 0, 0)).toBe(367.5);
	});

	it('keeps a scrolled gutter, and ignores non-finite or sub-1 columns', () => {
		expect(rulerLineOffset(10, 8, -24, 4)).toBe(-24 + 4 + 9 * 8);
		expect(rulerLineOffset(0, 8, 10, 2)).toBe(12);
		expect(rulerLineOffset(-3, 8, 10, 2)).toBe(12);
		expect(rulerLineOffset(Number.NaN, 8, 10, 2)).toBe(12);
		expect(rulerLineOffset(50, Number.NaN, 10, 2)).toBe(12);
		expect(rulerLineOffset(50, 8, Number.POSITIVE_INFINITY, 2)).toBe(2 + 49 * 8);
		expect(rulerLineOffset(50, 8, 10, Number.NaN)).toBe(10 + 49 * 8);
	});
});

/**
 * Vitest runs in node, so these tests drive the classes `ViewPlugin.fromClass`
 * captured instead of a DOM `EditorView`. `dispatch` builds the `ViewUpdate`
 * CodeMirror would hand the plugins.
 */
class FakeEl {
	className = '';
	style: { left: string } = { left: '' };
	attributes: Record<string, string> = {};
	children: FakeEl[] = [];
	parent: FakeEl | null = null;
	left = 0;
	paddingLeft = '0px';
	line: FakeEl | null = null;

	/** Obsidian's `HTMLElement.createDiv`, limited to the info the ruler passes. */
	createDiv(info: { cls: string; attr: Record<string, string> }): FakeEl {
		const child = new FakeEl();
		child.className = info.cls;
		child.attributes = { ...info.attr };
		child.parent = this;
		this.children.push(child);
		return child;
	}

	remove(): void {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((child) => child !== this);
		this.parent = null;
	}

	querySelector(selector: string): FakeEl | null {
		return selector === '.cm-line' ? this.line : null;
	}

	getBoundingClientRect(): { left: number } {
		return { left: this.left };
	}
}

interface DocLike {
	lines: number;
	line(n: number): { text: string; from: number; to?: number };
	lineAt(pos: number): { number: number };
}

interface HighlightPlugin {
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
	destroy(): void;
}

interface RulerPlugin {
	update(update: ViewUpdate): void;
	destroy(): void;
}

interface PaneUpdate {
	docChanged?: boolean;
	viewportChanged?: boolean;
	geometryChanged?: boolean;
	effects?: unknown;
	startState?: { doc: DocLike };
	changes?: { iterChangedRanges(callback: (fromA: number) => void): void };
}

function painted(set: DecorationSet): Array<{ from: number; to: number; class: string }> {
	const marks: Array<{ from: number; to: number; class: string }> = [];
	const cursor = set.iter();
	while (cursor.value) {
		marks.push({ from: cursor.from, to: cursor.to, class: cursor.value.spec.class ?? '' });
		cursor.next();
	}
	return marks;
}

function offsets(doc: DocLike, fromLine: number, toLine: number): { from: number; to: number } {
	const start = doc.line(fromLine + 1);
	const end = doc.line(toLine + 1);
	return { from: start.from, to: end.to ?? end.from + end.text.length };
}

function normalLines(count: number): string[] {
	const lines: string[] = [];
	for (let i = 0; i < count; i++) lines.push(i % 3 === 0 ? '2024-01-01 * "Shop"' : '  Assets:Cash  -4.50 USD');
	return lines;
}

function installDom(): void {
	globalThis.getComputedStyle = ((elt: FakeEl) => ({
		paddingLeft: elt.paddingLeft,
	})) as unknown as typeof getComputedStyle;
}

function mount(
	controller: LedgerFileController,
	options: {
		lines?: readonly string[];
		doc?: DocLike;
		file?: { path: string; extension?: string } | null;
		viewport?: readonly LedgerLineSpan[];
		visibleRanges?: Array<{ from: number; to: number }>;
		charWidth?: number;
		editorLeft?: number;
		contentLeft?: number;
		paddingLeft?: string;
	} = {}
) {
	let doc: DocLike = options.doc ?? Text.of([...(options.lines ?? ['2024-01-01 * "Shop"'])]);
	let file = options.file === undefined ? bean : options.file;
	let fieldMode: 'file' | 'raw' = 'file';
	let rawField: unknown;
	let ranges: Array<{ from: number; to: number }> | undefined = options.visibleRanges;
	if (options.viewport) ranges = options.viewport.map((span) => offsets(doc, span.fromLine, span.toLine));

	const dom = new FakeEl();
	dom.left = options.editorLeft ?? 0;
	const content = new FakeEl();
	content.left = options.contentLeft ?? 0;
	const line = new FakeEl();
	line.paddingLeft = options.paddingLeft ?? '0px';
	content.line = line;

	const measures: Array<{ read(): number; write(offset: number): void }> = [];
	const parts = controller.extension as unknown as [
		{ editorAttributes(view: unknown): { class: string } | null },
		MockViewPlugin<HighlightPlugin>,
		MockViewPlugin<RulerPlugin>,
	];
	const view: {
		dom: FakeEl | null;
		contentDOM: FakeEl | null;
		defaultCharacterWidth: number;
		readonly visibleRanges: Array<{ from: number; to: number }> | undefined;
		state: { readonly doc: DocLike; field(): unknown };
		requestMeasure(request: { read(): number; write(offset: number): void }): void;
		dispatch(spec: { effects?: unknown }): void;
	} = {
		dom,
		contentDOM: content,
		defaultCharacterWidth: options.charWidth ?? 8,
		get visibleRanges() {
			return ranges;
		},
		state: {
			get doc() {
				return doc;
			},
			field() {
				return fieldMode === 'raw' ? rawField : { file };
			},
		},
		requestMeasure(request) {
			measures.push(request);
			request.write(request.read());
		},
		dispatch(spec) {
			deliver({ effects: spec.effects });
		},
	};
	const highlight = new parts[1].cls(view as never);
	const ruler = new parts[2].cls(view as never);

	function deliver(flags: PaneUpdate): void {
		const effects = flags.effects == null ? [] : Array.isArray(flags.effects) ? flags.effects : [flags.effects];
		const update = {
			view,
			state: view.state,
			startState: flags.startState ?? view.state,
			docChanged: flags.docChanged ?? false,
			viewportChanged: flags.viewportChanged ?? false,
			geometryChanged: flags.geometryChanged ?? false,
			changes: flags.changes,
			transactions: [{ effects }],
		};
		highlight.update(update as unknown as ViewUpdate);
		ruler.update(update as unknown as ViewUpdate);
	}

	return {
		view,
		highlight,
		ruler,
		dom,
		content,
		line,
		measures,
		doc: () => doc,
		marks: () => painted(highlight.decorations),
		attributes: () => parts[0].editorAttributes(view),
		highlightLayer: () => parts[1].spec.decorations(highlight),
		rulerLayer: () => parts[2].spec.decorations(ruler),
		rulerEl: () => dom.children.find((child) => child.className === RULER_CLASS) ?? null,
		setLines(next: readonly string[]) {
			doc = Text.of([...next]);
		},
		setFile(next: { path: string; extension?: string } | null) {
			fieldMode = 'file';
			file = next;
		},
		setRawField(value: unknown) {
			fieldMode = 'raw';
			rawField = value;
		},
		setRanges(next: Array<{ from: number; to: number }> | undefined) {
			ranges = next;
		},
		update: deliver,
	};
}

describe('ledger file editor plugins', () => {
	beforeEach(installDom);
	afterEach(() => {
		Reflect.deleteProperty(globalThis, 'getComputedStyle');
	});

	it('repaints viewport marks when an edit above the viewport opens a string', () => {
		const lines = normalLines(600);
		const viewport: LedgerLineSpan[] = [{ fromLine: 550, toLine: 560 }];
		const controller = new LedgerFileController({ settings: { showRuler: false, separatorColumn: 50 } });
		const pane = mount(controller, { lines, viewport });
		const before = pane.marks();
		expect(before).toEqual(ledgerMarkRanges(bean, lines, viewport));
		expect(pane.highlightLayer()).toBe(pane.highlight.decorations);

		// Line 100 opens a string. The later changed range is reported first so a
		// plugin that keeps the first or the last range, instead of the earliest,
		// would leave the checkpoint above the viewport outside that string.
		const edited = [...lines];
		edited[100] = '2024-01-01 query "q" "SELECT';
		const previous = pane.doc();
		pane.setLines(edited);
		pane.setRanges([offsets(pane.doc(), 550, 560)]);
		pane.update({
			docChanged: true,
			startState: { doc: previous },
			changes: {
				iterChangedRanges(callback) {
					callback(previous.line(401).from);
					callback(previous.line(101).from);
				},
			},
		});
		const after = pane.marks();
		expect(after).toEqual(ledgerMarkRanges(bean, edited, viewport));
		expect(after).not.toEqual(before);
	});

	it('resets cached state on file switch and drops marks and the ledger class for markdown', () => {
		const lines = normalLines(600);
		const viewport: LedgerLineSpan[] = [{ fromLine: 550, toLine: 560 }];
		const host: LedgerFileHost = { settings: { showRuler: true, separatorColumn: 50 } };
		const controller = new LedgerFileController(host);
		const pane = mount(controller, { lines, viewport, editorLeft: 0, contentLeft: 16, paddingLeft: '4px' });
		expect(pane.attributes()).toEqual({ class: LEDGER_FILE_CLASS });
		expect(pane.rulerEl()?.className).toBe(RULER_CLASS);

		const opened = [...lines];
		opened[0] = '2024-01-01 query "q" "SELECT';
		pane.setLines(opened);
		pane.setRanges([offsets(pane.doc(), 550, 560)]);
		pane.setFile({ path: 'other.bean', extension: 'bean' });
		// The document was already replaced. Without a cache reset, checkpoints
		// from the previous file still style the viewport as ordinary postings.
		pane.update({});
		expect(pane.marks()).toEqual(ledgerMarkRanges(bean, opened, viewport));
		expect(pane.attributes()).toEqual({ class: LEDGER_FILE_CLASS });

		pane.setFile({ path: 'note.md', extension: 'md' });
		expect(pane.attributes()).toBeNull();
		pane.update({});
		expect(pane.highlight.decorations).toBe(Decoration.none);
		expect(pane.marks()).toEqual([]);
		expect(pane.rulerEl()).toBeNull();

		pane.setFile(beancount);
		pane.update({});
		expect(pane.attributes()).toEqual({ class: LEDGER_FILE_CLASS });
		expect(pane.marks()).toEqual(ledgerMarkRanges(beancount, opened, viewport));
		expect(pane.rulerEl()).not.toBeNull();
	});

	it('paints only the visible slices, and a missing viewport means the whole file', () => {
		const lines = ['2024-01-01 * "Shop"', '  Assets:Cash  1 USD', '  ; note'];
		const controller = new LedgerFileController({ settings: { showRuler: false, separatorColumn: 1 } });
		const pane = mount(controller, { lines, viewport: [{ fromLine: 0, toLine: 0 }] });
		expect(pane.marks()).toEqual(ledgerMarkRanges(bean, lines, [{ fromLine: 0, toLine: 0 }]));

		const doc = pane.doc();
		// A caret-sized range still covers the line it sits on.
		pane.setRanges([{ from: doc.line(2).from, to: doc.line(2).from }]);
		pane.update({ viewportChanged: true, effects: [{ is: () => false }] });
		expect(pane.marks()).toEqual(ledgerMarkRanges(bean, lines, [{ fromLine: 1, toLine: 1 }]));

		pane.setRanges([offsets(doc, 0, 0), offsets(doc, 2, 2)]);
		pane.update({ viewportChanged: true });
		expect(pane.marks()).toEqual(
			ledgerMarkRanges(bean, lines, [
				{ fromLine: 0, toLine: 0 },
				{ fromLine: 2, toLine: 2 },
			])
		);

		// The second range is inside the first: marks are the union, not duplicates.
		pane.setRanges([offsets(doc, 0, 2), offsets(doc, 1, 1)]);
		pane.update({ viewportChanged: true });
		expect(pane.marks()).toEqual(ledgerMarkRanges(bean, lines, [{ fromLine: 0, toLine: 2 }]));

		pane.setRanges([]);
		pane.update({ viewportChanged: true });
		expect(pane.marks()).toEqual(ledgerMarkRanges(bean, lines));

		pane.setRanges(undefined);
		pane.update({ viewportChanged: true });
		expect(pane.marks()).toEqual(ledgerMarkRanges(bean, lines));

		const same = pane.highlight.decorations;
		pane.update({ geometryChanged: true });
		expect(pane.highlight.decorations).toBe(same);
	});

	it('skips an inverted visible range and does not tokenize an empty document', () => {
		const lines = ['2024-01-01 * "Shop"', '  Assets:Cash  1 USD'];
		const starts = [0, lines[0].length + 1];
		const lineAt = (pos: number) => ({ number: pos >= 150 ? 2 : pos >= 100 ? 8 : 1 });
		const controller = new LedgerFileController({ settings: { showRuler: false, separatorColumn: 1 } });
		// from=100 is line 8, end=150 is line 2: the slice runs backwards and must not be tokenized.
		const backwards = mount(controller, {
			doc: {
				lines: lines.length,
				line: () => {
					throw new Error('inverted range must not be tokenized');
				},
				lineAt,
			},
			visibleRanges: [{ from: 100, to: 151 }],
		});
		expect(backwards.marks()).toEqual([]);

		const withSibling = mount(controller, {
			doc: {
				lines: lines.length,
				line: (n: number) => ({ text: lines[n - 1], from: starts[n - 1] }),
				lineAt,
			},
			visibleRanges: [
				{ from: 100, to: 151 },
				{ from: 0, to: 1 },
			],
		});
		expect(withSibling.marks()).toEqual(ledgerMarkRanges(bean, lines, [{ fromLine: 0, toLine: 0 }]));
		const empty = mount(controller, {
			doc: {
				lines: 0,
				line: () => {
					throw new Error('empty document has no lines');
				},
				lineAt: () => {
					throw new Error('empty document has no lines');
				},
			},
			visibleRanges: [{ from: 0, to: 1 }],
		});
		expect(empty.marks()).toEqual([]);

		const zeroBased = mount(controller, {
			doc: {
				lines: 1,
				line: () => {
					throw new Error('line number 0 is not a document line');
				},
				lineAt: () => ({ number: 0 }),
			},
			visibleRanges: [{ from: 0, to: 5 }],
		});
		expect(zeroBased.marks()).toEqual([]);
	});

	it('clears marks and the editor class when the file is missing or not a ledger', () => {
		const controller = new LedgerFileController({ settings: { showRuler: false, separatorColumn: 50 } });
		const pane = mount(controller, { lines: ['2024-01-01 * "Shop"'] });
		expect(pane.marks().length).toBeGreaterThan(0);

		pane.setRawField(undefined);
		pane.update({});
		expect(pane.highlight.decorations).toBe(Decoration.none);
		expect(pane.attributes()).toBeNull();

		pane.setFile(bean);
		pane.update({});
		expect(pane.attributes()).toEqual({ class: LEDGER_FILE_CLASS });

		pane.setRawField({ file: null });
		pane.update({ viewportChanged: true });
		expect(pane.highlight.decorations).toBe(Decoration.none);
		expect(pane.attributes()).toBeNull();

		pane.setRawField({});
		pane.update({ viewportChanged: true });
		expect(pane.attributes()).toBeNull();

		pane.setFile({ path: 'ledger' });
		pane.update({});
		expect(pane.highlight.decorations).toBe(Decoration.none);
		expect(pane.attributes()).toBeNull();

		pane.setFile({ path: 'ledger.Bean', extension: 'Bean' });
		pane.update({});
		expect(pane.attributes()).toBeNull();
		expect(pane.marks()).toEqual([]);
	});

	it('measures the ruler from the live column and removes it when hidden or the file is not a ledger', () => {
		const host: LedgerFileHost = { settings: { showRuler: false, separatorColumn: 50 } };
		const controller = new LedgerFileController(host);
		const pane = mount(controller, {
			lines: ['2024-01-01 * "Shop"'],
			editorLeft: 0,
			contentLeft: 16,
			paddingLeft: '4px',
			charWidth: 8,
		});
		expect(pane.rulerEl()).toBeNull();
		expect(pane.measures).toHaveLength(0);
		expect(pane.rulerLayer()).toBe(Decoration.none);

		host.settings.showRuler = true;
		controller.refresh();
		const ruler = pane.rulerEl();
		expect(ruler?.className).toBe(RULER_CLASS);
		expect(ruler?.attributes['aria-hidden']).toBe('true');
		expect(ruler?.parent).toBe(pane.dom);
		expect(ruler?.style.left).toBe('412px');

		host.settings.separatorColumn = 1;
		controller.refresh();
		expect(pane.rulerEl()).toBe(ruler);
		expect(ruler?.style.left).toBe('20px');

		host.settings.separatorColumn = 50;
		pane.view.defaultCharacterWidth = 10;
		const beforeGeometry = pane.measures.length;
		pane.update({ geometryChanged: true });
		expect(pane.measures.length).toBe(beforeGeometry + 1);
		expect(ruler?.style.left).toBe(`${16 + 4 + 49 * 10}px`);

		const beforeViewport = pane.measures.length;
		pane.update({ viewportChanged: true });
		expect(pane.measures.length).toBe(beforeViewport + 1);

		const beforeDoc = pane.measures.length;
		pane.update({
			docChanged: true,
			startState: { doc: pane.doc() },
			changes: {
				iterChangedRanges(callback) {
					callback(0);
				},
			},
		});
		expect(pane.measures.length).toBe(beforeDoc + 1);

		const unchanged = pane.measures.length;
		pane.update({});
		expect(pane.measures.length).toBe(unchanged);

		pane.line.paddingLeft = 'auto';
		pane.update({ geometryChanged: true });
		expect(ruler?.style.left).toBe(`${16 + 49 * 10}px`);

		pane.content.line = null;
		pane.update({ geometryChanged: true });
		expect(ruler?.style.left).toBe(`${16 + 49 * 10}px`);

		pane.view.contentDOM = null;
		pane.update({ geometryChanged: true });
		expect(ruler?.style.left).toBe(`${49 * 10}px`);

		pane.view.contentDOM = pane.content;
		pane.content.line = pane.line;
		pane.line.paddingLeft = '4px';
		pane.view.dom = null;
		pane.update({ geometryChanged: true });
		expect(ruler?.style.left).toBe(`${4 + 49 * 10}px`);

		pane.view.dom = pane.dom;
		host.settings.separatorColumn = Number.NaN;
		pane.view.defaultCharacterWidth = 8;
		controller.refresh();
		expect(ruler?.style.left).toBe('20px');

		host.settings.showRuler = false;
		controller.refresh();
		expect(pane.rulerEl()).toBeNull();
		expect(ruler?.parent).toBeNull();

		host.settings.showRuler = true;
		host.settings.separatorColumn = 50;
		controller.refresh();
		expect(pane.rulerEl()).not.toBeNull();
		pane.setFile({ path: 'note.md', extension: 'md' });
		pane.update({});
		expect(pane.rulerEl()).toBeNull();

		pane.setFile(bean);
		pane.update({});
		const restored = pane.rulerEl();
		expect(restored).not.toBeNull();
		pane.setRawField(undefined);
		pane.update({});
		expect(pane.rulerEl()).toBeNull();
		expect(restored?.parent).toBeNull();

		pane.setFile(bean);
		pane.update({});
		pane.ruler.destroy();
		expect(pane.rulerEl()).toBeNull();
	});

	it('refreshes every live editor and stops dispatching after destroy', () => {
		const host: LedgerFileHost = { settings: { showRuler: true, separatorColumn: 50 } };
		const controller = new LedgerFileController(host);
		const box = { editorLeft: 0, contentLeft: 16, paddingLeft: '4px', charWidth: 8 };
		const a = mount(controller, box);
		const b = mount(controller, box);
		expect(a.rulerEl()?.style.left).toBe('412px');
		expect(b.rulerEl()?.style.left).toBe('412px');

		const lines = ['2024-01-01 * "Shop"', '  Assets:Cash  1 USD'];
		a.setLines(lines);
		a.setRanges([offsets(a.doc(), 1, 1)]);
		host.settings.separatorColumn = 10;
		controller.refresh();
		expect(a.rulerEl()?.style.left).toBe(`${16 + 4 + 9 * 8}px`);
		expect(b.rulerEl()?.style.left).toBe(`${16 + 4 + 9 * 8}px`);
		expect(a.marks()).toEqual(ledgerMarkRanges(bean, lines, [{ fromLine: 1, toLine: 1 }]));

		a.highlight.destroy();
		a.ruler.destroy();
		a.view.dispatch = () => {
			throw new Error('dispatch into destroyed editor');
		};
		host.settings.separatorColumn = 2;
		controller.refresh();
		expect(b.rulerEl()?.style.left).toBe(`${16 + 4 + 1 * 8}px`);

		controller.destroy();
		b.view.dispatch = () => {
			throw new Error('dispatch after unload');
		};
		controller.refresh();
		expect(b.rulerEl()?.style.left).toBe(`${16 + 4 + 1 * 8}px`);
	});
});
