/**
 * Find editors showing a vault file: the active pane first, then markdown leaves.
 */

export interface EditorFileRef {
	path: string;
}

export interface EditorPane<E> {
	file?: EditorFileRef | null;
	editor?: E | null;
}

export interface EditorWorkspace<E> {
	activeEditor?: EditorPane<E> | null;
	getLeavesOfType(type: string): readonly { view?: unknown }[];
}

/** The editor of a leaf showing `file`, if any. */
export function openEditorFor<E>(workspace: EditorWorkspace<E>, file: EditorFileRef): E | null {
	return openEditorsFor(workspace, file)[0] ?? null;
}

/**
 * Every editor showing `file` — the active one first, then background leaves.
 * Each pane holds its own view of the file, and each carries its own markers.
 */
export function openEditorsFor<E>(workspace: EditorWorkspace<E>, file: EditorFileRef): E[] {
	const editors: E[] = [];
	const active = workspace.activeEditor;
	if (active && active.file?.path === file.path && active.editor) editors.push(active.editor);
	for (const leaf of workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (!view || typeof view !== 'object') continue;
		const pane = view as EditorPane<E>;
		if (pane.file?.path === file.path && pane.editor && !editors.includes(pane.editor)) {
			editors.push(pane.editor);
		}
	}
	return editors;
}
