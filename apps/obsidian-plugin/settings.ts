/**
 * Plugin settings and the settings tab that edits them. The tab talks to the
 * plugin through `SettingsHost` (state plus persistence) rather than importing
 * `main`, so the two modules never form a cycle.
 */
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_FLAG_WARNINGS } from './flag-warnings';
import type { FlagWarningLevel } from './flag-warnings';
import { DEFAULT_FAVA_PORT, normalizeFavaPort } from './fava';

export interface BeancountSettings {
	/** Re-align posting amounts whenever a ledger file is saved. */
	alignOnSave: boolean;
	/** Align the current transaction block when `.` is typed in an amount. */
	instantAlignment: boolean;
	/**
	 * 1-based display column of the decimal point for instant alignment.
	 * Matches vscode-beancount `beancount.separatorColumn`.
	 */
	separatorColumn: number;
	/** Dotted vertical line at `separatorColumn` in `.bean` / `.beancount` files. */
	showRuler: boolean;
	/** Path to the bean-check executable; empty takes `bean-check` from PATH. */
	beanCheckPath: string;
	/** Vault path of the ledger entry file; empty validates each saved file alone. */
	entryLedger: string;
	/**
	 * Show single-commodity balance assertion deltas at the end of balance lines.
	 * An entry ledger hides them: inventory outside this file is unknown.
	 */
	inlayHints: boolean;
	/** Complete the first quoted field of a transaction (payee). */
	completePayee: boolean;
	/**
	 * After picking a payee, insert the postings of that payee's most recent
	 * transaction when the entry has none yet. Amounts become Tab stops.
	 */
	payeeAutofill: boolean;
	/** Complete the narration field of a transaction (second quoted string). */
	completeNarration: boolean;
	/**
	 * Match payees, narrations and accounts by pinyin initials (`餐饮` from
	 * `cy`). Off leaves ranking as direct prefix, then subsequence.
	 */
	pinyinMatching: boolean;
	/** Path to the Fava executable; empty takes `fava` from PATH. */
	favaPath: string;
	/** TCP port Fava binds (`-p`); default 5000. */
	favaPort: number;
	/** Start Fava against the entry ledger when the plugin loads. */
	runFavaOnActivate: boolean;
	/**
	 * Per-flag marker style. `null` hides the flag; `warning` / `error` pick
	 * the CSS class. Defaults match vscode-beancount `beancount.flagWarnings`.
	 */
	flagWarnings: Record<string, FlagWarningLevel>;
}

export const DEFAULT_SETTINGS: BeancountSettings = {
	alignOnSave: false,
	instantAlignment: true,
	separatorColumn: 50,
	showRuler: true,
	beanCheckPath: '',
	entryLedger: '',
	inlayHints: true,
	completePayee: true,
	completeNarration: false,
	payeeAutofill: true,
	pinyinMatching: false,
	favaPath: '',
	favaPort: DEFAULT_FAVA_PORT,
	runFavaOnActivate: false,
	flagWarnings: { ...DEFAULT_FLAG_WARNINGS },
};

/** Fold stored `data.json` onto defaults, including the nested flag map. */
export function mergeSettings(stored: unknown): BeancountSettings {
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
		return { ...DEFAULT_SETTINGS, flagWarnings: { ...DEFAULT_FLAG_WARNINGS } };
	}
	const data: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
	delete data.completionUsage;
	const flagStored =
		data.flagWarnings && typeof data.flagWarnings === 'object' && !Array.isArray(data.flagWarnings)
			? data.flagWarnings
			: {};
	return {
		...DEFAULT_SETTINGS,
		...(data as Partial<BeancountSettings>),
		favaPort: normalizeFavaPort(data.favaPort ?? DEFAULT_SETTINGS.favaPort),
		flagWarnings: { ...DEFAULT_FLAG_WARNINGS, ...(flagStored as BeancountSettings['flagWarnings']) },
	};
}

/** What the settings tab needs from the plugin: state plus persistence. */
export interface SettingsHost {
	settings: BeancountSettings;
	saveSettings(): Promise<void>;
}

const FLAG_LEVEL_OPTIONS: Array<[string, FlagWarningLevel]> = [
	['None', null],
	['Warning', 'warning'],
	['Error', 'error'],
];

function parseFlagLevel(value: string): FlagWarningLevel {
	if (value === 'warning' || value === 'error') return value;
	return null;
}

export class BeancountSettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;

	constructor(app: App, plugin: Plugin & SettingsHost) {
		super(app, plugin);
		// Read settings through the host contract, not `Plugin.settings`
		// (an Obsidian 1.13 declaration this plugin does not depend on).
		this.host = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Alignment').setHeading();
		new Setting(containerEl)
			.setName('Align amounts on save')
			.setDesc('Re-align the decimal points of posting amounts whenever a Markdown or Beancount file is saved.')
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.alignOnSave).onChange(async (value) => {
					this.host.settings.alignOnSave = value;
					await this.host.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName('Instant alignment')
			.setDesc('When typing a decimal point in a posting amount, align that transaction block and keep the cursor after the point.')
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.instantAlignment).onChange(async (value) => {
					this.host.settings.instantAlignment = value;
					await this.host.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName('Separator column')
			.setDesc('1-based column the decimal point jumps to during instant alignment. Wide accounts still push past it.')
			.addText((text) =>
				text
					.setPlaceholder('50')
					.setValue(String(this.host.settings.separatorColumn))
					.onChange(async (value) => {
						const column = Number.parseInt(value, 10);
						if (!Number.isFinite(column) || column < 1) return;
						this.host.settings.separatorColumn = column;
						await this.host.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Show separator ruler')
			.setDesc('Draw a dotted vertical line at the separator column in .bean and .beancount files.')
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.showRuler).onChange(async (value) => {
					this.host.settings.showRuler = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl).setName('Validation').setHeading();
		new Setting(containerEl)
			.setName('Bean-check executable')
			.setDesc(
				'Path to bean-check; leave empty to run `bean-check` from PATH. Install beancount with `pip install beancount`.'
			)
			.addText((text) =>
				text
					.setPlaceholder('bean-check')
					.setValue(this.host.settings.beanCheckPath)
					.onChange(async (value) => {
						this.host.settings.beanCheckPath = value;
						await this.host.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Entry ledger')
			.setDesc(
				'Vault path of the ledger entry file. Saving a .bean file checks that file’s whole include chain. Saving a markdown note with ```beancount / ```bean fences checks those fences: with an entry ledger they are validated as if included after it (opens and accounts apply); without one, the fences are checked on their own. Leave empty to validate each saved ledger file on its own.'
			)
			.addText((text) =>
				text
					.setPlaceholder('main.bean')
					.setValue(this.host.settings.entryLedger)
					.onChange(async (value) => {
						this.host.settings.entryLedger = value;
						await this.host.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Balance inlay hints')
			.setDesc(
				'Show the single-commodity difference (asserted minus accumulated) at the end of balance lines. Hidden when an entry ledger is set, because postings outside this file are unknown.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.inlayHints).onChange(async (value) => {
					this.host.settings.inlayHints = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl).setName('Completion').setHeading();
		new Setting(containerEl)
			.setName('Complete payees')
			.setDesc(
				'Typing the first quoted field of a transaction line (2026-09-30 * "Am…) suggests payees found in the vault.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.completePayee).onChange(async (value) => {
					this.host.settings.completePayee = value;
					await this.host.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName('Autofill payee postings')
			.setDesc(
				'Picking a payee inserts the postings of that payee\'s most recent transaction when the entry has none yet. Amounts are selected so the next numbers can be typed; Tab moves between them.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.payeeAutofill).onChange(async (value) => {
					this.host.settings.payeeAutofill = value;
					await this.host.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName('Complete narrations')
			.setDesc(
				'Typing the second quoted field of a transaction line ("payee" "na…) suggests narrations found in the vault, and picking one closes the field.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.completeNarration).onChange(async (value) => {
					this.host.settings.completeNarration = value;
					await this.host.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName('Pinyin initials matching')
			.setDesc(
				'Also match payees, narrations and accounts by pinyin initials: `餐饮` completes from `cy`, and `Expenses:餐饮` from `Expenses:cy`. Direct matches still rank first.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.pinyinMatching).onChange(async (value) => {
					this.host.settings.pinyinMatching = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl).setName('Fava').setHeading();
		new Setting(containerEl)
			.setName('Fava executable')
			.setDesc('Path to Fava; leave empty to run `fava` from PATH. Only a program named `fava` is accepted.')
			.addText((text) =>
				text
					.setPlaceholder('fava')
					.setValue(this.host.settings.favaPath)
					.onChange(async (value) => {
						this.host.settings.favaPath = value;
						await this.host.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Fava port')
			.setDesc('TCP port Fava binds on 127.0.0.1. Default 5000.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_FAVA_PORT))
					.setValue(String(this.host.settings.favaPort))
					.onChange(async (value) => {
						const port = Number.parseInt(value, 10);
						if (!Number.isInteger(port) || port < 1 || port > 65535) return;
						this.host.settings.favaPort = port;
						await this.host.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Run Fava on activate')
			.setDesc('Start Fava against the entry ledger (or the active ledger file) when the plugin loads.')
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.runFavaOnActivate).onChange(async (value) => {
					this.host.settings.runFavaOnActivate = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl).setName('Flag warnings').setHeading();
		this.addFlagLevelSetting('!', 'Incomplete transactions (!)', 'Marker style for transactions flagged `!`. Default: warning.');
		this.addFlagLevelSetting('*', 'Cleared transactions (*)', 'Marker style for transactions flagged `*` or `txn`. Default: none.');
	}

	private addFlagLevelSetting(flag: string, name: string, desc: string): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown((dropdown) => {
				for (const [label, level] of FLAG_LEVEL_OPTIONS) {
					dropdown.addOption(level ?? 'none', label);
				}
				dropdown
					.setValue(this.host.settings.flagWarnings[flag] ?? 'none')
					.onChange(async (value) => {
						this.host.settings.flagWarnings[flag] = parseFlagLevel(value);
						await this.host.saveSettings();
					});
			});
	}
}
