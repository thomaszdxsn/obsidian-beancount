/**
 * Plugin settings and the settings tab that edits them. The tab talks to the
 * plugin through `SettingsHost` (state plus persistence) rather than importing
 * `main`, so the two modules never form a cycle.
 */
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

export interface BeancountSettings {
	/** Re-align posting amounts whenever a ledger file is saved. */
	alignOnSave: boolean;
	/** Path to the bean-check executable; empty takes `bean-check` from PATH. */
	beanCheckPath: string;
	/** Vault path of the ledger entry file; empty validates each saved file alone. */
	entryLedger: string;
}

export const DEFAULT_SETTINGS: BeancountSettings = {
	alignOnSave: false,
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
				'Vault path of the ledger entry file to validate — its whole include chain is checked — e.g. main.bean. Leave empty to validate each saved file on its own.'
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
