/**
 * Account completion: an `EditorSuggest` popup fed by `AccountIndex`, plus
 * the wiring that keeps the index in sync with the vault.
 *
 * Typing an account-shaped token (`Assets:Ca…`) triggers a prefix-match
 * popup over every account name cached from the vault; picking one replaces
 * the typed token in place.
 */
import { EditorSuggest } from 'obsidian';
import type {
	App,
	Editor,
	EditorPosition,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	Plugin,
	TAbstractFile,
	TFile,
} from 'obsidian';
import { AccountIndex, ACCOUNT_PREFIX_RE } from './account-index';

/** File extensions whose text is scanned for account names. */
const INDEXED_EXTENSIONS: Record<string, true> = { md: true, beancount: true, bean: true };

/** The shape `isIndexable` needs: a folder has no `extension`. */
interface VaultEntry {
	path: string;
	extension?: string;
}

function isIndexable(file: VaultEntry): file is TFile {
	// Own-property check: `in` would treat `constructor`/`toString` file
	// extensions as indexed via the prototype chain.
	return (
		typeof file.extension === 'string' &&
		Object.prototype.hasOwnProperty.call(INDEXED_EXTENSIONS, file.extension)
	);
}

export class AccountSuggest extends EditorSuggest<string> {
	constructor(
		app: App,
		private readonly index: AccountIndex
	) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Mid-token edits (a word character right after the cursor) would make
		// selection replace only the typed prefix and garble the rest.
		const after = line.charAt(cursor.ch);
		if (after !== '' && /[A-Za-z0-9\-_:]/.test(after)) return null;
		const match = ACCOUNT_PREFIX_RE.exec(line.slice(0, cursor.ch));
		if (!match) return null;
		const query = match[1];
		// Stay quiet unless the word prefixes a cached account; a bare `USD`
		// or the just-typed token itself has nothing to offer.
		if (this.candidates(query).length === 0) return null;
		return {
			start: { line: cursor.line, ch: cursor.ch - query.length },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): string[] {
		return this.candidates(context.query);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		context.editor.replaceRange(value, context.start, context.end);
		// The suggestion chooser does not dismiss the popover itself; left
		// open it would re-trigger on the replacement and reuse the stale
		// range on a second pick. `close()` nulls `context`, hence the copy.
		this.close();
	}

	/** Completions for `query`, never the typed token itself. */
	private candidates(query: string): string[] {
		// The typed token is in the live buffer and therefore in the index;
		// offering it back would make Enter accept a no-op.
		return this.index.match(query).filter((account) => account !== query);
	}
}

/**
 * Register account completion on `plugin` and return the live index.
 *
 * The initial scan walks every indexed file once; afterwards only the file
 * named by a vault event is re-read. Out-of-order reads on rapid edits are
 * dropped by a per-path revision counter, and a read that fails (the file
 * vanished mid-scan) leaves the cache untouched.
 */
export function registerAccountSuggest(plugin: Plugin): AccountIndex {
	const index = new AccountIndex();
	const { vault } = plugin.app;

	const revisions = new Map<string, number>();
	let revision = 0;
	const refresh = (file: TAbstractFile): void => {
		if (!isIndexable(file)) return;
		const path = file.path;
		// Monotonic token: invalidation deletes the entry, so a read from a
		// previous life of the path can never match again — a per-path counter
		// would restart at 1 and let a stale read overwrite a recreated file.
		// The entry also marks the path as read-in-flight, so it is removed
		// once the read lands.
		const current = ++revision;
		revisions.set(path, current);
		vault
			.cachedRead(file)
			.then((content) => {
				if (revisions.get(path) !== current) return;
				index.setFileContent(path, content);
				revisions.delete(path);
			})
			.catch(() => undefined);
	};

	for (const file of vault.getFiles()) refresh(file);

	plugin.registerEvent(vault.on('create', refresh));
	plugin.registerEvent(vault.on('modify', refresh));
	plugin.registerEvent(vault.on('delete', (file) => {
		revisions.delete(file.path);
		index.removeFile(file.path);
	}));
	plugin.registerEvent(vault.on('rename', (file, oldPath) => {
		const oldPrefix = oldPath + '/';
		// Reads in flight for the old path or its children are stale once the
		// rename lands; drop their tokens so they cannot write back under old
		// paths, and remember where they were headed so they can be replaced.
		const dropped: string[] = [];
		if (revisions.delete(oldPath)) dropped.push(file.path);
		for (const path of [...revisions.keys()]) {
			if (!path.startsWith(oldPrefix)) continue;
			revisions.delete(path);
			dropped.push(file.path + path.slice(oldPath.length));
		}
		const moved = index.renameFile(oldPath, file.path);
		if (isIndexable(file)) {
			// A dropped in-flight read must be replaced; an untracked
			// destination (`.txt` → `.md`, or a file edited to account-less
			// prose) needs a first read.
			if (dropped.length > 0 || !moved) refresh(file);
		} else {
			index.removeFile(file.path);
			// Folder rename: the re-keyed children keep their cached content,
			// so re-read only the ones whose in-flight reads were dropped.
			if (dropped.length > 0) {
				const filesByPath = new Map(vault.getFiles().map((entry) => [entry.path, entry]));
				for (const path of dropped) {
					const child = filesByPath.get(path);
					if (child) refresh(child);
				}
			}
		}
	}));

	plugin.registerEditorSuggest(new AccountSuggest(plugin.app, index));
	return index;
}
