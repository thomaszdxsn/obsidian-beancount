import { Plugin } from 'obsidian';
import { beancountMode } from './beancount-mode';

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
// (`mfactory(options, spec)`), so register a factory — not the bare mode
// object — and keep its identity to recognize our own entries on unload.
const beancountModeFactory = () => beancountMode;

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

export default class BeancountPlugin extends Plugin {
	onload() {
		const uninstall = installBeancountModes(host.CodeMirror);
		if (uninstall) this.register(uninstall);
	}

	onunload() {}
}
