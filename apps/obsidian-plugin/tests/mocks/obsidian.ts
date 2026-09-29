/**
 * Runtime double for the `obsidian` npm package (which ships types only).
 * Records every UI/registration hook so tests can assert what a plugin
 * registers when it loads.
 */

export interface Registrations {
	commands: string[];
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

	constructor(
		public app: unknown,
		public manifest: unknown
	) {}

	addCommand(command: { id: string }): void {
		this.registrations.commands.push(command.id);
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
		return null;
	}

	async saveData(_data: unknown): Promise<void> {
		return undefined;
	}
}

export class Modal {}
export class PluginSettingTab {}
export class Notice {}
export class MarkdownView {}
export class Editor {}

/**
 * Base class double for `EditorSuggest`; the plugin subclass overrides the
 * suggestion methods, so only the constructor and the `context`/`limit`
 * state need to exist at runtime.
 */
export class EditorSuggest<T> {
	context: unknown = null;
	limit = 50;

	constructor(public app: unknown) {}

	open(): void {}

	close(): void {}
}
