/**
 * Plugin settings and the settings tab that edits them. The tab talks to the
 * plugin through `SettingsHost` (state plus persistence) rather than importing
 * `main`, so the two modules never form a cycle.
 */
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem, SettingGroupItem } from 'obsidian';
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

type ToggleKey = {
	[K in keyof BeancountSettings]: BeancountSettings[K] extends boolean ? K : never;
}[keyof BeancountSettings];

interface SpecText {
	name: string;
	desc: string;
}

/**
 * One row of the settings tab. The same table drives the declarative
 * definitions Obsidian 1.13+ renders and searches, and the imperative
 * `display()` older versions call, so the two cannot drift.
 */
type SettingSpec = SpecText &
	(
		| { kind: 'toggle'; key: ToggleKey }
		| { kind: 'text'; key: 'beanCheckPath' | 'entryLedger' | 'favaPath'; placeholder: string }
		| {
				kind: 'int';
				key: 'separatorColumn' | 'favaPort';
				placeholder: string;
				/** Rejected input leaves the stored value unchanged. */
				accepts: (value: number) => boolean;
		  }
		| { kind: 'flag'; key: `flagWarnings.${string}`; flag: string }
	);

const FLAG_LEVEL_OPTIONS: Record<string, string> = { none: 'None', warning: 'Warning', error: 'Error' };

const SETTING_GROUPS: ReadonlyArray<{ heading: string; items: readonly SettingSpec[] }> = [
	{
		heading: 'Alignment',
		items: [
			{
				kind: 'toggle',
				key: 'alignOnSave',
				name: 'Align amounts on save',
				desc: 'Re-align the decimal points of posting amounts whenever a Markdown or Beancount file is saved.',
			},
			{
				kind: 'toggle',
				key: 'instantAlignment',
				name: 'Instant alignment',
				desc: 'When typing a decimal point in a posting amount, align that transaction block and keep the cursor after the point.',
			},
			{
				kind: 'int',
				key: 'separatorColumn',
				name: 'Separator column',
				desc: '1-based column the decimal point jumps to during instant alignment. Wide accounts still push past it.',
				placeholder: '50',
				accepts: (column) => column >= 1,
			},
			{
				kind: 'toggle',
				key: 'showRuler',
				name: 'Show separator ruler',
				desc: 'Draw a dotted vertical line at the separator column in .bean and .beancount files.',
			},
		],
	},
	{
		heading: 'Validation',
		items: [
			{
				kind: 'text',
				key: 'beanCheckPath',
				name: 'Bean-check executable',
				desc: 'Path to bean-check; leave empty to run `bean-check` from PATH. Install beancount with `pip install beancount`.',
				placeholder: 'bean-check',
			},
			{
				kind: 'text',
				key: 'entryLedger',
				name: 'Entry ledger',
				desc: 'Vault path of the ledger entry file. Saving a .bean file checks that file’s whole include chain. Saving a markdown note with ```beancount / ```bean fences checks those fences: with an entry ledger they are validated as if included after it (opens and accounts apply); without one, the fences are checked on their own. Leave empty to validate each saved ledger file on its own.',
				placeholder: 'main.bean',
			},
			{
				kind: 'toggle',
				key: 'inlayHints',
				name: 'Balance inlay hints',
				desc: 'Show the single-commodity difference (asserted minus accumulated) at the end of balance lines. Hidden when an entry ledger is set, because postings outside this file are unknown.',
			},
		],
	},
	{
		heading: 'Completion',
		items: [
			{
				kind: 'toggle',
				key: 'completePayee',
				name: 'Complete payees',
				desc: 'Typing the first quoted field of a transaction line (2026-09-30 * "Am…) suggests payees found in the vault.',
			},
			{
				kind: 'toggle',
				key: 'payeeAutofill',
				name: 'Autofill payee postings',
				desc: "Picking a payee inserts the postings of that payee's most recent transaction when the entry has none yet. Amounts are selected so the next numbers can be typed; Tab moves between them.",
			},
			{
				kind: 'toggle',
				key: 'completeNarration',
				name: 'Complete narrations',
				desc: 'Typing the second quoted field of a transaction line ("payee" "na…) suggests narrations found in the vault, and picking one closes the field.',
			},
			{
				kind: 'toggle',
				key: 'pinyinMatching',
				name: 'Pinyin initials matching',
				desc: 'Also match payees, narrations and accounts by pinyin initials: `餐饮` completes from `cy`, and `Expenses:餐饮` from `Expenses:cy`. Direct matches still rank first.',
			},
		],
	},
	{
		heading: 'Fava',
		items: [
			{
				kind: 'text',
				key: 'favaPath',
				name: 'Fava executable',
				desc: 'Path to Fava; leave empty to run `fava` from PATH. Only a program named `fava` is accepted.',
				placeholder: 'fava',
			},
			{
				kind: 'int',
				key: 'favaPort',
				name: 'Fava port',
				desc: 'TCP port Fava binds on 127.0.0.1. Default 5000.',
				placeholder: String(DEFAULT_FAVA_PORT),
				accepts: (port) => port >= 1 && port <= 65535,
			},
			{
				kind: 'toggle',
				key: 'runFavaOnActivate',
				name: 'Run Fava on activate',
				desc: 'Start Fava against the entry ledger (or the active ledger file) when the plugin loads.',
			},
		],
	},
	{
		heading: 'Flag warnings',
		items: [
			{
				kind: 'flag',
				key: 'flagWarnings.!',
				flag: '!',
				name: 'Incomplete transactions (!)',
				desc: 'Marker style for transactions flagged `!`. Default: warning.',
			},
			{
				kind: 'flag',
				key: 'flagWarnings.*',
				flag: '*',
				name: 'Cleared transactions (*)',
				desc: 'Marker style for transactions flagged `*` or `txn`. Default: none.',
			},
		],
	},
];

const SPEC_BY_KEY = new Map<string, SettingSpec>(
	SETTING_GROUPS.flatMap((group) => group.items.map((spec): [string, SettingSpec] => [spec.key, spec]))
);

/** The value a control shows: text inputs and dropdowns take strings. */
function readSetting(settings: BeancountSettings, spec: SettingSpec): boolean | string {
	switch (spec.kind) {
		case 'toggle':
			return settings[spec.key];
		case 'text':
			return settings[spec.key];
		case 'int':
			return String(settings[spec.key]);
		case 'flag':
			return settings.flagWarnings[spec.flag] ?? 'none';
	}
}

/** Store a control's new value; `false` when the input is rejected. */
function writeSetting(settings: BeancountSettings, spec: SettingSpec, value: unknown): boolean {
	switch (spec.kind) {
		case 'toggle':
			if (typeof value !== 'boolean') return false;
			settings[spec.key] = value;
			return true;
		case 'text':
			if (typeof value !== 'string') return false;
			settings[spec.key] = value;
			return true;
		case 'int': {
			const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
			if (!Number.isInteger(parsed) || !spec.accepts(parsed)) return false;
			settings[spec.key] = parsed;
			return true;
		}
		case 'flag': {
			const level: FlagWarningLevel = value === 'warning' || value === 'error' ? value : null;
			settings.flagWarnings[spec.flag] = level;
			return true;
		}
	}
}

function controlDefinition(spec: SettingSpec): SettingGroupItem {
	const { name, desc, key } = spec;
	switch (spec.kind) {
		case 'toggle':
			return { name, desc, control: { type: 'toggle', key } };
		case 'text':
		case 'int':
			return { name, desc, control: { type: 'text', key, placeholder: spec.placeholder } };
		case 'flag':
			return { name, desc, control: { type: 'dropdown', key, options: FLAG_LEVEL_OPTIONS } };
	}
}

export class BeancountSettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;

	constructor(app: App, plugin: Plugin & SettingsHost) {
		super(app, plugin);
		// Read settings through the host contract, not `Plugin.settings`
		// (an Obsidian 1.13 declaration this plugin does not depend on).
		this.host = plugin;
	}

	/** Obsidian 1.13+: renders and indexes the tab for settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return SETTING_GROUPS.map((group) => ({
			type: 'group',
			heading: group.heading,
			items: group.items.map(controlDefinition),
		}));
	}

	getControlValue(key: string): unknown {
		const spec = SPEC_BY_KEY.get(key);
		return spec ? readSetting(this.host.settings, spec) : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const spec = SPEC_BY_KEY.get(key);
		if (!spec || !writeSetting(this.host.settings, spec, value)) return;
		await this.host.saveSettings();
	}

	/** Obsidian before 1.13 renders the same table imperatively. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const group of SETTING_GROUPS) {
			new Setting(containerEl).setName(group.heading).setHeading();
			for (const spec of group.items) {
				const setting = new Setting(containerEl).setName(spec.name).setDesc(spec.desc);
				const value = readSetting(this.host.settings, spec);
				const save = (next: unknown) => this.setControlValue(spec.key, next);
				switch (spec.kind) {
					case 'toggle':
						setting.addToggle((toggle) => toggle.setValue(value === true).onChange(save));
						break;
					case 'text':
					case 'int':
						setting.addText((text) => text.setPlaceholder(spec.placeholder).setValue(String(value)).onChange(save));
						break;
					case 'flag':
						setting.addDropdown((dropdown) => dropdown.addOptions(FLAG_LEVEL_OPTIONS).setValue(String(value)).onChange(save));
						break;
				}
			}
		}
	}
}
