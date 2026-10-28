import { Menu, Notice, Plugin } from 'obsidian';
import type { App, Editor, FileSystemAdapter, MarkdownView, PluginManifest, TAbstractFile, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { isLedgerFile, ledgerKind } from './fences';
import { formatErrorNotice } from './format';
import {
	AlignOnSave,
	bindAlignOnSaveOpenEditor,
	maybeScheduleAlign,
	runAlignCommand,
	runFormatCommand,
} from './edits';
import { openEditorFor, openEditorsFor } from './open-editors';
import { beancountMode } from './beancount-mode';
import { AccountSuggest } from './account-suggest';
import { accountHoverTooltip } from './account-hover';
import type { BeanCheckRunner } from './bean-check';
import { runBeanCheck } from './bean-check';
import { flagOkayEdit, insertOpenDirective, padEdit, quickFixesForLine } from './code-actions';
import type { QuickFix, TextEdit } from './code-actions';
import { beanDiagnostics, createDiagnosticsExtension, flagOkayDiagnostics, setEditorBeanDiagnostics } from './diagnostics';
import type { DiagnosticClickHost } from './diagnostics';
import {
	FAVA_CLOSE_TIMEOUT_MS,
	FAVA_READY_TIMEOUT_MS,
	FavaProcess,
	openFavaUrl,
	probeFavaUrl,
	resolveFavaLedger,
	runFavaProcess,
} from './fava';
import type { FavaStartRequest } from './fava';
import { FlagWarningController } from './flag-warnings';
import { BalanceInlayController } from './inlay-hints';
import { insertTodayDate } from './insert-date';
import { LedgerIndex } from './ledger-index';
import { PayeeSuggest } from './payee-suggest';
import { SnippetSession, SnippetSuggest, snippetTabExtension } from './snippet-suggest';
import { CommoditySuggest, LinkSuggest, NarrationSuggest, TagSuggest } from './token-suggest';
import { transactionFoldExtension } from './transaction-fold';
import { postingIndentExtension } from './posting-indent';
import { PopoverOpen } from './slot';
import { fenceLanguageExtension } from './fence-language';
import { includeLinksExtension } from './include-links';
import { LedgerFileController } from './ledger-file-view';
import { BeancountOutlineView, revealOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { BeancountProblemsView, revealProblemsView, VIEW_TYPE_PROBLEMS } from './problems-view';
import { BeancountBalancesView, revealBalancesView, VIEW_TYPE_BALANCES } from './report-view';
import { fileMtime } from './problems';
import { instantAlignmentExtension } from './instant-alignment';
import { isTextFile } from './vault-index';
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


/** A vault file, not a folder: folders have no `extension` to stamp an mtime on. */
function isVaultFile(file: TAbstractFile | null): file is TFile {
	return !!file && 'extension' in file && typeof file.extension === 'string';
}

function fileRef(file: TFile): FileRef {
	return { path: file.path, extension: file.extension, mtime: fileMtime(file) };
}


function applyEditorEdit(editor: Editor, edit: TextEdit): void {
	editor.transaction({
		changes: [{ from: { line: edit.line, ch: edit.fromCh }, to: { line: edit.line, ch: edit.toCh }, text: edit.text }],
	});
}

export default class BeancountPlugin extends Plugin implements DiagnosticClickHost {
	constructor(app: App, manifest: PluginManifest, private readonly clock: Clock = systemClock) {
		super(app, manifest);
	}

	settings: BeancountSettings = { ...DEFAULT_SETTINGS };
	/** How `bean-check` is started; tests swap in their own runner. */
	beanCheckRunner: BeanCheckRunner = runBeanCheck;
	private validation!: LedgerValidation;
	private ledger!: LedgerIndex;
	/** On-save alignment; own timer map, same Clock as validation. */
	private onSaveAlign!: AlignOnSave;
	/** Balance-assertion deltas; refreshed when the settings that gate them change. */
	private readonly balanceInlays = new BalanceInlayController(this);
	/** Transaction-flag markers; refreshed when flagWarnings change. */
	private readonly flagWarnings = new FlagWarningController(this);
	/** Ledger-file token colors and the separator ruler; refreshed with those settings. */
	private readonly ledgerFile = new LedgerFileController(this);
	/** Fava child lifecycle; tests assign a process with fake ports before onload. */
	fava!: FavaProcess;
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
		this.onSaveAlign = new AlignOnSave({
			clock: this.clock,
			read: async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!isVaultFile(file)) throw new Error('missing');
				return this.app.vault.read(file);
			},
			modify: async (path, text) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!isVaultFile(file)) return;
				await this.app.vault.modify(file, text);
			},
			openEditor: bindAlignOnSaveOpenEditor({
				getFile: (path) => {
					const located = this.app.vault.getAbstractFileByPath(path);
					return isVaultFile(located) ? located : null;
				},
				findEditor: (path) => openEditorFor(this.app.workspace, { path }),
			}),
			alignOnSave: () => this.settings.alignOnSave,
			separatorColumn: () => this.settings.separatorColumn,
			ledgerKind: (file) => ledgerKind(file),
		});
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
		this.ledger = new LedgerIndex(this.usage, () => this.settings.pinyinMatching);
		this.ledger.applyVault(this);
		const snippetSession = new SnippetSession();
		const accountSuggest = new AccountSuggest(this.app, this.ledger.accounts);
		const payeeSuggest = new PayeeSuggest(this.app, this.ledger.payees, () => this.settings.completePayee, {
			enabled: () => this.settings.payeeAutofill,
			templateFor: (payee) => {
				const template = this.ledger.templateFor(payee);
				return template !== null && template.postings.length > 0 ? template.postings : null;
			},
			session: snippetSession,
		});
		const commoditySuggest = new CommoditySuggest(this.app, this.ledger.commodities);
		const tagSuggest = new TagSuggest(this.app, this.ledger.tags);
		const linkSuggest = new LinkSuggest(this.app, this.ledger.links);
		const narrationSuggest = new NarrationSuggest(this.app, this.ledger.narrations, () => this.settings.completeNarration);
		const snippetSuggest = new SnippetSuggest(this.app, snippetSession);
		this.registerEditorSuggest(accountSuggest);
		this.registerEditorSuggest(payeeSuggest);
		this.registerEditorSuggest(commoditySuggest);
		this.registerEditorSuggest(tagSuggest);
		this.registerEditorSuggest(linkSuggest);
		this.registerEditorSuggest(narrationSuggest);
		this.registerEditorSuggest(snippetSuggest);
		const popovers = new PopoverOpen();
		popovers.add(accountSuggest);
		popovers.add(payeeSuggest);
		popovers.add(commoditySuggest);
		popovers.add(tagSuggest);
		popovers.add(linkSuggest);
		popovers.add(narrationSuggest);
		popovers.add(snippetSuggest);
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
		this.registerEditorExtension(accountHoverTooltip(this.ledger.accounts));
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
				runAlignCommand(editor, ctx?.file ?? null, this.settings.separatorColumn),
		});
		this.addCommand({
			id: 'format-ledger',
			name: 'Format ledger',
			editorCallback: (editor, ctx) =>
				runFormatCommand(editor, ctx?.file ?? null, this.settings.separatorColumn, (error) => {
					new Notice(formatErrorNotice(error));
				}),
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
		this.fava ??= new FavaProcess(
			{
				runner: runFavaProcess,
				opener: openFavaUrl,
				probe: probeFavaUrl,
				delay: (ms) => new Promise((r) => window.setTimeout(r, ms)),
				notify: (text) => new Notice(text),
				resolveLedger: (entryLedger, activePath) =>
					resolveFavaLedger(this.vaultRootPath(), entryLedger, activePath),
			},
			{ readyMs: FAVA_READY_TIMEOUT_MS, closeMs: FAVA_CLOSE_TIMEOUT_MS },
		);
		this.addCommand({
			id: 'start-fava',
			name: 'Start Fava',
			callback: () => void this.fava.start(this.favaRequest(true)),
		});
		this.addCommand({
			id: 'stop-fava',
			name: 'Stop Fava',
			callback: () => this.fava.stop(),
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
			this.onSaveAlign.dispose();
			this.balanceInlays.destroy();
			this.flagWarnings.destroy();
			this.ledgerFile.destroy();
			this.fava.dispose();
		});
		if (this.settings.runFavaOnActivate) {
			this.app.workspace.onLayoutReady(() => void this.fava.start(this.favaRequest(false)));
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

	private favaRequest(announce: boolean): FavaStartRequest {
		return {
			announce,
			command: this.settings.favaPath.trim() || 'fava',
			port: this.settings.favaPort,
			entryLedger: this.settings.entryLedger,
			activePath: this.app.workspace.getActiveFile()?.path ?? null,
		};
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
		const openFile = this.ledger.bestOpenFile() ?? (isLedgerFile(file) ? file.path : null);
		const fixes = quickFixesForLine({
			lines,
			line,
			message: diagnostic.message,
			pairings: this.ledger.pairings(),
			openFile,
			openedAccounts: openFile ? this.ledger.openedIn(openFile) : new Set(),
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
			const edit = padEdit(lines, line, this.ledger.pairings(), message);
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
		const editor = openEditorFor(this.app.workspace, target);
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
		if (this.settings.alignOnSave) maybeScheduleAlign(this.onSaveAlign, file);
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
		const editor = openEditorFor(this.app.workspace, file);
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
				for (const editor of openEditorsFor(this.app.workspace, located)) {
					setEditorBeanDiagnostics(editor, diagnostics);
				}
			},
		};
	}


}
