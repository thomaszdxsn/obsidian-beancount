import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Prefer source over the gitignored main.js build artifact when importing '../main'.
		extensions: ['.ts', '.mts', '.js', '.mjs', '.jsx', '.tsx', '.json'],
		alias: {
			// `obsidian` npm package ships types only; tests run against a local mock.
			obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)),
			// `@codemirror/view`/`@codemirror/state` are external — Obsidian
			// provides them at runtime; tests run against a local mock.
			'@codemirror/view': fileURLToPath(new URL('./tests/mocks/codemirror.ts', import.meta.url)),
			'@codemirror/state': fileURLToPath(new URL('./tests/mocks/codemirror.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'istanbul',
			include: ['**/*.ts'],
			exclude: ['tests/**', 'vitest.config.mts', 'node_modules/**', 'coverage/**'],
			thresholds: {
				statements: 90,
				branches: 90,
				functions: 90,
				lines: 90,
			},
		},
	},
});
