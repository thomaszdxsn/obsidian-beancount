/**
 * Runtime double for the `obsidian` npm package (which ships types only).
 * Records every UI/registration hook so tests can assert what a plugin
 * registers when it loads.
 */

export interface PluginCommand {
	id: string;
	name?: string;
	editorCallback?: (editor: unknown) => void;
}

export interface Registrations {
	commands: PluginCommand[];
	ribbonIcons: string[];
	statusBarItems: number;
	settingTabs: number;
	domEvents: number[];
	intervals: number[];
	events: unknown[];
	editorSuggests: unknown[];
	cleanups: Array<() => void>;
}

export class Plugin {
	readonly registrations: Registrations = {
		commands: [],
		ribbonIcons: [],
		statusBarItems: 0,
		settingTabs: 0,
		domEvents: [],
		intervals: [],
		events: [],
		editorSuggests: [],
		cleanups: [],
	};

	/** What the next `loadData` resolves; tests seed persisted settings here. */
	loadedData: unknown = null;
	readonly savedData: unknown[] = [];

	constructor(
		public app: unknown,
		public manifest: unknown
	) {}

	addCommand(command: PluginCommand): void {
		this.registrations.commands.push(command);
	}

	addRibbonIcon(icon: string): { addClass(className: string): void } {
		this.registrations.ribbonIcons.push(icon);
		return { addClass: () => undefined };
	}

	addStatusBarItem(): { setText(text: string): void } {
		this.registrations.statusBarItems += 1;
		return { setText: () => undefined };
	}

	addSettingTab(): void {
		this.registrations.settingTabs += 1;
	}

	register(callback: () => void): void {
		this.registrations.cleanups.push(callback);
	}

	registerDomEvent(): void {
		this.registrations.domEvents.push(1);
	}

	registerInterval(id: number): number {
		this.registrations.intervals.push(id);
		return id;
	}

	registerEvent(eventRef: unknown): void {
		this.registrations.events.push(eventRef);
	}

	registerEditorSuggest(editorSuggest: unknown): void {
		this.registrations.editorSuggests.push(editorSuggest);
	}

	async loadData(): Promise<unknown> {
		return this.loadedData;
	}

	async saveData(data: unknown): Promise<void> {
		this.savedData.push(data);
	}
}

export class Modal {}
export class Notice {}
export class MarkdownView {}
export class Editor {}

/** The toggle a `Setting.addToggle` callback configures. */
export interface FakeToggle {
	value: boolean;
	onChangeHandler: ((value: boolean) => unknown) | null;
	setValue(value: boolean): FakeToggle;
	onChange(callback: (value: boolean) => unknown): FakeToggle;
}

/** A recorded `Setting`; tests reach it through the tab's container. */
export interface FakeSetting {
	name: string;
	desc: string;
	toggle: FakeToggle | null;
}

/** The container a `PluginSettingTab` hands to each `Setting`. */
export interface FakeSettingContainer {
	emptied: number;
	settings: FakeSetting[];
	empty(): void;
}

export class PluginSettingTab {
	readonly containerEl: FakeSettingContainer;

	constructor(
		_app: unknown,
		_plugin: unknown
	) {
		this.containerEl = {
			emptied: 0,
			settings: [],
			empty(): void {
				this.emptied += 1;
				this.settings.length = 0;
			},
		};
	}
}

export class Setting {
	name = '';
	desc = '';
	toggle: FakeToggle | null = null;

	constructor(container: FakeSettingContainer) {
		container.settings.push(this);
	}

	setName(name: string): this {
		this.name = name;
		return this;
	}

	setDesc(desc: string): this {
		this.desc = desc;
		return this;
	}

	addToggle(configure: (toggle: FakeToggle) => unknown): this {
		const toggle: FakeToggle = {
			value: false,
			onChangeHandler: null,
			setValue(value: boolean): FakeToggle {
				this.value = value;
				return this;
			},
			onChange(callback: (value: boolean) => unknown): FakeToggle {
				this.onChangeHandler = callback;
				return this;
			},
		};
		this.toggle = toggle;
		configure(toggle);
		return this;
	}
}

/**
 * Base class double for `EditorSuggest`; the plugin subclass overrides the
 * suggestion methods, so only the constructor, `close` and the
 * `context`/`limit` state need to exist at runtime.
 */
export class EditorSuggest<T> {
	context: unknown = null;
	limit = 50;

	constructor(public app: unknown) {}

	close(): void {}
}
