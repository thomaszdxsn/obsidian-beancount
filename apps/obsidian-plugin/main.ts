import { Plugin } from 'obsidian';
import { beancountMode } from './beancount-mode';
import { extractAccounts } from './account-index';
import { AccountSuggest } from './account-suggest';
import { extractPayees } from './payee-index';
import { PayeeSuggest } from './payee-suggest';
import { registerVaultIndex, VaultIndex } from './vault-index';

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

export default class BeancountPlugin extends Plugin {
	onload() {
		const uninstall = installBeancountModes(host.CodeMirror);
		if (uninstall) this.register(uninstall);
		// One vault scan feeds both completion indexes.
		const accounts = new VaultIndex(extractAccounts);
		const payees = new VaultIndex(extractPayees);
		registerVaultIndex(this, accounts, payees);
		this.registerEditorSuggest(new AccountSuggest(this.app, accounts));
		this.registerEditorSuggest(new PayeeSuggest(this.app, payees));
	}

	onunload() {}
}
