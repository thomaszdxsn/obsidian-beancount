# Plan 006: 对齐 / 格式化 / 按 `.` 共用一份改写计划

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, **do not** update `plans/README.md` —
> the dispatcher maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/main.ts apps/obsidian-plugin/align.ts apps/obsidian-plugin/format.ts apps/obsidian-plugin/instant-alignment.ts apps/obsidian-plugin/bench/editor.ts apps/obsidian-plugin/tests/plugin.test.ts apps/obsidian-plugin/tests/instant-alignment.test.ts CHANGELOG.md`
> If those in-scope files changed since `8b75729`, compare the "Current state"
> excerpts against live code.
> **API 依赖**（必须已存在，本身不在本计划 Scope）：001 的 `editorLedger` / `ledgerDoc` / `lineIsLedger` / `LedgerKind`；002 `clock.ts` 的 `Clock`+`systemClock` 与 `tests/fakes.ts` 的 `FakeClock.tick`；003 `scan.ts` 行级 posting 分类。这些替换调用点是预期漂移，OK。
> **串行顺序**：001–005 已合入。004 符号本计划不消费。005 已把 `main.ts` 的 `popovers` 换成 `PopoverOpen` — **不要还原**成 7 元素数组。任何对 `alignInEditor` / `formatInEditor` / `scheduleAlign` 光标或 debounce 语义的额外改动是 STOP。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: **API** — `plans/001-ledger-regions.md`（`editorLedger` / `ledgerDoc` / `lineIsLedger` / `LedgerKind` / `hostIndent`）、`plans/002-ledger-validation.md`（`Clock` / `systemClock` / `FakeClock`）、`plans/003-ledger-line-scanner.md`（`parsePostingLine` / `classifyLine`，本计划不再改词法）。**串行** — 排在 005 之后以免并行改 `main.ts`；004 符号不消费；005 的 `PopoverOpen` 接线必须保留
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/73

## Why this matters

同一种账本改写今天有三个入口、三套「改动 + 光标」组装：命令在 `main.ts` 的 `alignInEditor` / `formatInEditor` 各做一遍光标映射；按 `.` 在 `instant-alignment.ts` 用 offset 自己 diff；保存时对齐在 `alignFile` 里区分打开的编辑器与磁盘竞态。9a0f03e 曾经同时改 `align.ts`、`format.ts`、`main.ts` 和 `plugin.test.ts`，因为公式不在一处。命令路径的光标只能靠 `loadPlugin` 测，还夹着 `delay(600)`。

落地后：`edits.ts` 吃文本 + 光标，吐最小 `changes` + 可选单光标；命令 / 按 `.` / 保存三个 adapter 只 apply。光标测试不启动 `BeancountPlugin`。保存 debounce 用 002 的 `Clock`，但 **独立 timer map**（风险 6）。Enter 缩进不纳入（A5.3）。可见行为与 #76 锁定的 Separator column / Ledger text 规则不变，bench 哈希不变。

## Current state

规划对照 HEAD `8b75729`。执行时 001–005 已合入：区域问 `ledgerDoc` / `lineIsLedger`，时钟在 `clock.ts`，行级 posting 分类在 `scan.ts`。下面摘录是 **8b75729 实读**；合入后同名函数可能改成问 `ledgerDoc`，但三套光标组装与 `window.setTimeout` debounce **必须仍在**，否则 STOP。

### 相关文件

- `apps/obsidian-plugin/main.ts` — `editorLines` / `commandScope` / `alignInEditor` / `alignCommand` / `alignOpenEditor` / `formatInEditor` / `applyEditorEdit`；`alignTimers` + `scheduleAlign` + `alignFile`；命令注册。
- `apps/obsidian-plugin/align.ts` — `computeAlignment` / `alignmentTarget` / `alignmentRanges` / `alignText` / `alignFencedDocument` / `blockRangeAt` / `blockRangeInLedger` / `isAmountDotInsert`。
- `apps/obsidian-plugin/format.ts` — `formatLedger` / `formatFencedDocument` / `lineChanges` / `formatErrorNotice`。
- `apps/obsidian-plugin/instant-alignment.ts` — 纯 `instantAlignmentPlan` + keymap `instantAlignmentExtension`。
- `apps/obsidian-plugin/posting-indent.ts` — `postingIndentPlan`（**不要纳入、不要改**）。
- `apps/obsidian-plugin/clock.ts` — 002 引入：`Clock` + `systemClock`（执行时必须已存在）。
- `apps/obsidian-plugin/tests/fakes.ts` — `FakeVault` / `createEditor` / `flush`；002 后含 `FakeClock`。
- `apps/obsidian-plugin/tests/plugin.test.ts` — 对齐 / 格式化光标与保存 `delay(600)` 用例。
- `apps/obsidian-plugin/tests/instant-alignment.test.ts`、`align.test.ts`、`format.test.ts` — 纯函数覆盖。
- `apps/obsidian-plugin/bench/editor.ts` — `dot` 打 `instantAlignmentPlan`；`enter` 打 `postingIndentPlan`。

### 摘录（8b75729）

命令范围：无选区对齐光标所在交易块，有选区只取选中行；拖到下一行列 0 不包含该行。

```260:288:apps/obsidian-plugin/main.ts
function commandScope(editor: Editor, lines: readonly string[], bodies: readonly LineRange[]): LineRange[] {
	if (!editor.somethingSelected()) {
		const line = editor.getCursor().line;
		const block = blockRangeAt(lines, line);
		for (const body of bodies) {
			if (line < body.from || line > body.to) continue;
			const clipped = intersectRange(block, body);
			return clipped === null ? [] : [clipped];
		}
		return [];
	}
	let from = Number.MAX_SAFE_INTEGER;
	let to = 0;
	for (const selection of editor.listSelections()) {
		const start = Math.min(selection.anchor.line, selection.head.line);
		const end = Math.max(selection.anchor.line, selection.head.line);
		const endCh = selection.anchor.line === end ? selection.anchor.ch : selection.head.ch;
		from = Math.min(from, start);
		to = Math.max(to, endCh === 0 && end > start ? end - 1 : end);
	}
	const selected = { from, to };
	const scopes: LineRange[] = [];
	for (const body of bodies) {
		const clipped = intersectRange(selected, body);
		if (clipped !== null) scopes.push(clipped);
	}
	return scopes;
}
```

`alignInEditor`：`computeAlignment` → `editor.transaction`；单光标自己映射，多光标/选区交给编辑器。

```297:334:apps/obsidian-plugin/main.ts
function alignInEditor(
	editor: Editor,
	scope?: readonly LineRange[],
	targetColumn?: number,
	ledgerLine?: (line: number) => boolean
): void {
	const lines = editorLines(editor);
	const edits =
		scope === undefined
			? computeAlignment(lines, undefined, targetColumn, ledgerLine)
			: scope.flatMap((range) => computeAlignment(lines, range, targetColumn, ledgerLine));
	if (edits.length === 0) return;
	const changes = edits.map((edit) => ({
		from: { line: edit.line, ch: edit.from },
		to: { line: edit.line, ch: edit.to },
		text: edit.text,
	}));
	const carets = editor.listSelections();
	if (carets.length !== 1 || editor.somethingSelected()) {
		editor.transaction({ changes });
		return;
	}
	const caret = editor.getCursor();
	let ch = caret.ch;
	for (const edit of edits) {
		if (edit.line !== caret.line) continue;
		if (ch >= edit.to) ch += edit.text.length - (edit.to - edit.from);
		else if (ch > edit.from) ch = edit.from + edit.text.length;
	}
	editor.transaction({ changes, selection: { from: { line: caret.line, ch } } });
}
```

对齐光标规则（必须原样搬进 `planAlign`，不得「简化」）：

| 单光标位置 | 结果 |
| --- | --- |
| `ch <= edit.from`（账户侧，含空隙起点） | 列不变 |
| `edit.from < ch < edit.to`（空隙内部） | `ch = edit.from + edit.text.length`（新空隙末尾 / 金额起点） |
| `ch >= edit.to`（金额或行尾） | `ch += text.length - (to - from)` |

多光标或选区：`EditPlan` **省略** `caret`，adapter 只丢 `changes`。

`formatInEditor` 是第二份映射（按空白 run 累加 `shift`，与对齐公式不同）：

```369:417:apps/obsidian-plugin/main.ts
function formatInEditor(
	editor: Editor,
	file: { path: string; extension: string } | null,
	separatorColumn: number
): void {
	const targetColumn = alignmentTarget(separatorColumn);
	const result =
		file !== null && isLedgerFile(file)
			? formatLedger(editor.getValue(), targetColumn)
			: formatFencedDocument(editor.getValue(), targetColumn);
	if (!result.ok) {
		new Notice(formatErrorNotice(result.error));
		return;
	}
	const before = editor.getValue();
	const edits = lineChanges(before, result.text);
	if (edits.length === 0) return;
	const changes = edits.map((edit) => ({
		from: { line: edit.fromLine, ch: edit.fromCh },
		to: { line: edit.toLine, ch: edit.toCh },
		text: edit.text,
	}));
	const carets = editor.listSelections();
	if (carets.length !== 1 || editor.somethingSelected()) {
		editor.transaction({ changes });
		return;
	}
	const caret = editor.getCursor();
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
	editor.transaction({ changes, selection: { from: { line: caret.line, ch: ch + shift } } });
}
```

`applyEditorEdit` 是 quick fix，**留在** `main.ts`，不是对齐。

```419:422:apps/obsidian-plugin/main.ts
function applyEditorEdit(editor: Editor, edit: TextEdit): void {
	editor.transaction({
		changes: [{ from: { line: edit.line, ch: edit.fromCh }, to: { line: edit.line, ch: edit.toCh }, text: edit.text }],
	});
}
```

命令注册：`align-decimal-points` → `alignCommand`；`format-ledger` → `formatInEditor`（`main.ts:606-616`）。

保存 debounce 用 `window.setTimeout`，keyed by path，与校验 `validateTimers` 分开，但时钟不是注入的：

```129:130:apps/obsidian-plugin/main.ts
/** Delay before on-save alignment, so a burst of edits aligns once. */
const ALIGN_DEBOUNCE_MS = 500;
```

```431:432:apps/obsidian-plugin/main.ts
	/** Pending on-save alignment per file path. */
	private readonly alignTimers = new Map<string, number>();
```

```1098:1110:apps/obsidian-plugin/main.ts
	private scheduleAlign(file: TFile): void {
		window.clearTimeout(this.alignTimers.get(file.path));
		this.alignTimers.set(
			file.path,
			window.setTimeout(() => {
				this.alignTimers.delete(file.path);
				if (!this.settings.alignOnSave) return;
				this.alignFile(file).catch(() => undefined);
			}, ALIGN_DEBOUNCE_MS)
		);
	}
```

`alignFile`（adapter，不是光标公式）：打开则改编辑器缓冲；未打开则 `alignText` / `alignFencedDocument`；读后若已打开改编辑器；磁盘已变则不写。

```1389:1415:apps/obsidian-plugin/main.ts
	private async alignFile(file: TFile): Promise<void> {
		const editor = openEditorFor(this.app, file);
		const column = alignmentTarget(this.settings.separatorColumn);
		if (editor) {
			alignOpenEditor(editor, file, column);
			return;
		}
		const text = await this.app.vault.read(file);
		const aligned = isLedgerFile(file) ? alignText(text, column) : alignFencedDocument(text, column);
		if (aligned === text) return;
		const live = openEditorFor(this.app, file);
		if (live) {
			alignOpenEditor(live, file, column);
			return;
		}
		if ((await this.app.vault.read(file)) !== text) return;
		await this.app.vault.modify(file, aligned);
	}
```

`onFileModified`：`isTextFile`（`apps/obsidian-plugin/vault-index.ts:43`，扩展名表 `TEXT_EXTENSIONS` 在 `:31`，仅 `md` / `bean` / `beancount`）才 `scheduleAlign`。Unload 清 `alignTimers` 时也是 `window.clearTimeout`（`main.ts:669-670`）。

按 `.` 已是纯 plan + 薄 keymap：

```76:81:apps/obsidian-plugin/instant-alignment.ts
export function instantAlignmentPlan(
	text: string,
	carets: readonly Caret[],
	separatorColumn: number,
	ledgerLine?: (lineIndex: number) => boolean
): InstantPlan | null {
```

`InstantPlan.changes` 是 **整篇 offset** `{ from, to, insert }`，`carets` 是改写后 offset 数组。`instantAlignmentExtension` 在 `instantAlignment` 关闭或光标不在 Ledger text 时 return false，让编辑器自己插 `.`。

`alignmentTarget`：1-based Separator column → 0-based 列。命令 / 保存 / Format / 按 `.` 必须都走它（#76 / #75.5，硬验收）。

```396:398:apps/obsidian-plugin/align.ts
export function alignmentTarget(separatorColumn: number): number {
	return Math.max(0, separatorColumn - 1);
}
```

`format.ts` 的 `lineChanges` 按空白 run 出最小替换（`format.ts:135-156`）。语法错误：`FormatResult` `{ ok: false, error }`，notice `Line ${line}: ${message}`，缓冲不动。

Enter 缩进已是纯函数，BDD 不在本 issue 三条入口里：

```73:77:apps/obsidian-plugin/posting-indent.ts
export function postingIndentPlan(
	text: string,
	carets: readonly Caret[],
	ledgerLine?: (lineIndex: number) => boolean
): IndentPlan | null {
```

Bench `dot` / `enter`（禁止整篇 `scanLedger`，风险 10）：

```221:222:apps/obsidian-plugin/bench/editor.ts
	['dot', pure(() => instantAlignmentPlan(integerOnly.toString(), [{ anchor: integerCaret, head: integerCaret }], 50))],
	['enter', pure(() => postingIndentPlan(ledgerDoc.toString(), [{ anchor: ledgerDoc.line(ledgerLine).to, head: ledgerDoc.line(ledgerLine).to }]))],
```

覆盖率地板 90%（`apps/obsidian-plugin/vitest.config.mts:28-33`）。CHANGELOG 在仓库根 `## Unreleased`。`apps/obsidian-plugin/README.md` 只指向根 README。

### 合入前序后必须已存在的符号（本计划消费，不重做）

| 来源 | 符号 | 用途 |
| --- | --- | --- |
| 001 | `editorLedger(editor, file)`（打开的编辑器） | 命令 / 按 `.` 的 `lineIsLedger` |
| 001 | `ledgerDoc(kind, source)` / `ledgerKind` / `LedgerKind` / region.`hostIndent` | 磁盘文本与 Format；笔记只改 Fence body |
| 002 | `apps/obsidian-plugin/clock.ts` 的 `Clock` + `systemClock`；`tests/fakes.ts` 的 `FakeClock`（`tick(ms)`） | 保存 debounce；**禁止** `edits.ts` import `validation.ts`（A6.4） |
| 003 | `scan.ts` 的 `parsePostingLine` / `classifyLine`（以 003 实际导出为准） | `align.ts` / `format.ts` 已换行级扫描；本计划不再改词法 |

`extractBeancountFences` 在 001 后不再导出。本计划不得再引入。打开的编辑器问 `editorLedger`；纯文本问 `ledgerDoc`。

### 约定（照着写）

- 领域词用根 `CONTEXT.md`：Ledger file / Ledger kind / Ledger text / Ledger region / Fence body / Host line / Separator column。实现词 **Edit plan / FakeClock / Clock** 不要写进 CONTEXT。
- 错误处理：Format 语法错误返回 `{ error }`，adapter 用已有 `formatErrorNotice` + `Notice`；已格式化 / 已对齐 → 空 changes，无 notice。
- 测试风格：纯函数表驱动，参照 `tests/instant-alignment.test.ts` 的 `apply()`；编辑器假对象用 `createEditor`（`tests/fakes.ts:189`），不要 `loadPlugin`。
- 禁止 `vi.useFakeTimers`。对齐 debounce 用 `FakeClock.tick(500)`。
- TDD：red → green，竖切。先列出 seam 再写第一个失败测试。缺失场景可先在旧 interface 补 characterization，新 module 直接 TDD。
- 匹配现有缩进：插件源文件用 tab。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Drift | `git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/main.ts apps/obsidian-plugin/align.ts apps/obsidian-plugin/format.ts apps/obsidian-plugin/instant-alignment.ts apps/obsidian-plugin/bench/editor.ts apps/obsidian-plugin/tests/plugin.test.ts apps/obsidian-plugin/tests/instant-alignment.test.ts CHANGELOG.md` | 001–005 预期 diff OK；另 `test -f apps/obsidian-plugin/clock.ts` |
| 单测（新） | `cd apps/obsidian-plugin && npx vitest run tests/edits.test.ts` | 全绿 |
| 单测（保存 adapter） | `cd apps/obsidian-plugin && npx vitest run tests/edits-save.test.ts` | 全绿 |
| 单测（`.`） | `cd apps/obsidian-plugin && npx vitest run tests/instant-alignment.test.ts` | 全绿 |
| 类型 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0 |
| Lint | 仓库根 `pnpm lint` | exit 0 |
| Build | 仓库根 `pnpm build` | exit 0 |
| 全量测试 | 仓库根 `pnpm test` | 全绿；覆盖率 ≥90% |
| Bench | `pnpm --filter beancount-obsidian bench` | 各 workload 哈希与 `bench/expected.json`、`bench/editor-expected.json` **一致**；**禁止** `BENCH_UPDATE=1` |

## Suggested executor toolkit

- 实现前读 `skill://tdd`：竖切、只在下方列出的 seam 上测、red 先于 green。
- 领域词：根 `CONTEXT.md`。
- 前序合同：`plans/README.md`「跨 PR 合同」第 4 条（Clock）与风险 6/8/10。
- 不要读 grill transcript；本文件已含 A5.3 / A5.5 / A6.4。

## Scope

**In scope**（只改这些）：

- `apps/obsidian-plugin/edits.ts`（新建）
- `apps/obsidian-plugin/tests/edits.test.ts`（新建）
- `apps/obsidian-plugin/tests/edits-save.test.ts`（新建）
- `apps/obsidian-plugin/instant-alignment.ts`（keymap 只 apply `planInstantDot`；plan 本体迁走或薄封装）
- `apps/obsidian-plugin/main.ts`（删除光标映射；命令 / 保存只 apply；`scheduleAlign` 改注入 Clock；`alignTimers` 仍独立 Map）
- `apps/obsidian-plugin/tests/plugin.test.ts`（光标 / 保存竞态下沉后删除；≤1 条 Format 命令接线冒烟）
- `apps/obsidian-plugin/tests/instant-alignment.test.ts`（改为打 `planInstantDot`，可 re-export 兼容名）
- `apps/obsidian-plugin/bench/editor.ts`（`dot` import 跟到同一纯函数；输出形状不变）
- 根 `CHANGELOG.md`（`## Unreleased` 下一行 Internal）

`align.ts` / `format.ts`：**只许**改调用方所需的 re-export 或让 `alignmentRanges` 继续问 `ledgerDoc`（001 若已改则不要再动）。禁止在本计划里重写对齐/格式化算法。

**Out of scope**（碰了就是做错）：

- `posting-indent.ts` 与 Enter keymap — A5.3 明确不纳入。
- `validation.ts`、`fava.ts`、`clock.ts` 的接口形状、`vault-path.ts`。
- `applyEditorEdit` / quick fix。
- 重开 #76：账本文本规则、Separator column、索引、Fava HTTP、校验失败持续显示。
- 把 `Clock` 定义进 `edits.ts` 或从 `validation.ts` import Clock。
- 为过 bench 在 `dot`/`enter` 里调用 `scanLedger(整篇)`。
- 根 README（无用户可见变化）。
- `CONTEXT.md` / ADR（Edit plan 不进术语表）。
- `plans/README.md`。
- `@repo/beancount-parser`。

## Git workflow

- Branch: `refactor/73-ledger-edits`，基于**最新 main**（001–005 已合）。
- 每逻辑竖切一提交；中文 conventional commits。例：
  - `test: 为 planAlign 光标映射补纯函数测试（#73）`
  - `refactor: Ledger edits 统一账本改写与光标保持（#73）`
- 不要 push、不要开 PR。

## 模块边界 / 公开签名（A5.3，A6.4 修正）

`apps/obsidian-plugin/edits.ts` **不得** `import 'obsidian'`，也不得 import `validation.ts`。

```ts
import type { Clock } from './clock';
import type { LedgerKind } from './fences'; // 001 导出；不要复制类型

export interface EditCaret { line: number; ch: number } // Host line 0-based

export interface TextChange {
  from: EditCaret;
  to: EditCaret;
  text: string;
}

export interface EditPlan {
  changes: readonly TextChange[];
  /** 仅「单个无选区光标」时给出；多光标/选区省略，交给编辑器 */
  caret?: EditCaret;
}

export function planAlign(
  text: string,
  input: {
    carets: readonly { anchor: EditCaret; head: EditCaret }[];
    mode: 'block' | 'selection' | 'document';
    separatorColumn: number; // 1-based 设置；内部 alignmentTarget
    lineIsLedger?: (hostLine0: number) => boolean;
  },
): EditPlan | null;

export function planFormat(
  text: string,
  input: {
    carets: readonly { anchor: EditCaret; head: EditCaret }[];
    separatorColumn: number;
    kind: LedgerKind;
  },
): EditPlan | { error: FormatError };

export function planInstantDot(
  text: string,
  carets: readonly { anchor: number; head: number }[],
  separatorColumn: number,
  lineIsLedger?: (hostLine0: number) => boolean,
): InstantPlan | null;
```

`planInstantDot` 的返回形状必须与今日 `instantAlignmentPlan` 一致（`changes: { from, to, insert }[]`，`carets: number[]`），否则 bench `dot` 哈希会变。可将 `instantAlignmentPlan` 做成 `planInstantDot` 的别名并在 `instant-alignment.ts` re-export，避免测试/bench 大面积改名——但 **实现只能有一份**。

`planAlign` / `planFormat` 返回 `null` 或 `changes.length === 0`：adapter 不 `transaction`、不 notice。

`planFormat` 在任一 Fence body 语法错误时返回 `{ error }`（行号已是文档 1-based Host line，与今日 `formatFencedDocument` 相同）；合法 fence 也不写回。

保存 adapter（可同文件导出，避免 `main.ts` 再藏一份竞态）：

```ts
export interface AlignOnSavePorts {
  clock: Clock;
  read(path: string): Promise<string>;
  modify(path: string, text: string): Promise<void>;
  /** 该 path 若在某叶打开，返回可 apply 的编辑器；否则 null */
  openEditor(path: string): { getValue(): string; apply(plan: EditPlan): void } | null;
  alignOnSave(): boolean;
  separatorColumn(): number;
  ledgerKind(file: { path: string; extension: string }): LedgerKind;
}

export class AlignOnSave {
  constructor(ports: AlignOnSavePorts)
  schedule(file: { path: string; extension: string }): void
  dispose(): void // unload：clearTimeout 全部 alignTimers
}
```

约束（风险 6）：

- `AlignOnSave` **自有** `Map<path, timerId>`，不得与 `LedgerValidation` 的 `validateTimers` 共用。
- 只注入同一 `Clock` **实现**（生产 `systemClock`，测试 `FakeClock`）。插件测试里校验与对齐可以共用**一个** `FakeClock` 时间轴（一次 `tick(500)` 两边到期），但两个 Map。
- debounce 仍 500ms；等待期间 `alignOnSave()` 变 false → 丢弃；burst 多次 `schedule` 只跑最后一次。

四个入口（三个改写 adapter + 保存）：

| 入口 | 职责 |
| --- | --- |
| 命令 Align | `editorLedger(editor, file).lineIsLedger`；无选区 `mode:'block'`，有选区 `mode:'selection'`；`apply(planAlign(...))` |
| 命令 Format | `ledgerKind(file)` → `planFormat`；`{ error }` → `new Notice(formatErrorNotice)`；否则 apply |
| 按 `.` | keymap 读设置 + `editorLedger(...).lineIsLedger`；`planInstantDot`；dispatch 一次 `input.type` |
| 保存 | `AlignOnSave`：有编辑器 → `planAlign(..., mode:'document')` apply；无 → `alignText` / `alignFencedDocument` + 现有读后竞态 |

`main.ts` 的 `alignInEditor` / `formatInEditor` **删除**。命令 callback 不超过：取 text/carets/kind → `plan*` → `editor.transaction`。**不要**改 005 留下的 `PopoverOpen` / `registerEditorSuggest` 接线。

## Steps

### Step 0: 分支与 drift

```sh
git checkout main && git pull
git checkout -b refactor/73-ledger-edits
git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/main.ts apps/obsidian-plugin/align.ts apps/obsidian-plugin/format.ts apps/obsidian-plugin/instant-alignment.ts
test -f apps/obsidian-plugin/clock.ts
```

**Verify**: `clock.ts` 存在并导出 `Clock` / `systemClock`；`tests/fakes.ts` 有 `FakeClock` 且 `tick`。缺失 → STOP（002 未合）。`posting-indent.ts` 相对 003 可以变（行级扫描），但本计划仍不改它。

列出本计划 seam（写进 `edits.test.ts` 文件头注释即可，不要另建 md）：

1. `planAlign`：文本 + carets + mode + Separator column → changes + 可选 caret
2. `planFormat`：同上 + `LedgerKind` → changes + caret，或 `{ error }`
3. `planInstantDot`：offset carets → InstantPlan（与今日字节级行为一致）
4. `AlignOnSave`：Clock + 假 vault + 假 openEditor → debounce / 竞态 / 扩展名过滤
5. 薄 apply：`createEditor` + `EditPlan` → 一次 transaction（不 `loadPlugin`）

### Step 1: TDD `planAlign`（竖切 1）

在 `tests/edits.test.ts` **先写失败测试**（不要先写 `edits.ts` 实现）。模式：`instant-alignment.test.ts` 的 `apply`，但 changes 是 line/ch。用字面量期望，不要 `alignedLines()` 自己再算一遍当断言（避免套套）。

最小第一刀：无选区、两笔交易、光标在第二笔 → 只改第二笔；`changes` 非空；`caret` 给出。跑：

```sh
cd apps/obsidian-plugin && npx vitest run tests/edits.test.ts
```

**Verify**: 红（模块不存在或函数未定义）。然后只实现 `planAlign` 的 `mode:'block'`，复用 `blockRangeAt` / `computeAlignment` / `alignmentTarget`，再绿。

继续竖切（每条 red→green）：

- `mode:'selection'`：单行已对齐 → `null`；两行 posting → 只这两行；选区拖到第 2 行列 0 → 第 2 行不参与、不撑列（搬 `commandScope` 的 `endCh === 0` 规则进 plan，**不要**依赖 `Editor`）。
- 光标四位置 + 多光标省略 `caret` + 选区省略 `caret`（对照 `plugin.test.ts:646-742` 的期望列）。
- 笔记：`lineIsLedger` false 的 Host line 不改（fence 外形似 posting 的散文）。无 `lineIsLedger` 时整篇当 Ledger file。
- 只改金额前空白；tab / nbsp 换成普通空格。字符串续行 / `;` 注释不改——交给现有 `computeAlignment`，这里断言 `planAlign` 不另出 changes。

**Verify**: `npx vitest run tests/edits.test.ts` 全绿。

### Step 2: TDD `planFormat`（竖切 2）

同一测试文件（或 `describe('planFormat')`）：

- Ledger file：`2022-01-01   open   Assets:A` → `2022-01-01 open Assets:A`；已格式化 → `null` 或空 changes。
- `kind:'fenced'`：散文 `"# title  "` + 三个 fence 语言（```beancount / ```bean / ~~~bean）只改 body；开/闭标记与其它语言 fence 原文；缩进 fence 保留前导（用 region.`hostIndent`，不要重扫 opener）。
- 未闭合 fence：格式化已有正文，文末不多空行。
- 语法错误：笔记 intro 后 fence `2022-01-01 open` → `{ error: { line: 4, ... missing ACCOUNT } }`；`.beancount` 缺 ACCOUNT → Line 1 `<EOF>`；后一个 fence 出错则**整篇** `{ error }`。
- 单光标跨两段被压缩空白：对照 `plugin.test.ts:2442-2489`（`*` 上 ch 13→11；payee `S` 18→14）。多光标 / 选区省略 `caret`。
- Separator column：已按 50 对齐的 posting，Format 不再把点拉回紧凑列（#75.5 硬验收）。

实现：调用现有 `formatLedger` / `formatFencedDocument` + `lineChanges`，再套 format 光标公式。不要复制 `rewriteLines`。

**Verify**: `npx vitest run tests/edits.test.ts` 全绿。

### Step 3: 迁 `planInstantDot`（竖切 3）

把 `instantAlignmentPlan` 函数体移到 `edits.ts` 的 `planInstantDot`（或 `export const instantAlignmentPlan = planInstantDot`）。`instant-alignment.ts` 只保留 keymap：关设置 / 非 Ledger text / plan 为 null → `return false`。

`tests/instant-alignment.test.ts` 改为从 `edits` 或 re-export 打同一函数。keymap 单测（一次 transaction、`instantAlignment: false` 不接管）留在该文件，**不要** `loadPlugin`。

禁止在 `.` 路径调用 `scanLedger(整篇缓冲)`。继续用 `isAmountDotInsert` + `blockRangeInLedger` + `computeAlignment`。

**Verify**: `npx vitest run tests/instant-alignment.test.ts tests/edits.test.ts` 全绿。

### Step 4: TDD `AlignOnSave`（竖切 4）

`tests/edits-save.test.ts`：**禁止** `loadPlugin`、禁止 `delay(600)`、禁止 `vi.useFakeTimers`。用 `FakeClock` + 内存 Map 当 vault。

场景（从 `plugin.test.ts:861-1172` 下沉）：

- `alignOnSave` 关：`schedule` 后 `tick(500)` 不 `modify`。
- 未打开的 `.bean`：`tick(500)` 后 `modify` 一次；再因自己的写入 `schedule` → 已对齐不再写。
- burst 两次 `schedule`：只一次 rewrite。
- 等待期间把 `alignOnSave()` 改为 false：丢弃。
- 扩展名不是 `md`/`bean`/`beancount`：`schedule` 直接 no-op（可在 adapter 外由 `isTextFile` 过滤；测试钉死 png 不写）。
- 打开的文件：走 `openEditor.apply(planAlign document)`，不 `modify`。
- 读取期间磁盘内容变化：不把过期文本写回。
- 读取期间文件被打开：改走编辑器，不覆盖缓冲。
- 笔记：只对齐 Fence body；无 fence 的笔记不写。
- 读失败：不抛到外层（`.catch` 或内部吞掉），不写。

`main.ts` 的 `scheduleAlign` / `alignFile` / `alignTimers` / unload 清 timer 改为委托 `AlignOnSave`。生产 `clock` 用 `systemClock`（002 已给插件的那个实例，**不要** new 第二份系统时钟除非 002 没挂在 plugin 上——那时在 plugin 持有一个 `systemClock` 传给 validation 与 AlignOnSave）。

**Verify**: `npx vitest run tests/edits-save.test.ts` 全绿；测试文件内 `grep delay` / `loadPlugin` / `useFakeTimers` 无匹配。

### Step 5: cutover `main.ts` 与删光标映射

- 删除 `alignInEditor`、`formatInEditor`、以及只为它们服务的 `editorLines`/`commandScope`（若仍被别处用则 STOP 再看，不要为了删而留死包装）。
- `alignCommand` → `planAlign` + `editor.transaction`。
- Format 命令 → `planFormat` + Notice/transaction。
- `grep -n 'ch += edit.text.length' apps/obsidian-plugin/main.ts` 必须空。
- `grep -n 'alignInEditor\\|formatInEditor' apps/obsidian-plugin` 必须空（测试字符串除外）。
- 插件冒烟 **最多 1 条**：`plugin.test.ts` 里 Format 命令仍注册、`editorCallback` 能改一行（A5.5）。对齐光标断言全部离开 `plugin.test.ts`。
- 保存 `delay(600)` 用例从 `plugin.test.ts` 删除（已在 `edits-save.test.ts`）。
- 不要动 Fava / validation 字段；不要还原 005 的 `PopoverOpen`；不要「顺便」拆 `main.ts` 其它块（风险 8：`main.ts` 到 007 才瘦到装配）。

**Verify**:

```sh
cd apps/obsidian-plugin && npx vitest run tests/edits.test.ts tests/edits-save.test.ts tests/instant-alignment.test.ts tests/plugin.test.ts
grep -n 'alignInEditor\|formatInEditor' apps/obsidian-plugin --include='*.ts' | grep -v tests || true
```

`plugin.test.ts` 里对齐光标用例（原 `keeps a lone caret` / `rides a caret inside the gap` 等）必须已删。`loadPlugin` 仍可用于其它无关套件。

### Step 6: CHANGELOG、bench、全量门

根 `CHANGELOG.md` 的 `## Unreleased` 增加 Internal（若还没有 `### Internal` 就加一节）：

```markdown
### Internal

- 对齐、Format ledger 与按 `.` 共用同一份改写计划（#73）。
```

不要改根 README。不要 `BENCH_UPDATE=1`。

```sh
pnpm --filter beancount-obsidian bench
cd /Users/zhouyang/orca/workspaces/obsidian-beancount/seadevil && pnpm lint && pnpm build && pnpm test
```

**Verify**: bench 打印哈希匹配 expected；lint/build/test exit 0；覆盖率阈值过。若 `align`/`dot` 哈希变了且不是 003 已声明的 CJK 对齐变化 → STOP，回退算法，禁止改 expected。

## Test plan

新文件：

- `apps/obsidian-plugin/tests/edits.test.ts` — seam 1–3、5。结构参照 `tests/instant-alignment.test.ts`。
- `apps/obsidian-plugin/tests/edits-save.test.ts` — seam 4。假 vault + `FakeClock`，参照 `FakeVault` API（`tests/fakes.ts`），不要抄 `loadPlugin`。

保留并改 import：

- `tests/instant-alignment.test.ts` — plan + keymap。
- `tests/align.test.ts` / `tests/format.test.ts` — 算法回归，不要删。

从 `plugin.test.ts` **迁走后删除**的对齐/格式化光标与保存 debounce（A5.5：命令光标不启动插件）。

插件 ≤1 冒烟：Format 命令接线。

`tests/edits*.test.ts` 不得出现：`loadPlugin`、`delay(600)`、`vi.useFakeTimers`、`editorSuggests[`。

## BDD 测试地图

issue #73 场景 → 本计划测试。原 `# 待产品决定` 且 #76 已定的改为硬验收。

| 场景 | 原注释 | 落点 | 验收 |
| --- | --- | --- | --- |
| 无选区 Align 只改光标所在交易；一次 transaction | 现有 plugin.test.ts:532/562 | `edits.test.ts` `planAlign` mode `block` | 硬 |
| 有选区只对齐选中行；拖到下行列 0 不包含该行 | 现有 plugin.test.ts:583/696 | `planAlign` mode `selection` | 硬 |
| 按 `.` 把点放到 Separator column；账户超列不往回拉；邻交易不动 | 现有 instant-alignment.test.ts | `planInstantDot` | 硬 |
| 命令、保存、Format、按 `.` 同一目标列 | 原待产品决定 #75.5；#76 已定 | `edits.test.ts` 四处都用 `separatorColumn: 50` / `1` 对照 | **硬验收** |
| 单光标随空隙移动；选区/多光标不折叠 | 现有 plugin.test.ts:646-742 | `planAlign` caret 规则 | 硬 |
| 只改金额前空白；字符串/注释伪 posting 不动 | 现有 align.test.ts | 保留 align.test + `planAlign` 冒烟 | 硬 |
| Format：Ledger file 全文；笔记只 fence；缩进保留；未闭合不追加空行；已格式化无 transaction/notice | 现有 plugin.test.ts:2390+ | `planFormat` | 硬 |
| Format 语法错误报文档行号，全文不变；后一 fence 出错前面也不写 | 现有 plugin.test.ts:2423 | `planFormat` `{ error }` | 硬 |
| Format 单光标跨空白 run；一次 transaction；多光标不强制 | 现有 plugin.test.ts:2442 | `planFormat` caret | 硬 |
| 保存对齐整份缓冲、500ms debounce、已对齐停止、等待关设置丢弃、非 md/bean/beancount 不齐 | 现有 plugin.test.ts:872+ | `edits-save.test.ts` + `FakeClock.tick(500)` | 硬 |
| 打开的文件改编辑器；读期间磁盘变不覆盖；读期间打开改走编辑器 | 现有 plugin.test.ts:1018/1135/1157 | `edits-save.test.ts` | 硬 |
| 按 `.` 只在金额整数后接管；散文/payee/小数/空隙/cost/price/选区/关设置不接管 | 现有 instant-alignment.test.ts | `planInstantDot` + keymap | 硬 |
| 笔记 fence 外 posting 不被 Align / 保存 / `.` 改写；无 fence 笔记保存不对齐 | 原待产品决定 #75.4；#76 已定 | `planAlign` + `AlignOnSave` + `planInstantDot` 用 `lineIsLedger` | **硬验收** |

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f apps/obsidian-plugin/edits.ts` 且导出 `planAlign` / `planFormat` / `planInstantDot`
- [ ] `grep -n "from './validation'" apps/obsidian-plugin/edits.ts` 无匹配
- [ ] `grep -n "from 'obsidian'" apps/obsidian-plugin/edits.ts` 无匹配
- [ ] `grep -nE 'alignInEditor|formatInEditor' apps/obsidian-plugin --include='*.ts' | grep -v tests` 无匹配
- [ ] `grep -n 'ch += edit.text.length' apps/obsidian-plugin/main.ts` 无匹配
- [ ] `grep -n 'window.setTimeout' apps/obsidian-plugin/main.ts | grep -i align` 无匹配（对齐 debounce 走 `clock.setTimeout`）
- [ ] `grep -nE 'loadPlugin|delay\(600\)|useFakeTimers' apps/obsidian-plugin/tests/edits.test.ts apps/obsidian-plugin/tests/edits-save.test.ts` 无匹配
- [ ] `grep -n postingIndentPlan apps/obsidian-plugin/edits.ts` 无匹配
- [ ] `grep -n scanLedger apps/obsidian-plugin/instant-alignment.ts apps/obsidian-plugin/edits.ts` 若有匹配，不得出现对整份缓冲的 `scanLedger(` 调用（`.` 路径禁止）
- [ ] `grep -n '### Internal' CHANGELOG.md` 有匹配，且 Unreleased 含 `#73`
- [ ] `git diff --stat HEAD -- README.md apps/obsidian-plugin/README.md apps/obsidian-plugin/posting-indent.ts` 空（这三项本计划不改）
- [ ] `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` exit 0
- [ ] 仓库根 `pnpm lint`、`pnpm build`、`pnpm test` exit 0；覆盖率 ≥90%
- [ ] `pnpm --filter beancount-obsidian bench` 哈希不变（未设 `BENCH_UPDATE`）
- [ ] 工作区无 in-scope 之外的源码改动（`git status`）

## STOP conditions

Stop and report back (do not improvise) if:

- Drift check 显示 001–005 **以外**的人已改 `alignInEditor` / `formatInEditor` / `instantAlignmentPlan` 语义，或 Current state 摘录对不上且不是 `editorLedger` / `ledgerDoc` / `Clock` 替换。
- `apps/obsidian-plugin/clock.ts` 没有 `Clock` / `systemClock`，或 `tests/fakes.ts` 没有 `FakeClock.tick`（002 未合）。不要自己再定义一套 Clock，也不要从 `validation.ts` 抽。不要 import `vault-path.ts`（本计划不消费）。
- 实现 `planAlign` 似乎必须 `import 'obsidian'` 或启动插件才能测光标 — 说明 seam 做错了，停下来。
- 为了让保存测试过，想继续 `loadPlugin` + `delay(600)`，或想用 `vi.useFakeTimers`。
- bench `dot` / `align` / `format` 哈希变了。**禁止** `BENCH_UPDATE=1`。若 003 已声明 CJK 对齐变化且 expected 已更新，本计划仍不得再改 expected。
- 发现必须改 `posting-indent.ts`、Enter keymap、或把 Enter 收进 `edits.ts`。不要把 005 的 `PopoverOpen` 还原成 7 元素数组。
- 发现必须改 `validation.ts` 的 timer map，或想让 `alignTimers` 与 `validateTimers` 合成一个 Map。
- 想恢复 `extractBeancountFences` 导出，或对 `ledgerSource()` 拼接串做对齐扫描。
- 某步验证连续失败两次。
- 覆盖率掉到 90% 以下，且只能靠测私有函数补 — 停，不要测 internals。

## Maintenance notes

- 以后任何「改缓冲 + 保光标」的账本改写（含新命令）必须新增 `plan*`，禁止在 `main.ts` 再写一份 `ch +=`。Enter 仍在 `posting-indent.ts`；若将来合并，另开 issue，不要偷偷塞进本 module。
- 评审盯：① 三入口是否真共用 `plan*`；② `AlignOnSave` 与 validation 是否两个 timer Map、同一 `Clock`；③ `edits.ts` 零 Obsidian / 零 validation import；④ 光标测试是否零 `loadPlugin`；⑤ bench 哈希；⑥ fence 外散文与 Separator column 未被「优化」掉。
- 本计划显式推迟：posting-indent、Fava、把 `main.ts` 拆到只剩装配（007）。
- 001 的 `hostIndent` 是 Format 缩进 fence 的 seam；不要在 format 里再扫 opener。
- 术语：用户可见的列叫 **Separator column**；不要在 UI 文案里写 Edit plan。
