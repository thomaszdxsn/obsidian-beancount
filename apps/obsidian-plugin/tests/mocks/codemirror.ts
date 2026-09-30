/**
 * Runtime double for the CodeMirror packages Obsidian provides at runtime
 * (`esbuild` lists them as external): just the `keymap`/`Prec`/
 * `EditorSelection` pieces the posting-indent extension builds from, plus a
 * minimal `EditorView` double its Enter binding can be driven with.
 */

export interface MockKeyBinding {
	key: string;
	run: (view: never) => boolean;
}

export interface MockKeymapExtension {
	bindings: MockKeyBinding[];
}

export const Prec = {
	high: (extension: MockKeymapExtension): MockKeymapExtension => extension,
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
