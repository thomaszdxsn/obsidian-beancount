import { describe, expect, it } from 'vitest';
import { applyEditPlan, bindAlignOnSaveOpenEditor } from '../edits';
import { openEditorFor, openEditorsFor } from '../open-editors';
import { createEditor } from './fakes';

describe('openEditorsFor', () => {
	it('prefers the active editor and still finds a background leaf', () => {
		const file = { path: 'ledger.bean' };
		const activeEd = createEditor(['active']);
		const background = createEditor(['bg']);
		const other = createEditor(['other']);
		const workspace = {
			activeEditor: { file: { path: 'other.bean' }, editor: other },
			getLeavesOfType: (type: string) => {
				expect(type).toBe('markdown');
				return [
					{ view: { file: { path: 'other.bean' }, editor: other } },
					{ view: { file, editor: background } },
				];
			},
		};
		expect(openEditorFor(workspace, file)).toBe(background);
		expect(openEditorsFor(workspace, file)).toEqual([background]);

		const onFile = {
			activeEditor: { file, editor: activeEd },
			getLeavesOfType: () => [
				{ view: { file, editor: activeEd } },
				{ view: { file, editor: background } },
			],
		};
		expect(openEditorsFor(onFile, file)).toEqual([activeEd, background]);
	});
});

describe('bindAlignOnSaveOpenEditor', () => {
	it('returns null when getAbstractFileByPath misses, otherwise applies through the editor', () => {
		const editor = createEditor(['  Expenses:Food 12.5 USD', '  Assets:Cash -12.5 USD']);
		editor.setCursor({ line: 0, ch: 16 });
		const files = new Map<string, { path: string }>([['ledger.bean', { path: 'ledger.bean' }]]);
		const open = bindAlignOnSaveOpenEditor({
			getFile: (path) => files.get(path) ?? null,
			findEditor: (path) => (path === 'ledger.bean' ? editor : null),
		});
		expect(open('gone.bean')).toBeNull();
		const live = open('ledger.bean');
		expect(live).not.toBeNull();
		applyEditPlan(editor, {
			changes: [{ from: { line: 0, ch: 15 }, to: { line: 0, ch: 16 }, text: '  ' }],
			caret: { line: 0, ch: 17 },
		});
		expect(editor.lines[0].startsWith('  Expenses:Food')).toBe(true);
		expect(editor.transactions).toHaveLength(1);
	});
});
