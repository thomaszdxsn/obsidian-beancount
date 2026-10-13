// Mirrors the automated review behind the Obsidian community "Scorecard":
// eslint-plugin-obsidianmd's recommended set (ESLint core, typescript-eslint
// type-checked rules, Obsidian rules) over every source file in the repo.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores([
		"**/node_modules/",
		"**/coverage/",
		"apps/obsidian-plugin/main.js",
		"apps/obsidian-plugin/bench/out/",
		// Tests are not part of the shipped plugin and the review skips them.
		"**/tests/",
		"packages/beancount-parser/test/",
	]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						"eslint.config.mjs",
						"apps/obsidian-plugin/*.mjs",
						"apps/obsidian-plugin/*.mts",
						"apps/obsidian-plugin/bench/*.mjs",
					],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Fava is a product name, like Beancount.
			"obsidianmd/ui/sentence-case": ["warn", { brands: ["Fava"] }],
		},
	},
]);
