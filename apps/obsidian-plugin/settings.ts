/**
 * Plugin settings and the settings tab that edits them. The tab talks to the
 * plugin through `SettingsHost` (state plus persistence) rather than importing
 * `main`, so the two modules never form a cycle.
 */
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

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
	/** Path to the bean-check executable; empty takes `bean-check` from PATH. */
	beanCheckPath: string;
	/** Vault path of the ledger entry file; empty validates each saved file alone. */
	entryLedger: string;
}

export const DEFAULT_SETTINGS: BeancountSettings = {
	alignOnSave: false,
	instantAlignment: true,
	separatorColumn: 50,
	beanCheckPath: '',
	entryLedger: '',
};

/** What the settings tab needs from the plugin: state to edit, persistence. */
export interface SettingsHost {
	settings: BeancountSettings;
	saveSettings(): Promise<void>;
}

export class BeancountSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: Plugin & SettingsHost
	) {
		super(app, host);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName('Align amounts on save')
			.setDesc('Re-align the decimal points of posting amounts whenever a markdown or beancount file is saved.')
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
	}
}
