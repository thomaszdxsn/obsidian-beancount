import { Menu, Notice, Plugin } from 'obsidian';
import type { App, Editor, FileSystemAdapter, MarkdownView, TAbstractFile, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { ChildProcess } from 'child_process';
import { isAbsolute, relative, resolve, sep } from 'path';
import {
	alignFencedDocument,
	alignmentRanges,
	alignmentTarget,
	alignText,
	blockRangeAt,
	computeAlignment,
	inRanges,
	intersectRange,
} from './align';
import { formatErrorNotice, formatFencedDocument, formatLedger, lineChanges } from './format';
import type { LineRange } from './align';
import { beancountMode } from './beancount-mode';
import { AccountIndex } from './account-index';
import { AccountSuggest } from './account-suggest';
import { accountHoverTooltip } from './account-hover';
import type { BeanCheckRunner } from './bean-check';
import { clipText, runBeanCheck } from './bean-check';
import { flagOkayEdit, insertOpenDirective, OpenFileIndex, padEdit, PairingIndex, quickFixesForLine } from './code-actions';
import type { QuickFix, TextEdit } from './code-actions';
import { beanDiagnostics, createDiagnosticsExtension, flagOkayDiagnostics, setEditorBeanDiagnostics } from './diagnostics';
import type { DiagnosticClickHost } from './diagnostics';
import {
	captureFavaStderr,
	FAVA_CLOSE_TIMEOUT_MS,
	FAVA_HOST,
	FAVA_READY_TIMEOUT_MS,
	favaExitReason,
	favaUrl,
	isFavaBinary,
	normalizeFavaPort,
	openFavaUrl,
	probeFavaUrl,
	runFavaProcess,
	waitForChildClose,
	waitForFavaReady,
} from './fava';
import type { FavaOpener, FavaReadyProbe, FavaRunner } from './fava';
import { FlagWarningController } from './flag-warnings';
import { BalanceInlayController } from './inlay-hints';
import { isLedgerFile } from './fences';
import { insertTodayDate } from './insert-date';
import { extractPayees } from './payee-index';
import { PayeeSuggest } from './payee-suggest';
import { PayeeTemplateIndex } from './payee-template';
import { SnippetSession, SnippetSuggest, snippetTabExtension } from './snippet-suggest';
import { extractCommodities, extractLinks, extractNarrations, extractTags } from './token-index';
import { CommoditySuggest, LinkSuggest, NarrationSuggest, TagSuggest } from './token-suggest';
import { transactionFoldExtension } from './transaction-fold';
import { postingIndentExtension } from './posting-indent';
import { fenceLanguageExtension } from './fence-language';
import { includeLinksExtension } from './include-links';
import { LedgerFileController } from './ledger-file-view';
import { BeancountOutlineView, revealOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { BeancountProblemsView, revealProblemsView, VIEW_TYPE_PROBLEMS } from './problems-view';
import { BeancountBalancesView, revealBalancesView, VIEW_TYPE_BALANCES } from './report-view';
import { fileMtime } from './problems';
import { instantAlignmentExtension } from './instant-alignment';
import { isTextFile, registerVaultIndex, VaultIndex } from './vault-index';
import { CompletionUsage } from './completion-rank';
import { BeancountSettingTab, BeancountSettings, DEFAULT_SETTINGS, mergeSettings } from './settings';
import type { Clock } from './clock';
import { systemClock } from './clock';
import { resolveInVault, vaultRoot } from './vault-path';
import { createTempFilePort, LedgerValidation } from './validation';
import type { FileRef, MarkerSink, VaultPort } from './validation';

/**
 * Obsidian highlights fenced code blocks through its bundled CodeMirror 5
 * mode registry: the editor runs a `hypermd` mode with
 * `fencedCodeBlockHighlighting`, which resolves each fence's language via
 * `CodeMirror.getMode` — verified in the Obsidian 1.13 app bundle, where
 * `LanguageDescription.matchLanguageName` (the only CM6 name resolution API)
 * has no call sites. `beancountMode` is a CM5-compatible stream parser — the
 * same shape `StreamLanguage.define` consumes — so one spec serves both.
 */
interface CmModeRegistry {
	defineMode(name: string, mode: unknown): void;
	modes?: Record<string, unknown>;
}

// Obsidian injects `CodeMirror` onto the global at startup; it is not in the
// typings, so narrow the host object once here and treat the rest as checked.
const host = window as unknown as { CodeMirror?: CmModeRegistry };

const MODE_NAMES = ['beancount', 'bean'];

// The bundled CodeMirror's `getMode` calls the registered value as a factory
// (`mfactory(options, spec)`) and then writes `modeObj.name = spec.name`, so
// the factory returns a fresh spec object per call — a shared one would let
// the `beancount`/`bean` aliases clobber each other's `name`, and the write
// would leak into the object `StreamLanguage.define` holds. Its identity is
// kept to recognize our own entries on unload.
const beancountModeFactory = () => ({ ...beancountMode });

function installBeancountModes(registry: CmModeRegistry | undefined): (() => void) | null {
	if (!registry || typeof registry.defineMode !== 'function') return null;
	for (const name of MODE_NAMES) registry.defineMode(name, beancountModeFactory);
	return () => {
		const modes = registry.modes;
		if (!modes) return;
		// Only remove entries we still own; another plugin may have
		// re-registered the name in the meantime.
		for (const name of MODE_NAMES) if (modes[name] === beancountModeFactory) delete modes[name];
	};
}

/** Delay before on-save alignment, so a burst of edits aligns once. */
const ALIGN_DEBOUNCE_MS = 500;

const MISSING_FAVA_NOTICE =
	'fava not found — install fava (pip install fava) or set the Fava path in the plugin settings.';
const NO_LEDGER_FAVA_NOTICE =
	'Set Entry ledger in the Beancount settings or open a .bean / .beancount file.';

/** The editor of a leaf showing `file`, if any. */
function openEditorFor(app: App, file: TFile): Editor | null {
	return openEditorsFor(app, file)[0] ?? null;
}

/**
 * Every editor showing `file` — the active one first, then background leaves.
 * Each pane holds its own view of the file, and each carries its own markers.
 */
function openEditorsFor(app: App, file: TFile): Editor[] {
	// The active editor answers for any leaf type; the scan covers other
	// markdown tabs (Obsidian opens text files like `.bean` there too).
	const editors: Editor[] = [];
	const active = app.workspace.activeEditor;
	if (active && active.file?.path === file.path && active.editor) editors.push(active.editor);
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view as MarkdownView | null;
		if (view && view.file?.path === file.path && view.editor && !editors.includes(view.editor)) {
			editors.push(view.editor);
		}
	}
	return editors;
}


/** A vault file, not a folder: folders have no `extension` to stamp an mtime on. */
function isVaultFile(file: TAbstractFile | null): file is TFile {
	return !!file && 'extension' in file && typeof file.extension === 'string';
}

function fileRef(file: TFile): FileRef {
	return { path: file.path, extension: file.extension, mtime: fileMtime(file) };
}

/** Every line of the editor, in order. */
function editorLines(editor: Editor): string[] {
	const lines: string[] = [];
	for (let line = 0; line < editor.lineCount(); line += 1) lines.push(editor.getLine(line));
	return lines;
}

/**
 * What the command aligns: the selected lines when there is a selection,
 * otherwise the transaction block the cursor sits in — both cut to
 * `bodies`, the lines alignment may touch, so a block never crosses a fence.
 */
function commandScope(editor: Editor, lines: readonly string[], bodies: readonly LineRange[]): LineRange[] {
	if (!editor.somethingSelected()) {
		const line = editor.getCursor().line;
		const block = blockRangeAt(lines, line);
		for (const body of bodies) {
			if (line < body.from || line > body.to) continue;
			const clipped = intersectRange(block, body);
			return clipped === null ? [] : [clipped];
		}
		return [];
	}
	let from = Number.MAX_SAFE_INTEGER;
	let to = 0;
	for (const selection of editor.listSelections()) {
		const start = Math.min(selection.anchor.line, selection.head.line);
		const end = Math.max(selection.anchor.line, selection.head.line);
		const endCh = selection.anchor.line === end ? selection.anchor.ch : selection.head.ch;
		from = Math.min(from, start);
		// A selection dragged to the start of the next line holds none of its
		// characters, so the last selected line is the one before it.
		to = Math.max(to, endCh === 0 && end > start ? end - 1 : end);
	}
	const selected = { from, to };
	const scopes: LineRange[] = [];
	for (const body of bodies) {
		const clipped = intersectRange(selected, body);
		if (clipped !== null) scopes.push(clipped);
	}
	return scopes;
}

/**
 * Rewrite the gaps in `scope` (the whole buffer when omitted) so the decimal
 * points of each transaction block line up. Several ranges are one
 * transaction so undo is still one step. `ledgerLine` marks a note's fence
 * lines; without it the whole buffer is ledger text.
 */
function alignInEditor(
	editor: Editor,
	scope?: readonly LineRange[],
	targetColumn?: number,
	ledgerLine?: (line: number) => boolean
): void {
	const lines = editorLines(editor);
	const edits =
		scope === undefined
			? computeAlignment(lines, undefined, targetColumn, ledgerLine)
			: scope.flatMap((range) => computeAlignment(lines, range, targetColumn, ledgerLine));
	if (edits.length === 0) return;
	const changes = edits.map((edit) => ({
		from: { line: edit.line, ch: edit.from },
		to: { line: edit.line, ch: edit.to },
		text: edit.text,
	}));
	// One transaction: CodeMirror maps the cursor and undo stack through all
	// gap rewrites at once. Its offset mapping leaves the caret inside a
	// widened gap, so a lone caret is mapped onto the text it sat on: just
	// before the amount — and a caret inside the gap lands there too, while
	// one exactly at the gap start stays with the account. A range or several
	// carets are left to the editor's own mapping: forcing a caret there
	// would collapse what the user has selected.
	const carets = editor.listSelections();
	if (carets.length !== 1 || editor.somethingSelected()) {
		editor.transaction({ changes });
		return;
	}
	const caret = editor.getCursor();
	let ch = caret.ch;
	for (const edit of edits) {
		if (edit.line !== caret.line) continue;
		if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
		else if (ch > edit.from) ch = edit.from + edit.text.length;
	}
	editor.transaction({ changes, selection: { from: { line: caret.line, ch } } });
}

/** The `Align decimal points` command. */
function alignCommand(
	editor: Editor,
	file: { path: string; extension: string } | null,
	separatorColumn: number
): void {
	const lines = editorLines(editor);
	const ledger = file !== null && isLedgerFile(file);
	const bodies = alignmentRanges(lines, ledger);
	const scopes = commandScope(editor, lines, bodies);
	if (scopes.length === 0) return;
	alignInEditor(editor, scopes, alignmentTarget(separatorColumn), ledger ? undefined : inRanges(bodies));
}

/** On-save: a ledger file is the whole buffer; anything else is fence bodies. */
function alignOpenEditor(
	editor: Editor,
	file: { path: string; extension: string },
	targetColumn: number
): void {
	const ledger = isLedgerFile(file);
	const scopes = alignmentRanges(editorLines(editor), ledger);
	if (scopes.length === 0) return;
	alignInEditor(editor, scopes, targetColumn, ledger ? undefined : inRanges(scopes));
}

/**
 * `Format ledger`: a `.bean` / `.beancount` buffer is one ledger. Any other
 * file, including an untitled buffer, formats each ```beancount / ```bean
 * fence and leaves the rest. A syntax error names the document line and
 * changes nothing. No notice when the text is already formatted — same as
 * alignment finding nothing to do.
 */
function formatInEditor(
	editor: Editor,
	file: { path: string; extension: string } | null,
	separatorColumn: number
): void {
	const targetColumn = alignmentTarget(separatorColumn);
	const result =
		file !== null && isLedgerFile(file)
			? formatLedger(editor.getValue(), targetColumn)
			: formatFencedDocument(editor.getValue(), targetColumn);
	if (!result.ok) {
		new Notice(formatErrorNotice(result.error));
		return;
	}
	const before = editor.getValue();
	const edits = lineChanges(before, result.text);
	if (edits.length === 0) return;
	const changes = edits.map((edit) => ({
		from: { line: edit.fromLine, ch: edit.fromCh },
		to: { line: edit.toLine, ch: edit.toCh },
		text: edit.text,
	}));
	// One transaction. A lone caret maps through each whitespace run in the
	// original coordinates: one inside a run lands at the end of that run's
	// replacement, one past a run shifts by its length delta, and a token
	// between two runs stays on that token. A selection is left to the editor
	// so it is not collapsed.
	const carets = editor.listSelections();
	if (carets.length !== 1 || editor.somethingSelected()) {
		editor.transaction({ changes });
		return;
	}
	const caret = editor.getCursor();
	let ch = caret.ch;
	let shift = 0;
	for (const edit of edits) {
		if (edit.fromLine !== caret.line) continue;
		if (ch >= edit.toCh) {
			shift += edit.text.length - (edit.toCh - edit.fromCh);
		} else if (ch > edit.fromCh) {
			ch = edit.fromCh + shift + edit.text.length;
			shift = 0;
			break;
		} else {
			break;
		}
	}
	editor.transaction({ changes, selection: { from: { line: caret.line, ch: ch + shift } } });
}

function applyEditorEdit(editor: Editor, edit: TextEdit): void {
	editor.transaction({
		changes: [{ from: { line: edit.line, ch: edit.fromCh }, to: { line: edit.line, ch: edit.toCh }, text: edit.text }],
	});
}

export default class BeancountPlugin extends Plugin implements DiagnosticClickHost {
	settings: BeancountSettings = { ...DEFAULT_SETTINGS };
	/** How `bean-check` is started; tests swap in their own runner. */
	beanCheckRunner: BeanCheckRunner = runBeanCheck;
	/** Timer seam; tests set this before `onload`. */
	clock: Clock = systemClock;
	private validation!: LedgerValidation;
	private readonly pairings = new PairingIndex();
	private readonly openFiles = new OpenFileIndex();
	/** Pending on-save alignment per file path. */
	private readonly alignTimers = new Map<string, number>();
	/** Balance-assertion deltas; refreshed when the settings that gate them change. */
	private readonly balanceInlays = new BalanceInlayController(this);
	/** Transaction-flag markers; refreshed when flagWarnings change. */
	private readonly flagWarnings = new FlagWarningController(this);
	/** Ledger-file token colors and the separator ruler; refreshed with those settings. */
	private readonly ledgerFile = new LedgerFileController(this);
	/** How Fava is started; tests swap in their own runner. */
	favaRunner: FavaRunner = runFavaProcess;
	/** Opens the Fava UI after start or reuse; tests swap this. */
	favaOpener: FavaOpener = openFavaUrl;
	/** HTTP GET of Fava's root; tests swap this so they never open sockets. */
	favaReadyProbe: FavaReadyProbe = probeFavaUrl;
	/** Bound on waiting for Fava to answer; tests shrink this. */
	favaReadyTimeoutMs = FAVA_READY_TIMEOUT_MS;
	/** Pause between readiness probes and bound on the close wait; tests no-op this. */
	favaDelay: (ms: number) => Promise<void> = (ms) =>
		new Promise((resolve) => window.setTimeout(resolve, ms));
	/** Bound on waiting for stdio close after Fava exits; tests shrink this. */
	favaCloseTimeoutMs = FAVA_CLOSE_TIMEOUT_MS;
	/** Live Fava child, killed when the plugin unloads. */
	private favaChild: ChildProcess | null = null;
	/** Port the live child was started with; reuse must open this URL. */
	private favaBoundPort: number | null = null;
	/** True once the live child answered HTTP with status < 400. */
	private favaServing = false;
	/** True when Stop Fava or unload is the reason the child will exit. */
	private favaExpectExit = false;
	/** Stderr tail of the live child; captured once at spawn. */
	private favaStderr: () => string = () => '';
	/** In-flight start so a second command cannot spawn another process. */
	private favaStart: Promise<boolean> | null = null;
	/** Completion pick counts persisted beside settings in data.json. */
	private usage: CompletionUsage = CompletionUsage.parse(null);

	async onload() {
		let stored: unknown = null;
		try {
			stored = await this.loadData();
		} catch {
			stored = null;
		}
		this.settings = mergeSettings(stored);
		this.validation = new LedgerValidation(
			{
				clock: this.clock,
				runner: (...args) => this.beanCheckRunner(...args),
				vault: this.vaultPort(),
				tempFile: createTempFilePort(),
				markers: this.markerSink(),
				notifier: { show: (text) => new Notice(text) },
			},
			{
				entryLedger: () => this.settings.entryLedger,
				beanCheckPath: () => this.settings.beanCheckPath,
			},
		);
		this.usage = CompletionUsage.parse(stored, Date.now, () => {
			void this.writePluginData();
		});
		// Ledger files open as notes: without this Obsidian shows them as
		// unsupported, and nothing of the plugin (completion, alignment,
		// validation) has an editor to work in. Registration is read at app
		// start — a changed mapping needs an Obsidian restart, not just a
		// plugin reload.
		this.registerExtensions(['bean', 'beancount'], 'markdown');
		const uninstall = installBeancountModes(host.CodeMirror);
		if (uninstall) this.register(uninstall);
		// One vault scan feeds every completion index, balancing-account
		// history, and the file that already holds `open` directives.
		const pinyinMatching = () => this.settings.pinyinMatching;
		const accounts = new AccountIndex(this.usage, pinyinMatching);
		const payees = new VaultIndex(extractPayees, this.usage, pinyinMatching);
		const commodities = new VaultIndex(extractCommodities, this.usage, pinyinMatching);
		const tags = new VaultIndex(extractTags, this.usage, pinyinMatching);
		const links = new VaultIndex(extractLinks, this.usage, pinyinMatching);
		const narrations = new VaultIndex(extractNarrations, this.usage, pinyinMatching);
		const payeeTemplates = new PayeeTemplateIndex();
		const snippetSession = new SnippetSession();
		registerVaultIndex(
			this,
			accounts,
			payees,
			commodities,
			tags,
			links,
			narrations,
			this.pairings,
			this.openFiles,
			payeeTemplates
		);
		const accountSuggest = new AccountSuggest(this.app, accounts);
		const payeeSuggest = new PayeeSuggest(this.app, payees, () => this.settings.completePayee, {
			enabled: () => this.settings.payeeAutofill,
			templateFor: (payee) => {
				const template = payeeTemplates.get(payee);
				return template !== null && template.postings.length > 0 ? template.postings : null;
			},
			session: snippetSession,
		});
		const commoditySuggest = new CommoditySuggest(this.app, commodities);
		const tagSuggest = new TagSuggest(this.app, tags);
		const linkSuggest = new LinkSuggest(this.app, links);
		const narrationSuggest = new NarrationSuggest(this.app, narrations, () => this.settings.completeNarration);
		const snippetSuggest = new SnippetSuggest(this.app, snippetSession);
		this.registerEditorSuggest(accountSuggest);
		this.registerEditorSuggest(payeeSuggest);
		this.registerEditorSuggest(commoditySuggest);
		this.registerEditorSuggest(tagSuggest);
		this.registerEditorSuggest(linkSuggest);
		this.registerEditorSuggest(narrationSuggest);
		this.registerEditorSuggest(snippetSuggest);
		const popovers = [
			accountSuggest,
			payeeSuggest,
			commoditySuggest,
			tagSuggest,
			linkSuggest,
			narrationSuggest,
			snippetSuggest,
		];
		// Enter opens the next line of a beancount entry already indented;
		// the binding defers to the completion popovers while they are open.
		this.registerEditorExtension(postingIndentExtension(popovers));
		// Typing `.` in a posting amount aligns that transaction block and
		// parks the caret after the point; the setting can silence it.
		this.registerEditorExtension(instantAlignmentExtension(this));
		// The markers on lines bean-check complains about: inline underline
		// plus a gutter dot. Clicking the dot offers the quick fixes that
		// line can take.
		this.registerEditorExtension(createDiagnosticsExtension(this));
		this.registerEditorExtension(accountHoverTooltip(accounts));
		// Cmd+/ comments, auto-close brackets, and ;#region folds inside
		// ```beancount / ```bean fences — markdown's languageData otherwise
		// wins because the fence highlighter is a CM5 overlay, not a nested
		// CM6 language.
		this.registerEditorExtension(fenceLanguageExtension());
		// Each transaction folds to its header line, in ledger files and fences.
		this.registerEditorExtension(transactionFoldExtension());
		// Balance assertion deltas at the end of balance lines. Independent of
		// the diagnostic markers; a setting change reapplies them without an edit.
		this.registerEditorExtension(this.balanceInlays.extension);
		this.registerEditorExtension(this.flagWarnings.extension);
		// Tab walks snippet stops; yields while a completion popover is open.
		this.registerEditorExtension(snippetTabExtension(snippetSession, popovers));
		// Mod-click on an include "…" path opens that file, relative to the
		// ledger or — inside a fence — to the note's folder.
		this.registerEditorExtension(includeLinksExtension(this.app));
		// `.bean` / `.beancount` open as markdown; paint beancount token classes,
		// a monospace editor class, and the separator-column ruler on those files.
		this.registerEditorExtension(this.ledgerFile.extension);
		this.addCommand({
			id: 'align-decimal-points',
			name: 'Align decimal points',
			editorCallback: (editor, ctx) =>
				alignCommand(editor, ctx?.file ?? null, this.settings.separatorColumn),
		});
		this.addCommand({
			id: 'format-ledger',
			name: 'Format ledger',
			editorCallback: (editor, ctx) =>
				formatInEditor(editor, ctx?.file ?? null, this.settings.separatorColumn),
		});
		this.addCommand({
			id: 'insert-today-date',
			name: 'Insert today\'s date',
			editorCallback: insertTodayDate,
		});
		// Ledger files have no markdown headings, so Obsidian's Outline pane
		// stays empty; this view is the jumpable txn/heading tree.
		this.registerView(VIEW_TYPE_OUTLINE, (leaf) => new BeancountOutlineView(leaf));
		this.addCommand({
			id: 'show-outline',
			name: 'Show outline',
			callback: () => revealOutlineView(this.app),
		});
		this.registerView(VIEW_TYPE_PROBLEMS, (leaf) => new BeancountProblemsView(leaf, this.validation.problems));
		this.addCommand({
			id: 'show-problems',
			name: 'Show problems',
			callback: () => revealProblemsView(this.app),
		});
		this.registerView(VIEW_TYPE_BALANCES, (leaf) => new BeancountBalancesView(leaf, this));
		this.addCommand({
			id: 'show-balances',
			name: 'Show account balances',
			callback: () => revealBalancesView(this.app),
		});
		this.addCommand({
			id: 'start-fava',
			name: 'Start Fava',
			callback: () => this.launchFava(true),
		});
		this.addCommand({
			id: 'stop-fava',
			name: 'Stop Fava',
			callback: () => {
				this.stopFava();
			},
		});
		this.addSettingTab(new BeancountSettingTab(this.app, this));
		this.registerEvent(this.app.vault.on('modify', (file) => this.onFileModified(file)));
		this.registerEvent(
			this.app.vault.on('delete', (file) => this.validation.handle({ kind: 'deleted', path: file.path })),
		);
		this.registerEvent(
			this.app.vault.on('rename', (_file, oldPath) => this.validation.handle({ kind: 'renamed', oldPath })),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.onFileOpened(file);
			}),
		);
		this.register(() => {
			this.validation.handle({ kind: 'unload' });
			for (const timer of this.alignTimers.values()) window.clearTimeout(timer);
			this.alignTimers.clear();
			this.balanceInlays.destroy();
			this.flagWarnings.destroy();
			this.ledgerFile.destroy();
			this.favaExpectExit = true;
			this.favaChild?.kill();
			this.clearFavaChild();
		});
		if (this.settings.runFavaOnActivate) {
			this.app.workspace.onLayoutReady(() => void this.launchFava(false));
		}
	}

	onunload() {}
	async saveSettings(): Promise<void> {
		await this.writePluginData();
		this.validation.handle({ kind: 'beanCheckPathChanged' });
		const entryChanged = this.validation.commitEntryLedger(this.settings.entryLedger);
		this.balanceInlays.refresh();
		this.flagWarnings.refresh();
		this.ledgerFile.refresh();
		if (entryChanged) await this.refreshBalanceViews();
	}

	private async refreshBalanceViews(): Promise<void> {
		const workspace = this.app.workspace;
		if (typeof workspace.getLeavesOfType !== 'function') return;
		const pending: Array<Promise<void>> = [];
		for (const leaf of workspace.getLeavesOfType(VIEW_TYPE_BALANCES)) {
			const view = leaf.view;
			if (view instanceof BeancountBalancesView) pending.push(view.sync());
		}
		await Promise.all(pending);
	}

	private async writePluginData(): Promise<void> {
		const usage = this.usage.toJSON();
		if (Object.keys(usage).length === 0) {
			await this.saveData({ ...this.settings });
			return;
		}
		await this.saveData({ ...this.settings, completionUsage: usage });
	}

	private isFavaRunning(): boolean {
		return this.favaChild != null && this.favaChild.exitCode === null;
	}

	private clearFavaChild(): void {
		this.favaChild = null;
		this.favaBoundPort = null;
		this.favaServing = false;
		this.favaStderr = () => '';
	}

	private revealFava(announce: boolean): void {
		if (!announce) return;
		const bound = this.favaBoundPort ?? normalizeFavaPort(this.settings.favaPort);
		const wanted = normalizeFavaPort(this.settings.favaPort);
		const url = favaUrl(bound);
		this.favaOpener(url);
		if (bound !== wanted) {
			new Notice(
				`Fava is already running on port ${bound}; stop it and start again to use port ${wanted}.`
			);
			return;
		}
		new Notice(`Fava is running at ${url}`);
	}

	private stopFava(): void {
		if (!this.isFavaRunning()) {
			this.clearFavaChild();
			new Notice('Fava is not running.');
			return;
		}
		this.favaExpectExit = true;
		this.favaChild?.kill();
		this.clearFavaChild();
		new Notice('Fava stopped.');
	}

	private async launchFava(announce: boolean): Promise<void> {
		if (this.favaStart) {
			const started = await this.favaStart;
			if (started && this.isFavaRunning()) this.revealFava(announce);
			return;
		}
		if (this.isFavaRunning() && this.favaServing) {
			this.revealFava(announce);
			return;
		}
		this.favaStart =
			this.isFavaRunning() && this.favaChild
				? this.waitUntilFavaServes(this.favaChild)
				: this.startFavaProcess();
		try {
			const started = await this.favaStart;
			if (started && this.isFavaRunning()) this.revealFava(announce);
		} finally {
			this.favaStart = null;
		}
	}

	private async waitUntilFavaServes(child: ChildProcess): Promise<boolean> {
		const url = favaUrl(this.favaBoundPort ?? normalizeFavaPort(this.settings.favaPort));
		const getStderr = this.favaStderr;
		const outcome = await waitForFavaReady(child, url, this.favaReadyProbe, {
			timeoutMs: this.favaReadyTimeoutMs,
			delay: this.favaDelay,
			closeTimeoutMs: this.favaCloseTimeoutMs,
		});
		if (outcome === 'ready') {
			this.favaServing = true;
			return true;
		}
		if (outcome === 'timeout') {
			if (!this.favaExpectExit) new Notice(`Fava did not answer at ${url}`);
			return false;
		}
		if (!this.favaExpectExit) {
			new Notice(`Fava exited: ${favaExitReason(getStderr(), child.exitCode)}`);
		}
		if (this.favaChild === child) this.clearFavaChild();
		return false;
	}

	private async startFavaProcess(): Promise<boolean> {
		const command = this.settings.favaPath.trim() || 'fava';
		if (!isFavaBinary(command)) {
			new Notice(MISSING_FAVA_NOTICE);
			return false;
		}
		const requested = this.settings.entryLedger.trim() || this.app.workspace.getActiveFile()?.path || '';
		if (!requested.endsWith('.bean') && !requested.endsWith('.beancount')) {
			new Notice(NO_LEDGER_FAVA_NOTICE);
			return false;
		}
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const root = vaultRoot(adapter.getBasePath());
		const confined = resolve(root, requested);
		const rel = relative(root, confined);
		if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
			new Notice(`Fava: entry ledger must be a vault file, not "${clipText(requested)}"`);
			return false;
		}
		const port = normalizeFavaPort(this.settings.favaPort);
		const result = await this.favaRunner(command, ['-H', FAVA_HOST, '-p', String(port), confined]);
		if (result.missing) {
			new Notice(MISSING_FAVA_NOTICE);
			return false;
		}
		const child = result.child ?? null;
		if (!child) return false;
		const getStderr = captureFavaStderr(child);
		this.favaStderr = getStderr;
		this.favaExpectExit = false;
		this.favaServing = false;
		this.favaChild = child;
		this.favaBoundPort = port;
		let closed = false;
		child.once('close', () => {
			closed = true;
		});
		child.once('exit', (code) => {
			const unexpected = !this.favaExpectExit && this.favaServing && this.favaChild === child;
			void (async () => {
				await waitForChildClose(child, {
					alreadyClosed: closed,
					timeoutMs: this.favaCloseTimeoutMs,
					delay: this.favaDelay,
				});
				const stderr = getStderr();
				if (this.favaChild === child) this.clearFavaChild();
				if (unexpected && !this.favaExpectExit) {
					new Notice(`Fava exited: ${favaExitReason(stderr, code)}`);
				}
			})();
		});
		return this.waitUntilFavaServes(child);
	}

	onDiagnosticClick(view: EditorView, line: number, event: MouseEvent): boolean {
		const located = this.editorFileForView(view);
		if (!located) return false;
		const diagnostic =
			view.state.field(beanDiagnostics).find((entry) => entry.line === line) ??
			view.state.field(flagOkayDiagnostics).find((entry) => entry.line === line);
		if (!diagnostic) return false;
		const { editor, file } = located;
		const lines = editor.getValue().split('\n');
		const openFile = this.openFiles.bestFile() ?? (isLedgerFile(file) ? file.path : null);
		const fixes = quickFixesForLine({
			lines,
			line,
			message: diagnostic.message,
			pairings: this.pairings.all(),
			openFile,
			openedAccounts: openFile ? this.openFiles.openedIn(openFile) : new Set(),
		});
		if (fixes.length === 0) return false;
		const menu = new Menu();
		for (const fix of fixes) {
			menu.addItem((item) =>
				item.setTitle(fix.title).onClick(() => {
					this.applyQuickFix(editor, file, lines, line, diagnostic.message, fix);
				})
			);
		}
		menu.showAtMouseEvent(event);
		event.preventDefault();
		return true;
	}

	private editorFileForView(view: EditorView): { editor: Editor; file: TFile } | null {
		const matches = (editor: Editor | null | undefined, file: TFile | null | undefined) =>
			editor !== undefined &&
			editor !== null &&
			file !== undefined &&
			file !== null &&
			(editor as Editor & { cm?: EditorView }).cm === view
				? { editor, file }
				: null;
		const active = this.app.workspace.activeEditor;
		const fromActive = matches(active?.editor ?? null, active?.file ?? null);
		if (fromActive) return fromActive;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const markdown = leaf.view as MarkdownView | null;
			const found = matches(markdown?.editor ?? null, markdown?.file ?? null);
			if (found) return found;
		}
		return null;
	}

	private applyQuickFix(
		editor: Editor,
		file: TFile,
		lines: readonly string[],
		line: number,
		message: string,
		fix: QuickFix
	): void {
		if (fix.kind === 'flag-okay') {
			const edit = flagOkayEdit(lines, line);
			if (edit) applyEditorEdit(editor, edit);
			return;
		}
		if (fix.kind === 'pad') {
			const edit = padEdit(lines, line, this.pairings.all(), message);
			if (edit) applyEditorEdit(editor, edit);
			return;
		}
		void this.applyOpenAccount(file, fix);
	}

	private async applyOpenAccount(
		currentFile: TFile,
		fix: Extract<QuickFix, { kind: 'open-account' }>
	): Promise<void> {
		const target = this.app.vault.getFiles().find((entry) => entry.path === fix.path) ?? currentFile;
		const editor = openEditorFor(this.app, target);
		const text = editor ? editor.getValue() : await this.app.vault.read(target);
		const lines = text.split('\n');
		const edit = insertOpenDirective(lines, fix.date, fix.account, fix.commodity);
		if (editor) {
			applyEditorEdit(editor, edit);
			return;
		}
		const line = lines[edit.line] ?? '';
		lines[edit.line] = line.slice(0, edit.fromCh) + edit.text + line.slice(edit.toCh);
		await this.app.vault.modify(target, lines.join('\n'));
	}

	private onFileModified(file: TAbstractFile): void {
		if (!isTextFile(file)) return;
		const { extension } = file;
		if (this.settings.alignOnSave) this.scheduleAlign(file);
		if (isLedgerFile({ extension }) || extension === 'md') {
			this.validation.handle({ kind: 'saved', file: fileRef(file) });
		}
	}

	private onFileOpened(file: TFile | null): void {
		if (!file) return;
		const ledger = isLedgerFile({ extension: file.extension });
		if (!ledger && file.extension !== 'md') return;
		const ref = fileRef(file);
		if (ledger) {
			this.validation.handle({ kind: 'opened', file: ref, text: '' });
			return;
		}
		const editor = openEditorFor(this.app, file);
		if (editor) {
			this.validation.handle({ kind: 'opened', file: ref, text: editor.getValue() });
			return;
		}
		void this.app.vault.read(file).then(
			(body) => this.validation.handle({ kind: 'opened', file: ref, text: body }),
			() => undefined,
		);
	}

	private vaultPort(): VaultPort {
		return {
			read: async (path) => {
				const located = this.app.vault.getAbstractFileByPath(path);
				if (!isVaultFile(located)) throw new Error(`missing ${path}`);
				return this.app.vault.read(located);
			},
			files: () => this.app.vault.getFiles().map((entry) => fileRef(entry)),
			byPath: (path) => {
				const located = this.app.vault.getAbstractFileByPath(path);
				return isVaultFile(located) ? fileRef(located) : undefined;
			},
			resolveInVault: (vaultRel) => resolveInVault(this.vaultRootPath(), vaultRel),
			vaultRoot: () => this.vaultRootPath(),
		};
	}

	private vaultRootPath(): string {
		return vaultRoot((this.app.vault.adapter as FileSystemAdapter).getBasePath());
	}

	private markerSink(): MarkerSink {
		return {
			setBean: (path, diagnostics) => {
				const located = this.app.vault.getAbstractFileByPath(path);
				if (!isVaultFile(located)) return;
				for (const editor of openEditorsFor(this.app, located)) {
					setEditorBeanDiagnostics(editor, diagnostics);
				}
			},
		};
	}

	private scheduleAlign(file: TFile): void {
		window.clearTimeout(this.alignTimers.get(file.path));
		this.alignTimers.set(
			file.path,
			window.setTimeout(() => {
				this.alignTimers.delete(file.path);
				// The setting may have been toggled off while waiting; a file
				// that vanished (or a write that failed) is not worth a retry.
				if (!this.settings.alignOnSave) return;
				this.alignFile(file).catch(() => undefined);
			}, ALIGN_DEBOUNCE_MS)
		);
	}

	private async alignFile(file: TFile): Promise<void> {
		// A file open in a leaf is edited through its editor: the editor buffer
		// is what Obsidian autosaves, so a vault-level write would be clobbered
		// by the next autosave from the still-unaligned buffer. Files not open
		// in any leaf have no buffer to fight with.
		const editor = openEditorFor(this.app, file);
		const column = alignmentTarget(this.settings.separatorColumn);
		if (editor) {
			// The on-save walk aligns every transaction block of the buffer.
			alignOpenEditor(editor, file, column);
			return;
		}
		const text = await this.app.vault.read(file);
		const aligned = isLedgerFile(file) ? alignText(text, column) : alignFencedDocument(text, column);
		if (aligned === text) return;
		// The file may have been opened — or edited — while the read was in
		// flight. An open one is the editor's business again, and a changed
		// one is left alone: its own `modify` will bring alignment back here.
		// Write only on change — `vault.process` would write the unchanged
		// text back and re-arm the debounce forever.
		const live = openEditorFor(this.app, file);
		if (live) {
			alignOpenEditor(live, file, column);
			return;
		}
		if ((await this.app.vault.read(file)) !== text) return;
		await this.app.vault.modify(file, aligned);
	}
}
