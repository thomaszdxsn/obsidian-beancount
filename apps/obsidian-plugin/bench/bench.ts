/**
 * Performance benchmark for the hot paths of the plugin: parsing, formatting,
 * alignment, balance computation and the regex-based vault indexers.
 *
 * Bundled by bench/build.mjs with the same esbuild target as the plugin and
 * run under node (V8, as Electron). Output: `METRIC name=value` lines.
 * Every workload's output is hashed and compared with bench/expected.json so
 * an optimisation that changes behaviour fails the run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fencedMarkdown, generateLedger, hash, measure, messUp } from './common';
import { BeancountParser } from '@repo/beancount-parser';
import { formatLedger, formatFencedDocument } from '../format';
import { alignText } from '../align';
import { accountBalances } from '../balances';
import { extractAccounts, extractAccountDirectives } from '../account-index';
import { extractCommodities, extractTags, extractLinks, extractNarrations } from '../token-index';
import { parseBeancountOutline } from '../outline';
const DAYS = Number(process.env.BENCH_DAYS ?? 1500);
const ITERS = Number(process.env.BENCH_ITERS ?? 9);
const ledger = generateLedger(DAYS);
const messy = messUp(ledger);
const markdown = fencedMarkdown(messy);
// Balances over an include chain: split the ledger in 3 files.
const lines = ledger.split('\n');
const cut1 = lines.indexOf('', Math.floor(lines.length / 3));
const cut2 = lines.indexOf('', Math.floor((2 * lines.length) / 3));
const files = new Map<string, string>([
	['main.beancount', lines.slice(0, cut1).join('\n') + '\ninclude "part2.beancount"\ninclude "part3.beancount"\n'],
	['part2.beancount', lines.slice(cut1, cut2).join('\n') + '\n'],
	['part3.beancount', lines.slice(cut2).join('\n') + '\n'],
]);
const vaultFiles = [...files.keys()];
let balanceRun = 0;

const workloads: [string, () => unknown][] = [
	['parse', () => BeancountParser.parse(ledger).directives.length],
	['format', () => formatLedger(messy)],
	['format_md', () => formatFencedDocument(markdown)],
	['align', () => alignText(messy)],
	[
		'balances',
		() => {
			// Fresh text in every file each run defeats balances.ts' per-path
			// parse cache, so the measured cost includes parsing the whole
			// include chain, as on the first open.
			balanceRun += 1;
			const fresh = new Map<string, string>();
			for (const [path, text] of files) fresh.set(path, `${text}; run ${balanceRun}\n`);
			const r = accountBalances('main.beancount', fresh, '/vault', vaultFiles);
			return { rows: r.rows, errors: r.errors };
		},
	],
	[
		'index',
		() => [
			extractAccounts(ledger),
			extractAccountDirectives(ledger),
			extractCommodities(ledger),
			extractTags(ledger),
			extractLinks(ledger),
			extractNarrations(ledger),
		],
	],
	['outline', () => parseBeancountOutline(ledger).length],
];

// Resolved from the cwd (apps/obsidian-plugin): the bundle lives in bench/out.
const expectedPath = 'bench/expected.json';
const update = process.env.BENCH_UPDATE === '1';
let expected: Record<string, string> = {};
try {
	expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
} catch {
	/* first run */
}
const hashes: Record<string, string> = { ledger: hash(ledger) };
const metrics: Record<string, number> = {};
let total = 0;
for (const [name, fn] of workloads) {
	const { ms, result } = measure(fn, ITERS, 3);
	// The workload must take the full success path, not an early error return.
	const r = result as { ok?: boolean; errors?: unknown[] };
	if (r.ok === false || (r.errors && r.errors.length > 0)) {
		console.error(`${name} failed: ${JSON.stringify(result).slice(0, 500)}`);
		process.exit(1);
	}
	hashes[name] = hash(result);
	metrics[name] = ms;
	total += ms;
}

if (update) {
	writeFileSync(expectedPath, JSON.stringify(hashes, null, '\t') + '\n');
} else {
	const bad = Object.keys(hashes).filter((k) => expected[k] !== hashes[k]);
	if (bad.length > 0) {
		console.error(`output mismatch vs bench/expected.json: ${bad.join(', ')}`);
		process.exit(1);
	}
}

console.log(`ledger: ${ledger.length} chars, ${lines.length} lines`);
console.log(`METRIC total_ms=${total.toFixed(3)}`);
for (const [k, v] of Object.entries(metrics)) console.log(`METRIC ${k}_ms=${v.toFixed(3)}`);
