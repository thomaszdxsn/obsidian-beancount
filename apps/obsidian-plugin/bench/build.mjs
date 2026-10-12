// Bundle bench/bench.ts like the plugin build (esbuild, es2022) so the
// benchmark measures the code Obsidian actually runs.
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

const mock = (p) => fileURLToPath(new URL(`../tests/mocks/${p}`, import.meta.url));

await esbuild.build({
	entryPoints: [fileURLToPath(new URL('./bench.ts', import.meta.url))],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'es2022',
	alias: {
		obsidian: mock('obsidian.ts'),
		'@codemirror/view': mock('codemirror.ts'),
		'@codemirror/state': mock('codemirror.ts'),
	},
	outfile: fileURLToPath(new URL('./out/bench.mjs', import.meta.url)),
	logLevel: 'warning',
});
