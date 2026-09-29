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
