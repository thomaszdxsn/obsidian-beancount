// Obsidian runs plugins in a browser window, so source code reaches timers,
// `navigator` and injected globals through `window`. Vitest runs in Node,
// where the same globals live on `globalThis`; alias the two.
if (!('window' in globalThis)) {
	Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });
}
