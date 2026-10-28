/**
 * Shared rewrite plans for Align, Format ledger, typing `.`, and align-on-save.
 * Adapters apply the returned changes; this module does not import Obsidian.
 */
import {
	alignFencedDocument,
	alignmentTarget,
	alignText,
	blockRangeAt,
	blockRangeInLedger,
	computeAlignment,
	intersectRange,
	isAmountDotInsert,
} from './align';
import type { LineEdit, LineRange } from './align';
import type { Clock } from './clock';
import type { LedgerKind } from './fences';
import { editorLedger, ledgerDoc, ledgerKind } from './fences';
import type { FormatError, LineChange } from './format';
import { formatFencedDocument, formatLedger, lineChanges } from './format';
import { isTextFile } from './vault-index';

/** Delay before on-save alignment, so a burst of edits aligns once. */
const ALIGN_DEBOUNCE_MS = 500;

export interface EditCaret {
	line: number;
	ch: number;
}

export interface EditSelection {
	anchor: EditCaret;
	head: EditCaret;
}

export interface OffsetCaret {
	anchor: number;
	head: number;
}

export interface TextChange {
	from: EditCaret;
	to: EditCaret;
	text: string;
}

export interface EditPlan {
	changes: readonly TextChange[];
	/** Only a single collapsed caret is mapped; multi-cursor and selections omit this. */
	caret?: EditCaret;
}

export interface InstantChange {
	from: number;
	to: number;
	insert: string;
}

export interface InstantPlan {
	changes: InstantChange[];
	carets: number[];
}

export interface PlanEditor {
	transaction(tx: { changes: TextChange[]; selection?: { from: EditCaret } }): void;
}

export interface AlignEditor extends PlanEditor {
	getValue(): string;
	listSelections(): readonly EditSelection[];
	getCursor(): EditCaret;
	somethingSelected(): boolean;
}

interface Lines {
	text: string[];
	starts: number[];
}

export function planAlign(
	text: string,
	input: {
		carets: readonly EditSelection[];
		/** Block mode uses this line. Adapter passes `getCursor()`; tests may omit it. */
		primary?: EditCaret;
		mode: 'block' | 'selection' | 'document';
		separatorColumn: number;
		lineIsLedger?: (hostLine0: number) => boolean;
	},
): EditPlan | null {
	const lines = text.split('\n');
	const bodies = ledgerBodies(lines.length, input.lineIsLedger);
	const scopes = alignScopes(lines, bodies, input.carets, input.mode, input.primary);
	if (scopes.length === 0) return null;
	const targetColumn = alignmentTarget(input.separatorColumn);
	const edits = scopes.flatMap((range) => computeAlignment(lines, range, targetColumn, input.lineIsLedger));
	if (edits.length === 0) return null;
	const changes = edits.map(lineEditToChange);
	const caret = loneCollapsedCaret(input.carets);
	if (caret === null) return { changes };
	return { changes, caret: { line: caret.line, ch: mapGapCaret(edits, caret.line, caret.ch) } };
}

export function planFormat(
	text: string,
	input: {
		carets: readonly EditSelection[];
		separatorColumn: number;
		kind: LedgerKind;
	},
): EditPlan | { error: FormatError } | null {
	const targetColumn = alignmentTarget(input.separatorColumn);
	const result = formatByKind(input.kind, text, targetColumn);
	if (!result.ok) return { error: result.error };
	const edits = lineChanges(text, result.text);
	if (edits.length === 0) return null;
	const changes = edits.map(lineChangeToChange);
	const caret = loneCollapsedCaret(input.carets);
	if (caret === null) return { changes };
	return { changes, caret: mapFormatCaret(edits, caret) };
}

/**
 * The `.` handling for `text` and its carets, or null when no caret sits
 * where an amount decimal belongs. Every collapsed caret still receives a
 * `.` once the key is claimed, so multi-cursor does not drop a prose
 * caret's insert; only the blocks that gained an amount decimal are aligned.
 */
export function planInstantDot(
	text: string,
	carets: readonly OffsetCaret[],
	separatorColumn: number,
	lineIsLedger?: (hostLine0: number) => boolean,
): InstantPlan | null {
	if (carets.some((caret) => caret.anchor !== caret.head)) return null;

	const lines = linesOf(text);
	const inserts: Array<{ line: number; ch: number; amount: boolean }> = [];
	for (const caret of carets) {
		const line = lineAt(lines, caret.head);
		const ch = caret.head - lines.starts[line];
		inserts.push({ line, ch, amount: isAmountDotInsert(lines.text[line], ch) });
	}
	if (!inserts.some((insert) => insert.amount)) return null;

	const working = lines.text.slice();
	const dotsOfLine = new Map<number, number[]>();
	for (const insert of inserts) {
		const list = dotsOfLine.get(insert.line) ?? [];
		list.push(insert.ch);
		dotsOfLine.set(insert.line, list);
	}
	for (const [line, chs] of dotsOfLine) {
		chs.sort((a, b) => b - a);
		let next = working[line];
		for (const ch of chs) next = next.slice(0, ch) + '.' + next.slice(ch);
		working[line] = next;
	}

	const targetColumn = alignmentTarget(separatorColumn);
	const claimed = new Set<string>();
	const edits: LineEdit[] = [];
	for (const insert of inserts) {
		if (!insert.amount) continue;
		const range = blockRangeInLedger(working, insert.line, lineIsLedger);
		const key = `${range.from}:${range.to}`;
		if (claimed.has(key)) continue;
		claimed.add(key);
		edits.push(...computeAlignment(working, range, targetColumn, lineIsLedger));
	}
	for (const edit of edits) {
		const line = working[edit.line];
		working[edit.line] = line.slice(0, edit.from) + edit.text + line.slice(edit.to);
	}

	const touched = [...new Set([...dotsOfLine.keys(), ...edits.map((edit) => edit.line)])].sort((a, b) => a - b);
	const changes: InstantChange[] = [];
	for (const line of touched) {
		const before = lines.text[line];
		if (before === working[line]) continue;
		changes.push({ from: lines.starts[line], to: lines.starts[line] + before.length, insert: working[line] });
	}
	const newStart = (line: number): number => {
		let start = lines.starts[line];
		for (const t of touched) if (t < line) start += working[t].length - lines.text[t].length;
		return start;
	};

	const ordered = [...carets].sort((a, b) => a.head - b.head);
	const landed: number[] = [];
	for (const caret of ordered) {
		const line = lineAt(lines, caret.head);
		const origCh = caret.head - lines.starts[line];
		const dots = (dotsOfLine.get(line) ?? []).filter((ch) => ch <= origCh).length;
		landed.push(newStart(line) + mapGapCaret(edits, line, origCh + dots));
	}

	return { changes, carets: landed };
}

/** Apply `plan` in one transaction. Only a lone caret is forced; multi-cursor and selections are left to the editor. */
export function applyEditPlan(editor: PlanEditor, plan: EditPlan): void {
	if (plan.caret) {
		editor.transaction({ changes: [...plan.changes], selection: { from: plan.caret } });
		return;
	}
	editor.transaction({ changes: [...plan.changes] });
}

/** Align decimal points. A lone caret is mapped; several carets or a selection are left to the editor. */
export function runAlignCommand(
	editor: AlignEditor,
	file: { path: string; extension: string } | null,
	separatorColumn: number,
): void {
	const ledger = editorLedger(editor, file);
	const plan = planAlign(editor.getValue(), {
		carets: editor.listSelections(),
		primary: editor.getCursor(),
		mode: editor.somethingSelected() ? 'selection' : 'block',
		separatorColumn,
		lineIsLedger: (line) => ledger.lineIsLedger(line),
	});
	if (plan === null) return;
	applyEditPlan(editor, plan);
}

/**
 * Format ledger: a `.bean` / `.beancount` buffer is one ledger. Any other
 * file, including an untitled buffer, formats each ```beancount / ```bean
 * fence and leaves the rest. A syntax error names the document line and
 * changes nothing. No notice when the text is already formatted — same as
 * alignment finding nothing to do. Only a lone caret is mapped; multi-cursor
 * and selections are left to the editor.
 */
export function runFormatCommand(
	editor: AlignEditor,
	file: { path: string; extension: string } | null,
	separatorColumn: number,
	onError: (error: FormatError) => void,
): void {
	const result = planFormat(editor.getValue(), {
		carets: editor.listSelections(),
		separatorColumn,
		kind: ledgerKind(file),
	});
	if (result !== null && 'error' in result) {
		onError(result.error);
		return;
	}
	if (result === null) return;
	applyEditPlan(editor, result);
}

export function maybeScheduleAlign(align: AlignOnSave, file: { path: string; extension?: string }): void {
	if (!isTextFile(file) || file.extension === undefined) return;
	align.schedule({ path: file.path, extension: file.extension });
}

export interface OpenAlignEditor {
	getValue(): string;
	apply(plan: EditPlan): void;
	listSelections(): readonly EditSelection[];
}

export interface AlignOnSavePorts {
	clock: Clock;
	read(path: string): Promise<string>;
	modify(path: string, text: string): Promise<void>;
	openEditor(path: string): OpenAlignEditor | null;
	alignOnSave(): boolean;
	separatorColumn(): number;
	ledgerKind(file: { path: string; extension: string }): LedgerKind;
}

export function bindAlignOnSaveOpenEditor(deps: {
	getFile(path: string): { path: string } | null;
	findEditor(path: string): AlignEditor | null;
}): (path: string) => OpenAlignEditor | null {
	return (path) => {
		if (!deps.getFile(path)) return null;
		const editor = deps.findEditor(path);
		if (!editor) return null;
		return {
			getValue: () => editor.getValue(),
			listSelections: () => editor.listSelections(),
			apply: (plan) => applyEditPlan(editor, plan),
		};
	};
}

export class AlignOnSave {
	private readonly timers = new Map<string, number>();

	constructor(private readonly ports: AlignOnSavePorts) {}

	schedule(file: { path: string; extension: string }): void {
		this.ports.clock.clearTimeout(this.timers.get(file.path) ?? 0);
		this.timers.set(
			file.path,
			this.ports.clock.setTimeout(() => {
				this.timers.delete(file.path);
				if (!this.ports.alignOnSave()) return;
				this.alignFile(file).catch(() => undefined);
			}, ALIGN_DEBOUNCE_MS),
		);
	}

	dispose(): void {
		for (const id of this.timers.values()) this.ports.clock.clearTimeout(id);
		this.timers.clear();
	}

	private async alignFile(file: { path: string; extension: string }): Promise<void> {
		const separatorColumn = this.ports.separatorColumn();
		const kind = this.ports.ledgerKind(file);
		const editor = this.ports.openEditor(file.path);
		if (editor) {
			// A file open in a leaf is edited through its editor: the editor buffer
			// is what Obsidian autosaves, so a vault-level write would be clobbered
			// by the next autosave from the still-unaligned buffer.
			applyDocumentAlign(editor, separatorColumn, kind);
			return;
		}
		// Files not open in any leaf have no buffer to fight with.
		const text = await this.ports.read(file.path);
		const aligned = alignByKind(kind, text, alignmentTarget(separatorColumn));
		if (aligned === text) return;
		// The file may have been opened — or edited — while the read was in
		// flight. An open one is the editor's business again, and a changed
		// one is left alone: its own `modify` will bring alignment back here.
		// Write only on change — `vault.process` would write the unchanged
		// text back and re-arm the debounce forever.
		const live = this.ports.openEditor(file.path);
		if (live) {
			applyDocumentAlign(live, separatorColumn, kind);
			return;
		}
		if ((await this.ports.read(file.path)) !== text) return;
		await this.ports.modify(file.path, aligned);
	}
}

function applyDocumentAlign(editor: OpenAlignEditor, separatorColumn: number, kind: LedgerKind): void {
	const text = editor.getValue();
	const plan = planAlign(text, {
		carets: editor.listSelections(),
		mode: 'document',
		separatorColumn,
		lineIsLedger: lineFilter(kind, text),
	});
	if (plan !== null) editor.apply(plan);
}

function isLedgerKind(kind: LedgerKind): boolean {
	return kind === 'ledger-file';
}

function formatByKind(kind: LedgerKind, text: string, targetColumn: number) {
	return isLedgerKind(kind) ? formatLedger(text, targetColumn) : formatFencedDocument(text, targetColumn);
}

function alignByKind(kind: LedgerKind, text: string, targetColumn: number): string {
	return isLedgerKind(kind) ? alignText(text, targetColumn) : alignFencedDocument(text, targetColumn);
}

function lineFilter(kind: LedgerKind, text: string): ((hostLine0: number) => boolean) | undefined {
	if (isLedgerKind(kind)) return undefined;
	const doc = ledgerDoc(kind, text);
	return (hostLine0) => doc.lineIsLedger(hostLine0);
}

function ledgerBodies(lineCount: number, lineIsLedger?: (hostLine0: number) => boolean): LineRange[] {
	if (lineCount === 0) return [];
	if (lineIsLedger === undefined) return [{ from: 0, to: lineCount - 1 }];
	const ranges: LineRange[] = [];
	let start: number | null = null;
	for (let line = 0; line < lineCount; line += 1) {
		if (lineIsLedger(line)) {
			if (start === null) start = line;
			continue;
		}
		if (start !== null) {
			ranges.push({ from: start, to: line - 1 });
			start = null;
		}
	}
	if (start !== null) ranges.push({ from: start, to: lineCount - 1 });
	return ranges;
}

function alignScopes(
	lines: readonly string[],
	bodies: readonly LineRange[],
	carets: readonly EditSelection[],
	mode: 'block' | 'selection' | 'document',
	primary: EditCaret | undefined,
): LineRange[] {
	if (mode === 'document') return [...bodies];
	if (mode === 'block') {
		const line = (primary ?? carets[0]?.head)?.line;
		if (line === undefined) return [];
		const block = blockRangeAt(lines, line);
		for (const body of bodies) {
			if (line < body.from || line > body.to) continue;
			const clipped = intersectRange(block, body);
			return clipped === null ? [] : [clipped];
		}
		return [];
	}
	const selected = selectionRange(carets);
	if (selected === null) return [];
	const scopes: LineRange[] = [];
	for (const body of bodies) {
		const clipped = intersectRange(selected, body);
		if (clipped !== null) scopes.push(clipped);
	}
	return scopes;
}

function selectionRange(carets: readonly EditSelection[]): LineRange | null {
	let from = Number.MAX_SAFE_INTEGER;
	let to = 0;
	for (const selection of carets) {
		const start = Math.min(selection.anchor.line, selection.head.line);
		const end = Math.max(selection.anchor.line, selection.head.line);
		const endCh = selection.anchor.line === end ? selection.anchor.ch : selection.head.ch;
		from = Math.min(from, start);
		// A selection dragged to the start of the next line holds none of its
		// characters, so the last selected line is the one before it.
		to = Math.max(to, endCh === 0 && end > start ? end - 1 : end);
	}
	return from === Number.MAX_SAFE_INTEGER ? null : { from, to };
}

function loneCollapsedCaret(carets: readonly EditSelection[]): EditCaret | null {
	if (carets.length !== 1) return null;
	const caret = carets[0];
	if (caret.anchor.line !== caret.head.line || caret.anchor.ch !== caret.head.ch) return null;
	return caret.head;
}

function mapGapCaret(edits: readonly { line: number; from: number; to: number; text: string }[], line: number, ch: number): number {
	for (const edit of edits) {
		if (edit.line !== line) continue;
		if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
		else if (ch > edit.from) ch = edit.from + edit.text.length;
	}
	return ch;
}

function mapFormatCaret(edits: readonly LineChange[], caret: EditCaret): EditCaret {
	let ch = caret.ch;
	let shift = 0;
	for (const edit of edits) {
		if (edit.fromLine !== caret.line) continue;
		if (ch >= edit.toCh) {
			shift += edit.text.length - (edit.toCh - edit.fromCh);
		} else if (ch > edit.fromCh) {
			ch = edit.fromCh + shift + edit.text.length;
			shift = 0;
			break;
		} else {
			break;
		}
	}
	return { line: caret.line, ch: ch + shift };
}

function lineEditToChange(edit: LineEdit): TextChange {
	return { from: { line: edit.line, ch: edit.from }, to: { line: edit.line, ch: edit.to }, text: edit.text };
}

function lineChangeToChange(edit: LineChange): TextChange {
	return {
		from: { line: edit.fromLine, ch: edit.fromCh },
		to: { line: edit.toLine, ch: edit.toCh },
		text: edit.text,
	};
}

function linesOf(text: string): Lines {
	const lines = text.split('\n');
	const starts = new Array<number>(lines.length);
	let start = 0;
	for (let line = 0; line < lines.length; line += 1) {
		starts[line] = start;
		start += lines[line].length + 1;
	}
	return { text: lines, starts };
}

function lineAt(lines: Lines, offset: number): number {
	let lo = 0;
	let hi = lines.starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lines.starts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}
