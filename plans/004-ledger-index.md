# Plan 004: LedgerIndex 按 region 扫描，一份 FileFacts 取代九个 VaultCache

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Do **not** update `plans/README.md` — Status 由编排者维护，执行者不要改 README。
>
> **Drift check (run first)**:
> `git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/vault-index.ts apps/obsidian-plugin/account-index.ts apps/obsidian-plugin/token-index.ts apps/obsidian-plugin/payee-index.ts apps/obsidian-plugin/payee-template.ts apps/obsidian-plugin/code-actions.ts apps/obsidian-plugin/main.ts apps/obsidian-plugin/account-hover.ts apps/obsidian-plugin/account-suggest.ts apps/obsidian-plugin/payee-suggest.ts apps/obsidian-plugin/token-suggest.ts apps/obsidian-plugin/suggest.ts apps/obsidian-plugin/bench/bench.ts apps/obsidian-plugin/bench/editor.ts apps/obsidian-plugin/tests/vault-index.test.ts apps/obsidian-plugin/tests/account-index.test.ts apps/obsidian-plugin/tests/code-actions.test.ts apps/obsidian-plugin/tests/payee-template.test.ts apps/obsidian-plugin/tests/account-hover.test.ts apps/obsidian-plugin/tests/account-suggest.test.ts apps/obsidian-plugin/tests/payee-suggest.test.ts apps/obsidian-plugin/tests/token-suggest.test.ts apps/obsidian-plugin/tests/pinyin.test.ts apps/obsidian-plugin/tests/completion-rank.test.ts apps/obsidian-plugin/tests/snippet-suggest.test.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition — **except** the 001–003 expected diffs in Step 0.
>
> 本计划假定 `plans/001-ledger-regions.md` 与 `plans/003-ledger-line-scanner.md` **已合并**：生产代码已提供 `ledgerKind` / `ledgerDoc` / `LedgerRegion` / `scanLedger(text: string)`。串行下 002 也已在 main；本计划不使用 `FakeClock`。不要重开 #76 已定行为（索引只取 Ledger text）。

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-ledger-regions.md`（`ledgerKind` / `ledgerDoc` / `LedgerRegion`）、`plans/003-ledger-line-scanner.md`（`scanLedger(text: string)`）。串行合并顺序 001→002→003→004，故开分支时 002 已在 main；本计划不消费 002 符号。
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/72

## Why this matters

`registerVaultIndex` 已经对每个 vault 事件只 `cachedRead` 一次，但读完后把 `ledgerSource()` 拼接串喂给 9 个 `VaultCache`，每个再扫一遍；`renameFile` 前缀重挂写了 5 份。笔记两段 fence 若先拼接再扫，上一段 header 会吞下一段 posting（风险 3）。落地后：每个文件读一次、按 Ledger region 各 `scanLedger` 一次、得到一份 File facts；改名/删除只有一份；补全 / hover / 模板 / quick fix 继续走窄查询口。余额 `parsedByPath` 与 report-view 自己的 vault 监听不并入（ADR 0003 / 风险 5）。

## Current state

相关文件（HEAD `8b75729` 行号；001–003 合并后 `main.ts` / `fences.ts` 会漂移，以符号为准）：

- `apps/obsidian-plugin/main.ts` — `onload` 装配 9 个 cache 并 `registerVaultIndex`；`pairings` / `openFiles` 是实例字段，quick fix 再读。
- `apps/obsidian-plugin/vault-index.ts` — `VaultCache`、`VaultIndex`（按路径字符串 + 排名）、`registerVaultIndex`（全局 `revision`、失败保留、`kindChanged` 重读）。
- `apps/obsidian-plugin/account-index.ts` — `AccountIndex`：内嵌 `VaultIndex(extractAccounts)` + 自有 `directivesByPath` / `renameFile`。
- `apps/obsidian-plugin/payee-index.ts` — `extractPayees`；cache 是 `VaultIndex`。
- `apps/obsidian-plugin/token-index.ts` — `extractCommodities` / `extractTags` / `extractLinks` / `extractNarrations`。
- `apps/obsidian-plugin/payee-template.ts` — `PayeeTemplateIndex` 第三份 `renameFile`。
- `apps/obsidian-plugin/code-actions.ts` — `PairingIndex`、`OpenFileIndex` 第四、五份 `renameFile`。
- `apps/obsidian-plugin/account-hover.ts` — hover 吃 `AccountIndex.has` / `record`。
- `apps/obsidian-plugin/suggest.ts` — 窄口 `CompletionIndex { match; remember? }`。
- `apps/obsidian-plugin/balances.ts` — 模块级 `parsedByPath`（**不要动**）。
- `apps/obsidian-plugin/report-view.ts` — 自己听 modify/create/delete/rename（**不要动**）。
- `apps/obsidian-plugin/bench/bench.ts` — workload `index` 调 6 个 extractor。
- `apps/obsidian-plugin/bench/editor.ts` — workload `save` 模拟 9 cache + `ledgerSource`。

九个 `VaultCache` 清单（自己从 `main.ts` 读到，不是 transcript 行号）：

| # | 实例 | 类型 | extractor / 事实 |
| --- | --- | --- | --- |
| 1 | `accounts` | `AccountIndex` | `extractAccounts` + `extractAccountDirectives` |
| 2 | `payees` | `VaultIndex(extractPayees)` | payee 字符串 |
| 3 | `commodities` | `VaultIndex(extractCommodities)` | commodity |
| 4 | `tags` | `VaultIndex(extractTags)` | tag（含 `#`） |
| 5 | `links` | `VaultIndex(extractLinks)` | link（含 `^`） |
| 6 | `narrations` | `VaultIndex(extractNarrations)` | narration |
| 7 | `this.pairings` | `PairingIndex` | 两腿配对 |
| 8 | `this.openFiles` | `OpenFileIndex` | open 所在文件 |
| 9 | `payeeTemplates` | `PayeeTemplateIndex` | 最新 payee 模板 |

`registerVaultIndex` 调用（`main.ts:534-545`）：

```ts
registerVaultIndex(
  this,
  accounts,
  payees,
  commodities,
  tags,
  links,
  narrations,
  this.pairings,
  this.openFiles,
  payeeTemplates
);
```

一次 read 喂 9 次 `setFileContent`（`vault-index.ts:144-164`）：

```ts
const revisions = new Map<string, number>();
let revision = 0;
const refresh = (file: TAbstractFile): void => {
  if (!isTextFile(file)) return;
  const path = file.path;
  const current = ++revision;
  revisions.set(path, current);
  vault
    .cachedRead(file)
    .then((content) => {
      if (revisions.get(path) !== current) return;
      const ledger = ledgerSource(path, content);
      for (const index of indexes) index.setFileContent(path, ledger);
      revisions.delete(path);
    })
    .catch(() => undefined);
};
```

`kindChanged` 今日用路径后缀，不是 `ledgerKind`（`vault-index.ts:192-198`）：

```ts
const kindChanged = oldPath.endsWith('.md') !== file.path.endsWith('.md');
if (dropped.length > 0 || !moved || kindChanged) refresh(file);
```

五份 `renameFile`：`vault-index.ts:98`、`account-index.ts:201`、`payee-template.ts:170`、`code-actions.ts:345`、`code-actions.ts:382`。

余额缓存（不要并入，`balances.ts:155-156`、`:224-238`）：

```ts
const parsedByPath = new Map<string, ParsedLedger>();
function parseLedger(path: string, text: string): ParsedLedger {
  const hit = parsedByPath.get(path);
  if (hit && hit.text === text) return hit;
  // BeancountParser.parse(text) …
  parsedByPath.set(path, parsed);
  return parsed;
}
```

报表自己的监听（不要并入，`report-view.ts:132-154`）：`vault.on('modify'|'create'|'delete'|'rename')`，只 `schedule()` include 链。

`CompletionIndex`（`suggest.ts:17-21`）是 suggest 的窄口，保留：

```ts
export interface CompletionIndex {
  match(query: string): string[];
  remember?(value: string): void;
}
```

Account hover 额外需要 `has` / `record`（`account-hover.ts:30-35`）。

001 之后预期（本计划消费，不在本计划实现；与 `plans/001-ledger-regions.md` Target API 一致）：

```ts
// apps/obsidian-plugin/fences.ts
type LedgerKind = 'ledger-file' | 'fenced';
interface LedgerRegion {
  hostStartLine: number;    // Host line，0-based；ledger-file 为 0
  lines: readonly string[];
  hostIndent: number;
}
function ledgerKind(file: { extension?: string } | null | undefined): LedgerKind;
function ledgerDoc(kind: LedgerKind, source: string | FenceDoc): LedgerDoc; // .regions
```

- **禁止**对 `ledgerSource()` 拼接串做一次 `scanLedger`（A6.3）

003 之后预期（与 `plans/003-ledger-line-scanner.md` 公开签名一致，**不要**假设 `string[]` overload）：

```ts
// apps/obsidian-plugin/scan.ts
function scanLedger(text: string): ScanResult; // { lines, entries }
```

`ScannedEntry.startLine` 相对这次扫描的文本、0-based。`scanLedger('')` → `{ lines: [], entries: [] }`。转宿主行：`region.hostStartLine + entry.startLine`（Host line）。open 行币种 **不**在 ScannedEntry 上——本计划从 `region.lines[entry.startLine]` 按今日 `extractAccountDirectives` 的 remainder 解析。

Repo 约定：

- 覆盖率地板 90%（`apps/obsidian-plugin/vitest.config.mts:28-33`）。
- 中文 conventional commits；例：`8b75729 fix: 修复架构评审汇总的 UI/UX 问题（#75） (#76)`。
- 测试 fake 在 `apps/obsidian-plugin/tests/fakes.ts`（`FakeVault`、`flush`）。禁止 `vi.useFakeTimers`。本计划的 vault 异步用 `FakeVault.delays` + 现有 `delay()`/`flush()`，不要引入时钟。
- TDD：红→绿，竖切；新 module 直接 TDD。缺失场景若仍只存在于旧 interface，先补 characterization 再迁。
- CHANGELOG 根目录 `## Unreleased` 下 `### Internal` 一行；本 PR 无用户可见行为则不动 README。
- ADR 0003 `docs/adr/0003-index-is-not-balance-cache.md` 已在规划阶段随 #69 合入（Accepted）。本 PR 不改其正文。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Drift | `git diff --stat 8b75729..HEAD -- <in-scope paths>` | 若有 diff，先对照 Current state 摘录 |
| 单测（新） | `cd apps/obsidian-plugin && npx vitest run tests/ledger-index.test.ts` | 该文件全绿 |
| 单测（迁） | `cd apps/obsidian-plugin && npx vitest run tests/vault-index.test.ts tests/account-index.test.ts tests/account-hover.test.ts tests/payee-template.test.ts tests/code-actions.test.ts tests/account-suggest.test.ts tests/payee-suggest.test.ts tests/token-suggest.test.ts tests/pinyin.test.ts tests/completion-rank.test.ts` | 全绿 |
| 类型 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0 |
| Lint | `pnpm lint`（仓库根） | exit 0 |
| Build | `pnpm build`（仓库根） | exit 0 |
| 全量测试 | `pnpm test`（仓库根） | 全绿；基线 1064，本计划会增测、删重复改名测；覆盖率 ≥90% |
| Bench | `pnpm --filter beancount-obsidian bench` | `index` 与 `save` 哈希与 `bench/expected.json` / `bench/editor-expected.json` 一致；**不要**设 `BENCH_UPDATE=1` 除非哈希因「同一份 FileFacts、查询结果集合不变」而序列化形状变了——若变，STOP 先报告，不要自行改 expected |

## Suggested executor toolkit

- 若环境有 `tdd` skill：本计划 Step 2–4 用红→绿竖切；先写 `tests/ledger-index.test.ts` 再写 `ledger-index.ts`。
- 术语：根 `CONTEXT.md`（Ledger file / Ledger kind / Ledger text / Ledger region / Fence body / Host line / File facts / Scanned entry）。实现词 Revision token 不要写进 CONTEXT。
- ADR：`docs/adr/0003-index-is-not-balance-cache.md`。
- 前序符号：`ledgerKind` / `ledgerDoc`（#69）、`scanLedger`（#70，`apps/obsidian-plugin/scan.ts`）。

## Scope

**In scope**（只改这些，以及为删类而必须改的测试/bench 引用）：

- 新建 `apps/obsidian-plugin/ledger-index.ts`（`FileFacts`、`LedgerIndex`、`setFile` / `applyVault`）
- 新建 `apps/obsidian-plugin/tests/ledger-index.test.ts`
- `apps/obsidian-plugin/vault-index.ts` — 删除 `VaultCache`、`VaultIndex`、`registerVaultIndex`；保留 `isTextFile`、`TEXT_EXTENSIONS`（`main.ts` 校验/对齐仍用）；`MAX_SUGGESTIONS` 再导出可删，测试改从 `completion-rank` 引
- `apps/obsidian-plugin/account-index.ts` — 删除 `AccountIndex`；保留 `ACCOUNT_SHAPE`、`ACCOUNT_PREFIX_RE`、`ACCOUNT_CHAR_RE`、`accountTokenAt`、`AccountRecord`、`isAccountClosed`、`describeAccount`、`accountHoverCard`
- `apps/obsidian-plugin/payee-template.ts` — 删除 `PayeeTemplateIndex`、`extractLatestPayeeTemplates`（逻辑迁入 FileFacts 归并）；保留 `PayeeTemplate`、`TemplatePosting`、`buildPayeeAutofill`
- `apps/obsidian-plugin/code-actions.ts` — 删除 `PairingIndex`、`OpenFileIndex`；保留 `Pairing`、`inferBalancingAccount`、quick fix 纯函数
- `apps/obsidian-plugin/payee-index.ts` / `token-index.ts` — 删除仅被索引调用的 `extractPayees` / `extractCommodities` / `extractTags` / `extractLinks` / `extractNarrations`（若无其它生产调用方）；保留 `*_PREFIX_RE`、`transactionPayee`
- `apps/obsidian-plugin/account-index.ts` — 删除 `extractAccounts` / `extractAccountDirectives`（若无其它生产调用方）
- `apps/obsidian-plugin/main.ts` — 一个 `LedgerIndex`；suggest / hover / quick fix 拿窄口
- `apps/obsidian-plugin/account-hover.ts`、`account-suggest.ts` — `AccountIndex` 改为窄接口（`CompletionIndex` + `has` + `record`）
- `apps/obsidian-plugin/payee-suggest.ts`、`token-suggest.ts` — 继续 `CompletionIndex`
- 测试：`tests/vault-index.test.ts` 事件/并发迁到 `ledger-index.test.ts` 后删除或缩成 `isTextFile` 单测；`account-index.test.ts` / `code-actions.test.ts` / `payee-template.test.ts` / `account-hover.test.ts` / `account-suggest.test.ts` / `payee-suggest.test.ts` / `token-suggest.test.ts` / `pinyin.test.ts` / `completion-rank.test.ts` / `snippet-suggest.test.ts` 去掉已删类
- `apps/obsidian-plugin/bench/bench.ts`、`bench/editor.ts` — `index` / `save` 打 `LedgerIndex.setFile` + 查询，不再 6 extractor / 9 cache
- 根 `CHANGELOG.md` — `## Unreleased` → `### Internal` 一行

**Out of scope**（即使看起来相关也禁止改）：

- `apps/obsidian-plugin/balances.ts`、`report-view.ts` — 余额 parse 缓存与报表监听不并入；不要把 include 图塞进 `FileFacts`（ADR 0003 / 风险 5）
- `apps/obsidian-plugin/scan.ts`、`align.ts`、`format.ts`、`transaction-fold.ts` — #70 的行级 API，本计划只**调用** `scanLedger`
- `completionSlot` / 7 个 EditorSuggest 仲裁（#71）
- `edits.ts` / 光标映射（#73）
- `validation.ts` / `FakeClock` / `vi.useFakeTimers`
- `beancount-mode.ts`、`packages/beancount-parser`
- 根 `README.md`（无可见行为变化）
- `CONTEXT.md`
- `docs/adr/0003-index-is-not-balance-cache.md` 正文（已 Accepted）
- `plans/README.md`

## Git workflow

- Branch: `refactor/72-ledger-index`，基于最新 `main`（须已含 001–003）
- 按逻辑步提交；信息中文 conventional commits，例：`refactor: Ledger index 统一账本事实索引（#72）`
- 执行者不要 push、不要开 PR

## Steps

### Step 0: Drift check 与前序符号

001 **预期** `vault-index.ts`：`ledgerSource(path, content)` 改为 `ledgerDoc(ledgerKind(file), content).ledgerSource()`；`kindChanged` 已用 `ledgerKind` 而不是 `endsWith('.md')`。003 **预期** `scan.ts` 存在。这些不是 STOP。STOP：`registerVaultIndex` 已被删、或 `scanLedger` 不接受 `string`。

**Verify**:

```sh
rg -n "export function ledgerKind|export function ledgerDoc|interface LedgerRegion|hostStartLine" apps/obsidian-plugin/fences.ts
rg -n "export function scanLedger" apps/obsidian-plugin/scan.ts
test -f docs/adr/0003-index-is-not-balance-cache.md
cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck
```

→ 三个符号有匹配；ADR 存在；tsc exit 0。任一缺失 → STOP。

### Step 1: 窄接口与 FileFacts 形状（先测后写）

在 `ledger-index.ts` 落地（命名可微调，语义不可改；**A6.3 修正优先于 A4.4 草案**）：

```ts
interface FileFacts {
  accounts: ReadonlySet<string>;
  directives: ReadonlyArray<{
    kind: 'open' | 'close';
    account: string;
    date: string; // YYYY-MM-DD
    currencies: readonly string[];
  }>;
  payees: ReadonlySet<string>;
  narrations: ReadonlySet<string>;
  commodities: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  links: ReadonlySet<string>;
  pairings: readonly Pairing[];
  templates: ReadonlyMap<string, PayeeTemplate>;
  openCount: number; // 该路径 open 账户个数，供 bestOpenFile
}

class LedgerIndex {
  constructor(usage?: CompletionUsage, pinyin?: () => boolean)
  applyVault(plugin: Plugin): void
  /** vault 原文 + path；内部 ledgerKind → ledgerDoc → 各 region scanLedger */
  setFile(path: string, rawText: string): void
  removeFile(path: string): void
  renameFile(oldPath: string, newPath: string): boolean

  readonly accounts: CompletionIndex & {
    record(name: string): AccountRecord | undefined;
    has(name: string): boolean;
  };
  readonly payees: CompletionIndex;
  readonly commodities: CompletionIndex;
  readonly tags: CompletionIndex;
  readonly links: CompletionIndex;
  readonly narrations: CompletionIndex;

  templateFor(payee: string): PayeeTemplate | null;
  pairings(): readonly Pairing[];
  bestOpenFile(): string | null;
  openedIn(path: string): ReadonlySet<string>;
}
```

禁止：

- `setFileContent(path, ledgerText)` 吃 `ledgerSource()` 再 `scanLedger`（A4.4 草案已被 A6.3 废止）
- 导出 9 个 cache 类
- `FileFacts` 含 include 图、AST、`parsedByPath`

`setFile` 算法：

1. 从 path 取 **最后一段**扩展名（与 Obsidian `TFile.extension` 相同：`a.bean` → `bean`，`foo.bar.md` → `md`）。`ledgerKind(ext ? { extension: ext } : {})`。无扩展名 / `txt` → `'fenced'`（#69）。非 `isTextFile` 的 path 测试里不要调用 `setFile`。
2. `const doc = ledgerDoc(kind, rawText)`。
3. 对每个 `region`：若 `region.lines.length === 0`，当作空 scan（或 `scanLedger('')`）。否则 **`scanLedger(region.lines.join('\n'))`**。不要 `string[]` overload，不要先拼全文件。
4. 把各 region 的 Scanned entry 归并成该 path 的一份 `FileFacts`。模板的 `PayeeTemplate.line` 用 **Host line**（`region.hostStartLine + entry.startLine`）。payee 字符串 = 今日 `transactionPayee` 的字面量（含 `\"`），不要 unescape。
5. 字符串仍丢弃 `length > 256`。在 `ledger-index.ts` 写 `const MAX_VALUE_LENGTH = 256`（今日 `vault-index.ts:29`，私有，不要从 vault-index 再导出）。
6. 空 facts 的 path：与今日「无字符串则 untracked」相同——`renameFile` 返回 `false`，`applyVault` 会重读。

账户集合必须覆盖今日 `extractAccounts` 在 **每个 region 的 Ledger text** 上的可观察结果（posting-only 名称、ledger file 正文里的 `ACCOUNT_SHAPE`）。不要只收 `open` 行。若 `scanLedger` 某 `LineKind` 不含账户 span，允许在 **region.lines** 上复用 `ACCOUNT_SHAPE` 补账户集合，但 **仍然每个 region 扫一次**，禁止全文件 `ledgerSource` 连扫。commodity / tag / link / narration / payee 同理：可观察 `match` 结果与今日 extractor 在该 region 文本上一致。

`match`：继续 `rankCompletions`（prefix → subsequence → frecency；pinyin getter 为 true 时插入声母档）。账户 `match` 仍隐藏 `isAccountClosed` 的名字；`has` / hover 仍认识已关闭账户。

`bestOpenFile`：原样搬 `OpenFileIndex.bestFile`——Ledger file（`.bean` / `.beancount`）击败笔记，即使笔记 open 更多；同 kind 则 openCount 更大者赢；全空则 `null`。

模板最新规则原样：日期新者赢；同日 path 字符串更大者赢；同 path 则 Host line 更大者赢；没有 posting 的更晚交易不挤掉已有模板。

**Verify**: 先写 Step 2 测试文件，`cd apps/obsidian-plugin && npx vitest run tests/ledger-index.test.ts` → 失败（缺模块或断言红）。本步不要先写绿实现。

### Step 2: 两段 fence 不被吞（新 module TDD，风险 3）

`tests/ledger-index.test.ts` 第一条（# 缺失 → 直接打新 interface）：

```
Given note.md:
  ```bean
  2026-01-01 * "Cafe"
  ```
  ```bean
    Expenses:Food  10.00 USD
    Assets:Cash   -10.00 USD
  ```
When index.setFile('note.md', raw)
Then pairings() 为空（两段不是同一笔 Scanned entry）
And 账户仍含 Expenses:Food 与 Assets:Cash
And 不把第二段 posting 算进第一段 "Cafe" 的模板
```

对照：若错误地对 `ledgerSource()` 连扫，第一段 header 会吞第二段 posting。此测试必须失败那种实现。

再写：

- `setFile('a.bean', raw)` 一次读入的事实同时含账户与 payee（对应今日「一次读取多种事实」）
- 笔记正文 `PG_DATA_DIR:-supabase-db-data` 不进 `accounts.match`；fence 内 `open` / posting 账户进入
- 笔记 fence 外更晚的 `"Cafe"` 两腿交易 **不** 进入 payee / narration / 模板 / 配对 / open 计数（#76 硬验收，原 BDD「待产品决定」）

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/ledger-index.test.ts` → 红，然后实现 `setFile` 后绿。

### Step 3: 查询口与生命周期（仍不接线 vault）

把今日 `AccountIndex` / 各 `VaultIndex` / 模板 / 配对 / open 的 **纯查询** 测试迁到 `LedgerIndex` 的窄口（`setFile` 喂 **vault 原文**，含 fence 的 md 喂带 fence 的原文，不要先 `ledgerSource`）：

- close 后补全退出、posting-only 仍补全、hover 仍认识关闭账户、再 open 后补全回来（`account-index.test.ts` 约 323+、`account-hover.test.ts` 约 93）
- 同一 payee 模板取最新（`payee-template.test.ts:40` 的 a/b/c.bean + `2026/02/01`）
- 两腿配对跨文件合并；改名再删除后为空
- `bestOpenFile`：笔记 3 条 open vs `accounts.bean` 2 条 → bean；同为 ledger 则条数多者；没有任何 open → `null`

`renameFile` / `removeFile` 只在 `LedgerIndex` 实现一份前缀重挂（含文件夹 `oldPath + '/'`）；模板条目的 `path` 必须改写到新路径（今日 `PayeeTemplateIndex.renameFile`）。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/ledger-index.test.ts` → 上述用例绿。

### Step 4: `applyVault` — 并发语义原样搬迁（A4.5）

把 `registerVaultIndex` 的事件与 revision 逻辑搬进 `LedgerIndex.applyVault`，**语义不得改**：

- 只索引 `isTextFile`（`md` / `bean` / `beancount`）；`d.png` 不读
- 全局单调 `++revision`（**不是**每 path 从 1 数）；注释保留：删后重建若每 path 从 1 会计数会撞上旧 read（`vault-index.ts:149-151`）
- 落地时 `revisions.get(path) !== current` 则丢
- `.catch(() => undefined)`：失败保留上一次成功 File facts
- rename：删在途 token；`renameFile`；若 `dropped.length > 0 || !moved || kindChanged` 则 `refresh`
- `kindChanged` 改为 `ledgerKind(old) !== ledgerKind(new)`（`.md` ↔ `.bean` 重读；`.bean` ↔ `.beancount` 同为 `ledger-file` 不重读，除非 `!moved` / dropped）
- 改成不可索引扩展名：`removeFile` 新路径（今日对非 `isTextFile` 调 `removeFile(file.path)`）
- 文件夹改名：子路径前缀重挂；只对 dropped 的在途 child `refresh`

从 `tests/vault-index.test.ts` 把 `registerVaultIndex` 整段迁来，断言改打 `LedgerIndex` 查询口；`vault.reads` 仍断言「一事件一读」。乱序 / 改名掉在途 / 失败保留三条必须留下。

**Verify**: 迁过去的事件测试全绿。允许测试里继续 `delay(50~100)` 配 `FakeVault.delays`（这是 promise 延迟，不是 debounce 时钟）。禁止 `vi.useFakeTimers`。

### Step 5: 切换调用方，删除 9 类

`main.ts`：

```ts
const ledger = new LedgerIndex(this.usage, () => this.settings.pinyinMatching);
ledger.applyVault(this);
// AccountSuggest(this.app, ledger.accounts) 等
// accountHoverTooltip(ledger.accounts)
// quickFixesForLine({ pairings: ledger.pairings(), openFile: ledger.bestOpenFile(), openedAccounts: ledger.openedIn(...) })
```

删除 `this.pairings` / `this.openFiles` 字段。删除 `registerVaultIndex(...)` 九参数。

`AccountSuggest` / hover 的参数类型改为窄接口，不要依赖已删的 `AccountIndex`。

删掉 `VaultIndex`、`AccountIndex`、`PayeeTemplateIndex`、`PairingIndex`、`OpenFileIndex`、`VaultCache`、`registerVaultIndex`。`grep` 见 Done criteria。

改名/删除测试**合并一份**（本文件 `tests/ledger-index.test.ts`）。从 `account-index.test.ts`、`code-actions.test.ts`、`payee-template.test.ts` 删除仅测 adapter `renameFile`/`removeFile` 的用例（保留 `inferBalancingAccount`、`buildPayeeAutofill`、`ACCOUNT_SHAPE` 等纯函数测）。

`extract*` 单测：若函数已删，把「形状」用例改成 `setFile` + `match`，或删掉与 FileFacts 重复的 extractor describe。不要两套永久并存。

**Verify**:

```
cd apps/obsidian-plugin && npx vitest run tests/ledger-index.test.ts tests/account-index.test.ts tests/account-hover.test.ts tests/payee-template.test.ts tests/code-actions.test.ts tests/account-suggest.test.ts tests/payee-suggest.test.ts tests/token-suggest.test.ts tests/pinyin.test.ts tests/completion-rank.test.ts tests/snippet-suggest.test.ts tests/plugin.test.ts
```

→ 全绿。

`cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` → exit 0。

### Step 6: Bench `index` / `save`

`bench/bench.ts` workload `index`：对生成账本 `new LedgerIndex().setFile('ledger.bean', ledger)`，返回 `match` / `record` / `templateFor` / `pairings` / `bestOpenFile` 的可哈希快照（集合排序后），**不要**再调 6 个 extract\*。

`bench/editor.ts` `saveWorkload`：一次 `setFile(ledgerFile.path, ledger)`（原文；`.bean` 无 fence），返回与今日类似的 `[accounts.match('Ex'), payees.match('W'), commodities.match('U')]`。禁止 `ledgerSource` + 9 cache。

`dot` / `enter` **禁止** `scanLedger(wholeBuffer)`（#70 合同；本计划不要改这两条 workload）。

**Verify**: `pnpm --filter beancount-obsidian bench` → `index` 与 `save` 哈希通过。若仅因快照从 `Set` 迭代顺序变成排序数组而哈希变、查询结果集合不变：STOP 报告，等编排者决定是否 `BENCH_UPDATE=1`。不要为过 bench 改排名算法。

### Step 7: CHANGELOG

根 `CHANGELOG.md` 的 `## Unreleased` 增加（若无 `### Internal` 则建）：

```
### Internal

- Ledger index 对每个 vault 文件按 Ledger region 扫描一次得到 File facts，改名/删除只保留一份（#72）。
```

不要改 README。不要改 ADR 0003 正文。

**Verify**: `pnpm lint && pnpm build && pnpm test`（仓库根）→ exit 0，覆盖率 ≥90%。

## Test plan

新文件 `apps/obsidian-plugin/tests/ledger-index.test.ts`，结构可参考今日 `tests/vault-index.test.ts` 的 `FakeVault` + `flush` 装配。

BDD 地图（#72 原文 → 本计划硬验收；`# 待产品决定` 且 #76 已定的改为硬验收）：

| 场景 | 原注释 | 新测试位置 / 断言 |
| --- | --- | --- |
| 启动扫描 md/bean/beancount，跳过 png | 现有 vault-index.test.ts:141 | `applyVault`：能查到三账户；`vault.reads` 无 `d.png` |
| 一次读取同时更新多种事实 | :157 | 一 `reads` 条；`accounts`+`payees` 都有 |
| 修改只刷新该路径 | :177 | modify 后 Old 消失、New+Food 在 |
| 加载后新建进入索引 | :185 | create `new.md` → `Liabilities:Card` |
| 删除只去掉该文件事实 | :193 | 删 a 后 Food 在、Cash 无 |
| 同类型改名重挂且不重读 | :209 | rename 后 reads 仍一次；删新路径 Cash 消失 |
| 文件夹改名按前缀重挂 | vault-index:258 + account-index:407 | close 仍隐藏；删 moved/b.bean 后 Cash 回补全；删 moved/a.md 后 Food 仍在 |
| 改成不可索引扩展名移除 | :345 | `a.md`→`a.txt` 查不到 |
| `.txt`→可索引，或 md↔bean 重读 | :268 / :277 | `note.txt`→`note.md` 读出；`x.md`→`x.bean` 含 Prose:Name+Food，改回只 Food |
| 乱序 / 改名 / 失败不写过期 | :353 / :468 / :483 | Fresh 保留；失败保留 Old |
| close 退出补全；hover 仍认识；再 open | account-index / account-hover | `accounts.match` / `has` / `record` |
| 同一 payee 最新模板；无 posting 不挤掉 | payee-template.test.ts:40,:71 | `templateFor('Cafe')` → c.bean Expenses:Late |
| 两腿配对跨文件；改名删除后空 | code-actions.test.ts:300,:250 | `pairings()`；驱动 pad 的账户仍由 `inferBalancingAccount` 测 |
| 添加 open 写到 open 最多的 **Ledger file** | code-actions.test.ts:322,:440 | `bestOpenFile()`；无 open → null |
| 笔记账户只来自 fence | account-index.test.ts:462 | 不索引 `PG_DATA_DIR:-…` |
| 笔记 fence 外形似交易是否进 payee/模板/配对/open | 原文待产品决定；#76 已定 | **硬验收**：只取 Ledger text（fence body） |
| 两段 fence header+posting 不被吞 | 风险 3，# 缺失 | Step 2 专用 |
| include 链刷新余额报表 | report-view.test.ts | **不迁、不改**；现有 `tests/report-view.test.ts` 保持绿灯即验收「未并入」 |

改名/删除：只在 `ledger-index.test.ts` 写一份（文件 + 文件夹 + 扩展名 kind 变化）。禁止每个旧 adapter 再留一份。

现有 suggest 测试保持绿灯直到 cutover 把 `VaultIndex` 换成 `ledger.payees` 等。

**Verification**: `pnpm test` → 全绿，含新文件；覆盖率 statements/branches/functions/lines ≥ 90。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm lint` exit 0
- [ ] `pnpm build` exit 0
- [ ] `pnpm test` exit 0；`tests/ledger-index.test.ts` 存在且覆盖上表除报表以外的场景
- [ ] `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` exit 0
- [ ] `pnpm --filter beancount-obsidian bench`：`index` 与 `save` 哈希通过（未擅自 `BENCH_UPDATE=1`）
- [ ] `rg -n "registerVaultIndex" apps/obsidian-plugin --glob '!plans/**'` 无匹配
- [ ] `rg -n "interface VaultCache" apps/obsidian-plugin` 无匹配
- [ ] `rg -n "class VaultIndex" apps/obsidian-plugin` 无匹配
- [ ] `rg -n "class AccountIndex" apps/obsidian-plugin` 无匹配
- [ ] `rg -n "class PayeeTemplateIndex|class PairingIndex|class OpenFileIndex" apps/obsidian-plugin` 无匹配
- [ ] `rg -n "renameFile\\(" apps/obsidian-plugin --glob '!tests/**' --glob '!bench/**'` 仅 `ledger-index.ts` 一处生产实现
- [ ] `rg "scanLedger\\(ledgerSource" apps/obsidian-plugin` 无匹配
- [ ] `rg -n "parsedByPath" apps/obsidian-plugin/balances.ts` 仍存在（未并入索引）
- [ ] `rg -n "vault.on\\('modify'" apps/obsidian-plugin/report-view.ts` 仍存在
- [ ] `rg "vi\\.useFakeTimers" apps/obsidian-plugin/tests/ledger-index.test.ts` 无匹配
- [ ] 两段 fence 测试存在：`rg "两段|second fence|Cafe" apps/obsidian-plugin/tests/ledger-index.test.ts` 能命中 Step 2 用例
- [ ] CHANGELOG `## Unreleased` 有 #72 Internal 一行；`git diff -- README.md CONTEXT.md docs/adr/0003-index-is-not-balance-cache.md plans/README.md` 空
- [ ] 工作区无 in-scope 外的源码改动（`git status`）

## STOP conditions

Stop and report back (do not improvise) if:

- Drift check 显示 in-scope 文件相对 `8b75729` 已变，且与「Current state」摘录不符——**先排除** Step 0 的 001/003 预期 diff（`vault-index` 改走 `ledgerDoc`、`scan.ts` 出现）。STOP 仅当 `registerVaultIndex` 已被本序列以外删除，或 `scanLedger` 不是 `(text: string)`。
- `ledgerKind` / `ledgerDoc` / `LedgerRegion.hostStartLine` / `scanLedger` 不存在。
- 实现上似乎必须改 `balances.ts` / `report-view.ts` 才能让索引测试通过。
- 两段 fence 测试只能靠对 `ledgerSource()` 连扫才能绿。
- 某步验证连续失败两次。
- Bench `index`/`save` 哈希失败且查询结果集合已变（不是纯序列化顺序）——不要 `BENCH_UPDATE=1` 掩盖行为漂移。
- `docs/adr/0003-index-is-not-balance-cache.md` 缺失（应由 #69 规划提交提供）。
- 发现「#76 索引只取 Ledger text」被改回「笔记全文进 payee」。

## Maintenance notes

- 新增一种补全事实：给 `FileFacts` 加字段并在 region 归并里填，不要再加 `VaultCache` adapter，也不要改 `main.ts` 九参数列表（已不存在）。
- Include 图、余额、glob `watchCreates` 继续走 `balances.ts` / `report-view.ts`。若将来要「未 include 的文件也驱报表」，那是新 ADR，不是给 `FileFacts` 加字段。
- Reviewer 应盯：`setFile` 是否吃 vault 原文；`kindChanged` 是否用 `ledgerKind`；rename 是否只一份且模板 `path` 改写；全局 revision 注释是否还在。
- 本计划明确推迟：#71 completion slot、#73 edits、报表并入索引。
