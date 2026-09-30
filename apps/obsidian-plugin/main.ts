import { Notice, Plugin } from 'obsidian';
import type { App, Editor, FileSystemAdapter, MarkdownView, TAbstractFile, TFile } from 'obsidian';
import { join } from 'path';
import { alignText, blockRangeAt, computeAlignment } from './align';
import type { LineRange } from './align';
import { beancountMode } from './beancount-mode';
import { extractAccounts } from './account-index';
import { AccountSuggest } from './account-suggest';
import type { BeanCheckError, BeanCheckRunner } from './bean-check';
import { matchesVaultFile, parseBeanCheckErrors, runBeanCheck, toLineDiagnostics } from './bean-check';
import { diagnosticsExtension, setEditorLineDiagnostics } from './diagnostics';
import { insertTodayDate } from './insert-date';
import { extractPayees } from './payee-index';
import { PayeeSuggest } from './payee-suggest';
import { postingIndentExtension } from './posting-indent';
import { isLedgerFile, isTextFile, registerVaultIndex, VaultIndex } from './vault-index';
import { BeancountSettingTab, BeancountSettings, DEFAULT_SETTINGS } from './settings';

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

/** Delay before on-save validation, so a burst of saves checks once. */
const VALIDATE_DEBOUNCE_MS = 500;

/** The editor of a leaf showing `file`, if any. */
function openEditorFor(app: App, file: TFile): Editor | null {
	// The active editor answers for any leaf type; the scan covers other
	// markdown tabs (Obsidian opens text files like `.bean` there too).
	const active = app.workspace.activeEditor;
	if (active && active.file?.path === file.path && active.editor) return active.editor;
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view as MarkdownView | null;
		if (view && view.file?.path === file.path && view.editor) return view.editor;
	}
	return null;
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
	/** Pending on-save validation per file path. */
	private readonly validateTimers = new Map<string, NodeJS.Timeout>();
	/** Which run (its target path) last marked each vault file, so its next run clears them. */
	private readonly markOwners = new Map<string, string>();
	/** Whether the missing-bean-check hint has been shown this session. */
	private missingWarned = false;

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		const uninstall = installBeancountModes(host.CodeMirror);
		if (uninstall) this.register(uninstall);
		// One vault scan feeds both completion indexes.
		const accounts = new VaultIndex(extractAccounts);
		const payees = new VaultIndex(extractPayees);
		registerVaultIndex(this, accounts, payees);
		const accountSuggest = new AccountSuggest(this.app, accounts);
		const payeeSuggest = new PayeeSuggest(this.app, payees);
		this.registerEditorSuggest(accountSuggest);
		this.registerEditorSuggest(payeeSuggest);
		// Enter opens the next line of a beancount entry already indented;
		// the binding defers to the completion popovers while they are open.
		this.registerEditorExtension(postingIndentExtension([accountSuggest, payeeSuggest]));
		// The markers on lines bean-check complains about: inline underline
		// plus a gutter dot, styled by `styles.css`.
		this.registerEditorExtension(diagnosticsExtension);
		this.addCommand({
			id: 'align-decimal-points',
			name: 'Align decimal points',
			editorCallback: alignCommand,
		});
		this.addCommand({
			id: 'insert-today-date',
			name: 'Insert today\'s date',
			editorCallback: insertTodayDate,
			// A default hotkey so the date is one chord away while typing; a
			// customized binding for this command wins over the default.
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'D' }],
		});
		this.addSettingTab(new BeancountSettingTab(this.app, this));
		this.registerEvent(this.app.vault.on('modify', (file) => this.onFileModified(file)));
		this.register(() => {
			for (const timer of this.alignTimers.values()) clearTimeout(timer);
			this.alignTimers.clear();
			for (const timer of this.validateTimers.values()) clearTimeout(timer);
			this.validateTimers.clear();
		});
	}

	onunload() {}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private onFileModified(file: TAbstractFile): void {
		if (!isTextFile(file)) return;
		if (this.settings.alignOnSave) this.scheduleAlign(file);
		// Only ledger files reach bean-check; a markdown note is not one,
		// whatever it happens to contain.
		if (isLedgerFile(file)) this.scheduleValidate(file);
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
		clearTimeout(this.validateTimers.get(file.path));
		this.validateTimers.set(
			file.path,
			setTimeout(() => {
				this.validateTimers.delete(file.path);
				this.validateFile(file).catch(() => undefined);
			}, VALIDATE_DEBOUNCE_MS)
		);
	}

	/**
	 * Run bean-check over the saved file — or over the entry ledger, when one
	 * is configured — and mark every line it complains about in the editors
	 * showing the files it reported.
	 */
	private async validateFile(file: TFile): Promise<void> {
		// An entry ledger turns one run into a check of its whole include
		// chain; without one, the saved file is checked with whatever it
		// includes — both name the run that owns the resulting marks.
		const target = this.settings.entryLedger.trim() || file.path;
		const command = this.settings.beanCheckPath.trim() || 'bean-check';
		const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
		const run = await this.beanCheckRunner(command, [join(basePath, target)]);
		if (run.missing) {
			this.warnMissingBeanCheck();
			return;
		}
		this.markErrors(target, parseBeanCheckErrors(run.stderr));
	}

	/**
	 * Mark — or clear — the lines bean-check complained about, naming the run's
	 * `target` their owner: the target's next run replaces exactly these marks
	 * (a file that went quiet is cleared), and the target file itself is always
	 * in scope — its own save is the newest word on it, whoever marked it
	 * before. A file another target marked is left for that target's next run.
	 */
	private markErrors(target: string, errors: readonly BeanCheckError[]): void {
		const vaultFiles = this.app.vault.getFiles();
		const errorsByPath = new Map<string, BeanCheckError[]>();
		const unmapped: BeanCheckError[] = [];
		for (const error of errors) {
			// Reports name files by the real paths their loader resolved, so
			// the vault-relative path is matched at its end. The longest vault
			// path wins: `other/sub/a.bean` is not mistaken for the shorter
			// `sub/a.bean` it also ends with.
			const match = vaultFiles
				.filter((entry) => matchesVaultFile(error.file, entry.path))
				.sort((a, b) => b.path.length - a.path.length)[0];
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
			new Notice(`bean-check: ${unmapped[0].file}: ${unmapped[0].message}`);
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
			const editor = openEditorFor(this.app, vaultFile);
			if (editor) setEditorLineDiagnostics(editor, toLineDiagnostics(errorsByPath.get(path) ?? []));
		}
	}

	/** Hint once — bean-check missing is not news at every save. */
	private warnMissingBeanCheck(): void {
		if (this.missingWarned) return;
		this.missingWarned = true;
		new Notice(
			'bean-check not found — install beancount (pip install beancount) or set the bean-check path in the plugin settings.'
		);
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
