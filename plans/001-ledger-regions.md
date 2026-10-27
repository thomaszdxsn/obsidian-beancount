# Plan 001: Ledger regions 统一账本区域判断

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, **do not** update `plans/README.md` —
> the reviewer maintains the index.
>
> **Drift check (run first)** — in-scope production + docs only:
> ```
> git diff --stat 8b75729..HEAD -- \
>   apps/obsidian-plugin/fences.ts \
>   apps/obsidian-plugin/align.ts \
>   apps/obsidian-plugin/format.ts \
>   apps/obsidian-plugin/transaction-fold.ts \
>   apps/obsidian-plugin/include-links.ts \
>   apps/obsidian-plugin/inlay-hints.ts \
>   apps/obsidian-plugin/flag-warnings.ts \
>   apps/obsidian-plugin/fence-language.ts \
>   apps/obsidian-plugin/main.ts \
>   apps/obsidian-plugin/problems.ts \
>   apps/obsidian-plugin/report-view.ts \
>   apps/obsidian-plugin/vault-index.ts \
>   apps/obsidian-plugin/token-suggest.ts \
>   apps/obsidian-plugin/snippet-suggest.ts \
>   apps/obsidian-plugin/account-suggest.ts \
>   apps/obsidian-plugin/payee-suggest.ts \
>   apps/obsidian-plugin/posting-indent.ts \
>   apps/obsidian-plugin/instant-alignment.ts \
>   apps/obsidian-plugin/bench/editor.ts \
>   CHANGELOG.md README.md
> ```
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Tests under `apps/obsidian-plugin/tests/`
> may also have drifted — re-read the cited `file:line` before rewriting them.
>
> 执行者零上下文：不要回读 grill transcript。术语只用根 `CONTEXT.md`。#76 已定产品行为不得重开。本计划是序列里的第一份，不依赖其它计划的代码。
>
> **Bean-check 资格 ≠ Ledger kind（跨 PR 合同）**：`ledgerKind('.txt'|null)==='fenced'` 只约束编辑器（fold / inlay / include / flag / 补全）和索引抽取。bean-check **仍只**跑 Ledger file 与 `.md`（与报表 `pickSource` 同类例外）。禁止让 `.txt` / 无文件成为 Run target。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/69

## Why this matters

插件同时服务 Ledger file 与笔记里的 Fence body，几乎每个功能都要先问「这个位置是不是 Ledger text、行号怎么对应」。今天答案散落在 `extractBeancountFences` / `docFences` / `ledgerSource` / `editorLineIsLedger` / `buildFenceLedger` 以及各 module 私有的 `extension === 'md'` 判断里。同一份 CodeMirror `Text` 会被 fold 再 `toString()` 扫一遍，和 `docFences` 的 WeakMap 并存。无文件缓冲与 `.txt` 上，fold / inlay / include 当成「无账本」，flag 当成「整篇账本」，补全已按 fenced——#75.13 的裂缝。把 `fences.ts` 加深成 Ledger regions module 之后，缩进 fence、`~~~`、未闭合 fence、info string 只在一处；#68 的 Temp ledger、#70 的按 region 扫描、#71 的 `lineIsLedger`、#72 的原文+path 都有同一入口。

## Current state

相关文件（插件根目录 `apps/obsidian-plugin/`）：

- `fences.ts` — 半成品 deep module：扫描、CM WeakMap、`ledgerSource`、`editorLineIsLedger`、`buildFenceLedger`。`BeancountFence` **不存** opener indent。
- `align.ts` — `alignmentRanges` 对非 ledger 自行 `extractBeancountFences(lines.join('\n'))`。
- `format.ts` — `formatFencedDocument` 自行扫 fence，事后 `openerIndent`。
- `transaction-fold.ts` — 私有 `fenceBodiesCache`，对 `doc.toString()` 再扫；无文件 / 非 md 直接 `null`。
- `include-links.ts` — 编辑器走 `docFences`，vault 字符串走 `extractBeancountFences`；非 md 为 `'none'`。
- `inlay-hints.ts` — `DocMemo` 调 `docFences`；`!file`（`:283`）与非 md/bean（`:314-315`）无装饰；md 分支在 `:290`。
- `flag-warnings.ts` — 无文件或 Ledger file 当整篇账本（`iterLines` 全文）。
- `fence-language.ts` — 每次 `extractBeancountFences(text)`，无缓存。
- `main.ts` / `problems.ts` / `report-view.ts` — 校验与报表各自扫 fence、拼 `buildFenceLedger`。
- `vault-index.ts` — `ledgerSource(path, content)`：非 `.md` 路径返回全文（`.txt` 会被当成整篇 Ledger text）。
- `token-suggest.ts` / `snippet-suggest.ts` / `account-suggest.ts` / `payee-suggest.ts` — 已用 `editorLineIsLedger`（#76）。
- `posting-indent.ts` / `instant-alignment.ts` — `ledgerLinesOf` + `docFences`。
- `ledger-file-view.ts` / `outline-view.ts` — `isLedgerFile` 判断整文件账本（保留）。
- `tests/fences.test.ts` — 现有 fence / `ledgerSource` / `buildFenceLedger` / `docFences` 测试。
- `tests/transaction-fold.test.ts` / `tests/include-links.test.ts` — 钉死「`.txt` / 无文件不是账本」的旧行为。
- `bench/editor.ts` — `ledgerSource` 热路径。

产品句已经写在 module 顶（#76，不得重开）：

```1:8:apps/obsidian-plugin/fences.ts
/**
 * Where a buffer's ledger text is. A `.bean` / `.beancount` file is ledger
 * text throughout; any other buffer (a markdown note, another extension, or
 * no file) only inside its `beancount`/`bean` fenced code blocks.
 *
 * bean-check cannot parse markdown, so the plugin copies each fence body into
 * a temporary `.bean` file, then maps the tool's 1-based temp lines back onto
 * the host document so markers land on the fence, not the temp file.
```

今日形状（实现时应对着这些行，不要凭记忆）：

```13:18:apps/obsidian-plugin/fences.ts
export interface BeancountFence {
	/** 0-based line of the first body line in the host document. */
	startLine: number;
	/** Fence body lines, excluding the opening and closing markers. */
	lines: readonly string[];
}
```

```61:88:apps/obsidian-plugin/fences.ts
function fencesOfLines(lines: readonly string[]): BeancountFence[] {
	const fences: BeancountFence[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = mayBeFence(lines[i]) ? OPEN_FENCE.exec(lines[i]) : null;
		if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
			i += 1;
			continue;
		}
		const marker = open[1][0];
		const minLen = open[1].length;
		const ledger = /^(beancount|bean)(?:[ \t]|$)/i.test(open[2]);
		// CommonMark strips the opener's indent (0–3 spaces) from each body line.
		const indent = (/^ */.exec(lines[i]) ?? [''])[0].length;
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length; j += 1) {
			if (mayBeFence(lines[j]) && isClosingFence(lines[j], marker, minLen)) break;
			const line = lines[j];
			let start = 0;
			while (start < indent && line[start] === ' ') start += 1;
			if (ledger) body.push(line.slice(start));
		}
		if (ledger) fences.push({ startLine: i + 1, lines: body });
		i = j + 1;
	}
	return fences;
}
```

闭合已经是 `close[2].length >= minLen`（`fences.ts:147-149`）——「闭合可以更长、不能更短」在实现里成立，只是**没有测试**。

```106:132:apps/obsidian-plugin/fences.ts
const fencesByDoc = new WeakMap<object, DocFences>();
// ...
export function docFences(doc: FenceDoc): DocFences {
	let entry = fencesByDoc.get(doc);
	if (entry === undefined) {
		const lines = docLines(doc);
		const fences = fencesOfLines(lines);
		let masked: string[] | null = null;
		if (fences.length > 0) {
			masked = new Array<string>(lines.length).fill('');
			for (const fence of fences) {
				for (let i = 0; i < fence.lines.length; i += 1) masked[fence.startLine + i] = fence.lines[i];
			}
		}
		entry = { fences, masked };
		fencesByDoc.set(doc, entry);
	}
	return entry;
}
```

```158:163:apps/obsidian-plugin/fences.ts
export function ledgerSource(path: string, content: string): string {
	if (!path.endsWith('.md')) return content;
	return extractBeancountFences(content)
		.map((fence) => fence.lines.join('\n'))
		.join('\n');
}
```

注意：非 `.md`（含 `.txt`）返回**全文**。本计划按 Ledger kind 修正为：只有 `ledger-file` 返回全文，其余（含 `.txt`）只拼 Fence body。这与 #76「其它缓冲只有 fence 体」一致，是索引侧补洞，不是重开产品决定。

```215:223:apps/obsidian-plugin/fences.ts
export function editorLineIsLedger(
	editor: LedgerEditor,
	lineIndex: number,
	file: { extension?: string } | null | undefined
): boolean {
	if (file && isLedgerFile(file)) return true;
	const doc = editor.cm?.state?.doc;
	const fences = doc ? docFences(doc).fences : extractBeancountFences(editor.getValue());
	return fenceContainsLine(fences, lineIndex);
}
```

```240:270:apps/obsidian-plugin/fences.ts
export function buildFenceLedger(fences: readonly BeancountFence[], includePath?: string): FenceLedger {
	const hostByTemp = new Map<number, number>();
	const chunks: string[] = [];
	let tempLine = 1;

	if (includePath !== undefined) {
		const posix = includePath.replace(/\\/g, '/');
		if (isSafeIncludePath(posix)) {
			chunks.push(`include "${posix}"`, '');
			tempLine += 2;
		}
	}

	for (let i = 0; i < fences.length; i += 1) {
		if (i > 0) {
			chunks.push('');
			tempLine += 1;
		}
		const fence = fences[i];
		for (let j = 0; j < fence.lines.length; j += 1) {
			chunks.push(fence.lines[j]);
			hostByTemp.set(tempLine, fence.startLine + j + 1);
			tempLine += 1;
		}
	}

	const body = chunks.join('\n');
	return {
		text: body === '' ? '' : body + '\n',
		hostLine: (line) => hostByTemp.get(line),
	};
}
```

第二份缓存 + `.txt` / 无文件直接放弃：

```143:173:apps/obsidian-plugin/transaction-fold.ts
const fenceBodiesCache = new WeakMap<Text, FoldBody[]>();
function fenceBodies(doc: Text): FoldBody[] {
	let bodies = fenceBodiesCache.get(doc);
	if (!bodies) {
		bodies = extractBeancountFences(doc.toString()).map((fence) => ({
			first: fence.startLine + 1,
			lines: fence.lines,
		}));
		fenceBodiesCache.set(doc, bodies);
	}
	return bodies;
}
export function transactionFoldInState(state: EditorState, lineStart: number): { from: number; to: number } | null {
	const file = state.field(editorInfoField, false)?.file;
	if (!file) return null;
	const { extension } = file;
	if (isLedgerFile(file)) return transactionFoldAt(doc, line.number);
	if (extension !== 'md') return null;
```

flag 把无文件当整篇账本：

```118:128:apps/obsidian-plugin/flag-warnings.ts
function scanLines(view: EditorView): readonly string[] | null {
	const info = view.state.field(editorInfoField, false) as EditorFileInfo | undefined;
	const file = info?.file;
	const doc = view.state.doc;
	if (!file || isLedgerFile(file)) {
		const lines: string[] = [];
		for (const iter = doc.iterLines(); !iter.next().done; ) lines.push(iter.value);
		return lines;
	}
	return docFences(doc).masked;
}
```

报表 source 仍只认 bean/beancount/md（**本计划保持**，A2.3 产品例外）：

```253:260:apps/obsidian-plugin/report-view.ts
	private pickSource(): Source | null {
		const entry = this.host.settings.entryLedger.trim();
		if (entry) return { path: entry, fences: entry.endsWith('.md') };
		const file = this.app.workspace.getActiveFile();
		if (!file) return this.source;
		if (file.extension === 'bean' || file.extension === 'beancount') return { path: file.path, fences: false };
		if (file.extension === 'md') return { path: file.path, fences: true };
		return null;
	}
```

format 事后重算 indent（本计划把 `hostIndent` 放进 region，此处改为读 region）：

```233:237:apps/obsidian-plugin/format.ts
function openerIndent(lines: readonly string[], fence: BeancountFence): number {
	const opener = lines[fence.startLine - 1];
	let n = 0;
	while (n < opener.length && opener[n] === ' ') n += 1;
	return n;
}
```

仓库约定：

- 测试风格照 `apps/obsidian-plugin/tests/fences.test.ts`（vitest `describe`/`it`，字面量期望，不用 snapshot）。
- 覆盖率地板 90%：`apps/obsidian-plugin/vitest.config.mts` 的 `thresholds`。
- CHANGELOG 在仓库根 `## Unreleased`；可见行为写 Changed，内部写 Internal。
- 禁止 `vi.useFakeTimers`。本计划**不**引入 `FakeClock`（那是 002）。
- 错误处理、Notice、bean-check 生命周期本计划不动。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Drift | `git diff --stat 8b75729..HEAD -- <in-scope paths>` | 空，或你已对照 Current state 处理过的 diff |
| 单测（新 API） | `cd apps/obsidian-plugin && npx vitest run tests/fences.test.ts` | 全绿 |
| 单测（fold / include） | `cd apps/obsidian-plugin && npx vitest run tests/transaction-fold.test.ts tests/include-links.test.ts` | 全绿 |
| 单测（跨 module 扫描） | `cd apps/obsidian-plugin && npx vitest run tests/ledger-scan-once.test.ts` | 全绿（该文件在步骤中创建） |
| 类型检查 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0 |
| Lint | 仓库根 `pnpm lint` | exit 0 |
| Build | 仓库根 `pnpm build` | exit 0 |
| 全量测试 | 仓库根 `pnpm test` | 全绿，覆盖率 ≥90%，条数不低于规划基线 1064（允许因新测试增加） |
| Bench | `pnpm --filter beancount-obsidian bench` | 各 workload 输出哈希与 `bench/expected.json` / `bench/editor-expected.json` 一致 |
| 旧符号消失 | 见 Done criteria 的 grep | 无生产代码匹配 |

## Suggested executor toolkit

- 有 `tdd` skill 则全程按它：red → green，竖切；先列出本计划要测的 seam（见 Test plan），不要先写完所有测试再实现。
- 实现前读根 `CONTEXT.md`（术语）和 `docs/adr/0004-temp-ledger-is-not-ledger-text.md`（`ledgerSource()` ≠ Temp ledger）。ADR 已 Accepted，不要改写决策。
- 新测试的用词：Ledger file / Ledger kind / Ledger text / Ledger region / Fence body / Host line / Temp ledger。不要把 `ledgerSource()` 的拼接串叫 Ledger text。

## Scope

**In scope**（只改这些，含新建测试）：

- `apps/obsidian-plugin/fences.ts`
- 一次切完的调用方：
  - `align.ts`（仅 `alignmentRanges` 的扫描来源；**不要**把 `alignInEditor` 搬进 `edits.ts`）
  - `format.ts`（扫 fence + 用 `hostIndent`，不改 formatter 算法）
  - `fence-language.ts`
  - `transaction-fold.ts`
  - `include-links.ts`
  - `inlay-hints.ts`（fence 扫描改走 `ledgerDoc`；`DocMemo.balance` 可留）
  - `flag-warnings.ts`
  - `main.ts`（只替换 `extractBeancountFences` / `buildFenceLedger`；笔记校验用 `ledgerDoc('fenced', text).tempLedger`。bean-check **资格**保持 `isLedgerFile(file) || extension === 'md'`（`onFileModified:971`、`onFileOpened:986`）。Run target 仍 `extension === 'md' ? path : entry || path`（`:1003`、`:1116`、`:1135`）。`flagsFor` 去掉 `extractBeancountFences`：`.md`/非 ledger-file 走 fence 区域。`onDiagnosticClick:884` 的 `extension === 'md'` 是 quick-fix 默认账本路径，可改为 `!isLedgerFile(file)`，不是行级上下文。**不要**抽 validation 模块、不要动 Fava 字段）
  - `problems.ts`（`openValidationTarget`：资格仍 `isLedgerFile || extension === 'md'`；有无 fence 改问 `ledgerDoc('fenced', text).regions.length`。**不要**让 `.txt` 成为 Run target）
  - `report-view.ts`（fence 扫描与 `tempLedger()`；`pickSource` 仍只认 bean/beancount/md）
  - `vault-index.ts`（`ledgerDoc(ledgerKind(file), content).ledgerSource()`；rename 的 kind 变化用 `ledgerKind` 比，不再 `endsWith('.md')`）
  - `token-suggest.ts` / `snippet-suggest.ts` / `account-suggest.ts` / `payee-suggest.ts`（`editorLedger(...).lineIsLedger`）
  - `posting-indent.ts` / `instant-alignment.ts`
  - `bench/editor.ts`（改为 `ledgerDoc`；行为应不变，因为 bench 用的是 `.bean`）
- 测试：`tests/fences.test.ts`，以及所有 import 了旧符号的测试文件；新建 `tests/ledger-scan-once.test.ts`；改写 `tests/transaction-fold.test.ts`、`tests/include-links.test.ts` 的 #75.13 用例；按需改 `tests/inlay-hints.test.ts`、`tests/flag-warnings.test.ts`、`tests/report-view.test.ts`。
- 根 `CHANGELOG.md`（Changed + Internal）。根 `README.md` 仅加一句可见行为（无文件 / `.txt` 的 fence 也折叠/hints/include/flag；报表仍只认 bean/beancount/md）。

**本 PR 还携带（已由别人写好，执行者不要重写，提交 #69 时一并带上）：**

- `plans/`（本目录全部计划）
- 根 `CONTEXT.md`
- `docs/adr/0001-scanner-in-plugin.md` … `0004-temp-ledger-is-not-ledger-text.md`

**Out of scope**：

- `clock.ts` / `FakeClock` / `tests/fakes.ts` 时钟（002）。
- `validation.ts`、把 `main.ts` 的校验状态搬出（002）。`TempFilePort` 本计划不出现：`tempLedger()` 只造文本+映射，落盘仍留在 `main.ts` 的 `writeFileSync`。
- `scan.ts`、行级词法、CJK 对齐（003）。
- `LedgerIndex` / `setFile` 吃原文后按 region 扫（004）。本计划的 `vault-index` 仍把 `ledgerSource()` 交给现有 `setFileContent`——004 再改扫描方式。
- `completionSlot`（005）。snippet 行首 = **宿主列 0**（缩进 fence 内 `  txn` 不触发 snippet），本计划不改。
- `edits.ts` / 光标映射（006）。
- `FavaProcess` / `vault-path.ts`（007 / 002）。
- `@repo/beancount-parser`。
- 统一四份 `loadPlugin`。
- 重开 #76：账本文本规则、`separatorColumn`、索引只取 Ledger text、Fava HTTP 就绪、bean-check 失败持续显示。

## Git workflow

- 分支：`refactor/69-ledger-regions`，基于**最新 main**（规划时 SHA `8b75729`）。
- 提交信息中文 conventional commits，例：`refactor: Ledger regions 统一账本区域判断（#69）`。可按步骤拆 commit（characterization → API → 调用方 cutover → CHANGELOG），不要把 002+ 的改动塞进来。
- **不要** push，**不要**开 PR（编排者负责）。把已存在的 `plans/`、`CONTEXT.md`、`docs/adr/` 留在工作区，它们随本 PR 合入。

## Target API（实现可微调命名，不得合并 `ledgerSource` 与 `tempLedger`）

全部放在 `apps/obsidian-plugin/fences.ts`。核心 **不** import `obsidian.Editor`。

```ts
type LedgerKind = 'ledger-file' | 'fenced';

interface LedgerRegion {
  hostStartLine: number;       // Host line，0-based，首行 body；ledger-file 为 0
  lines: readonly string[];    // 已剥 opener 0–3 空格；ledger-file 为全文（含注释空行）
  hostIndent: number;          // ledger-file 为 0；笔记 = opener 前导空格数
}

interface TempLedger {
  text: string;
  /** 1-based temp → 1-based 宿主；include 前导与 fence 间空行返回 undefined。禁止改成 0-based。 */
  hostLine(tempLine1: number): number | undefined;
}

interface LedgerDoc {
  readonly kind: LedgerKind;
  readonly regions: readonly LedgerRegion[];
  lineIsLedger(hostLine0: number): boolean;
  containsPos(pos: number): boolean;          // 文档字符偏移（与 `posInBeancountFence(text, pos)` 相同）；body 内 true
  masked(): readonly string[] | null;         // 与宿主等长；非 Ledger text 行为 ''；无 region 时 null
  ledgerSource(): string;                     // region 文本用单个 `\n` 连接，不插空行、无 include
  tempLedger(includePath?: string): TempLedger; // 现 buildFenceLedger：可选 include、fence 间空行、末尾 `\n`
}

function ledgerKind(file: { extension?: string } | null | undefined): LedgerKind;
function isLedgerFile(file: { extension?: string }): file is TFile; // 保留；=== true 查表
function ledgerDoc(kind: LedgerKind, source: string | FenceDoc): LedgerDoc;
function editorLedger(editor: LedgerEditor, file: { extension?: string } | null | undefined): LedgerDoc;
function isSafeIncludePath(path: string): boolean; // 保留
function splitLines(text: string): string[];       // 保留；format 等仍用
```

规则（硬验收）：

- `ledgerKind(null)`、`ledgerKind({ extension: 'txt' })`、`ledgerKind({ extension: 'md' })` → `'fenced'`。`bean` / `beancount` → `'ledger-file'`。文件夹无 extension → `'fenced'`（不会被当成 Ledger file）。
- Ledger file：**恰好一个** region，`hostStartLine=0`，`hostIndent=0`，`lines` 为全文（含 `;` 注释与空行）。
- fenced：每个 `beancount`/`bean` Fence body 一个 region（含空 body `lines=[]`）。开/闭标记行 **不是** Ledger text：`lineIsLedger(opener)===false`。
- `ledgerSource()`：regions 用 `\n` 直连，**不**插空行。空 regions → `''`。
- `tempLedger()`：**只造文本+映射**（A6.1）。落盘是 002 的 `TempFilePort`，本计划不引入该名。`includePath` 不安全则省略 include（现 `isSafeIncludePath`）。Windows 反斜杠改 `/`。无 Ledger text 时 `text === ''` 且无末尾 `\n`（现 `buildFenceLedger([])`）。
- 记忆化（A2.2）：CM `Text`（`FenceDoc` 对象身份）WeakMap 是**唯一**编辑器缓存；`ledgerDoc(kind, 同一 Text)` 返回同一 `LedgerDoc`。vault **字符串不缓存**。删除 `transaction-fold.ts` 的 `fenceBodiesCache`。inlay 的 `DocMemo.masked` 不得再作为第二份 fence 缓存；从 `ledgerDoc` 取 `masked()`。`DocMemo.balance`（balanceHints 结果）可留——那不是 fence 扫描。
- `editorLedger`：若 `file` 是 Ledger file，kind 为 `ledger-file`（可不扫 fence）。否则 kind `fenced`，优先 `editor.cm.state.doc` 走 WeakMap，否则 `editor.getValue()` 现算。
- 报表 `pickSource` **与 bean-check 资格**：本 module 之外允许继续用 `isLedgerFile(file) || file.extension === 'md'`（或等价 bean/beancount/md）决定「要不要当余额 source / 要不要跑 bean-check」。不得用 `ledgerKind === 'fenced'`（否则 `.txt` 会出报表并进入 Run target）。编辑器行级上下文与索引抽取必须用 `ledgerKind` / `lineIsLedger`。

停止导出：`extractBeancountFences`、`docFences`、`ledgerLinesOf`、`editorLineIsLedger`、`buildFenceLedger`、类型 `BeancountFence` / `DocFences` / `FenceLedger`。测试全部改走 `ledgerDoc`。可保留未导出的 `fencesOfLines` 作为 `ledgerDoc` 内部实现。

独立函数 `ledgerSource(path, content)` 删除；调用方改为 `ledgerDoc(ledgerKind(fileOrExt), content).ledgerSource()`。`vault-index` 有 `file.extension`；`bench/editor.ts` 用 `{ extension: 'bean' }` 或 path 推 extension。

## Steps

### Step 0: Drift check + 分支

**Verify**: drift 命令无意外 diff。`git checkout -b refactor/69-ledger-regions`（若编排者已给分支则沿用）。

### Step 1: 缺失场景 characterization（旧 interface）

在 `tests/fences.test.ts` 的 `extractBeancountFences` describe 里补（#69 BDD「闭合可以比开 fence 长，不能比它短」，今日 `# 缺失`）：

```ts
it('closes when the closer is longer than the opener, not when it is shorter', () => {
  expect(extractBeancountFences('````beancount\n2026-01-01 open Assets:Cash\n`````\n')).toEqual([
    { startLine: 1, lines: ['2026-01-01 open Assets:Cash'] },
  ]);
  expect(extractBeancountFences('````beancount\n2026-01-01 open Assets:Cash\n```\n')).toEqual([
    { startLine: 1, lines: ['2026-01-01 open Assets:Cash', '```'] },
  ]);
});
```

Cutover 后把断言改到 `ledgerDoc('fenced', text).regions`（`hostStartLine` / `lines` / `hostIndent`）。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/fences.test.ts` → 该例已绿（实现已支持）。若红：STOP——闭合规则与计划假设不符，不要改 scanner 去迁就测试。

### Step 2: 新 API 直接 TDD（旧导出暂时保留）

Seam（只测这些，不要测 `fencesOfLines` 私有）：`ledgerKind`、`ledgerDoc`（`regions` / `lineIsLedger` / `containsPos` / `masked` / `ledgerSource` / `tempLedger`）、`editorLedger`、WeakMap 身份。

竖切顺序建议（一轮一个失败测试再写最小实现）：

1. `ledgerKind` 表：`bean`/`beancount` → `ledger-file`；`md`/`txt`/`undefined`/`null` → `fenced`。
2. Ledger file：一个 region，`ledgerSource()` === 原文（含 `PG_DATA_DIR:-x` 与注释），`lineIsLedger` 任意 Host line 为 true，`tempLedger()` 无 include 时文本为原文+现有换行约定。
3. 笔记两段 fence：`ledgerSource()` 直连无空行（与今日 `ledgerSource('note.md', …)` 相同）；`tempLedger()` **有** fence 间空行且 `hostLine` 与今日 `buildFenceLedger` 测试相同（把 `tests/fences.test.ts` 的 `buildFenceLedger` 例原样迁过来）。
4. 空 fence：仍有 `lines=[]` 的 region；opener/closer `lineIsLedger === false`。
5. 缩进 0–3：`hostIndent === 2`，`lines` 已剥空格；四空格 / tab 开 fence → 无 region。
6. info string、`~~~`、未闭合至文末、嵌套四反引号、行内 ```` ```x``` ```` —— 从现有 `extractBeancountFences` 例迁移。
7. `containsPos`：body 内 true，opener/closer/散文 false。
8. `masked()`：与今日 `docFences.masked` 相同；无 region 时 `null`。
9. WeakMap：对带 `iterLines` 的假 `Text`，两次 `ledgerDoc('fenced', doc)` 是同一对象；`iterLines` 调用次数为 1；`toString` 次数为 0。计数器做在假文档上，**不要**给生产 API 加 debug 计数。
10. `tempLedger('/vault/main.bean')` include 前导、`hostLine(1)` 为 `undefined`；不安全路径不写 include。

实现提示：把 `fencesOfLines` 改为同时记下 `indent`，push `LedgerRegion`。Ledger file 分支不要走 fence 扫描。`docLines` 的 CR strip（`fences.ts:141-143`）必须保留。

**Verify**: `npx vitest run tests/fences.test.ts` 全绿。此时旧导出仍在，旧测试仍可跑。

### Step 3: 一次切换所有调用方，然后删除旧导出

禁止「只改已用 `docFences` 的，把 align/format/main 留给 006/002」——验收勾不上。

完整生产调用清单（执行前再 grep 一遍，以当时输出为准）：

| 符号 | 文件 |
| --- | --- |
| `extractBeancountFences` | `align.ts` `fence-language.ts` `format.ts` `include-links.ts` `main.ts` `problems.ts` `report-view.ts` `transaction-fold.ts` `fences.ts` |
| `docFences` | `flag-warnings.ts` `include-links.ts` `inlay-hints.ts` `instant-alignment.ts` `posting-indent.ts` `fences.ts` |
| `editorLineIsLedger` | `account-suggest.ts` `payee-suggest.ts` `snippet-suggest.ts` `token-suggest.ts` |
| `ledgerLinesOf` | `instant-alignment.ts` `posting-indent.ts` |
| `ledgerSource` | `vault-index.ts` `bench/editor.ts` `fences.ts` |
| `buildFenceLedger` | `main.ts` `report-view.ts` `fences.ts` |
| `extension !== 'md'` 决定**编辑器**有没有 fence 上下文 | `include-links.ts:231,344,378` `inlay-hints.ts:283,290,314` `transaction-fold.ts:163,171` |
| bean-check / 报表资格（**保持** md 或 ledger-file，不要改成 ledgerKind） | `main.ts:971,986,1003,1116,1135` `problems.ts:95` `report-view.ts:258-259` |
| 索引 kind 变化 | `vault-index.ts:197`（`endsWith('.md')` → `ledgerKind` 比较；`.txt` 抽取改走 fence，但仍不 bean-check） |

替换模式：

- 需要「这行是不是 Ledger text」（编辑器）：`ledgerKind(file)` + `lineIsLedger`，不要再写 `extension === 'md'`。
- 需要区域：`ledgerDoc(ledgerKind(file), textOrDoc)` 或 `editorLedger(editor, file)`。
- 需要「要不要跑 bean-check / 当报表 source」：`isLedgerFile(file) || file.extension === 'md'`。`.txt` 与无文件：**不** `scheduleValidate`、**不** `openValidationTarget`。
- `alignmentRanges(lines, ledger)`（`align.ts:410-419`）：`ledger` 真 → 整篇；假 → `ledgerDoc('fenced', lines.join('\n')).regions` 里 `lines.length > 0` 的 span。实现可留在 `align.ts`。
- `formatFencedDocument`：`regions` + `hostIndent`，删除 `openerIndent` 对 opener 行的重扫（仍可用 `hostIndent` 把格式化结果贴回宿主前缀）。
- `posInBeancountFence(text, pos)`：`ledgerDoc('fenced', text).containsPos(pos)`，`pos` 是字符偏移。若调用处拿得到 `state.doc`，传入同一 `Text` 以命中 WeakMap。
- fold：删 `fenceBodiesCache`。无文件 / `.txt` 走 `ledgerKind` → fenced，在 `lineIsLedger` 的 Host line 上 `transactionFoldAt`。Ledger file 仍整篇。
- include：`ledgerLines` / `includeMarks` / `lineInLedger` 问 `ledgerDoc`/`editorLedger`。无文件与 `.txt` 按 fenced。`docHasFence` 廉价拒绝可留，但命中后必须问 `ledgerDoc`，不得自己解析 info string。
- inlay：`!file` 与 `.txt` 按 fenced 的 `masked()`；不要 `if (!file) return Decoration.none` 然后对 `.txt` 再 `Decoration.none`。Ledger file 仍 `isLedgerFile`。
- flag：`!file` 改为 fenced 的 `masked()`，**禁止**再走全文 `iterLines`。
- `main.ts` 笔记校验（仅当 `extension === 'md'`）：`const doc = ledgerDoc('fenced', text)`；无 region 则安静 run（现 `fences.length === 0` 分支）；有则 `doc.tempLedger(includePath)`，再现有 `mkdtempSync` 落盘。不要在 `main.ts` 再拼 include/空行。Ledger file 仍跑真实路径，不要对 `.bean` 走 `tempLedger`。
- `openValidationTarget`：`isLedgerFile` → target = entry 或 path；`extension === 'md'` 且 `regions.length > 0` → target = path；其它（含 `.txt`、无 fence 的 md）→ `null`。
- `flagsFor(path, text)`：去掉 `extractBeancountFences`。`.md` 或非 ledger-file 用 `ledgerDoc('fenced', text)` 的 regions；ledger-file 仍 `flagDiagnostics(text)`。002 会删掉这个函数。
- `report-view` 读 fence：`ledgerDoc('fenced', text).tempLedger()`（无 include），`hostLine` 回映。`pickSource` 保持 bean/beancount/md。
- suggester：`editorLedger(editor, file).lineIsLedger(cursor.line)`。
- `posting-indent` / `instant-alignment`：`ledgerDoc(ledgerKind(file), view.state.doc).lineIsLedger(...)`。Ledger file 上每行 true，不必再返回 `undefined` 表示「全是」。

改完立即删除旧导出，修测试 import。不要留 deprecated 别名。

**Verify**: `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` exit 0。`npx vitest run tests/fences.test.ts tests/align.test.ts tests/format.test.ts tests/fence-language.test.ts tests/token-suggest.test.ts tests/snippet-suggest.test.ts` 全绿。

### Step 4: 改写 #75.13 旧用例（有意行为变化）

今日钉死旧行为，必须改期望，不要删测试：

1. `tests/transaction-fold.test.ts:182-184`（`folds nothing in other files or an editor without a file`）。`LEDGER` 是**无 fence 的账本文本**，按 fenced 仍然不该折——那测不到新规则。改成：
   - `.txt` / `file=null` 里包一层 ` ```beancount ` … ` ``` `，交易头 **会** fold（与 md 笔记相同）。
   - `.txt` 里**没有** fence 的纯 `LEDGER` 仍 `null`（不是 Ledger file）。
2. `tests/include-links.test.ts:448-455`（无文件 / `.txt` 对裸 `include "a.bean"` 为 []）。裸 include 按 fenced 仍是 []。改成：fence 内的 `include "a.bean"` 在 `file=null` 与 `{ extension: 'txt' }` 上**有** mark；fence 外仍无。同步改 `include-links.test.ts` 里其它「txt 永远无链接」的例（约 `:617`、`:799`）：有 fence 则有链接，无 fence 则无。
3. `tests/inlay-hints.test.ts:322-327`：对无 fence 的 ledger 文本切到 `.txt` / `null` 仍无 hints（fenced 且无 region）。另加：同一段交易包在 fence 里时，`.txt` 与 `file=null` **有** posting/balance hints。
4. flag：无文件 + 无 fence 的 `2026-10-01 ! "A"` **不再**标记；包进 fence 后标记。补测试，不要只靠 code review。
5. `tests/report-view.test.ts:222`「非账本文件清报表」保持：活动文件 `pic.png` / `.txt` 仍清报表；无活动文件保持上次 source。不要让 `.txt` 成为 source。

**Verify**: `npx vitest run tests/transaction-fold.test.ts tests/include-links.test.ts tests/inlay-hints.test.ts tests/flag-warnings.test.ts tests/report-view.test.ts` 全绿。

### Step 5: 跨 module「每文档版本只扫一次」

新建 `apps/obsidian-plugin/tests/ledger-scan-once.test.ts`（A2.5）。假 `Text`：

- `iterLines()` 每次调用 `iters += 1` 再委托真实 CM `Text.iterLines()`。
- `toString()` 每次 `strings += 1`。

同一对象上依次调用（用各 module **公开**入口，不要为测试导出私有函数）：

- `ledgerDoc('fenced', doc)`（或 `editorLedger`）
- `transactionFoldInState`（state.doc 为该对象，file 为 md 或 txt）
- include 的编辑器路径（现有 `include-links.test.ts` 的 plugin/view 装配，把 `state.doc` 换成该对象）
- flag / inlay 的 controller + mock view（照 `flag-warnings.test.ts` / `inlay-hints.test.ts` 的 `editor()` 模式）

断言：`doc.strings === 0`；`doc.iters === 1`（允许 1，不允许 2+）。若某入口仍 `toString()`：修该入口，禁止放宽断言。

**Verify**: `npx vitest run tests/ledger-scan-once.test.ts tests/fences.test.ts` 全绿。

### Step 6: CHANGELOG / README

根 `CHANGELOG.md` 的 `## Unreleased`：

- **Changed**（#75.13，用户可见）：untitled 缓冲与 `.txt` 上，折叠、inlay hints、include 链接、flag 标记只作用于 `beancount`/`bean` Fence body，与补全一致。无 fence 则不把整篇当账本。**Show account balances** 的 source 仍只认 `.bean` / `.beancount` / markdown。
- **Internal**：Ledger regions（`ledgerDoc` / `editorLedger`）集中回答「哪里是 Ledger text」；各功能不再自己扫 fence 或看扩展名决定行级上下文（#69）。

根 `README.md`：在「Transactions fold to their header line」附近加半句——无文件 / `.txt` 里的 beancount fence 同样折叠；余额报表仍只用 ledger 文件或 markdown 笔记。不要新开章节。

**Verify**: 只改了这两处文档 + 代码/测试；`git diff --name-only` 无 out-of-scope 源码。

### Step 7: 全量门禁

仓库根：`pnpm lint`、`pnpm build`、`pnpm test`。然后 `pnpm --filter beancount-obsidian bench`。

本计划不应改变 align/format/dot/enter 的输出哈希（扫描来源变了，改写结果不变）。**不要**设 `BENCH_UPDATE=1`。若哈希变了：STOP，先看是不是误改了 `align.ts`/`format.ts` 的改写逻辑。

**Verify**: 三门禁 exit 0；bench 哈希匹配；覆盖率 ≥90%。

## Test plan

**Seam**（TDD 只打这些）：`ledgerKind`、`LedgerDoc` 六个查询、`editorLedger`、CM WeakMap 身份、`tempLedger` 与 `ledgerSource` 的文本差、跨 module 扫描次数、#75.13 编辑器 vs 报表。

**新测试**在 `tests/fences.test.ts`（可拆 `describe('ledgerDoc')`）+ `tests/ledger-scan-once.test.ts`。结构照 `tests/fences.test.ts` 的 `cmDoc` 助手，但**分别**计 `iterLines` / `toString`（今日 `doc.scans` 其实是测试自己调了 `toString()`，不要复制这个陷阱）。

BDD 地图（issue #69；`# 待产品决定` 且 #76 已定的改为硬验收）：

| 场景 | 验收 | 测试落点 |
| --- | --- | --- |
| 按路径区分整文件账本与笔记 fence | 硬。`main.bean` / `x.beancount` 全文；笔记两段 body 直连；无 fence 笔记 `ledgerSource()===''` | `ledgerDoc` + 迁 `tests/fences.test.ts` 现有 `ledgerSource` 例 |
| info string 只认 beancount/bean | 硬 | 迁现有 extract 例 |
| 反引号与波浪号同等 | 硬；format/补全/fold/include/inlay/flag 只在这些 body 上——现有各文件测试保持绿 | regions + 现有 `format.test.ts` 等 |
| opener 0–3 空格从 body 剥掉 | 硬；`hostIndent` 进入 region | regions + inlay/fold 现有缩进例 |
| 四空格或 tab 不是 fence | 硬 | 迁现有例 |
| 未闭合占剩余部分 | 硬；开 fence 行不是 body | 迁现有例 + `lineIsLedger` |
| 非账本 fence 与行内反引号 | 硬 | 迁现有例 |
| 闭合可以更长、不能更短 | 硬（原 `# 缺失`） | Step 1 |
| 笔记行 ↔ temp 行双向 | 硬。临时第 1 行 = 宿主 1-based；fence 间空行无宿主 | 迁 `buildFenceLedger` 例；`report-view.test.ts:193` 保持 |
| 只有账本位置才是 Ledger text | 硬（#76/#75.1,4,6,7 已定）。`.bean` 任意行 true；笔记只有 `#trip` 那行；opener/closer/空 fence/散文 false。account/payee/narration/Enter/对齐只在账本位置——现有 suggester/indent/align 测试保持绿 | `lineIsLedger`/`containsPos` + 现有 `token-suggest`/`snippet-suggest`/`account-suggest`/`posting-indent`/`align` |
| 同一文档版本只扫描一次 | 硬。跨 module，`toString===0`，`iterLines===1` | Step 5 |
| 无文件 / `.txt` | **硬验收**：编辑器功能按 fenced；报表 source **与 bean-check** 仍只认 bean/beancount/md | Step 4；`report-view.test.ts:222` 保持清 png（现网只有 png）；补 `.txt` 同样清报表。不要写「`.txt` 会跑 bean-check」测试 |

原先「5 个不判断上下文的 feature」与「5 个读整篇笔记的索引」已在 #76 修好。本计划不重开；cutover 后它们必须仍只问 `lineIsLedger` / `ledgerSource()`。不要为它们再写一套产品问题。

**Verify**: 仓库根 `pnpm test` 全绿，含全部新测试。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm lint`、`pnpm build`、`pnpm test` exit 0；插件覆盖率 statements/branches/functions/lines ≥ 90
- [ ] `pnpm --filter beancount-obsidian bench` 哈希与 expected 一致（未设 `BENCH_UPDATE`）
- [ ] `rg -n "extractBeancountFences" apps/obsidian-plugin --glob '!**/coverage/**'` 无匹配
- [ ] `rg -n "\\bdocFences\\b" apps/obsidian-plugin --glob '!**/coverage/**'` 无匹配
- [ ] `rg -n "editorLineIsLedger|ledgerLinesOf|buildFenceLedger" apps/obsidian-plugin --glob '!**/coverage/**'` 无匹配
- [ ] `rg -n "fenceBodiesCache" apps/obsidian-plugin` 无匹配
- [ ] `rg -n "export function ledgerSource" apps/obsidian-plugin` 无匹配（只允许 `LedgerDoc` 方法）
- [ ] `rg -n "extractBeancountFences|docFences" apps/obsidian-plugin --glob '!**/coverage/**'` 在 `align.ts` `format.ts` `main.ts` `transaction-fold.ts` `include-links.ts` `fence-language.ts` `inlay-hints.ts` `flag-warnings.ts` `problems.ts` `report-view.ts` 中无匹配
- [ ] 生产代码中，除 (1) `fences.ts` (2) `report-view.ts` 的 `pickSource` (3) `main.ts`/`problems.ts` 的 **bean-check 资格与 Run target**（必须仍认 `.md`，不是一切 fenced）(4) `onDiagnosticClick` 的默认 openFile 外，没有用 `file.extension === 'md'` / `!== 'md'` 决定「这行是不是账本」
- [ ] `ledgerKind` / `ledgerDoc` / `editorLedger` 从 `fences.ts` 导出；`isLedgerFile` 仍导出
- [ ] `tests/ledger-scan-once.test.ts` 存在且断言同一 `Text` 上 `toString` 为 0、fence 扫描一次
- [ ] `tests/transaction-fold.test.ts` 与 `tests/include-links.test.ts` 覆盖 untitled / `.txt` **有 fence 则编辑器功能生效**
- [ ] `tests/report-view.test.ts` 仍：无活动文件保持上次 source；`.txt` 与 png 清报表；**没有**把 `.txt` 当 bean-check / 报表 source
- [ ] `CHANGELOG.md` `## Unreleased` 有 Changed（#75.13）和 Internal（#69）
- [ ] 无 out-of-scope 源码改动（`git diff --name-only` 对照 Scope）。`plans/`、`CONTEXT.md`、`docs/adr/` 若已在工作区，保留它们，不要删
- [ ] 不更新 `plans/README.md` 状态行（评审维护）

## STOP conditions

Stop and report back (do not improvise) if:

- Current state 摘录与工作区代码不符（漂移）。
- 某步验证连续失败两次。
- 修复看起来必须改 out-of-scope 文件（parser、`edits.ts`、`validation.ts`、`clock.ts`、Fava 生命周期）。
- 发现必须把 `ledgerSource()` 与 `tempLedger()` 合成一个拼接函数才能让测试通过（违反 ADR 0004 / 风险 3）。
- bench 哈希变了，但你没有改 align/format 的改写规则——不要 `BENCH_UPDATE=1` 遮过去。
- 「闭合更长/更短」characterization 在旧 `extractBeancountFences` 上就是红的（实现与 CommonMark 假设不符）。
- 跨 module 测试只有通过给生产代码加全局扫描计数器才能绿（禁止；修调用方）。
- 删除 inlay `DocMemo.masked` 后，若不重写整个 inlay 插件就无法保持滚动时复用 `balanceHints`——保留 `DocMemo.balance`，不要为了字面「删掉 DocMemo」而重做 inlay。
- `pickSource` 或 `openValidationTarget` / `scheduleValidate` 被改成 `ledgerKind === 'fenced'`，导致 `.txt` 出现在余额报表或成为 Run target。
- 为了让 `.txt` 折叠，把 `.txt` 当成 `ledger-file`（违反 #76：其它缓冲只有 fence 体）。

## Maintenance notes

- #68 必须消费 `tempLedger()` 的文本和 1-based `hostLine`，再用 `TempFilePort.write` 落盘；不要在 validation 里重写 `buildFenceLedger`。
- #70 对每个 `LedgerRegion.lines` 调用 `scanLedger`，禁止对 `ledgerSource()` 直连串扫描（两段 fence：第一段 header、第二段 posting 会被吞成一笔）。
- #71 用 `lineIsLedger` + 宿主列 0；不要在本 module 里为缩进 fence 改 snippet 触发。
- #72 `setFile` 吃 vault 原文 + path，自己 `ledgerKind`+`regions`；本计划仍给索引 `ledgerSource()` 字符串，004 再换。
- #73 format 应读 `hostIndent`，不要再扫 opener。不要在本 PR 把 `alignInEditor` 搬进 `edits.ts`（风险 8）。
- 评审重点：WeakMap 是否真的是唯一编辑器缓存；fold 是否还有 `toString()`；flag 无文件是否仍走全文；`ledgerSource` vs `tempLedger` 文本是否再次分叉；报表是否误吃 `.txt`。
- 本计划有意改变 untitled / `.txt` 编辑器行为（Changed）。索引对 `.txt` 从「全文」改为「仅 fence」——与 #76 一致，无单独用户文案除非 README 已声称 `.txt` 会进索引（今日没有）。

## Review notes

- Bean-check 是否扩到 `.txt`：A2.3 与跨 PR 合同只锁编辑器 + 报表 source；「`.txt` 不是 bean-check 入口」。已与 002 Out of scope 对齐。

