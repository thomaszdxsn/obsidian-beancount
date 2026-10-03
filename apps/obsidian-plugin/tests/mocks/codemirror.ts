/**
 * Runtime double for the CodeMirror packages Obsidian provides at runtime
 * (`esbuild` lists them as external): just the `keymap`/`Prec`/
 * `EditorSelection` pieces the posting-indent extension builds from, plus a
 * minimal `EditorView` double its Enter binding can be driven with — and the
 * `StateField`/`StateEffect`/`Decoration`/`ViewPlugin`/`gutter`/`hoverTooltip`
 * pieces the diagnostics and account-hover extensions build from, each
 * mirroring the real behaviour those calls rely on (effect identity via `is`,
 * decoration ranges, sorted sets, captured hover sources).
 */

export interface MockKeyBinding {
	key: string;
	run: (view: never) => boolean;
}

export interface MockKeymapExtension {
	bindings: MockKeyBinding[];
}

export const Prec = {
	high: <T>(extension: T): T => extension,
};

/** `EditorState.languageData.of` — tests call the captured source. */
export type MockLanguageDataSource = (
	state: { doc: { toString(): string } },
	pos: number
) => readonly unknown[];

export interface MockLanguageDataExtension {
	languageData: MockLanguageDataSource;
}

export const EditorState = {
	languageData: {
		of: (source: MockLanguageDataSource): MockLanguageDataExtension => ({ languageData: source }),
	},
};

export const keymap = {
	of: (bindings: MockKeyBinding[]): MockKeymapExtension => ({ bindings }),
};

export interface MockCaret {
	anchor: number;
	head: number;
}

export const EditorSelection = {
	cursor: (pos: number): MockCaret => ({ anchor: pos, head: pos }),
	create: (ranges: MockCaret[]): { ranges: MockCaret[] } => ({ ranges }),
};

export interface MockDispatchSpec {
	changes: Array<{ from: number; to: number; insert: string }>;
	selection: { ranges: MockCaret[] };
	userEvent?: string;
	scrollIntoView?: boolean;
}

/** The whole `EditorView` surface the posting-indent binding touches. */
export interface MockView {
	state: {
		doc: { toString(): string };
		selection: { ranges: MockCaret[] };
	};
	dispatched: MockDispatchSpec[];
	dispatch(spec: MockDispatchSpec): void;
}

/** A view over `text` with one caret/selection per given range. */
export function createView(text: string, carets: Array<{ anchor: number; head?: number }>): MockView {
	const dispatched: MockDispatchSpec[] = [];
	return {
		state: {
			doc: { toString: () => text },
			selection: {
				ranges: carets.map((range) => ({
					anchor: range.anchor,
					head: range.head === undefined ? range.anchor : range.head,
				})),
			},
		},
		dispatched,
		dispatch(spec: MockDispatchSpec): void {
			dispatched.push(spec);
		},
	};
}

/** An effect instance, as `StateEffectType.of` produces it. */
export interface MockStateEffect<T> {
	value: T;
	is(spec: unknown): boolean;
}

export interface MockStateEffectType<T> {
	of(value: T): MockStateEffect<T>;
}

export const StateEffect = {
	define<T>(): MockStateEffectType<T> {
		const type: MockStateEffectType<T> = {
			of(value: T): MockStateEffect<T> {
				return { value, is: (spec: unknown) => spec === type };
			},
		};
		return type;
	},
};

/** What a `StateField`'s update sees: the transaction's effects and edits. */
export interface MockFieldUpdate {
	effects: ReadonlyArray<{ is(spec: unknown): boolean; value: unknown }>;
	docChanged?: boolean;
	startState?: { doc: { lines: number; line(at: number): { from: number; to: number } } };
	state?: { doc: { lineAt(pos: number): { number: number } } };
	changes?: { mapPos(pos: number, assoc?: number): number };
}

export interface MockStateField<T> {
	create(): T;
	update(value: T, tr: MockFieldUpdate): T;
}

export const StateField = {
	define<T>(config: { create(): T; update(value: T, tr: MockFieldUpdate): T }): MockStateField<T> {
		return { create: config.create, update: config.update };
	},
};

export interface MockDecorationSpec {
	class?: string;
	attributes?: Record<string, string>;
}

export interface MockDecorationRange {
	from: number;
	to: number;
	/** The decoration the range wraps, as the real `Range` names it. */
	value: MockDecoration;
}

export interface MockDecoration {
	kind: 'line' | 'mark';
	spec: MockDecorationSpec;
	range(from: number, to?: number): MockDecorationRange;
}

function decoration(kind: 'line' | 'mark', spec: MockDecorationSpec): MockDecoration {
	return {
		kind,
		spec,
		range(from: number, to: number = from): MockDecorationRange {
			return { from, to, value: this };
		},
	};
}

export const Decoration = {
	line: (spec: MockDecorationSpec): MockDecoration => decoration('line', spec),
	mark: (spec: MockDecorationSpec): MockDecoration => decoration('mark', spec),
	/** A sorted copy when `sort` is set, like the real `Decoration.set`. */
	set(ranges: ReadonlyArray<MockDecorationRange>, sort?: boolean): MockDecorationRange[] {
		const list = [...ranges];
		return sort ? list.sort((a, b) => a.from - b.from || a.to - b.to) : list;
	},
};

/** The class shape `ViewPlugin.fromClass` is given and kept. */
export interface MockViewPlugin<C extends object> {
	cls: new (view: never) => C;
	spec: { decorations: (value: C) => unknown };
}

export const ViewPlugin = {
	fromClass<C extends object>(
		cls: new (view: never) => C,
		spec: { decorations: (value: C) => unknown }
	): MockViewPlugin<C> {
		return { cls, spec };
	},
};

export interface MockBlockInfo {
	from: number;
	to: number;
}

/** The gutter marker base the diagnostics dot extends, mirroring `GutterMarker`. */
export class GutterMarker {
	elementClass = '';
}

export interface MockGutterConfig {
	class?: string;
	lineMarker?: (view: unknown, block: MockBlockInfo, otherMarkers: readonly unknown[]) => GutterMarker | null;
	lineMarkerChange?: (update: unknown) => boolean;
}

export const gutter = (config: MockGutterConfig): MockGutterConfig => config;

/** The hover source `hoverTooltip` captures so tests can call it directly. */
export interface MockHoverTooltip {
	source: (
		view: { state: { doc: { lineAt(pos: number): { from: number; to: number; text: string } } } },
		pos: number,
		side?: -1 | 1
	) => { pos: number; end?: number; create: () => { dom: unknown } } | null;
	options?: unknown;
}

export function hoverTooltip(
	source: MockHoverTooltip['source'],
	options?: unknown
): MockHoverTooltip {
	return { source, options };
}
