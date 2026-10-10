import { Menu, Notice, Plugin } from 'obsidian';
import type { App, Editor, FileSystemAdapter, MarkdownView, TAbstractFile, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import type { ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { alignText, blockRangeAt, computeAlignment } from './align';
import type { LineRange } from './align';
import { beancountMode } from './beancount-mode';
import { AccountIndex } from './account-index';
import { AccountSuggest } from './account-suggest';
import { accountHoverTooltip } from './account-hover';
import type { BeanCheckError, BeanCheckRunner, LineDiagnostic } from './bean-check';
import {
	clipText,
	isBeanCheckBinary,
	matchesVaultFile,
	parseBeanCheckErrors,
	runBeanCheck,
	toLineDiagnostics,
} from './bean-check';
import {
	FLAGGED_MESSAGE,
	flagDiagnostics,
	flagDiagnosticsFromFences,
	flagOkayEdit,
	insertOpenDirective,
	mergeDiagnostics,
	OpenFileIndex,
	padEdit,
	PairingIndex,
	quickFixesForLine,
} from './code-actions';
import type { QuickFix, TextEdit } from './code-actions';
import { createDiagnosticsExtension, lineDiagnostics, setEditorLineDiagnostics } from './diagnostics';
import type { DiagnosticClickHost } from './diagnostics';
import { FAVA_HOST, favaUrl, isFavaBinary, normalizeFavaPort, openFavaUrl, runFavaProcess } from './fava';
import type { FavaOpener, FavaRunner } from './fava';
import { FlagWarningController } from './flag-warnings';
import { BalanceInlayController } from './inlay-hints';
import { buildFenceLedger, extractBeancountFences, isSafeIncludePath, ledgerSource } from './fences';
import type { BeancountFence } from './fences';
import { insertTodayDate } from './insert-date';
import { extractPayees } from './payee-index';
import { PayeeSuggest } from './payee-suggest';
import { PayeeTemplateIndex } from './payee-template';
import { SnippetSession, SnippetSuggest, snippetTabExtension } from './snippet-suggest';
import { extractCommodities, extractLinks, extractNarrations, extractTags } from './token-index';
import { CommoditySuggest, LinkSuggest, NarrationSuggest, TagSuggest } from './token-suggest';
import { postingIndentExtension } from './posting-indent';
import { fenceLanguageExtension } from './fence-language';
import { includeLinksExtension } from './include-links';
import { LedgerFileController } from './ledger-file-view';
import { BeancountOutlineView, revealOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { BeancountProblemsView, revealProblemsView, VIEW_TYPE_PROBLEMS } from './problems-view';
import { fileMtime, openValidationTarget, ProblemStore, toProblemRows } from './problems';
import { instantAlignmentExtension } from './instant-alignment';
import { isLedgerFile, isTextFile, registerVaultIndex, VaultIndex } from './vault-index';
import { CompletionUsage } from './completion-rank';
import { BeancountSettingTab, BeancountSettings, DEFAULT_SETTINGS, mergeSettings } from './settings';

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

const MISSING_BEAN_CHECK_NOTICE =
	'bean-check not found — install beancount (pip install beancount) or set the bean-check path in the plugin settings.';

const MISSING_FAVA_NOTICE =
	'fava not found — install fava (pip install fava) or set the Fava path in the plugin settings.';

/** Delay before on-save validation, so a burst of saves checks once. */
const VALIDATE_DEBOUNCE_MS = 500;
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

function openEditorFiles(app: App): Array<{ file: TFile; editor: Editor }> {
	const found: Array<{ file: TFile; editor: Editor }> = [];
	const add = (file: TFile | null | undefined, editor: Editor | null | undefined) => {
		if (!file || !editor) return;
		if (found.some((entry) => entry.editor === editor)) return;
		found.push({ file, editor });
	};
	const active = app.workspace.activeEditor;
	add(active?.file ?? null, active?.editor ?? null);
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view as MarkdownView | null;
		add(view?.file ?? null, view?.editor ?? null);
	}
	return found;
}

function flagsFor(path: string, text: string): LineDiagnostic[] {
	return path.endsWith('.md') ? flagDiagnosticsFromFences(extractBeancountFences(text)) : flagDiagnostics(text);
}

function beanDiagnosticsOn(editor: Editor): LineDiagnostic[] {
	const view = (editor as Editor & { cm?: EditorView }).cm;
	const field = view?.state?.field?.(lineDiagnostics);
	if (!field) return [];
	return field.filter((diagnostic) => diagnostic.message !== FLAGGED_MESSAGE);
}


/**
 * The vault base as bean-check reports files under it: the real path (its
 * loader resolves symlinks), `/`-separated, with a trailing slash.
 */
function vaultRoot(basePath: string): string {
	try {
		return realpathSync(basePath).replace(/\\/g, '/') + '/';
	} catch {
		// A base path that does not exist has no real path to resolve.
		return basePath.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
	}
}

/**
 * Whether a bean-check report names the temp fence ledger we handed it.
 * The tool prints the path it was given, or — rarely — the bare filename.
 */
function matchesTempFile(reported: string, absPath: string): boolean {
	const normalized = reported.replace(/\\/g, '/');
	return normalized === absPath.replace(/\\/g, '/') || normalized === 'fences.bean';
}

/** A vault file, not a folder: folders have no `extension` to stamp an mtime on. */
function isVaultFile(file: TAbstractFile | null): file is TFile {
	return !!file && 'extension' in file && typeof file.extension === 'string';
}

/**
 * Vault path bean-check's `reported` names, or undefined when it names nothing
 * in `filesByPath`. Same rule as `matchesVaultFile`: the report is `root + path`
 * or the bare path. When both name a different file, the earliest in `order` wins.
 * `root` is `/`-separated with a trailing slash, as `vaultRoot` returns it.
 */
function vaultPathForReported(
	reported: string,
	root: string,
	filesByPath: ReadonlyMap<string, { path: string }>,
	order: readonly { path: string }[],
): string | undefined {
	const normalized = reported.replace(/\\/g, '/');
	const rooted = normalized.startsWith(root) ? normalized.slice(root.length) : undefined;
	const rootedHit = rooted !== undefined && filesByPath.has(rooted) ? rooted : undefined;
	const bareHit = filesByPath.has(normalized) ? normalized : undefined;
	if (rootedHit !== undefined && bareHit !== undefined && rootedHit !== bareHit) {
		for (const entry of order) {
			if (matchesVaultFile(reported, entry.path, root)) return entry.path;
		}
	}
	return rootedHit ?? bareHit;
}

/** Every line of the editor, in order. */
function editorLines(editor: Editor): string[] {
	const lines: string[] = [];
	for (let line = 0; line < editor.lineCount(); line += 1) lines.push(editor.getLine(line));
	return lines;
}

/**
 * What the command aligns: the selected lines when there is a selection,
 * otherwise the transaction block the cursor sits in.
 */
function commandScope(editor: Editor, lines: readonly string[]): LineRange {
	if (!editor.somethingSelected()) return blockRangeAt(lines, editor.getCursor().line);
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
	return { from, to };
}

/**
 * Rewrite the gaps in `scope` (the whole buffer when omitted) so the decimal
 * points of each transaction block line up.
 */
function alignInEditor(editor: Editor, scope?: LineRange): void {
	const lines = editorLines(editor);
	const edits = computeAlignment(lines, scope);
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
function alignCommand(editor: Editor): void {
	alignInEditor(editor, commandScope(editor, editorLines(editor)));
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
	private readonly pairings = new PairingIndex();
	private readonly openFiles = new OpenFileIndex();
	/** Pending on-save alignment per file path. */
	private readonly alignTimers = new Map<string, number>();
	/** Pending on-save validation per run target. */
	private readonly validateTimers = new Map<string, number>();
	/**
	 * In-flight `validateFile` calls per target. A count, not a flag: an older
	 * run's `finally` must not clear a newer run still checking the same target.
	 */
	private readonly validateInFlight = new Map<string, number>();
	/** Which run (its target path) last marked each vault file, so its next run clears them. */
	private readonly markOwners = new Map<string, string>();
	/** Open files this extra loop last stamped with flag markers. */
	private readonly extraFlagged = new Set<string>();

	/** Newest run per target; older runs finishing later must not report. */
	private readonly validateSeq = new Map<string, number>();
	/** False after cleanup; in-flight bean-check must not publish. */
	private validateLive = true;
	/** mtime of each target when its last run reported; a later open at that mtime skips. */
	private readonly lastValidatedMtime = new Map<string, number>();
	/** Latest bean-check rows per target, including files that are not open. */
	private readonly problems = new ProblemStore();
	/**
	 * Entry ledger the stored rows were collected under. Compared in
	 * `saveSettings`: a change drops every target, because rows keyed by the
	 * old per-file targets would never be replaced by a later run.
	 */
	private problemsEntryLedger = '';
	/** Notice texts shown this session: autosave must not stack them. */
	private readonly noticesShown = new Set<string>();
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
	/** Live Fava child, killed when the plugin unloads. */
	private favaChild: ChildProcess | null = null;
	/** Port the live child was started with; reuse must open this URL. */
	private favaBoundPort: number | null = null;
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
		this.problemsEntryLedger = this.settings.entryLedger;
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
		// Markdown tags (`#project`), Obsidian block IDs (` ^abc123`), prose
		// amounts (`- 10 GB`) and colon-joined words (`PG_DATA_DIR:-x`) collide
		// with ledger token shapes, so on notes these extractors (and the
		// account index) see only the beancount fence bodies; ledger files are
		// scanned whole.
		const commodities = new VaultIndex((content, path) => extractCommodities(ledgerSource(path, content)), this.usage, pinyinMatching);
		const tags = new VaultIndex((content, path) => extractTags(ledgerSource(path, content)), this.usage, pinyinMatching);
		const links = new VaultIndex((content, path) => extractLinks(ledgerSource(path, content)), this.usage, pinyinMatching);
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
			editorCallback: alignCommand,
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
		this.registerView(VIEW_TYPE_PROBLEMS, (leaf) => new BeancountProblemsView(leaf, this.problems));
		this.addCommand({
			id: 'show-problems',
			name: 'Show problems',
			callback: () => revealProblemsView(this.app),
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
		// A deleted or renamed path is no longer a validation target. Rows
		// keyed by it would otherwise stay after the file is gone.
		this.registerEvent(this.app.vault.on('delete', (file) => this.dropValidation(file.path)));
		this.registerEvent(this.app.vault.on('rename', (_file, oldPath) => this.dropValidation(oldPath)));
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.onFileOpened(file);
			}),
		);
		this.register(() => {
			this.validateLive = false;
			this.validateSeq.clear();
			for (const timer of this.alignTimers.values()) window.clearTimeout(timer);
			this.alignTimers.clear();
			for (const timer of this.validateTimers.values()) window.clearTimeout(timer);
			this.validateTimers.clear();
			this.balanceInlays.destroy();
			this.flagWarnings.destroy();
			this.ledgerFile.destroy();
			this.favaChild?.kill();
			this.favaChild = null;
			this.favaBoundPort = null;
		});
		if (this.settings.runFavaOnActivate) {
			this.app.workspace.onLayoutReady(() => void this.launchFava(false));
		}
	}

	onunload() {}
	async saveSettings(): Promise<void> {
		const entryLedger = this.settings.entryLedger;
		const entryChanged = entryLedger !== this.problemsEntryLedger;
		await this.writePluginData();
		if (entryChanged) {
			this.problemsEntryLedger = entryLedger;
			this.problems.clear();
			this.lastValidatedMtime.clear();
			// A ledger run that started under the previous entry ledger must
			// not republish those rows when it finishes. Markdown fences are
			// their own target either way, so an in-flight note may still report.
			for (const [target, seq] of this.validateSeq) {
				if (target.endsWith('.md')) continue;
				this.validateSeq.set(target, seq + 1);
			}
		}
		this.balanceInlays.refresh();
		this.flagWarnings.refresh();
		this.ledgerFile.refresh();
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

	private revealFava(announce: boolean): void {
		if (!announce) return;
		const url = favaUrl(this.favaBoundPort ?? normalizeFavaPort(this.settings.favaPort));
		this.favaOpener(url);
		new Notice(`Fava is running at ${url}`);
	}

	private stopFava(): void {
		if (!this.isFavaRunning()) {
			this.favaChild = null;
			this.favaBoundPort = null;
			new Notice('Fava is not running.');
			return;
		}
		this.favaChild?.kill();
		this.favaChild = null;
		this.favaBoundPort = null;
		new Notice('Fava stopped.');
	}

	private async launchFava(announce: boolean): Promise<void> {
		if (this.isFavaRunning()) {
			this.revealFava(announce);
			return;
		}
		if (this.favaStart) {
			const started = await this.favaStart;
			if (started && this.isFavaRunning()) this.revealFava(announce);
			return;
		}
		this.favaStart = this.startFavaProcess();
		try {
			const started = await this.favaStart;
			if (started && this.isFavaRunning()) this.revealFava(announce);
		} finally {
			this.favaStart = null;
		}
	}

	private async startFavaProcess(): Promise<boolean> {
		const command = this.settings.favaPath.trim() || 'fava';
		if (!isFavaBinary(command)) {
			new Notice(MISSING_FAVA_NOTICE);
			return false;
		}
		const requested = this.settings.entryLedger.trim() || this.app.workspace.getActiveFile()?.path || '';
		if (!requested.endsWith('.bean') && !requested.endsWith('.beancount')) {
			new Notice('No valid bean file is available.');
			return false;
		}
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const root = vaultRoot(adapter.getBasePath());
		const confined = resolve(root, requested);
		const rel = relative(root, confined);
		if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
			new Notice('No valid bean file is available.');
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
		this.favaChild = child;
		this.favaBoundPort = port;
		child.once('exit', () => {
			if (this.favaChild === child) {
				this.favaChild = null;
				this.favaBoundPort = null;
			}
		});
		return true;
	}

	onDiagnosticClick(view: EditorView, line: number, event: MouseEvent): boolean {
		const located = this.editorFileForView(view);
		if (!located) return false;
		const diagnostic = view.state.field(lineDiagnostics).find((entry) => entry.line === line);
		if (!diagnostic) return false;
		const { editor, file } = located;
		const lines = editor.getValue().split('\n');
		const openFile = this.openFiles.bestFile() ?? (file.extension === 'md' ? null : file.path);
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
		// Ledger files, and markdown notes that may hold ```beancount fences.
		if (isLedgerFile(file) || extension === 'md') this.scheduleValidate(file);
	}

	/**
	 * Opening a ledger — or a note that holds a beancount fence — checks it
	 * the same way a save does. A target already validated at this mtime is
	 * a tab switch: bean-check must not run again until the file changes.
	 * Editors that were closed when that run finished still need its markers,
	 * so the skip republishes the stored report for the opened file.
	 */
	private onFileOpened(file: TFile | null): void {
		if (!file || !this.validateLive) return;
		// `isLedgerFile` is a type predicate to `TFile`. Called on `file` it
		// would narrow the false branch to `never`, so the check uses a copy.
		const ledger = isLedgerFile({ path: file.path, extension: file.extension });
		if (!ledger && file.extension !== 'md') return;
		const editor = ledger ? null : openEditorFor(this.app, file);
		if (ledger || editor) {
			this.scheduleOpenValidation(file, editor ? editor.getValue() : '');
			return;
		}
		void this.app.vault.read(file).then(
			(body) => {
				if (!this.validateLive) return;
				this.scheduleOpenValidation(file, body);
			},
			() => undefined,
		);
	}

	private scheduleOpenValidation(file: TFile, text: string): void {
		const entryLedger = this.settings.entryLedger.trim();
		const target = file.extension === 'md' ? file.path : entryLedger || file.path;
		// One lookup, not a scan of every vault file. A folder has no extension,
		// so it is not the TFile whose mtime a skip compares.
		const located = this.app.vault.getAbstractFileByPath(target);
		const targetFile = located && isVaultFile(located) ? located : undefined;
		const input = {
			path: file.path,
			extension: file.extension,
			text,
			entryLedger,
			targetMtime: fileMtime(targetFile),
			lastValidatedMtime: this.lastValidatedMtime.get(target),
		};
		// Null is also "not a ledger" and "prose, no fence". Asking again
		// without a recorded mtime is null only for those; an mtime skip
		// becomes the target. Stored rows are already host lines: fence runs
		// map temp-file lines before `markErrors` records them, and a markdown
		// note is its own target (not the entry ledger), so the same rows are
		// safe to republish. Do not skip the mapping by re-running bean-check.
		// A child save does not bump the entry ledger's mtime, so an open while
		// that re-check is debounced or in flight looks like a tab switch.
		// Replaying would stamp the previous run's line numbers over markers
		// that followed the edit, and skipping the schedule would leave the
		// open on that stale report.
		const recheck = this.validateTimers.has(target) || this.validateInFlight.has(target);
		if (openValidationTarget({ ...input, lastValidatedMtime: undefined }) === null) return;
		if (!recheck && openValidationTarget(input) === null) {
			this.replayStoredMarkers(file, target);
			return;
		}
		this.scheduleValidate(file);
	}

	/**
	 * Publish the last report's markers for `file` onto its open editors.
	 * `markErrors` only reaches editors that exist when the run finishes, so
	 * a child opened later — or a tab closed and reopened — would stay blank
	 * while Problems still lists the rows.
	 */
	private replayStoredMarkers(file: TFile, target: string): void {
		const rows = this.problems.rowsFor(target).filter((row) => row.vaultPath === file.path);
		const bean = toLineDiagnostics(
			rows.map((row) => ({ file: row.vaultPath ?? row.file, line: row.line, message: row.message })),
		);
		for (const editor of openEditorsFor(this.app, file)) {
			setEditorLineDiagnostics(
				editor,
				mergeDiagnostics(bean, flagsFor(file.path, editor.getValue())),
			);
		}
	}

	/**
	 * Forget `path` as a validation target. The next run reports under a new
	 * key, so the old rows and the mtime that would skip a re-check must go.
	 * An in-flight run for this path must not write them back.
	 */
	private dropValidation(path: string): void {
		this.problems.replace(path, []);
		this.lastValidatedMtime.delete(path);
		const pending = this.validateTimers.get(path);
		if (pending !== undefined) {
			window.clearTimeout(pending);
			this.validateTimers.delete(path);
		}
		const seq = this.validateSeq.get(path);
		if (seq !== undefined) this.validateSeq.set(path, seq + 1);
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

	private scheduleValidate(file: TFile): void {
		// Keyed by run target: with an entry ledger, saves of any member
		// ledger file are one run. Markdown notes keep their own window —
		// they check a temp file, not the entry ledger itself.
		const target = file.extension === 'md' ? file.path : this.settings.entryLedger.trim() || file.path;
		window.clearTimeout(this.validateTimers.get(target));
		this.validateTimers.set(
			target,
			window.setTimeout(() => {
				this.validateTimers.delete(target);
				this.validateFile(file).catch(() => undefined);
			}, VALIDATE_DEBOUNCE_MS)
		);
	}

	/**
	 * Run bean-check over the saved file — or over the entry ledger, when one
	 * is configured — and mark every line it complains about in the editors
	 * showing the files it reported. A markdown note is checked through a
	 * temp ledger of its fences, with lines mapped back onto the note.
	 */
	private async validateFile(file: TFile): Promise<void> {
		if (!this.validateLive) return;
		const markdown = file.extension === 'md';
		// An entry ledger turns a ledger-file save into a check of its whole
		// include chain. A markdown save always owns its own run: the fences
		// live in a temp file, even when the entry ledger is included first.
		const target = markdown ? file.path : this.settings.entryLedger.trim() || file.path;
		this.validateInFlight.set(target, (this.validateInFlight.get(target) ?? 0) + 1);
		try {
			const root = vaultRoot((this.app.vault.adapter as FileSystemAdapter).getBasePath());
			// Only the newest run for a target may report: bean-check speed varies
			// with its cache, and an older run finishing last must not overwrite
			// the newer report. Unload shares this gate: cleanup flips
			// `validateLive` so a started runner cannot publish after teardown.
			const seq = (this.validateSeq.get(target) ?? 0) + 1;
			this.validateSeq.set(target, seq);

			let fences: BeancountFence[] | undefined;
			if (markdown) {
				const text = await this.app.vault.read(file);
				if (!this.validateLive || this.validateSeq.get(target) !== seq) return;
				fences = extractBeancountFences(text);
				if (fences.length === 0) {
					this.markErrors(target, [], root);
					return;
				}
			}

			// Only the validator itself may run: the setting locates bean-check,
			// it must not name some other program to execute on the ledger.
			const command = this.settings.beanCheckPath.trim() || 'bean-check';
			if (!isBeanCheckBinary(command)) {
				this.notify(MISSING_BEAN_CHECK_NOTICE);
				return;
			}
			const entry = this.settings.entryLedger.trim();
			// Newlines/quotes in the setting would break out of the generated
			// `include "..."` line; reject them the same way as a path escape.
			if (entry && !isSafeIncludePath(entry)) {
				this.notify(`bean-check: entry ledger must be a vault file, not "${clipText(entry)}"`);
				return;
			}
			const confined = resolve(root, entry || file.path);
			// The entry-ledger setting must stay inside the vault: `..` or an
			// absolute path would point bean-check (and its quoted error text)
			// at some other file entirely.
			const rel = relative(root, confined);
			if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
				this.notify(`bean-check: entry ledger must be a vault file, not "${clipText(entry || file.path)}"`);
				return;
			}

			let includePath: string | undefined;
			if (markdown && entry) {
				try {
					const real = realpathSync(confined).replace(/\\/g, '/');
					const realRel = relative(root, real);
					if (realRel === '' || realRel === '..' || realRel.startsWith('..' + sep) || isAbsolute(realRel)) {
						this.notify(`bean-check: entry ledger must be a vault file, not "${clipText(entry)}"`);
						return;
					}
					includePath = real;
				} catch {
					includePath = confined.replace(/\\/g, '/');
				}
			}

			let checkPath = confined;
			let cleanup: (() => void) | undefined;
			let hostLine: ((tempLine: number) => number | undefined) | undefined;
			try {
				if (markdown && fences) {
					const ledger = buildFenceLedger(fences, includePath);
					const dir = mkdtempSync(join(tmpdir(), 'obsidian-beancount-'));
					cleanup = () => rmSync(dir, { recursive: true, force: true });
					const temp = join(dir, 'fences.bean');
					writeFileSync(temp, ledger.text);
					checkPath = realpathSync(temp);
					hostLine = (line) => ledger.hostLine(line);
				}

				const run = await this.beanCheckRunner(command, [checkPath]);
				if (!this.validateLive || this.validateSeq.get(target) !== seq) return;
				if (run.missing) {
					this.notify(MISSING_BEAN_CHECK_NOTICE);
					return;
				}
				let errors = parseBeanCheckErrors(run.stderr);
				// stderr that parses to nothing is a broken bean-check (a traceback,
				// a hang cut short) — say so and keep the marks that are already up,
				// instead of clearing them for "clean".
				if (errors.length === 0 && (run.stderr.trim() !== '' || run.failure)) {
					this.notify(`bean-check ${run.failure ?? `failed: ${clipText(run.stderr.trim().split('\n')[0])}`}`);
					return;
				}
				if (hostLine) {
					const mapHost = hostLine;
					errors = errors.flatMap((error) => {
						if (error.file.startsWith('<')) return [error];
						if (!matchesTempFile(error.file, checkPath)) return [];
						const line = mapHost(error.line);
						if (line === undefined) return [];
						return [{ ...error, file: root + file.path, line }];
					});
				}
				this.markErrors(target, errors, root);
			} finally {
				cleanup?.();
			}
		} finally {
			const left = (this.validateInFlight.get(target) ?? 1) - 1;
			if (left > 0) this.validateInFlight.set(target, left);
			else this.validateInFlight.delete(target);
		}
	}

	/**
	 * Mark — or clear — the lines bean-check complained about, naming the run's
	 * `target` their owner: the target's next run replaces exactly these marks
	 * (a file that went quiet is cleared), and the target file itself is always
	 * in scope — its own save is the newest word on it, whoever marked it
	 * before. A file another target marked is left for that target's next run.
	 */
	private markErrors(target: string, errors: readonly BeanCheckError[], root: string): void {
		if (!this.validateLive) return;
		const vaultFiles = this.app.vault.getFiles();
		const filesByPath = new Map<string, TFile>();
		for (const entry of vaultFiles) {
			if (!filesByPath.has(entry.path)) filesByPath.set(entry.path, entry);
		}
		// One resolution per reported path, shared by the Problems rows and the
		// editor marks. A second linear scan per error would repeat the first.
		const vaultPathByReported = new Map<string, string | undefined>();
		const vaultPathFor = (reported: string): string | undefined => {
			if (vaultPathByReported.has(reported)) return vaultPathByReported.get(reported);
			const vaultPath = vaultPathForReported(reported, root, filesByPath, vaultFiles);
			vaultPathByReported.set(reported, vaultPath);
			return vaultPath;
		};
		this.problems.replace(target, toProblemRows(errors, vaultPathFor));
		const targetFile = filesByPath.get(target);
		const mtime = fileMtime(targetFile);
		if (mtime === undefined) this.lastValidatedMtime.delete(target);
		else this.lastValidatedMtime.set(target, mtime);
		const errorsByPath = new Map<string, BeanCheckError[]>();
		const unmapped: BeanCheckError[] = [];
		for (const error of errors) {
			// Reports name files by the real paths their loader resolved; a
			// file outside the vault matches nothing and drops to `unmapped`.
			const match = vaultPathFor(error.file);
			if (!match) {
				unmapped.push(error);
				continue;
			}
			const list = errorsByPath.get(match) ?? [];
			list.push(error);
			errorsByPath.set(match, list);
		}
		// What no editor can carry — a `<load>:0` failure (missing entry
		// ledger, broken include) or an error in a file outside the vault —
		// must not pass for a clean run, so the first of it becomes a notice.
		if (unmapped.length > 0) {
			this.notify(
				`bean-check: ${clipText(unmapped[0].file)}: ${clipText(unmapped[0].message)}`
			);
		}
		const reported = new Set(errorsByPath.keys());
		const previouslyOwned = [...this.markOwners.entries()]
			.filter(([, owner]) => owner === target)
			.map(([path]) => path);
		const published = new Set<string>();
		for (const path of new Set([...reported, ...previouslyOwned, target])) {
			if (reported.has(path)) this.markOwners.set(path, target);
			else this.markOwners.delete(path);
			const vaultFile = filesByPath.get(path);
			// No editor, no markers: a background file is marked when it is
			// opened and its target is saved again.
			if (!vaultFile) continue;
			published.add(path);
			for (const editor of openEditorsFor(this.app, vaultFile)) {
				setEditorLineDiagnostics(
					editor,
					mergeDiagnostics(toLineDiagnostics(errorsByPath.get(path) ?? []), flagsFor(path, editor.getValue()))
				);
			}
		}
		// Flag markers do not need bean-check: a clean journal under an entry
		// ledger is never `target`, so it would otherwise stay unmarked.
		for (const { file, editor } of openEditorFiles(this.app)) {
			if (published.has(file.path)) continue;
			const flags = flagsFor(file.path, editor.getValue());
			if (flags.length === 0) {
				if (!this.extraFlagged.has(file.path)) continue;
				this.extraFlagged.delete(file.path);
				// Another target owns bean-check marks: drop only FLAGGED.
				// Unpublished journals have flags only — an empty list is the
				// clear. Do not read `state.field` (Obsidian returns undefined).
				if (this.markOwners.has(file.path)) {
					setEditorLineDiagnostics(editor, beanDiagnosticsOn(editor));
				} else {
					setEditorLineDiagnostics(editor, []);
				}
				continue;
			}
			this.extraFlagged.add(file.path);
			setEditorLineDiagnostics(
				editor,
				mergeDiagnostics(beanDiagnosticsOn(editor), flags)
			);
		}
	}

	/**
	 * Show a notice once per session per text: with autosave, the same
	 * problem re-arms every few seconds and must not stack toasts.
	 */
	private notify(text: string): void {
		if (!this.validateLive) return;
		if (this.noticesShown.has(text)) return;
		this.noticesShown.add(text);
		new Notice(text);
	}

	private async alignFile(file: TFile): Promise<void> {
		// A file open in a leaf is edited through its editor: the editor buffer
		// is what Obsidian autosaves, so a vault-level write would be clobbered
		// by the next autosave from the still-unaligned buffer. Files not open
		// in any leaf have no buffer to fight with.
		const editor = openEditorFor(this.app, file);
		if (editor) {
			// The on-save walk aligns every transaction block of the buffer.
			alignInEditor(editor);
			return;
		}
		const text = await this.app.vault.read(file);
		const aligned = alignText(text);
		if (aligned === text) return;
		// The file may have been opened — or edited — while the read was in
		// flight. An open one is the editor's business again, and a changed
		// one is left alone: its own `modify` will bring alignment back here.
		// Write only on change — `vault.process` would write the unchanged
		// text back and re-arm the debounce forever.
		const live = openEditorFor(this.app, file);
		if (live) {
			alignInEditor(live);
			return;
		}
		if ((await this.app.vault.read(file)) !== text) return;
		await this.app.vault.modify(file, aligned);
	}
}
