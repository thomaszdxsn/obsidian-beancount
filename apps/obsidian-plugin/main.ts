import { Notice, Plugin } from 'obsidian';
import type { App, Editor, FileSystemAdapter, MarkdownView, TAbstractFile, TFile } from 'obsidian';
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
import type { BeanCheckError, BeanCheckRunner } from './bean-check';
import {
	clipText,
	isBeanCheckBinary,
	matchesVaultFile,
	parseBeanCheckErrors,
	runBeanCheck,
	toLineDiagnostics,
} from './bean-check';
import { diagnosticsExtension, setEditorLineDiagnostics } from './diagnostics';
import { FAVA_HOST, FAVA_URL, isFavaBinary, runFavaProcess } from './fava';
import type { FavaRunner } from './fava';
import { FlagWarningController } from './flag-warnings';
import { BalanceInlayController } from './inlay-hints';
import { buildFenceLedger, extractBeancountFences, isSafeIncludePath } from './fences';
import type { BeancountFence } from './fences';
import { insertTodayDate } from './insert-date';
import { extractPayees } from './payee-index';
import { PayeeSuggest } from './payee-suggest';
import { SnippetSession, SnippetSuggest, snippetTabExtension } from './snippet-suggest';
import { extractCommodities, extractLinks, extractNarrations, extractTags } from './token-index';
import { CommoditySuggest, LinkSuggest, NarrationSuggest, TagSuggest } from './token-suggest';
import { postingIndentExtension } from './posting-indent';
import { fenceLanguageExtension } from './fence-language';
import { BeancountOutlineView, revealOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { instantAlignmentExtension } from './instant-alignment';
import { isLedgerFile, isTextFile, registerVaultIndex, VaultIndex } from './vault-index';
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
const host = globalThis as { CodeMirror?: CmModeRegistry };

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

export default class BeancountPlugin extends Plugin {
	settings: BeancountSettings = { ...DEFAULT_SETTINGS };
	/** How `bean-check` is started; tests swap in their own runner. */
	beanCheckRunner: BeanCheckRunner = runBeanCheck;
	/** Pending on-save alignment per file path. */
	private readonly alignTimers = new Map<string, NodeJS.Timeout>();
	/** Pending on-save validation per run target. */
	private readonly validateTimers = new Map<string, NodeJS.Timeout>();
	/** Which run (its target path) last marked each vault file, so its next run clears them. */
	private readonly markOwners = new Map<string, string>();
	/** Newest run per target; older runs finishing later must not report. */
	private readonly validateSeq = new Map<string, number>();
	/** False after cleanup; in-flight bean-check must not publish. */
	private validateLive = true;
	/** Notice texts shown this session: autosave must not stack them. */
	private readonly noticesShown = new Set<string>();
	/** Balance-assertion deltas; refreshed when the settings that gate them change. */
	private readonly balanceInlays = new BalanceInlayController(this);
	/** Transaction-flag markers; refreshed when flagWarnings change. */
	private readonly flagWarnings = new FlagWarningController(this);
	/** How Fava is started; tests swap in their own runner. */
	favaRunner: FavaRunner = runFavaProcess;
	/** Live Fava child, killed when the plugin unloads. */
	private favaChild: ChildProcess | null = null;

	async onload() {
		this.settings = mergeSettings(await this.loadData());
		// Ledger files open as notes: without this Obsidian shows them as
		// unsupported, and nothing of the plugin (completion, alignment,
		// validation) has an editor to work in. Registration is read at app
		// start — a changed mapping needs an Obsidian restart, not just a
		// plugin reload.
		this.registerExtensions(['bean', 'beancount'], 'markdown');
		const uninstall = installBeancountModes(host.CodeMirror);
		if (uninstall) this.register(uninstall);
		// One vault scan feeds every completion index.
		const accounts = new AccountIndex();
		const payees = new VaultIndex(extractPayees);
		// Markdown tags (`#project`), Obsidian block IDs (` ^abc123`) and
		// prose amounts (`- 10 GB`) collide with ledger token shapes, so on
		// notes these extractors see only the beancount fence bodies; ledger
		// files are scanned whole.
		const ledgerText = (path: string, content: string): string =>
			path.endsWith('.md')
				? extractBeancountFences(content)
						.map((fence) => fence.lines.join('\n'))
						.join('\n')
				: content;
		const commodities = new VaultIndex((content, path) => extractCommodities(ledgerText(path, content)));
		const tags = new VaultIndex((content, path) => extractTags(ledgerText(path, content)));
		const links = new VaultIndex((content, path) => extractLinks(ledgerText(path, content)));
		const narrations = new VaultIndex(extractNarrations);
		registerVaultIndex(this, accounts, payees, commodities, tags, links, narrations);
		const accountSuggest = new AccountSuggest(this.app, accounts);
		const payeeSuggest = new PayeeSuggest(this.app, payees, () => this.settings.completePayee);
		const commoditySuggest = new CommoditySuggest(this.app, commodities);
		const tagSuggest = new TagSuggest(this.app, tags);
		const linkSuggest = new LinkSuggest(this.app, links);
		const narrationSuggest = new NarrationSuggest(this.app, narrations, () => this.settings.completeNarration);
		const snippetSession = new SnippetSession();
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
		// plus a gutter dot, styled by `styles.css`.
		this.registerEditorExtension(diagnosticsExtension);
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
		this.addCommand({
			id: 'align-decimal-points',
			name: 'Align decimal points',
			editorCallback: alignCommand,
			// Instant alignment covers typing `.`; this chord is the command
			// until then. Obsidian has no default Mod+Shift+. binding.
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '.' }],
		});
		this.addCommand({
			id: 'insert-today-date',
			name: 'Insert today\'s date',
			editorCallback: insertTodayDate,
			// A default hotkey so the date is one chord away while typing; a
			// customized binding for this command wins over the default.
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'D' }],
		});
		// Ledger files have no markdown headings, so Obsidian's Outline pane
		// stays empty; this view is the jumpable txn/heading tree.
		this.registerView(VIEW_TYPE_OUTLINE, (leaf) => new BeancountOutlineView(leaf));
		this.addCommand({
			id: 'show-outline',
			name: 'Show outline',
			callback: () => revealOutlineView(this.app),
		});
		this.addCommand({
			id: 'run-fava',
			name: 'Run Fava',
			callback: () => {
				void this.launchFava(true);
			},
		});
		this.addSettingTab(new BeancountSettingTab(this.app, this));
		this.registerEvent(this.app.vault.on('modify', (file) => this.onFileModified(file)));
		this.register(() => {
			this.validateLive = false;
			this.validateSeq.clear();
			for (const timer of this.alignTimers.values()) clearTimeout(timer);
			this.alignTimers.clear();
			for (const timer of this.validateTimers.values()) clearTimeout(timer);
			this.validateTimers.clear();
			this.balanceInlays.destroy();
			this.flagWarnings.destroy();
			this.favaChild?.kill();
			this.favaChild = null;
		});
		if (this.settings.runFavaOnActivate) {
			this.app.workspace.onLayoutReady(() => void this.launchFava(false));
		}
	}

	onunload() {}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.balanceInlays.refresh();
		this.flagWarnings.refresh();
	}

	private async launchFava(announce: boolean): Promise<void> {
		if (this.favaChild && this.favaChild.exitCode === null) {
			if (announce) new Notice(`Fava is running at ${FAVA_URL}`);
			return;
		}
		const command = this.settings.favaPath.trim() || 'fava';
		if (!isFavaBinary(command)) {
			new Notice(MISSING_FAVA_NOTICE);
			return;
		}
		const requested = this.settings.entryLedger.trim() || this.app.workspace.getActiveFile()?.path || '';
		if (!requested.endsWith('.bean') && !requested.endsWith('.beancount')) {
			new Notice('No valid bean file is available.');
			return;
		}
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const root = vaultRoot(adapter.getBasePath());
		const confined = resolve(root, requested);
		const rel = relative(root, confined);
		if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
			new Notice('No valid bean file is available.');
			return;
		}
		const result = await this.favaRunner(command, ['-H', FAVA_HOST, confined]);
		if (result.missing) {
			new Notice(MISSING_FAVA_NOTICE);
			return;
		}
		this.favaChild = result.child ?? null;
		if (this.favaChild) {
			this.favaChild.once('exit', () => {
				this.favaChild = null;
			});
		}
		if (announce) new Notice(`Fava is running at ${FAVA_URL}`);
	}

	private onFileModified(file: TAbstractFile): void {
		if (!isTextFile(file)) return;
		const { extension } = file;
		if (this.settings.alignOnSave) this.scheduleAlign(file);
		// Ledger files, and markdown notes that may hold ```beancount fences.
		if (isLedgerFile(file) || extension === 'md') this.scheduleValidate(file);
	}

	private scheduleAlign(file: TFile): void {
		clearTimeout(this.alignTimers.get(file.path));
		this.alignTimers.set(
			file.path,
			setTimeout(() => {
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
		clearTimeout(this.validateTimers.get(target));
		this.validateTimers.set(
			target,
			setTimeout(() => {
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
		const errorsByPath = new Map<string, BeanCheckError[]>();
		const unmapped: BeanCheckError[] = [];
		for (const error of errors) {
			// Reports name files by the real paths their loader resolved; a
			// file outside the vault matches nothing and drops to `unmapped`.
			const match = vaultFiles.find((entry) => matchesVaultFile(error.file, entry.path, root));
			if (!match) {
				unmapped.push(error);
				continue;
			}
			const list = errorsByPath.get(match.path) ?? [];
			list.push(error);
			errorsByPath.set(match.path, list);
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
		for (const path of new Set([...reported, ...previouslyOwned, target])) {
			if (reported.has(path)) this.markOwners.set(path, target);
			else this.markOwners.delete(path);
			const vaultFile = vaultFiles.find((entry) => entry.path === path);
			// No editor, no markers: a background file is marked when it is
			// opened and its target is saved again.
			if (!vaultFile) continue;
			for (const editor of openEditorsFor(this.app, vaultFile)) {
				setEditorLineDiagnostics(editor, toLineDiagnostics(errorsByPath.get(path) ?? []));
			}
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
