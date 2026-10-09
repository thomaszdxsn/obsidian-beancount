import { describe, expect, it } from 'vitest';
import { LEDGER_EDITOR_CLASS, ledgerFontExtension } from '../ledger-font';
import type { MockAttributeSource } from './mocks/codemirror';

function attributesFor(file: { path: string; extension: string } | null): Record<string, string> | null {
	const { editorAttributes } = ledgerFontExtension() as unknown as { editorAttributes: MockAttributeSource };
	return editorAttributes({ state: { field: () => (file ? { file } : undefined) } });
}

describe('ledgerFontExtension', () => {
	it('marks .bean and .beancount editors for the monospace font', () => {
		expect(attributesFor({ path: 'main.bean', extension: 'bean' })).toEqual({ class: LEDGER_EDITOR_CLASS });
		expect(attributesFor({ path: 'x.beancount', extension: 'beancount' })).toEqual({ class: LEDGER_EDITOR_CLASS });
	});

	it('leaves notes and fileless editors in their own font', () => {
		expect(attributesFor({ path: 'note.md', extension: 'md' })).toBeNull();
		expect(attributesFor(null)).toBeNull();
	});
});
