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
import { ledgerDoc } from './fences';
import type { FormatError, LineChange } from './format';
import { formatFencedDocument, formatLedger, lineChanges } from './format';

/** Delay before on-save alignment, so a burst of edits aligns once. */
const ALIGN_DEBOUNCE_MS = 500;

const TEXT_EXTENSIONS: Record<string, true> = { md: true, beancount: true, bean: true };

export interface EditCaret {
	line: number;
	ch: number;
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

interface Lines {
	text: string[];
	starts: number[];
}

export function planAlign(
	text: string,
	input: {
		carets: readonly { anchor: EditCaret; head: EditCaret }[];
		mode: 'block' | 'selection' | 'document';
		separatorColumn: number;
		lineIsLedger?: (hostLine0: number) => boolean;
	},
): EditPlan | null {
	const lines = text.split('\n');
	const bodies = ledgerBodies(lines.length, input.lineIsLedger);
	const scopes = alignScopes(lines, bodies, input.carets, input.mode);
	if (scopes.length === 0) return null;
	const targetColumn = alignmentTarget(input.separatorColumn);
	const edits = scopes.flatMap((range) => computeAlignment(lines, range, targetColumn, input.lineIsLedger));
	if (edits.length === 0) return null;
	const changes = edits.map(lineEditToChange);
	const caret = loneCollapsedCaret(input.carets);
	if (caret === null) return { changes };
	return { changes, caret: mapAlignCaret(edits, caret) };
}

export function planFormat(
	text: string,
	input: {
		carets: readonly { anchor: EditCaret; head: EditCaret }[];
		separatorColumn: number;
		kind: LedgerKind;
	},
): EditPlan | { error: FormatError } | null {
	const targetColumn = alignmentTarget(input.separatorColumn);
	const result = input.kind === 'ledger-file' ? formatLedger(text, targetColumn) : formatFencedDocument(text, targetColumn);
	if (!result.ok) return { error: result.error };
	const edits = lineChanges(text, result.text);
	if (edits.length === 0) return null;
	const changes = edits.map(lineChangeToChange);
	const caret = loneCollapsedCaret(input.carets);
	if (caret === null) return { changes };
	return { changes, caret: mapFormatCaret(edits, caret) };
}

export function planInstantDot(
	text: string,
	carets: readonly { anchor: number; head: number }[],
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
		let ch = origCh + dots;
		for (const edit of edits) {
			if (edit.line !== line) continue;
			if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
			else if (ch > edit.from) ch = edit.from + edit.text.length;
		}
		landed.push(newStart(line) + ch);
	}

	return { changes, carets: landed };
}

export const instantAlignmentPlan = planInstantDot;

export interface AlignOnSavePorts {
	clock: Clock;
	read(path: string): Promise<string>;
	modify(path: string, text: string): Promise<void>;
	openEditor(path: string): { getValue(): string; apply(plan: EditPlan): void } | null;
	alignOnSave(): boolean;
	separatorColumn(): number;
	ledgerKind(file: { path: string; extension: string }): LedgerKind;
}

export class AlignOnSave {
	private readonly timers = new Map<string, number>();

	constructor(private readonly ports: AlignOnSavePorts) {}

	schedule(file: { path: string; extension: string }): void {
		if (TEXT_EXTENSIONS[file.extension] !== true) return;
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
		const editor = this.ports.openEditor(file.path);
		const column = alignmentTarget(this.ports.separatorColumn());
		if (editor) {
			applyDocumentAlign(editor, this.ports.separatorColumn(), this.ports.ledgerKind(file));
			return;
		}
		const text = await this.ports.read(file.path);
		const kind = this.ports.ledgerKind(file);
		const aligned = kind === 'ledger-file' ? alignText(text, column) : alignFencedDocument(text, column);
		if (aligned === text) return;
		const live = this.ports.openEditor(file.path);
		if (live) {
			applyDocumentAlign(live, this.ports.separatorColumn(), kind);
			return;
		}
		if ((await this.ports.read(file.path)) !== text) return;
		await this.ports.modify(file.path, aligned);
	}
}

function applyDocumentAlign(
	editor: { getValue(): string; apply(plan: EditPlan): void },
	separatorColumn: number,
	kind: LedgerKind,
): void {
	const text = editor.getValue();
	const doc = kind === 'ledger-file' ? null : ledgerDoc(kind, text);
	const plan = planAlign(text, {
		carets: [],
		mode: 'document',
		separatorColumn,
		lineIsLedger: doc === null ? undefined : (hostLine0) => doc.lineIsLedger(hostLine0),
	});
	if (plan !== null) editor.apply(plan);
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
	carets: readonly { anchor: EditCaret; head: EditCaret }[],
	mode: 'block' | 'selection' | 'document',
): LineRange[] {
	if (mode === 'document') return [...bodies];
	if (carets.length === 0) return [];
	if (mode === 'block') {
		const line = carets[0].head.line;
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

function selectionRange(carets: readonly { anchor: EditCaret; head: EditCaret }[]): LineRange | null {
	let from = Number.MAX_SAFE_INTEGER;
	let to = 0;
	for (const selection of carets) {
		const start = Math.min(selection.anchor.line, selection.head.line);
		const end = Math.max(selection.anchor.line, selection.head.line);
		const endCh = selection.anchor.line === end ? selection.anchor.ch : selection.head.ch;
		from = Math.min(from, start);
		to = Math.max(to, endCh === 0 && end > start ? end - 1 : end);
	}
	return from === Number.MAX_SAFE_INTEGER ? null : { from, to };
}

function loneCollapsedCaret(carets: readonly { anchor: EditCaret; head: EditCaret }[]): EditCaret | null {
	if (carets.length !== 1) return null;
	const caret = carets[0];
	if (caret.anchor.line !== caret.head.line || caret.anchor.ch !== caret.head.ch) return null;
	return caret.head;
}

function mapAlignCaret(edits: readonly LineEdit[], caret: EditCaret): EditCaret {
	let ch = caret.ch;
	for (const edit of edits) {
		if (edit.line !== caret.line) continue;
		if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
		else if (ch > edit.from) ch = edit.from + edit.text.length;
	}
	return { line: caret.line, ch };
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
