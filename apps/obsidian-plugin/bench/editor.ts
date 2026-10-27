/**
 * Per-keystroke editor benchmark: what the plugin's CodeMirror extensions
 * and handlers cost while a large ledger is open in Obsidian.
 *
 * Bundled by bench/build.mjs (es2022, as the plugin) and run under node.
 * Documents, change sets and decoration sets are real CodeMirror objects;
 * only the EditorView is a stub carrying `state`, `visibleRanges` and the
 * file. Every workload's output is hashed against bench/editor-expected.json.
 *
 *   key_*     one typed character in a posting line mid-file (`docChanged`)
 *   scroll    viewport moved, document unchanged (`viewportChanged`)
 *   md_key    one typed character inside a fence of a markdown note
 *   dot       the `.` keymap (instant alignment) on that posting
 *   enter     the Enter keymap (posting indent) at the end of that posting
 *   save      vault `modify` of the ledger: every index re-reads the file,
 *             then account/payee completion asks for matches
 *
 * Output: `METRIC name=value`; `editor_ms` is the sum.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ChangeSet, Text } from '@codemirror/state';
import type { MockViewPlugin } from '../tests/mocks/codemirror';
import { fencedMarkdown, generateLedger, hash, measure } from './common';
import { BalanceInlayController } from '../inlay-hints';
import { FlagWarningController, DEFAULT_FLAG_WARNINGS } from '../flag-warnings';
import { LedgerFileController } from '../ledger-file-view';
import { includeLinksExtension } from '../include-links';
import { instantAlignmentPlan } from '../instant-alignment';
import { postingIndentPlan } from '../posting-indent';
import { AccountIndex } from '../account-index';
import { VaultIndex } from '../vault-index';
import { extractPayees } from '../payee-index';
import { extractCommodities, extractLinks, extractNarrations, extractTags } from '../token-index';
import { ledgerDoc as ledgerOf, ledgerKind } from '../fences';
import { OpenFileIndex, PairingIndex } from '../code-actions';
import { PayeeTemplateIndex } from '../payee-template';
import type { App } from 'obsidian';

interface Plugin {
	decorations: unknown;
	update(update: unknown): void;
}

interface Editor {
	view: { state: { doc: Text; field(this: void): unknown }; visibleRanges: Array<{ from: number; to: number }> };
	plugins: Plugin[];
}

/** A stub view over `doc` showing `file`, with ~60 lines visible around `line` (1-based). */
function editor(doc: Text, file: { path: string; extension: string }, line: number, classes: Array<MockViewPlugin<Plugin>>): Editor {
	const info = { file };
	const view = {
		state: { doc, field: () => info },
		visibleRanges: visibleAround(doc, line),
	};
	return { view, plugins: classes.map((spec) => new spec.cls(view as never)) };
}

function visibleAround(doc: Text, line: number): Array<{ from: number; to: number }> {
	const from = doc.line(Math.max(1, line - 30)).from;
	const to = doc.line(Math.min(doc.lines, line + 30)).to;
	return [{ from, to }];
}

/** Applies `changes` to the editor as one transaction and runs every plugin's update. */
function type(ed: Editor, changes: ChangeSet): void {
	const startState = ed.view.state;
	const state = { doc: changes.apply(startState.doc), field: startState.field };
	ed.view.state = state;
	const update = { view: ed.view, state, startState, changes, docChanged: true, viewportChanged: false, transactions: [] };
	for (const plugin of ed.plugins) plugin.update(update);
}

function scroll(ed: Editor, line: number): void {
	ed.view.visibleRanges = visibleAround(ed.view.state.doc, line);
	const update = {
		view: ed.view,
		state: ed.view.state,
		startState: ed.view.state,
		changes: ChangeSet.empty(ed.view.state.doc.length),
		docChanged: false,
		viewportChanged: true,
		transactions: [],
	};
	for (const plugin of ed.plugins) plugin.update(update);
}

/** Decorations as plain data, for hashing. */
function dump(plugin: Plugin): unknown[] {
	const out: unknown[] = [];
	const set = plugin.decorations as { iter(): { value: unknown; from: number; to: number; next(): void } };
	for (const cursor = set.iter(); cursor.value; cursor.next()) {
		const spec = (cursor.value as { spec: Record<string, unknown> }).spec;
		const widget = spec.widget as { label?: string; className?: string } | undefined;
		out.push([cursor.from, cursor.to, spec.class ?? null, spec.attributes ?? null, widget?.label ?? null, widget?.className ?? null]);
	}
	return out;
}

const ITERS = Number(process.env.BENCH_ITERS ?? 15);
// The generated ledger, made to show inlay hints near the typed posting:
// without the `plugin` line balance assertions are not source-dependent, and
// a three-leg transaction with an omitted amount sits just above a
// `balance` directive past the middle of the file.
function editorLedger(): string {
	const lines = generateLedger(1500).replace('plugin "beancount.plugins.auto"\n', '').split('\n');
	const balance = lines.findIndex((line, i) => i > lines.length / 2 && / balance Assets:Cash /.test(line));
	const date = lines[balance].slice(0, 10);
	lines.splice(balance, 0, `${date} * "Split" "Dinner"`, '  Expenses:Food:Restaurant    30.00 USD', '  Expenses:餐饮:午餐    12.50 USD', '  Assets:Cash', '');
	return lines.join('\n');
}
const ledger = editorLedger();
const markdown = fencedMarkdown(ledger);
const ledgerDoc = Text.of(ledger.split('\n'));
const markdownDoc = Text.of(markdown.split('\n'));

// The typed posting: the first one with an amount past the middle of the file.
function postingLine(doc: Text, near: number): number {
	for (let n = near; n <= doc.lines; n += 1) if (/^ {2}(Expenses|Assets):\S+ +-?[0-9]+\.[0-9]+ USD$/.test(doc.line(n).text)) return n;
	throw new Error('no posting');
}
// The posting typed into: the first amount line after the Split transaction.
const ledgerLine = postingLine(ledgerDoc, ledgerDoc.lineAt(ledger.indexOf('"Split"')).number + 4);
const markdownLine = postingLine(markdownDoc, markdownDoc.lineAt(markdown.indexOf('"Split"')).number + 4);

// The keystroke: a character typed right after the account name, and its undo.
function keystroke(doc: Text, line: number): [ChangeSet, ChangeSet] {
	const at = doc.line(line).from + doc.line(line).text.indexOf(' ', 2);
	return [ChangeSet.of({ from: at, insert: 'x' }, doc.length), ChangeSet.of({ from: at, to: at + 1 }, doc.length + 1)];
}

const settings = {
	inlayHints: true,
	entryLedger: '',
	separatorColumn: 50,
	showRuler: true,
	flagWarnings: { ...DEFAULT_FLAG_WARNINGS },
};
const host = { settings };
const app = { vault: { getFiles: () => [] }, workspace: {} } as unknown as App;
const extensionClasses = () => {
	const ledgerFile = new LedgerFileController(host).extension as unknown as [unknown, MockViewPlugin<Plugin>];
	return {
		inlay: new BalanceInlayController(host).extension as unknown as MockViewPlugin<Plugin>,
		flags: new FlagWarningController(host).extension as unknown as MockViewPlugin<Plugin>,
		highlight: ledgerFile[1],
		include: includeLinksExtension(app) as unknown as MockViewPlugin<Plugin>,
	};
};

const ledgerFile = { path: 'ledger.beancount', extension: 'beancount' };
const noteFile = { path: 'journal.md', extension: 'md' };

/** Workload: type and undo one character with `classes` mounted; output: decorations after the typed one. */
function typingWorkload(doc: Text, file: typeof ledgerFile, line: number, classes: Array<MockViewPlugin<Plugin>>): [() => unknown, () => unknown] {
	const ed = editor(doc, file, line, classes);
	const [insert, undo] = keystroke(doc, line);
	const run = () => {
		type(ed, insert);
		type(ed, undo);
	};
	const check = () => {
		type(ed, insert);
		const result = ed.plugins.map(dump);
		type(ed, undo);
		return result;
	};
	return [run, check];
}

const cls = extensionClasses();
const pure = (fn: () => unknown): [() => unknown, () => unknown] => [fn, fn];

function scrollWorkload(): [() => unknown, () => unknown] {
	const ed = editor(ledgerDoc, ledgerFile, ledgerLine, [cls.inlay, cls.highlight, cls.include]);
	let toggle = false;
	const run = () => {
		toggle = !toggle;
		scroll(ed, toggle ? ledgerLine + 200 : ledgerLine);
	};
	const check = () => {
		scroll(ed, ledgerLine + 200);
		const result = ed.plugins.map(dump);
		scroll(ed, ledgerLine);
		return result;
	};
	return [run, check];
}

const integerOnly = Text.of(
	ledger
		.split('\n')
		.map((text, i) => (i === ledgerLine - 1 ? text.replace(/\.[0-9]+ USD$/, ' USD') : text))
);
const integerCaret = integerOnly.line(ledgerLine).from + integerOnly.line(ledgerLine).text.lastIndexOf(' USD');

function saveWorkload(): [() => unknown, () => unknown] {
	const accounts = new AccountIndex();
	const payees = new VaultIndex(extractPayees);
	const commodities = new VaultIndex(extractCommodities);
	const tags = new VaultIndex(extractTags);
	const links = new VaultIndex(extractLinks);
	const narrations = new VaultIndex(extractNarrations);
	const caches = [accounts, payees, commodities, tags, links, narrations, new PairingIndex(), new OpenFileIndex(), new PayeeTemplateIndex()];
	const run = () => {
		// What `registerVaultIndex` does per read: ledger text once, then every cache.
		const text = ledgerOf(ledgerKind(ledgerFile), ledger).ledgerSource();
		for (const cache of caches) cache.setFileContent(ledgerFile.path, text);
		return [accounts.match('Ex'), payees.match('W'), commodities.match('U')];
	};
	return [run, run];
}

const workloads: Array<[string, [() => unknown, () => unknown]]> = [
	['key_inlay', typingWorkload(ledgerDoc, ledgerFile, ledgerLine, [cls.inlay])],
	['key_flags', typingWorkload(ledgerDoc, ledgerFile, ledgerLine, [cls.flags])],
	['key_highlight', typingWorkload(ledgerDoc, ledgerFile, ledgerLine, [cls.highlight])],
	['key_include', typingWorkload(ledgerDoc, ledgerFile, ledgerLine, [cls.include])],
	['scroll', scrollWorkload()],
	['md_key', typingWorkload(markdownDoc, noteFile, markdownLine, [cls.inlay, cls.flags, cls.include])],
	['dot', pure(() => instantAlignmentPlan(integerOnly.toString(), [{ anchor: integerCaret, head: integerCaret }], 50))],
	['enter', pure(() => postingIndentPlan(ledgerDoc.toString(), [{ anchor: ledgerDoc.line(ledgerLine).to, head: ledgerDoc.line(ledgerLine).to }]))],
	['save', saveWorkload()],
];

const expectedPath = 'bench/editor-expected.json';
const update = process.env.BENCH_UPDATE === '1';
let expected: Record<string, string> = {};
try {
	expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, string>;
} catch {
	/* first run */
}
const hashes: Record<string, string> = {};
const metrics: Record<string, number> = {};
let total = 0;
for (const [name, [run, check]] of workloads) {
	const result = check();
	if (result === null || (Array.isArray(result) && result.length === 0)) {
		console.error(`${name}: empty result`);
		process.exit(1);
	}
	hashes[name] = hash(result);
	const { ms } = measure(run, ITERS, 5);
	metrics[name] = ms;
	total += ms;
}
if (update) {
	writeFileSync(expectedPath, JSON.stringify(hashes, null, '\t') + '\n');
} else {
	const bad = Object.keys(hashes).filter((k) => expected[k] !== hashes[k]);
	if (bad.length > 0) {
		console.error(`output mismatch vs ${expectedPath}: ${bad.join(', ')}`);
		process.exit(1);
	}
}
// Results go to stdout for the benchmark harness that parses METRIC lines.
const report = [`ledger line ${ledgerLine}/${ledgerDoc.lines}, note line ${markdownLine}/${markdownDoc.lines}`, `METRIC editor_ms=${total.toFixed(3)}`];
for (const [k, v] of Object.entries(metrics)) report.push(`METRIC ${k}_ms=${v.toFixed(3)}`);
process.stdout.write(report.join('\n') + '\n');
