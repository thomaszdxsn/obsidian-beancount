// `@codemirror/view` for bench/editor.ts: the test double (so ViewPlugin
// classes and keymaps stay reachable) with the real Decoration/WidgetType,
// so decoration sets are built and sorted as in the editor.
export * from '../tests/mocks/codemirror';
export { Decoration, WidgetType } from '@codemirror/view';
