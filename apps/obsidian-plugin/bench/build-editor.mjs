// Bundle bench/editor.ts like the plugin build (esbuild, es2022). Real
// @codemirror/state and @codemirror/language. The plugin's own imports of
// @codemirror/view get bench/cm-view.ts (the test double, so ViewPlugin
// classes stay reachable, plus the real Decoration/WidgetType); imports
// from node_modules get the real package.
import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const require = createRequire(import.meta.url);
const realView = require.resolve('@codemirror/view');

const viewShim = {
	name: 'view-shim',
	setup(build) {
		build.onResolve({ filter: /^@codemirror\/view(-real)?$/ }, (args) => ({
			path: args.path === '@codemirror/view' && !args.importer.includes('node_modules') ? here('./cm-view.ts') : realView,
		}));
	},
};

await esbuild.build({
	entryPoints: [here('./editor.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'es2022',
	alias: { obsidian: here('../tests/mocks/obsidian.ts') },
	plugins: [viewShim],
	outfile: here('./out/editor.mjs'),
	logLevel: 'warning',
});
