# Plan 002: Ledger validation 收拢为 deep module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, **do not** update `plans/README.md` —
> 编排者维护索引。
>
> **Drift check (run first)**:
> ```
> git diff --stat 8b75729..HEAD -- \
>   apps/obsidian-plugin/main.ts \
>   apps/obsidian-plugin/problems.ts \
>   apps/obsidian-plugin/bean-check.ts \
>   apps/obsidian-plugin/diagnostics.ts \
>   apps/obsidian-plugin/fences.ts \
>   apps/obsidian-plugin/tests/fakes.ts \
>   apps/obsidian-plugin/tests/plugin.test.ts \
>   apps/obsidian-plugin/tests/plugin-lifecycle.test.ts \
>   apps/obsidian-plugin/tests/problems.test.ts \
>   apps/obsidian-plugin/tests/diagnostics.test.ts \
>   CHANGELOG.md
> ```
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition — **except** the expected #69
> (`plans/001-ledger-regions.md`) cutover listed under "Depends on"
> (`extractBeancountFences`/`buildFenceLedger` → `ledgerDoc`/`tempLedger`；
> 校验字段仍在 `BeancountPlugin` 上)。
>
> **TDD**: 先列 seam 上的失败测试，再写实现（red → green，竖切）。禁止
> **新增** `vi.useFakeTimers`（`tests/report-view.test.ts` 里已有的不要动）。
> 用 `tests/fakes.ts` 的 `FakeClock`。若环境有 `tdd` skill，写测试时先读它。
>
> **Run target ≠ Ledger kind**：只对 Ledger file 与 `.md` 发 `saved`/`opened`。
> `.txt` / 无文件不是 bean-check 入口（001 编辑器 fenced 不改变这一点）。
> `resolveInVault` 签名：`{ ok: true; absPath: string } | { ok: false; reason: 'escape' }`。

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-ledger-regions.md`（必须已合并）
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/68

## Why this matters

校验（保存 / 打开 → bean-check → Problems + markers）是 bug 最密的区域（#14、#19、#33、#49），却没有自己的 module：约 450 行和十几个私有字段挂在 `BeancountPlugin` 上。Run target 写了四遍；Replay 把 `ProblemRow` 捏回伪 `BeanCheckError`；flag 与 bean-check 标靠比较 `FLAGGED_MESSAGE` 拆开。插件测试用 `delay(600)` 等 500ms debounce，慢且测不到 seq/mtime 不变量的核心。

落地后调用方只报事件；`LedgerValidation` 拥有 debounce、只让最新一次 run 发布、卸载静默、Temp ledger 行号回映、禁逃逸、Problems 写入、Marker owner、notice 去重。下一个同类 bug 修在一个文件里。用户可见行为不变（含 #76 已定：失败 run 保留旧标、Problems 持续显示失败行）。

## Current state

本计划写于 `8b75729`。执行时 **001 必须已合并**；下面摘录是当时的真实代码。001 会改 `fences.ts` 导出并替换 `main.ts` 里对 `extractBeancountFences` / `buildFenceLedger` 的调用，**不会**搬走下面列出的校验字段。

### 001 落地后必须已经存在（本计划消费，不重做）

- `ledgerKind` / `ledgerDoc(kind, source)` / `LedgerDoc.tempLedger(includePath?)`
- `TempLedger.text` + `hostLine(tempLine1)`：1-based temp → 1-based 宿主（与现 `buildFenceLedger` 相同）
- `ledgerSource()` 与 `tempLedger()` **不是**同一份文本（fence 间空行、可选 `include` 只在后者）
- `extractBeancountFences` 已停止导出

若 `ledgerDoc(...).tempLedger` 不存在 → STOP。

### 相关文件

- `apps/obsidian-plugin/main.ts` — 插件装配；校验生命周期与 9+ 字段仍在这里（1417 行）
- `apps/obsidian-plugin/bean-check.ts` — spawn + `BeanCheckError` / `LineDiagnostic` / `toLineDiagnostics` / `isBeanCheckBinary`
- `apps/obsidian-plugin/problems.ts` — `ProblemStore` 视图模型；误放的 `openValidationTarget`
- `apps/obsidian-plugin/problems-view.ts` — 只读 `ProblemStore`（构造注入）
- `apps/obsidian-plugin/diagnostics.ts` — 单一 `lineDiagnostics` StateField + gutter
- `apps/obsidian-plugin/code-actions.ts` — `FLAGGED_MESSAGE`、`flagDiagnostics*`、`mergeDiagnostics`
- `apps/obsidian-plugin/fences.ts` — （001 后）`tempLedger`；现网仍有 `buildFenceLedger` / `isSafeIncludePath`
- `apps/obsidian-plugin/flag-warnings.ts` — 设置驱动的 `!`/`*` 波浪线；**本计划不动**
- `apps/obsidian-plugin/tests/fakes.ts` — `FakeVault` / `createEditor` / `flush`；**无 Clock**
- 插件测试：`tests/plugin.test.ts`、`tests/plugin-lifecycle.test.ts`、`tests/problems.test.ts` 大量 `delay(600)`

### 摘录（`8b75729`，自行读到）

校验字段（`main.ts:433-467`）：

```433:467:apps/obsidian-plugin/main.ts
	/** Pending on-save validation per run target. */
	private readonly validateTimers = new Map<string, number>();
	/**
	 * In-flight `validateFile` calls per target. A count, not a flag: an older
	 * run's `finally` must not clear a newer run still checking the same target.
	 */
	private readonly validateInFlight = new Map<string, number>();
	/** Which run (its target path) last marked each vault file, so its next run clears them. */
	private readonly markOwners = new Map<string, string>();
	/** Open files this extra loop last stamped with flag markers. */
	private readonly extraFlagged = new Set<string>();

	/** Newest run per target; older runs finishing later must not report. */
	private readonly validateSeq = new Map<string, number>();
	/** False after cleanup; in-flight bean-check must not publish. */
	private validateLive = true;
	/** mtime of each target when its last run reported; a later open at that mtime skips. */
	private readonly lastValidatedMtime = new Map<string, number>();
	/** Latest bean-check rows per target, including files that are not open. */
	private readonly problems = new ProblemStore();
	/**
	 * Entry ledger the stored rows were collected under. Compared in
	 * `saveSettings`: a change drops every target, because rows keyed by the
	 * old per-file targets would never be replaced by a later run.
	 */
	private problemsEntryLedger = '';
	/** bean-check path the notice dedupe was last reset under. */
	private problemsBeanCheckPath = '';
	/**
	 * Notice texts shown per run target since that target's last quiet run.
	 * Autosave must not stack the same toast; another target's quiet run
	 * must not re-arm this one. A bean-check-path or entry-ledger change
	 * clears every target.
	 */
	private readonly noticesShown = new Map<string, Set<string>>();
```

（若 live 代码把 `problemsBeanCheckPath` 算进去，清单里一并搬走；它与 `noticesShown` 同属校验。）

`FLAGGED_MESSAGE` 过滤（`main.ts:185-193`）：

```185:193:apps/obsidian-plugin/main.ts
function flagsFor(path: string, text: string): LineDiagnostic[] {
	return path.endsWith('.md') ? flagDiagnosticsFromFences(extractBeancountFences(text)) : flagDiagnostics(text);
}

function beanDiagnosticsOn(editor: Editor): LineDiagnostic[] {
	const view = (editor as Editor & { cm?: EditorView }).cm;
	const field = view?.state?.field?.(lineDiagnostics);
	if (!field) return [];
	return field.filter((diagnostic) => diagnostic.message !== FLAGGED_MESSAGE);
}
```

Debounce 与第四份之外的 Run target（`main.ts:1112-1123`、`:1135-1139`）：

```1112:1123:apps/obsidian-plugin/main.ts
	private scheduleValidate(file: TFile): void {
		// Keyed by run target: with an entry ledger, saves of any member
		// ledger file are one run. Markdown notes keep their own window —
		// they check a temp file, not the entry ledger itself.
		const target = file.extension === 'md' ? file.path : this.settings.entryLedger.trim() || file.path;
		window.clearTimeout(this.validateTimers.get(target));
		this.validateTimers.set(
			target,
			window.setTimeout(() => {
				this.validateTimers.delete(target);
				this.validateFile(file).catch(() => undefined);
			}, VALIDATE_DEBOUNCE_MS)
		);
	}
```

Replay 伪造 `BeanCheckError`（`main.ts:1042-1051`）：

```1042:1051:apps/obsidian-plugin/main.ts
	private replayStoredMarkers(file: TFile, target: string): void {
		const rows = this.problems.rowsFor(target).filter((row) => row.vaultPath === file.path);
		const bean = toLineDiagnostics(
			rows.map((row) => ({ file: row.vaultPath ?? row.file, line: row.line, message: row.message })),
		);
		for (const editor of openEditorsFor(this.app, file)) {
			setEditorLineDiagnostics(
				editor,
				mergeDiagnostics(bean, flagsFor(file.path, editor.getValue())),
			);
		}
	}
```

`openValidationTarget` 在 `problems.ts:92-106`（第四份 Run target + mtime skip）。`ProblemStore.replace` / `fail` / `clear` / `groups` / `subscribe`：`problems.ts:133-216`。Problems 视图：`problems-view.ts:100-102` 只读 store。

单一 CM field：`diagnostics.ts:21` `setLineDiagnostics`、`:33-49` `lineDiagnostics`、`:128-139` gutter 只读该 field。`createDiagnosticsExtension(this)` 在 `main.ts:585`。

Gutter 点击用该 field 的 message：`main.ts:877-888`。

禁逃逸与 temp 落盘仍内联在 `validateFile`（`main.ts:1179-1228`）：`relative(root, resolve(root, entry || file.path))` + `realpathSync`；笔记走 `buildFenceLedger` + `mkdtempSync` + `fences.bean`。

`saveSettings` 知道校验内部（`main.ts:686-711`）：清 `noticesShown`、`problems.clear()`、`lastValidatedMtime`、`dropOwnedBeanCheckMarkers()`、非 `.md` 的 `validateSeq` +1，**不重跑**。

`onload` 接线：`main.ts:656-672` modify → `scheduleValidate`；delete/rename → `dropValidation`；file-open → `onFileOpened`；cleanup 翻 `validateLive` 并清 `validateTimers`。

`alignTimers`（`main.ts:432`）与 `scheduleAlign`（`:1098-1109`）**留下**，属 #73。

### 约定

- 错误处理：失败 run 走 `ProblemStore.fail`（`problems.ts:157-163`），**不**清旧 markers。#76 已定，禁止改成清标或会话级只弹一次 notice。
- 测试：model after `apps/obsidian-plugin/tests/diagnostics.test.ts`（纯 field）和 `tests/problems.test.ts` 里 `describe('ProblemStore')`（不启动插件）。新测试 **禁止** `loadPlugin`，禁止 `await delay(600)`。
- 覆盖率地板 90%：`apps/obsidian-plugin/vitest.config.mts:28-33`。
- CHANGELOG 在仓库根 `CHANGELOG.md` 的 `## Unreleased`；纯内部重构写一行 `### Internal`。
- 术语用根 `CONTEXT.md`：Ledger file / Ledger kind / Ledger text / Ledger region / Fence body / Host line / Temp ledger / Entry ledger / Run target / Marker owner / Replay / Quiet run。不要把 Clock、TempFilePort、FakeClock 写进 CONTEXT。

### `main.ts` 必须移除的字段 / 方法 / 模块级函数

**字段（全部迁入 `LedgerValidation` 或删除）：**

| 符号 | 处置 |
|------|------|
| `validateTimers` | 迁入 validation（debounce Map，**不要**与 `alignTimers` 合并） |
| `validateInFlight` | 迁入 |
| `validateSeq` | 迁入 |
| `validateLive` | 迁入（`unload` 事件） |
| `lastValidatedMtime` | 迁入 |
| `markOwners` | 迁入（Marker owner） |
| `extraFlagged` | **删除**（flag 离开校验） |
| `noticesShown` | 迁入（去重在 validation 内） |
| `problems` | 改为 `validation.problems`（同一 `ProblemStore` 实例交给 Problems 视图） |
| `problemsEntryLedger` | 迁入 / 由 `entryLedgerChanged` 取代 |
| `problemsBeanCheckPath` | 迁入 / 由 `beanCheckPathChanged` 取代 |

**方法：**

| 符号 | 处置 |
|------|------|
| `onFileOpened` | 插件改为 `handle({ kind: 'opened', ... })` |
| `scheduleOpenValidation` | 迁入 |
| `replayStoredMarkers` | 迁入；改读缓存 `LineDiagnostic`，禁止 `ProblemRow` → `BeanCheckError` |
| `dropValidation` | 迁入（`deleted` / `renamed`） |
| `dropOwnedBeanCheckMarkers` | 迁入（`entryLedgerChanged`） |
| `scheduleValidate` | 迁入（`saved`） |
| `validateFile` | 迁入 |
| `markErrors` | 迁入；只 `MarkerSink.setBean`，不再 `mergeDiagnostics` / `flagsFor` |
| `recordRunFailure` | 迁入 |
| `notify` | 迁入（`Notifier.show` + 内部去重） |
| `onFileModified` 里的 `scheduleValidate` 分支 | 改为 `handle({ kind: 'saved', ... })`；**保留** `scheduleAlign` |
| `saveSettings` 里清 Problems / mtime / seq / notices 的块 | 改为发 `entryLedgerChanged` / `beanCheckPathChanged` |
| `onload` cleanup 里 `validateLive` / `validateSeq` / `validateTimers` | 改为 `handle({ kind: 'unload' })`；**保留** `alignTimers` 清理 |

**模块级函数 / 常量（从 `main.ts` 搬走）：**

| 符号 | 去向 |
|------|------|
| `VALIDATE_DEBOUNCE_MS` | `validation.ts` |
| `MISSING_BEAN_CHECK_REASON` / `_NOTICE` | `validation.ts` |
| `TEMP_LEDGER_NOTICE` / `_REASON` | `validation.ts` |
| `flagsFor` | flag 扩展（或删除，由扩展直接调 `flagDiagnostics*`） |
| `beanDiagnosticsOn` | **删除** |
| `vaultRoot` | `vault-path.ts` |
| `matchesTempFile` | `validation.ts` |
| `vaultPathForReported` | `validation.ts` |

**留下（本计划不要删）：** `alignTimers`、`scheduleAlign`、`alignFile`、`openEditorFor` / `openEditorsFor` / `openEditorFiles`（MarkerSink 适配器与对齐仍要用）、`beanCheckRunner` 公开字段（装配时传入 Runner；≤3 冒烟仍可换这个字段）、Fava 全部字段/方法、`FlagWarningController`、`onDiagnosticClick`（改为并集两 field）。

## Commands you will need

在仓库根 `/Users/zhouyang/orca/workspaces/obsidian-beancount/seadevil`：

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift | 见文首 drift 命令 | 空，或仅为 001 的 fences/main/problems cutover |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Test (all) | `pnpm test` | 全绿；覆盖率 statements/branches/functions/lines ≥ 90 |
| 单文件 | `cd apps/obsidian-plugin && npx vitest run tests/validation.test.ts` | 该文件全绿 |
| 类型检查 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0，无 errors |
| Bench | **不要跑**（本计划不碰 align/format/suggest/parser 热路径）。需要重写 expected 时才 `BENCH_UPDATE=1` — 本计划不允许 |

基线（计划时）：1064 测试全绿。不要为凑旧的 96% 堆实现细节测试。

## Suggested executor toolkit

- 写测试时用 `tdd` skill（red → green，先失败断言）。
- 调试失败测试用 `diagnosing-bugs`；**不要**用重跑来「确认」用户/计划已写明的失败。
- 参考：issue #68 BDD；根 `CONTEXT.md` 术语；`CONTRIBUTING.md` 的 PR 门槛。

## Scope

**In scope**（只改这些）：

- `apps/obsidian-plugin/clock.ts`（新建）
- `apps/obsidian-plugin/vault-path.ts`（新建）
- `apps/obsidian-plugin/validation.ts`（新建，导出 `LedgerValidation`）
- `apps/obsidian-plugin/diagnostics.ts`（两个 StateField + gutter 并集）
- `apps/obsidian-plugin/main.ts`（装配：构造 `LedgerValidation`、接线、删除上表符号）
- `apps/obsidian-plugin/problems.ts`（`openValidationTarget` 迁出；store 段保留。`fileMtime` / `toProblemRows` 可留）
- `apps/obsidian-plugin/tests/fakes.ts`（`FakeClock`）
- `apps/obsidian-plugin/tests/validation.test.ts`（新建，BDD 下沉）
- `apps/obsidian-plugin/tests/clock.test.ts` 或把 Clock 测放进 `validation.test.ts` / `fakes` 同测（择一，不要第三份时钟）
- `apps/obsidian-plugin/tests/vault-path.test.ts`（或并入 `validation.test.ts`）
- `apps/obsidian-plugin/tests/diagnostics.test.ts`（两 field、gutter 并集、tooltip bean 优先）
- `apps/obsidian-plugin/tests/plugin.test.ts`、`plugin-lifecycle.test.ts`、`problems.test.ts`（校验场景下沉/删除 `delay(600)`；留下 ≤3 装配冒烟；**对齐**的 `delay(600)` 不动）
- `CHANGELOG.md`（`## Unreleased` 下一行 Internal）

**Out of scope**（碰了就 STOP）：

- `flag-warnings.ts` / `FlagWarningController`
- `code-actions.ts`（`FLAGGED_MESSAGE` / `flagDiagnostics*` / `mergeDiagnostics` 可 import；不要为了删死代码去改这个文件）
- `align.ts` / `format.ts` / `scheduleAlign` / `alignTimers`（#73；Clock **实现**可共用，timer Map 必须独立）
- `fava.ts` 与 `favaDelay`（不要改成 `Clock`）
- `fences.ts` 的扫描实现（只 **调用** `ledgerDoc().tempLedger`）
- 统一四份 `loadPlugin`
- **新增** `vi.useFakeTimers`（现网 `tests/report-view.test.ts:248` 已有，不要删、不要学）
- 把校验扩到 `.txt` / 无文件缓冲（今日只校验 Ledger file 与 `.md`）。若 001 误把 `openValidationTarget` 扩到 `.txt`，本计划改回 `isLedgerFile || extension === 'md'`
- 重开 #76：账本文本规则、失败持续显示、notice 按 target 去重
- `plans/README.md`（编排者维护 Status）、`CONTEXT.md`（术语已在 001 写入）、ADR（本 PR 不新增）
- README（无用户可见行为变化）
- bench expected 文件

## Git workflow

- 基于**最新 main**（须含 001）。分支：`refactor/68-ledger-validation`
- 提交信息：中文 conventional commits。例：
  - `test: 引入 FakeClock 作为校验 debounce 的 seam（#68）`
  - `refactor: 抽出 vault-path 禁逃逸（#68）`
  - `refactor: Ledger validation 收拢校验生命周期（#68）`
- 每逻辑单元可一次提交；第一步必须是 Clock/FakeClock。
- **不要 push、不要开 PR**（编排者做）。

## 模块边界（签名）

事件用 `kind`（不要用 `op`，以免和 Ledger kind 以外的词打架；与 001 的 `LedgerKind` 不在同一类型里）。

```ts
type ValidationEvent =
  | { kind: 'saved'; file: FileRef }
  | { kind: 'opened'; file: FileRef; text: string }
  | { kind: 'renamed'; oldPath: string }
  | { kind: 'deleted'; path: string }
  | { kind: 'entryLedgerChanged'; entryLedger: string }
  | { kind: 'beanCheckPathChanged' }
  | { kind: 'unload' };

interface FileRef {
  path: string;
  extension: string;
  mtime?: number;
}

interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

interface VaultPort {
  read(path: string): Promise<string>;
  files(): Iterable<FileRef>;
  resolveInVault(vaultRel: string): { ok: true; absPath: string } | { ok: false; reason: 'escape' };
  vaultRoot(): string;
}

/** 只落盘。文本+映射来自 LedgerDoc.tempLedger（A6.1）。不要再叫 TempLedgerPort。 */
interface TempFilePort {
  write(text: string): { checkPath: string; dispose(): void };
}

interface MarkerSink {
  /** 只写 bean-check 标；空数组 = 清掉该 path 上本 module 拥有的 bean 标 */
  setBean(path: string, diagnostics: readonly LineDiagnostic[]): void;
}

interface Notifier {
  show(text: string): void; // 去重留在 LedgerValidation 内
}

class LedgerValidation {
  constructor(
    ports: {
      clock: Clock;
      runner: BeanCheckRunner;
      vault: VaultPort;
      tempFile: TempFilePort;
      markers: MarkerSink;
      notifier: Notifier;
    },
    settings: { entryLedger(): string; beanCheckPath(): string },
  );
  readonly problems: ProblemStore;
  handle(event: ValidationEvent): void;
}
```

实现约束（违反即 STOP / 返工）：

1. **Run target 只有一处**：`.md` 笔记 = 自身 path；Ledger file = Entry ledger（空则该 path）。**不是**一切 `ledgerKind==='fenced'`（`.txt` 无 Run target）。`problems.ts` 不得再算 target。插件只对 `isLedgerFile(file) || file.extension === 'md'` 发 `saved`/`opened`。
2. **六 seam** 全部注入。生产：`systemClock`（`clock.ts`，`window.setTimeout`）；`runBeanCheck`；VaultPort 适配 `app.vault`（其 `resolveInVault` 调 `vault-path.ts` 的同名函数，签名 `{ ok: true; absPath } | { ok: false; reason: 'escape' }`）；TempFilePort 生产仍 `mkdtempSync` + 文件名 `fences.bean`（`matchesTempFile` 认这个名字）；MarkerSink 适配器用 `openEditorsFor` 只 dispatch **bean** field；Notifier 包 `new Notice`。
3. **Temp 文本**：仅 markdown 笔记：`const temp = ledgerDoc('fenced', source).tempLedger(includeAbs?)`，再 `tempFile.write(temp.text)`，回映用 `temp.hostLine`（1-based）。Ledger file 校验真实 vault 路径，不 `write` temp。禁止在 validation 里重拼 fence / 插空行。
4. **三类型都留**：`BeanCheckError`（工具 1-based 路径）→ 一次产出 `ProblemRow[]` + 按 vault path 的 `LineDiagnostic[]`，**缓存后者供 Replay**。禁止 `ProblemRow` → `BeanCheckError`。`toLineDiagnostics` 留在 `bean-check.ts`。
5. **Quiet run**：成功得到（可空）报告且无未映射路径；重置该 target 的 notice 去重。`fail` 不是 Quiet run，保留旧标。
6. **Replay**：同 Run target、同事 mtime、且 **无** debounce/飞行 → `setBean` 缓存标，不调 runner。子文件保存不改 Entry ledger mtime 时，打开不得 Replay。
7. **entryLedgerChanged**：Problems 立即空；丢掉飞行中的 **Ledger file** 报告；飞行中的笔记仍可发布；清 bean 标留 flag 标；**不**立刻重跑（#76 / #75.9）。之后同 mtime 打开会再跑。
8. **beanCheckPathChanged**：只重置 notice 去重。
9. **无 fence 的 `.md`**：一次安静 run（`setBean` 空 + 清该 target notice），不调 runner。
10. 行号：Host line 0-based；Problems / `BeanCheckError` / `hostLine()` 1-based；CM `LineDiagnostic` 0-based。转换只在边界。

`vault-path.ts`（A6.5；#74 将复用，本次只抽出）：

```ts
function vaultRoot(basePath: string): string; // 现 main.ts:201-208 语义：realpath、`/`、尾斜杠
function resolveInVault(
  root: string,
  vaultRel: string,
): { ok: true; absPath: string } | { ok: false; reason: 'escape' };
```

含 symlink `realpath` 逃逸。不要放进 `bean-check.ts` 或 `fences.ts`。

`FakeClock`（`tests/fakes.ts`，实现 `Clock`）：

```ts
class FakeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  tick(ms: number): void; // 推进 now 并同步跑到期回调
}
```

## Steps

### Step 0: 分支与 drift

```sh
# 基于已含 001 的 main。不要 git pull，除非编排者明确要求。
git checkout -b refactor/68-ledger-validation
# drift：用文首那条（含根 CHANGELOG.md；不要 apps/obsidian-plugin/CHANGELOG.md）
```

确认 `ledgerDoc` / `tempLedger` 可 import。校验字段仍在 `BeancountPlugin` 上。

**Verify**: `git branch --show-current` → `refactor/68-ledger-validation`；`rg -n "tempLedger" apps/obsidian-plugin/fences.ts` 有命中。

### Step 1: Clock + FakeClock（必须是第一笔功能提交）

新建 `apps/obsidian-plugin/clock.ts`：导出 `Clock` 与 `systemClock`（`now: Date.now`，timer 走 `window.setTimeout` / `clearTimeout`）。

在 `tests/fakes.ts` 实现 `FakeClock`。测试（可放 `tests/clock.test.ts`）：`setTimeout(fn, 500)` 在 `tick(499)` 不跑、`tick(1)` 后跑；`clearTimeout` 后 tick 不跑；多次 timer 按到期顺序；`tick` 推进 `now()`。

禁止 **新增** `vi.useFakeTimers`。Fava 不要改。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/clock.test.ts`（或你放 Clock 断言的文件）→ 全绿。

提交：`test: 引入 FakeClock 作为校验 debounce 的 seam（#68）`（若实现与测试分提交，先 test 红再绿亦可，但不要把 FakeClock 拖到 validation 大提交之后）。

### Step 2: `vault-path.ts`

把 `vaultRoot` 与 `validateFile` 里 `relative/resolve/realpath` 禁逃逸（`main.ts:1179-1205` 语义）抽成纯函数。表驱动测试：

- 库内 `main.bean` → ok
- `/etc/passwd`、`../escape`、绝对路径 → escape
- `main.bean\nplugin "os"` 不在这一层（那是 `isSafeIncludePath`）；本函数测路径逃逸
- symlink 逃逸：用临时目录造指向库外的 link（或 Fake 无法覆盖时在纯函数里对 `realpath` 结果再 `relative`）

`main.ts` 本步可先改为 import `vaultRoot`/`resolveInVault` 以保持绿灯，或等 Step 6 一起切。不要在这一步发明第三套规则。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/vault-path.test.ts` → 全绿。

### Step 3: 双 StateField（bean / flag）— 先测 diagnostics，再接 validation

在 `diagnostics.ts`：

- 保留或改名为 `beanDiagnostics` + `setBeanDiagnostics`（bean-check）
- 新增 `flagOkayDiagnostics` + `setFlagOkayDiagnostics`
- `lineDiagnostics` **停止**作为混合 field。允许短暂 alias，cutover 结束必须删掉「一个 field 混两种来源」
- gutter `lineMarker`：两 field 并集都出点
- `lineMarkerChange`：任一 field 变就重绘
- decorations / tooltip：同一行两 field 都有时 **title 用 bean 文案**（保持 `mergeDiagnostics` 语义）
- `setEditorLineDiagnostics` 拆成 `setEditorBeanDiagnostics`；flag 由文档扩展写
- flag 扩展：根据文档源码调已有 `flagDiagnostics` / `flagDiagnosticsFromFences`（001 后用 `ledgerDoc` 判断 region，**不要**再 `extractBeancountFences`）。**不要**让 `LedgerValidation` 写 flag。`FlagWarningController` 不动
- `createDiagnosticsExtension` 同时安装两 field + 并集 gutter + 两套 decorations（或一套 builder 读两 field）

若实现中发现 mock CM 管道无法表达两 field：**STOP 并报告**，不要默默改回单 field。唯一允许的退路是 PR 描述写明改用 `LineDiagnostic.source`（grill A3.3 B），但执行中先完成 A，不要自己选 B。

更新 `tests/diagnostics.test.ts`：create/update 两 field 互不影响；gutter 并集；同行 tooltip bean 优先；空 bean 数组不清 flag。

`onDiagnosticClick`：先找 bean field，没有再找 flag；`quickFixesForLine` 的 `message` 仍是点上那条文案（pad 用 bean）。无标则 false。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/diagnostics.test.ts` → 全绿。此步之后 `plugin.test.ts` 里依赖 `setLineDiagnostics` 的 `published()` 会红 — 立即改 helper 认 bean effect，或暂时让 `published` 读 bean field；**不要**用 `FLAGGED_MESSAGE` 过滤来「修复」红测试。

### Step 4: TDD `LedgerValidation` — `tests/validation.test.ts`

新建 module 测试，**不** import `BeancountPlugin`，**不** `delay()`。装配：

- `FakeClock`
- Fake `BeanCheckRunner`（记录 `command`/`args`，可延迟 resolve 以测过期）
- Fake `VaultPort`（Map 内容 + files + `resolveInVault`）
- Fake `TempFilePort`（记录 `write` 的 text，`checkPath` 固定如 `/tmp/obsidian-beancount-fake/fences.bean`，`dispose` 计数）
- 记录版 `MarkerSink`（`Map<path, LineDiagnostic[]>`）
- 记录版 `Notifier`（数组）
- `ProblemStore` 即 `validation.problems`

先写失败测试再实现 `validation.ts`。竖切顺序建议：

1. Run target 表（Step 5 BDD 第 1 条）— `tick(500)` 后 runner args
2. 500ms debounce 合并突发
3. 慢旧 run 不覆盖新报告（runner 返回 Promise，先 resolve 第二次）
4. `unload` 后不发布、不 notice、debounce 到期不跑
5. Replay：同事 mtime、sink 有标、runner 不再调用；debounce/飞行中打开不 Replay
6. Temp ledger：`write` 的 text 以 `include "…"` 开头（有 Entry ledger 时）；`dispose` 在 run 结束调用；host 行号；无 fence 不 write
7. 不安全 Entry ledger：不调 runner，notice 含 `entry ledger must be a vault file`
8. `<load>` / 库外路径 → notice 去重；不清错文件；仍清该 owner 的旧标
9. Marker owner 安静报告清标；另一 target 不互清
10. flag 不经 validation：`setBean` 后 flag field 仍在（此条可放 diagnostics + 薄装配；validation 测试只断言 sink 没有 FLAGGED 文案）
11. `entryLedgerChanged` / missing binary（#76 硬验收）

实现时把 `openValidationTarget` 逻辑迁入 validation（可保持函数但改从 `validation.ts` 导出）。从 `problems.ts` **删除** `openValidationTarget` 及其对 `extractBeancountFences`/`isLedgerFile` 的依赖（若 001 后仍用它们）。`problems.test.ts` 的 `describe('openValidationTarget')` 迁到 `validation.test.ts`。

Debounce：`clock.setTimeout(..., 500)`，与 `ALIGN_DEBOUNCE_MS` 数值相同但 **另一个 Map**。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/validation.test.ts` → 全绿，且文件中无 `delay(`、无 `BeancountPlugin`、无 `vi.useFakeTimers`。

### Step 5: 装配 `main.ts` + 下沉旧测试

构造：

```ts
this.validation = new LedgerValidation(
  { clock: systemClock, runner: (...args) => this.beanCheckRunner(...args), vault: ..., tempFile: ..., markers: ..., notifier: ... },
  { entryLedger: () => this.settings.entryLedger, beanCheckPath: () => this.settings.beanCheckPath },
);
this.registerView(VIEW_TYPE_PROBLEMS, (leaf) => new BeancountProblemsView(leaf, this.validation.problems));
```

Vault/workspace 事件只 `handle(...)`。`saveSettings`：entry 变化发 `entryLedgerChanged`（仍 `refreshBalanceViews`）；bean-check path 变化发 `beanCheckPathChanged`。不要在 `saveSettings` 里 `problems.clear()`。

生产 TempFilePort：现 `mkdtempSync`/`writeFileSync`/`rmSync` 块原样搬迁。

插件测试留下 **最多 3** 个装配冒烟（可保留/改写现有，不要新增第四个校验+delay）：

1. onload 把 vault `modify`/`delete`/`rename` 与 `file-open` 接到 validation（一次保存后 runner 被调 — 若仍用真 timer，改注入 FakeClock 到插件 **仅测试**，或断言 `handle` 被调用的间谍；优先：插件构造用测试 Clock，`tick(500)`，零 `delay(600)`）
2. `saveSettings` 改 Entry ledger → Problems 空、不立刻跑 runner
3. gutter 点 Flag as okay（`plugin.test.ts` 现 `offers Flag as okay from the gutter...`，不经过 debounce）

从 `plugin.test.ts` / `plugin-lifecycle.test.ts` / `problems.test.ts` **删除或下沉**所有校验路径的 `delay(600)`。对齐相关 `delay`（`plugin.test.ts` 约 866–1177 `alignOnSave`，含 `delay(650)`）**原样留下**。`:1186` 起「unload 丢掉 pending on-save」若同时覆盖 align+validate，改成 FakeClock 或只留 align 断言，不要再用 `delay(600)` 等 bean-check。

`problems.test.ts` 保留：`toProblemRows`、`ProblemStore`、`fileMtime`、`problemRowText`、`drawProblems`、`revealProblemsView`、`BeancountProblemsView`。删除 `describe('open-triggered validation')` 与 `describe('stored markers and stale targets')`（已在 validation.test.ts）。

**Verify**:

```sh
cd apps/obsidian-plugin && npx vitest run tests/validation.test.ts tests/diagnostics.test.ts tests/problems.test.ts tests/plugin.test.ts tests/plugin-lifecycle.test.ts
```

全绿。然后：

```sh
rg -n "delay\(600\)" apps/obsidian-plugin/tests/validation.test.ts
rg -n "validateTimers|extraFlagged|beanDiagnosticsOn|replayStoredMarkers|scheduleValidate" apps/obsidian-plugin/main.ts
rg -n "openValidationTarget" apps/obsidian-plugin/problems.ts
rg -n "message !== FLAGGED_MESSAGE" apps/obsidian-plugin/main.ts apps/obsidian-plugin/validation.ts
rg -n "vi\\.useFakeTimers" apps/obsidian-plugin/clock.ts apps/obsidian-plugin/validation.ts apps/obsidian-plugin/tests/fakes.ts apps/obsidian-plugin/tests/validation.test.ts apps/obsidian-plugin/tests/clock.test.ts
```

这五条无命中。`plugin.test.ts` 里剩余 `delay(600)` 必须能在 20 行上下文里看出是 **alignOnSave / 对齐**，不是 bean-check。`tests/report-view.test.ts` 的 `vi.useFakeTimers` 保持原样。

### Step 6: CHANGELOG；不改 README

根 `CHANGELOG.md` 的 `## Unreleased` 增加：

```markdown
### Internal

- Ledger validation owns bean-check debounce, Problems writes, and bean-check markers (#68).
```

若 `### Internal` 已存在就追加一行。不要写 Changed/Fixed（行为不变）。不要改 `README.md`。不要改 `CONTEXT.md`。

**Verify**: `rg -n "Internal" -n CHANGELOG.md` 能看到 #68。

### Step 7: 全量门槛

仓库根：

```sh
pnpm lint
pnpm build
pnpm test
```

**Verify**: 三者 exit 0；`pnpm test` 覆盖率四项 ≥ 90。不要跑 bench。

`git status` 只含 Scope 内文件（外加你的测试新文件）。

## Test plan

**结构范本**：`tests/diagnostics.test.ts`、`tests/problems.test.ts` 的 `ProblemStore` 段。新文件 `tests/validation.test.ts`。

**禁止**：`vi.useFakeTimers`；校验路径 `delay(600)`；启动 `BeancountPlugin` 来测 debounce/seq/mtime/owner（冒烟除外）；统一 `loadPlugin`。

**缺失 characterization**：#68 BDD 均有 `# 现有` 测试，不要在旧 interface 再复制一套 `delay(600)`。直接在新 interface TDD。

### BDD 测试地图（issue #68；`# 待产品决定` 且 #76 已定 → 硬验收）

在 `tests/validation.test.ts`（除非注明 diagnostics/plugin 冒烟）：

| BDD 场景 | 测什么 | 文件 |
|----------|--------|------|
| 按 run target 选择校验对象（ledger.bean / child+entry / note.md 临时 fences.bean；笔记与账本不合并） | runner `args[0]`；两次 saved 不同 target → 两次 run | validation.test.ts |
| 同一目标上的保存突发只跑一次 | 500ms 内两次 child 或 child+main → `tick(500)` 后 runner 一次 `/vault/main.bean` | validation.test.ts |
| 较慢的旧 run 不得覆盖较新的报告 | 先慢后快；慢的 resolve 后 sink 仍干净 | validation.test.ts |
| 卸载后不再发布（错误 / 干净 / missing / `<load>`；debounce 也不跑） | `unload` 后 resolve / tick | validation.test.ts |
| 同 mtime 切 tab Replay 且不再跑 | sink 立即有标；runner 次数不变；fence 为笔记行号 | validation.test.ts |
| 目标仍在 debounce 或飞行中切 tab 不 Replay 旧行号 | 打开不 `setBean` 旧缓存；run 仍完成 | validation.test.ts |
| fence 临时账本行号映回笔记；跑完 dispose；无 fence 不调 runner | TempFilePort.write/dispose；sink 行号；prose saved | validation.test.ts |
| 校验笔记 fence 时先 include Entry ledger；include/空行/仅 entry 文件的报不错到笔记、不 notice | write 文本前缀；hostLine undefined 的行不进 sink | validation.test.ts |
| 不安全 Entry ledger 拒绝（`/etc/passwd`、换行+plugin、symlink escape） | runner 空；notice 含 `entry ledger must be a vault file` | validation.test.ts + vault-path |
| 库外路径与 `<load>` 变 notice；去重；不标库内同名；仍清 owner 旧标 | notifier 文本；sink | validation.test.ts |
| markers 按 run target 归属；安静文件由主人清；换主人后旧主人干净报告不再清 | sink | validation.test.ts |
| flag 与 bean 共存；同行 bean 文案优先；去掉 `!` 只清 flag | diagnostics 两 field；validation 的 setBean **不含** `FLAGGED_MESSAGE` | diagnostics.test.ts + validation.test.ts |
| **硬验收** 改 Entry ledger：Problems 空；飞行中账本丢弃、笔记可发布；同 mtime 再打开会跑；只改其它设置不跑；**清 bean 留 flag、不立刻重跑**（#76 / #75.9） | `entryLedgerChanged` | validation.test.ts |
| **硬验收** bean-check 缺失：不执行其它程序；notice 含 `pip install beancount`；去重；每次保存再尝试；**保留旧标**；Problems `fail` 直到下次报告（#76 / #75.3） | runner missing / 非 bean-check 路径 | validation.test.ts |

插件 ≤3 冒烟：事件接线、`saveSettings`、gutter Flag as okay。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/validation.test.ts tests/diagnostics.test.ts tests/problems.test.ts` → 全绿，含上表新用例。

## Done criteria

ALL must hold:

- [ ] `pnpm lint` exit 0
- [ ] `pnpm build` exit 0
- [ ] `pnpm test` exit 0，覆盖率四项 ≥ 90
- [ ] `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` exit 0
- [ ] `rg -n "validateTimers|validateInFlight|validateSeq|validateLive|lastValidatedMtime|markOwners|extraFlagged|noticesShown|problemsEntryLedger|problemsBeanCheckPath|scheduleValidate|validateFile|dropValidation|replayStoredMarkers|beanDiagnosticsOn" apps/obsidian-plugin/main.ts` 无命中
- [ ] `rg -n "openValidationTarget" apps/obsidian-plugin/problems.ts` 无命中
- [ ] `rg -n "message !== FLAGGED_MESSAGE|message === FLAGGED_MESSAGE" apps/obsidian-plugin/main.ts apps/obsidian-plugin/validation.ts` 无命中
- [ ] `rg -n "rows.map\(\(row\) => \(\{ file:" apps/obsidian-plugin` 无命中（禁止 ProblemRow→BeanCheckError）
- [ ] Run target 的 `entryLedger.trim() ||` 只出现在 `validation.ts`（`rg -n "entryLedger.trim() ||" apps/obsidian-plugin --glob '!tests/**'`）。`report-view.ts` / `inlay-hints.ts` / Fava 的 `entryLedger.trim()` **无** `||` 后缀，允许保留
- [ ] `rg -n "delay\(600\)" apps/obsidian-plugin/tests/validation.test.ts` 无命中
- [ ] `rg -n "vi\\.useFakeTimers" apps/obsidian-plugin/clock.ts apps/obsidian-plugin/validation.ts apps/obsidian-plugin/tests/fakes.ts apps/obsidian-plugin/tests/validation.test.ts` 无命中（不要要求整个 `apps/obsidian-plugin` 清零：`tests/report-view.test.ts:248` 已有）
- [ ] `rg -n "class LedgerValidation|interface TempFilePort|class FakeClock" apps/obsidian-plugin` 有命中
- [ ] `rg -n "export (interface Clock|const systemClock)" apps/obsidian-plugin/clock.ts` 有命中
- [ ] `rg -n "resolveInVault" apps/obsidian-plugin/vault-path.ts` 有命中
- [ ] 存在 `apps/obsidian-plugin/tests/validation.test.ts` 且覆盖上表 BDD
- [ ] 插件校验装配冒烟 ≤ 3；`plugin.test.ts` 剩余 `delay(600)` 仅对齐
- [ ] `CHANGELOG.md` Unreleased Internal 含 `#68`；`README.md` 无本计划 diff
- [ ] 未跑 bench / 未改 `bench/expected.json`
- [ ] `git status` 无 Scope 外源码
- [ ] 未 push、未开 PR；**未**改 `plans/README.md` Status

## STOP conditions

Stop and report（不要即兴发挥）if:

- 「Current state」摘录与 live `main.ts` 校验字段对不上，且不是 001 把 `extractBeancountFences`/`buildFenceLedger` 换成 `ledgerDoc`/`tempLedger`。
- `ledgerDoc(...).tempLedger` 不存在（001 未合并或 API 改名到找不到映射）。
- 某步验证连续失败两次。
- 修复看起来必须改 Out of scope 文件（尤其 `flag-warnings.ts`、`align.ts`、`fava.ts`、`fences.ts` 扫描器）。
- 双 StateField 在现有 CM mock 下无法测 gutter 并集 — 报告，不要擅自改用 `source` 标签（那是退路，需写进 PR 描述并由编排者决定）。
- 有人逼你 **新增** `vi.useFakeTimers` 或统一 `loadPlugin`。
- 发现需要把 `.txt` / 无文件纳入 bean-check。
- 发现需要改失败 run 的可见行为（清旧标、会话级只 notice 一次）。
- diff 碰到 `align.ts`/`format.ts`/suggest/parser 热路径（本计划声称不跑 bench；若真碰到 → STOP，不要 `BENCH_UPDATE`）。
- `TempFilePort.write` 开始自己拼 include/空行（职责又和 `tempLedger()` 分叉）。
- 把 `validateTimers` 和 `alignTimers` 合成一个 Map，或让 Fava 改用 `Clock`。

## Maintenance notes

- **#73** 保存对齐 debounce 必须注入**同一套** `Clock` 接口、**独立** timer Map。测试里可以共用一个 `FakeClock` 时间轴（一次 `tick(500)` 两边到期）。不要在 #68 预建 `alignTimers` 的注入，留给 #73。
- **#74** `resolveLedger` 必须调 `vault-path.ts` 的 `resolveInVault`，不要第三份 `relative(root, …)`。`resolveLedger` 仍先判 Ledger file，再禁逃逸。
- Replay 缓存的是 **LineDiagnostic**（已映回宿主、0-based）。改 Problems 行模型时不要再从 store 反推 markers。
- 评审应盯：Run target 是否只剩一处；`setBean` 是否从不写 flag；卸载与过期 seq；Temp 文本是否只来自 `tempLedger()`；notice 去重键是否仍是 Run target。
- 风险 2（双 StateField CM 代价）：本 PR 用 mock view 看 decorations/gutter；不要拖到 #73。
- 风险 6：校验与对齐 timer Map 分离。
- 风险 7：禁逃逸已进 `vault-path.ts`。
- 风险 8：不要把 `alignInEditor` 搬进 edits；`main.ts` 本 PR 只瘦校验。
- 风险 9：失败持续显示、Entry ledger 变更清 bean 留 flag 已锁。
- 本计划不写 ADR。

## Review notes

- `resolveInVault` 以本文件签名为准：`{ ok: true; absPath: string } | { ok: false; reason: 'escape' }`（VaultPort 与 `vault-path.ts` 相同）。
- 全库 `rg vi.useFakeTimers` 会误伤 `report-view.test.ts`；Done criteria 已收窄。
