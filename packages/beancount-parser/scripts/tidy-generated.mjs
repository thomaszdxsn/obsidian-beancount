// Runs after antlr-ng (see the `generate` script) on the directory it wrote.
// The TypeScript target emits a few constructs that type-aware lint (and
// Obsidian's community review) reports in every regeneration; drop them here
// so the committed src/parser stays exactly what `pnpm generate` produces.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: tidy-generated.mjs <antlr-ng output directory>");
const path = join(dir, "BeancountParser.ts");
const original = readFileSync(path, "utf8");

const tidied = original
	// Unused `int` alias behind an undescribed eslint-disable comment.
	.replace(
		"// for running tests with parameters, TODO: discuss strategy for typed parameters in CI\n" +
			"// eslint-disable-next-line no-unused-vars\n" +
			"type int = number;\n",
		"",
	)
	// Labelled sub-rule results pushed onto their list: the label was just
	// assigned a non-null context, so the `!` changes nothing.
	.replace(/\.push\((localContext\._\w+)!\)/g, ".push($1)")
	// Left-recursive rules track `previousContext` for listener hooks the
	// visitor-only output never reads.
	.replace(/^[ \t]*(?:let )?previousContext = localContext;\n/gm, "");

for (const leftover of ["type int", "previousContext", "eslint-disable", ")!)"]) {
	if (tidied.includes(leftover)) {
		throw new Error(`tidy-generated: "${leftover}" survived; antlr-ng output changed, update this script`);
	}
}

writeFileSync(path, tidied);
