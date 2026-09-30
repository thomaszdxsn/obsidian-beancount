/**
 * Plugin settings and the settings tab that edits them. One setting today:
 * whether saving a ledger file re-aligns its posting amounts. The tab talks
 * to the plugin through `SettingsHost` (state plus persistence) rather than
 * importing `main`, so the two modules never form a cycle.
 */
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

export interface BeancountSettings {
	/** Re-align posting amounts whenever a ledger file is saved. */
	alignOnSave: boolean;
}

export const DEFAULT_SETTINGS: BeancountSettings = { alignOnSave: false };

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
			.setDesc('Re-align the decimal points of posting amounts whenever a ledger file is saved.')
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.alignOnSave).onChange(async (value) => {
					this.host.settings.alignOnSave = value;
					await this.host.saveSettings();
				})
			);
	}
}
