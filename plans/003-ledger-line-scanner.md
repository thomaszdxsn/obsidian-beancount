# Plan 003: 插件内落地 Ledger line scanner，行级消费者不再自带 Beancount 词法

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Do **not** update `plans/README.md` — Status 由编排者维护，执行者不要改 README。
>
> **Drift check (run first)**:
> `git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/align.ts apps/obsidian-plugin/transaction-fold.ts apps/obsidian-plugin/format.ts apps/obsidian-plugin/balance-hints.ts apps/obsidian-plugin/posting-hints.ts apps/obsidian-plugin/code-actions.ts apps/obsidian-plugin/flag-warnings.ts apps/obsidian-plugin/token-suggest.ts apps/obsidian-plugin/account-suggest.ts apps/obsidian-plugin/outline.ts apps/obsidian-plugin/posting-indent.ts apps/obsidian-plugin/account-index.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition — **except** the 001-expected diffs listed in Step 0.
>
> 假设 `plans/001-ledger-regions.md`（#69）**已合并**。001 之后 fence 扫描走 `ledgerDoc` / `LedgerRegion`；本计划只消费区域，不再发明第二套 fence 扫描。串行下 002 也会已在 main；本计划**不消费** `FakeClock` / `validation.ts`。禁止 `vi.useFakeTimers`。

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-ledger-regions.md`（API：`ledgerKind` / `ledgerDoc` / `LedgerRegion`）。串行合并顺序仍是 001→002→003，开分支时 002 已在 main；本计划不消费 002 符号。
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/70

## Why this matters

插件里十几个 module 各自用正则重写 Beancount 词法（账户形状、flag 集合、日期–flag 空白、引号/转义/`;` 注释）。规则已经漂移：`ACCOUNT_SHAPE` 认 CJK/`_·・`，align / balance-hints / payee-template 仍用 `[A-Z][a-z]+(?::[^\s:]+)+`；fold / outline / flag-warnings 的 flag 是 `PSTCURM`，align 的 `isFlag` 是任意大写；字符串扫描至少 `endsInString`、`stringOpenAfter`、`inStringOrComment`、`stripComment`、`collapseHeaderLine` 五份。`@repo/beancount-parser` 的 `parse()` 遇错即抛、不返回部分结果，不能当编辑器切分器。

本计划在插件内落下唯一一份容错行扫描（`scan.ts`），行级功能改查它。CJK 账户、无空白 flag（#76 已定）、多行字符串与转义只修一次。按键路径（`.` / Enter）只走局部 API，禁止整篇 `scanLedger`。`extract*` 与 File facts 留给 `plans/004-ledger-index.md`。

## Current state

本计划写于 `8b75729`。001 合并后 `fences.ts` / `transaction-fold.ts` 的 fence 入口会变（`extractBeancountFences` / `fenceBodiesCache` 消失，改为 `ledgerDoc` / `LedgerRegion`）；**词法正则副本不会被 001/002 删掉**。词法摘录必须与 live 代码对照。001 已改的 fold 入口按 Step 0「预期 diff」处理，不要 STOP。

相关文件（角色一行）：

- `apps/obsidian-plugin/align.ts` — 对齐；私有 `parsePosting` / `ACCOUNT_RE` / `endsInString`；`computeAlignment` 按行推进字符串状态。
- `apps/obsidian-plugin/instant-alignment.ts` — 按 `.`；经 `isAmountDotInsert` / `computeAlignment` 吃 align 的 posting 解析。**禁止**改成整篇 `scanLedger`。
- `apps/obsidian-plugin/transaction-fold.ts` — 用正则切分录切片，再对切片 `BeancountParser.parse` 取 `location.end.line`。
- `apps/obsidian-plugin/format.ts` — `collapseHeaderLine` 自带引号/注释扫描，字符串状态来自 `endsInString`。
- `apps/obsidian-plugin/balance-hints.ts` — 私有 `classifyLine` / `TXN_RE` / `ACCOUNT_SRC` / `stripComment` / `parsePosting`。
- `apps/obsidian-plugin/posting-hints.ts` — `classifyPosting` + `TXN_RE` 切交易。
- `apps/obsidian-plugin/code-actions.ts` — `TXN_HEADER_RE` / `HEADER_BANG_RE` / `parsePostingLine`；`extractPairings` 是 extract*（#72），遍历策略不动，行解析改调 scan。
- `apps/obsidian-plugin/flag-warnings.ts` — `TXN_FLAG_RE`。
- `apps/obsidian-plugin/token-suggest.ts` — `inStringOrComment`；`account-suggest.ts` 也 import 它。
- `apps/obsidian-plugin/outline.ts` — 私有 `TXN_RE`；org 标题 `raw.startsWith('*')`。
- `apps/obsidian-plugin/posting-indent.ts` — Enter；`DATED_ENTRY_RE` 来自 `beancount-mode`（本计划改走 `classifyLine`，**不要**整篇扫描）。
- `apps/obsidian-plugin/account-index.ts` — 现行 `ACCOUNT_SHAPE`（编辑器规范）；`extractAccounts` 留给 #72。
- `apps/obsidian-plugin/beancount-mode.ts` — CM stream mode；**本计划不改**（ADR 0002）。
- `apps/obsidian-plugin/payee-template.ts` / `payee-index.ts` / `token-index.ts` — `extract*`，本计划不改写成 `scanLedger`。
- `packages/beancount-parser` — 严格 AST；`parse()` 永不部分恢复。差分只用它能 parse 的输入。
- `apps/obsidian-plugin/bench/common.ts` — `generateLedger`（含 `Expenses:餐饮:午餐`）。
- `docs/adr/0001-scanner-in-plugin.md`、`docs/adr/0002-editor-account-shape.md` — 随 #69 合入；本 PR 不重写。

账户形状（编辑器规范，ADR 0002；**scanner 必须用这个，不要用 g4 的无 `_` / 根可 NON_ASCII**）：

```30:33:apps/obsidian-plugin/account-index.ts
const SEGMENT_CHARS = String.raw`\p{L}\p{N}\p{M}_\-·・`;
const SEGMENT = `[${SEGMENT_CHARS}]`;
const NAME_END = String.raw`(?<=[\p{L}\p{N}\p{M}_])`;
export const ACCOUNT_SHAPE = String.raw`[A-Z]${SEGMENT}*(?::${SEGMENT}+)+${NAME_END}`;
```

align 仍用另一套（根必须 `[A-Z][a-z]+`，段是 `[^\s:]+`），以及任意大写 flag：

```82:86:apps/obsidian-plugin/align.ts
const ACCOUNT_RE = /^[A-Z][a-z]+(?::[^\s:]+)+$/;

/** A posting flag: `*!&#?%` or a single capital. */
function isFlag(c: number): boolean {
	return (c >= 0x41 && c <= 0x5a) || c === 0x2a || c === 0x21 || c === 0x26 || c === 0x23 || c === 0x3f || c === 0x25;
```

字符串扫描（align；format 与它对拍）：

```138:158:apps/obsidian-plugin/align.ts
export function endsInString(line: string, inStringStart: boolean): boolean {
	// Most lines hold no quote at all: nothing can open a string.
	if (!inStringStart && !line.includes('"')) return false;
	let inString = inStringStart;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (inString) {
			if (ch === '\\' && i + 1 < line.length) {
				i += 1;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === ';') break;
	}
	return inString;
}
```

`parsePosting`（缩进、可选 flag、账户、gap、金额；cost/price 不进入 gap）：

```176:218:apps/obsidian-plugin/align.ts
function parsePosting(line: string): Posting | null {
	// Postings are indented; directives (`2026-01-01 balance …`, `include`)
	// start at column 0 and are out of scope.
	let at = skipBlank(line, 0);
	if (at === 0) return null;
	// ...
	if (accountEnd === at || !ACCOUNT_RE.test(line.slice(at, accountEnd))) return null;
	// ...
	NUMBER_RE.lastIndex = gapEnd;
	const number = NUMBER_RE.exec(line);
	if (number === null || !amountTailOk(line, NUMBER_RE.lastIndex)) return null;
	return {
		gapStart,
		gapEnd,
		prefixWidth: displayWidth(line.slice(0, gapStart)),
		beforeDot: dotOffset(number[0]),
		line: 0,
		block: -1,
	};
}
```

fold：header 正则 + `stringOpenAfter`，再 parse 切片（损坏分录 `parse` 抛错则该条无 fold）：

```29:34:apps/obsidian-plugin/transaction-fold.ts
const DATED_HEADER = /^\d{4}[-/]\d{2}[-/]\d{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;
const MAYBE_HEADER = /^ {0,3}\d{4}[-/]\d{2}[-/]\d{2}[ \t]*(?:txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;
const ATTACHED_LINE = /^[ \t]+\S/;
```

```64:73:apps/obsidian-plugin/transaction-fold.ts
function stringOpenAfter(text: string, open: boolean): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (open) {
			if (ch === '\\') i += 1;
			else if (ch === '"') open = false;
		} else if (ch === '"') open = true;
		else if (ch === ';') return false;
	}
	return open;
}
```

```96:106:apps/obsidian-plugin/transaction-fold.ts
function parseHiddenLines(entry: string): number | null {
	let directive;
	try {
		[directive] = BeancountParser.parse(entry).directives;
	} catch (e) {
		if (e instanceof BeancountSyntaxError) return null;
		throw e;
	}
	if (!(directive instanceof Transaction) || !directive.location) return null;
	const hidden = directive.location.end.line - directive.location.start.line;
	return hidden > 0 ? hidden : null;
}
```

balance-hints 的 header / 账户 / 私有 `classifyLine`：

```63:75:apps/obsidian-plugin/balance-hints.ts
const FLAG_CHARS = '*!&#?%A-Z';
const ACCOUNT_SRC = '[A-Z][a-z]+(?::[^\\s:]+)+';
const NUMBER_SRC = '[-+]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]*)?';
export const TXN_RE = new RegExp(
	'^([0-9]{4})[-/]([0-9]{2})[-/]([0-9]{2})[ \\t]*(?:txn|[' + FLAG_CHARS + '])(?![A-Za-z0-9])'
);
```

```159:167:apps/obsidian-plugin/balance-hints.ts
function classifyLine(line: string): LineInfo {
	if (/^[ \t]*$/.test(line) || isComment(line)) return IGNORE;
	if (isOrgHeading(line)) return CLOSE;
	if (/^[ \t]*(include|plugin)(?![A-Za-z0-9_])(?:[ \t]|"|$)/.test(line)) return REFUSE;
	if (line.charAt(0) === ' ' || line.charAt(0) === '\t') return { kind: 'indented', posting: parsePosting(line) };
	const txn = TXN_RE.exec(line);
	if (txn !== null) return { kind: 'txn', date: txn[1] + '-' + txn[2] + '-' + txn[3] };
```

```538:558:apps/obsidian-plugin/balance-hints.ts
export function stripComment(line: string): string {
	let quote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line.charAt(i);
		if (ch === '\\' && quote) {
			i++;
			continue;
		}
		if (ch === '"') quote = !quote;
		else if (ch === ';' && !quote) return line.slice(0, i);
	}
	return line;
}
function isOrgHeading(line: string): boolean {
	return /^\*+/.test(line);
}
```

code-actions / flag-warnings / outline / token-suggest / posting-indent：

```68:85:apps/obsidian-plugin/code-actions.ts
const TXN_HEADER_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]*(txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])(.*)$/;
const HEADER_BANG_RE = /^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \t]*(!)(?![A-Za-z0-9])/;
// ...
const ACCOUNT_RE = new RegExp(`^${ACCOUNT_SHAPE}`, 'u');
```

```62:63:apps/obsidian-plugin/flag-warnings.ts
const TXN_FLAG_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]*(txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])/;
```

```42:45:apps/obsidian-plugin/outline.ts
const TXN_RE =
	/^([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})[ \t]*(txn|[*!&#?%PSTCURM])(?![A-Za-z0-9])(.*)$/;
```

```31:43:apps/obsidian-plugin/token-suggest.ts
export function inStringOrComment(prefix: string): boolean {
	let inString = false;
	for (let i = 0; i < prefix.length; i += 1) {
		const ch = prefix[i];
		if (inString && ch === '\\') {
			i += 1;
		} else if (ch === '"') {
			inString = !inString;
		} else if (ch === ';' && !inString) {
			return true;
		}
	}
	return inString;
}
```

```61:65:apps/obsidian-plugin/posting-indent.ts
	const text = lines[line] ?? '';
	if (DATED_ENTRY_RE.test(text)) return true;
	if (!/^[ \t]/.test(text) || text.trim() === '') return false;
	const { from } = blockRangeInLedger(lines, line, ledgerLine);
	return DATED_ENTRY_RE.test(lines[from] ?? '');
```

parser 合同（差分只在能 parse 的输入上比；坏分录只跑表驱动）：

```43:43:packages/beancount-parser/README.md
`parse()` never returns a partially recovered file. Any lexer or parser error throws a `BeancountSyntaxError` listing every problem in source order.
```

g4 flag（编辑器规范跟这套 + 可选空白；账户**不**跟 g4）：

```118:128:packages/beancount-parser/src/grammar/Beancount.g4
txn_flag
    : TXN
    | flag
    ;
flag
    : ASTERISK
    | HASH
    | FLAG
    | CAPITAL
    ;
```

g4 账户无 `_`/`·`，根可 NON_ASCII（`ACCOUNT_TYPE`）——scanner **禁止**改成这样。

`generateLedger`：`apps/obsidian-plugin/bench/common.ts:40`；语料含 `Expenses:餐饮:午餐`（`:34`）与 `\"` payee（`:37-58`）。

仓库约定：

- 插件扁平目录；新 module 文件名 `scan.ts`（与 `fences.ts` / `validation.ts` 一样短名）。
- 测试 `apps/obsidian-plugin/tests/*.test.ts`，vitest，覆盖率地板 90%（`vitest.config.mts:28-33`）。
- 错误处理：scanner **永不抛**；坏分录 `damaged: true` 仍有边界。
- TDD：先列 seam，竖切 red→green。新 module 直接 TDD。缺失场景若旧测试没有，先在旧 interface 补 characterization，再迁到 `scan.ts`。
- 术语用根 `CONTEXT.md`：Ledger file / Ledger kind / Ledger text / Ledger region / Fence body / Host line / Scanned entry。不要把 `scanLedger` 的输入叫 Temp ledger 或 `ledgerSource()` 拼接串。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Drift | 见 Step 0 的 `git diff --stat` | 001 的 fold/`ledgerDoc` 预期 diff 可有；词法正则副本仍在。对不上摘录（除 Step 0 预期）→ STOP |
| 单测 scan | `cd apps/obsidian-plugin && npx vitest run tests/scan.test.ts` | 全绿 |
| 单测差分 | `cd apps/obsidian-plugin && npx vitest run tests/scan-parser-diff.test.ts` | 全绿 |
| 行级消费者 | `cd apps/obsidian-plugin && npx vitest run tests/align.test.ts tests/instant-alignment.test.ts tests/transaction-fold.test.ts tests/format.test.ts tests/balance-hints.test.ts tests/posting-hints.test.ts tests/code-actions.test.ts tests/flag-warnings.test.ts tests/token-suggest.test.ts tests/account-suggest.test.ts tests/outline.test.ts tests/posting-indent.test.ts` | 全绿 |
| 类型检查 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0 |
| 全量测试 | `pnpm test`（仓库根） | 全绿；基线 1064，本计划只增不减；覆盖率 ≥90% |
| Lint | `pnpm lint`（仓库根） | exit 0 |
| Build | `pnpm build`（仓库根） | exit 0 |
| Bench | `pnpm --filter beancount-obsidian bench` | `align` / `format` / `format_md` / `outline` / `dot` / `enter` 哈希与 expected 一致。仅当「以前不对齐的 posting 现在对齐」才 `BENCH_UPDATE=1`，且 CHANGELOG **Internal 与 Changed 都写** |

不要跑与本计划无关的 Fava/校验插件套件来「确认」；上表即全部验证。

## Suggested executor toolkit

- 有 `tdd` skill 则全程用：先列出本计划 Test plan 的 seam，再竖切；禁止先铺完全部测试再写实现。
- 读 `CONTEXT.md` 术语；读 `docs/adr/0001-scanner-in-plugin.md`、`docs/adr/0002-editor-account-shape.md`（已 Accepted）。不要改 ADR 正文。
- 不要用 `diagnosing-bugs` 去重跑用户没报的失败。

## Scope

**In scope**（只改这些，以及本计划新建的测试）：

- `apps/obsidian-plugin/scan.ts`（新建）
- `apps/obsidian-plugin/tests/scan.test.ts`（新建）
- `apps/obsidian-plugin/tests/scan-parser-diff.test.ts`（新建）
- `apps/obsidian-plugin/align.ts`
- `apps/obsidian-plugin/transaction-fold.ts`
- `apps/obsidian-plugin/format.ts`
- `apps/obsidian-plugin/balance-hints.ts`
- `apps/obsidian-plugin/posting-hints.ts`
- `apps/obsidian-plugin/code-actions.ts`
- `apps/obsidian-plugin/flag-warnings.ts`
- `apps/obsidian-plugin/token-suggest.ts`
- `apps/obsidian-plugin/account-suggest.ts`（只改 `inStringOrComment` 的 import 路径，若该函数改由 `scan.ts` 导出）
- `apps/obsidian-plugin/outline.ts`
- `apps/obsidian-plugin/posting-indent.ts`（`DATED_ENTRY_RE` → `classifyLine`；保留 `blockRangeInLedger`）
- `apps/obsidian-plugin/account-index.ts`（仅当把 `ACCOUNT_SHAPE` 的**定义**挪到 `scan.ts` 并从此处 re-export / 改为 import；**不要**改 `extractAccounts` / `extractAccountDirectives` 的遍历）
- 若 `inStringOrComment` 搬家：其现有测试文件里的 import
- `CHANGELOG.md`（`## Unreleased`：每个 PR 一行 Internal；CJK 对齐若从「不对齐」变为「对齐」，**Internal 与 Changed 都写**）

**Out of scope**（即使看起来相关也禁止动）：

- `apps/obsidian-plugin/beancount-mode.ts` 与 `tests/beancount-mode.test.ts` — 高亮继续分叉（风险 4 / ADR 0002）。
- `packages/beancount-parser/**`、`fast-lexer.ts`、`.g4` — scanner 不进 parser 包（A4.1 / ADR 0001）。
- `extractAccounts` / `extractAccountDirectives` / `extractPayees` / `extractCommodities` / `extractTags` / `extractLinks` / `extractNarrations` / `extractLatestPayeeTemplates` 的**算法与正则遍历** — #72。允许它们调用 `parsePostingLine` / `classifyLine`，禁止改成一次 `scanLedger(content)` 出 File facts。
- `payee-index.ts` 的 `PAYEE_PREFIX_RE` / `extractPayees` — 补全前缀形状留给 #71/#72；header 分类的**行级**消费者不在这个文件。
- `main.ts` 装配、`alignInEditor` / `formatInEditor` 光标映射 — #73（风险 8）。
- `edits.ts`（不要新建）、`instantAlignmentPlan` 不要包一层 `scanLedger`。
- `balances.ts` / `report-view.ts` 的严格 parse 缓存。
- `validation.ts` / `clock.ts` / `vault-path.ts` / FakeClock。
- 根 `README.md`（无用户可见命令/设置变化）。
- `CONTEXT.md`（「Scanned entry」已存在，不要改）。
- `plans/README.md`（Status 由编排者维护，执行者不要改）。
- 重开 #76：账本文本规则、separatorColumn、索引只取 Ledger text、无空白 `2026-10-01!` 算交易。

## Git workflow

- 分支：`refactor/70-ledger-line-scanner`，基于**最新 main**（应已含 001/002）。
- 按逻辑单元提交，中文 conventional commits。例：
  - `test: 为 Ledger line scanner 补表驱动与 parser 差分（#70）`
  - `refactor: Ledger line scanner 统一账本行扫描（#70）`
  - `refactor: align/fold/format/hints 改用 scan.ts（#70）`
  - `docs: Unreleased Internal — Ledger line scanner（#70）`
- 仓库近期风格：`fix: 修复架构评审汇总的 UI/UX 问题（#75） (#76)`。
- **不要 push、不要开 PR**（编排者做）。

## 模块边界 / 公开签名

文件：`apps/obsidian-plugin/scan.ts`。

Grill A4.2 草案 + A6.2 行号修正。实现可微调字段名，但**不得**合并 `ledgerSource` 扫描、不得让 `scanLedger` 吃宿主行号。

```ts
type LineKind =
  | 'txn-header'
  | 'directive'
  | 'posting'
  | 'metadata'
  | 'comment'
  | 'blank'
  | 'string-continue'
  | 'org'
  | 'other';

interface LineSpan { from: number; to: number } // 列，UTF-16

interface ScannedPosting {
  flag?: string;
  account?: { text: string; span: LineSpan };
  number?: LineSpan;
  commodity?: LineSpan;
  hasCost: boolean;
  hasPrice: boolean;
}

interface ScannedEntry {
  startLine: number; // 0-based，相对这次扫描的文本，不是 Host line
  endLine: number;   // inclusive
  damaged: boolean;  // 坏掉仍有边界
  header?: {
    date: string; // 原文日期，斜杠不改写成横杠（outline 要原样）
    flag?: string; // 源码 token（`txn` 保持 `txn`，不是 `*`）
    keyword?: string; // `open` / `close` / `balance` / `pad` / …；txn-header 无 keyword
    payee?: LineSpan; // 第一对引号内的字面量（含 `\\` `\"`），与 `transactionPayee` 同形
    narration?: LineSpan;
  };
  postings: ScannedPosting[];
}

interface ScanResult {
  lines: readonly LineKind[];
  entries: readonly ScannedEntry[];
}

function scanLedger(text: string): ScanResult;
function parsePostingLine(line: string): ScannedPosting | null;
function classifyLine(line: string, inStringStart?: boolean): LineKind;
function entryAt(lines: readonly string[], line: number): { from: number; to: number } | null;
/** `txn` → `*`；其余 flag token 原样。 */
function canonicalTxnFlag(token: string): string;

/** 一行扫描完后是否仍在 `"` 字符串内。`;` 仅在字符串外开始注释。 */
function endsInString(line: string, inStringStart: boolean): boolean;
/** 光标前缀是否位于未闭合字符串或 `;` 注释。 */
function inStringOrComment(prefix: string): boolean;
```

约束：

1. **编辑器规范（A4.3）**：flag / 字符串 / 注释 / 日期与 flag 之间**可选空白**跟 g4；账户跟现行 `ACCOUNT_SHAPE`。`2026-10-01!` / `2026-10-01txn` **算交易**（#76，硬验收）。`txn` 与 `*` 同义。flag 字符 = `*` `#` `!&?%` 与 `[A-Z]`（g4 CAPITAL），不是只 `PSTCURM`。
2. **org**：第 0 列 `*` 且后面是空白+词（或 outline 今日的 `*+` 标题）→ `org`，不是 txn flag。它结束上一笔 Scanned entry。
3. **切分**：标题 + 附着缩进行；空行与第 0 列 `;` / org 结束该项。未闭合字符串内的空行与第 0 列行仍属于该项（`string-continue`），形似 posting 的行不是 posting。
4. **行号（A6.2）**：`startLine`/`endLine` 相对本次 `text`/`lines`，0-based。Host line = `region.hostStartLine + scanLine`，**只在调用方加**。禁止 `hostLine` 有时 0-based。Temp ledger 的 1-based 映射本模块不用。fold 的 CM `doc.line` 仍是 1-based，只在 fold 边界转换。
5. **按区域扫（A4.2）**：对每个 `LedgerRegion`（001：`hostStartLine` 0-based、`lines` 已剥 opener 0–3 空格、`hostIndent`）调用 **`scanLedger(region.lines.join('\n'))`**。**不要**给 `scanLedger` 加 `string[]` overload。`scanLedger('')`（含 `lines.length === 0` 的 join）必须返回 `{ lines: [], entries: [] }`，禁止把空串 `split('\n')` 成一行 `blank`。**禁止**对 `ledgerSource()` 拼接串一次连扫。fold/outline/hints 若输入已是单一 region 的文本，可以一次 `scanLedger`。
6. **按键路径（A4.6 / 风险 10）**：`instantAlignmentPlan` / `postingIndentPlan` **禁止**调用 `scanLedger(wholeBuffer)`。`.` 继续 `parsePostingLine` / 现有 `computeAlignment`；Enter 用 `classifyLine` + 现有 `blockRangeInLedger`（不要改成字符串感知的 `entryAt` 以免改变 Enter 在多行字符串里的现状）。
7. **`ACCOUNT_SHAPE` 所有权**：定义只留一处。推荐：`scan.ts` 持有常量，`account-index.ts` `export { ACCOUNT_SHAPE } from './scan'`（或反向：scan import account-index **仅**常量——若造成 `scan` → 索引模块的重依赖则 STOP，改为把常量放到 `scan.ts`）。
8. **fold 隐藏范围**：scanner 负责「哪几行是候选分录」；`hiddenLines` **继续**对切片 `BeancountParser.parse` 取 `location.end.line`。不要用 scanner 的 `endLine` 替换 parser 的 fold 范围（parser 不含尾部缩进注释；scanner 含。改了就是可见行为）。损坏分录 parse 失败 → 该条无 fold，邻居不受影响。
9. **align 的 `Posting` gap 字段**：`parsePostingLine` 要能支撑对齐（账户 span、number span、`hasCost`/`hasPrice`）。`computeAlignment` 用 span 算 `gapStart`/`gapEnd`/`beforeDot`，删除私有 `parsePosting`。cost `{` / price `@` `@@` 不参与单位金额对齐。
10. **导出**：`endsInString` 从 `align.ts` 挪到 `scan.ts`；`align.ts` 可 re-export 以免 format 大面积改 import，但函数体只一份。`inStringOrComment` 同理。`balance-hints` 的 `stripComment` 改为基于同一扫描（字符串外的 `;`）。`TXN_RE` / `ACCOUNT_EXACT` / `FLAG_EXACT`：posting-hints 改为问 scan；若测试仍 import 这些符号，从 `scan.ts` 再导出或改测试 import——不要留第二份字符类。

**给 001 / 004 的合同（不得改名）**：

- 消费 001：`ledgerKind` / `ledgerDoc(kind, source).regions` / `LedgerRegion.{hostStartLine, lines, hostIndent}`，定义在 `apps/obsidian-plugin/fences.ts`。
- 提供给 004：`apps/obsidian-plugin/scan.ts` 导出 `scanLedger(text: string): ScanResult`（仅 string）、`ScanResult.entries`、`ScannedEntry.startLine`（相对本次 text、0-based）、`canonicalTxnFlag`。004 写 `scanLedger(region.lines.join('\n'))`，Host line = `region.hostStartLine + entry.startLine`。本计划**不**解析 open 行币种、不归并 File facts。


## Steps

### Step 0: Drift check + 依赖符号

001 **预期**出现在 `transaction-fold.ts` 的 diff：`fenceBodiesCache` / `extractBeancountFences` 消失，改为 `ledgerDoc` / `editorLedger`。词法正则（`DATED_HEADER` 等）在本计划开始前应仍在。`align.ts` 的 `ACCOUNT_RE` / `endsInString` / `parsePosting` 与 Current state 摘录应仍匹配。

**Verify**:

```sh
git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/align.ts apps/obsidian-plugin/transaction-fold.ts apps/obsidian-plugin/format.ts apps/obsidian-plugin/balance-hints.ts apps/obsidian-plugin/posting-hints.ts apps/obsidian-plugin/code-actions.ts apps/obsidian-plugin/flag-warnings.ts apps/obsidian-plugin/token-suggest.ts apps/obsidian-plugin/account-suggest.ts apps/obsidian-plugin/outline.ts apps/obsidian-plugin/posting-indent.ts apps/obsidian-plugin/account-index.ts CHANGELOG.md
rg -n "export function ledgerDoc|export type LedgerKind|interface LedgerRegion|hostStartLine" apps/obsidian-plugin/fences.ts
rg -n "const ACCOUNT_RE = /\^\\[A-Z\\]\\[a-z\\]" apps/obsidian-plugin/beancount-mode.ts
test -f docs/adr/0001-scanner-in-plugin.md && test -f docs/adr/0002-editor-account-shape.md
```

→ `ledgerDoc`、`LedgerRegion`、`hostStartLine` 有匹配；mode 的 `ACCOUNT_RE` 仍有匹配；两个 ADR 文件存在。`align.ts` 无意外词法改写。若 `LedgerRegion.lines` / `hostStartLine` 缺失 → STOP。不要因为 002 的 `validation.ts` 存在而 STOP。

### Step 1: 列出 seam，TDD `scan.ts`（不要先改消费者）

Seam（只测这些公开面）：

1. `scanLedger` — 分录边界、`LineKind[]`、`ScannedEntry`、`damaged`；`scanLedger('')` 为空结果
2. `parsePostingLine` — flag / ACCOUNT_SHAPE / 千分位 / cost / price / 行内注释
3. `classifyLine` — txn-header / directive / org / metadata / comment / blank / string-continue
4. `entryAt` — 局部从某行找分录 `[from,to]`（给 fold 切切片用，不是给 Enter）
5. `endsInString` / `inStringOrComment` — `\"`、字符串内 `;`、注释里的 `"`
6. `canonicalTxnFlag('txn') === '*'`

在 `tests/scan.test.ts` 按 Test plan / BDD 地图**一条竖切**写红测试 → 只实现够用的 `scan.ts` → 绿。禁止 `vi.useFakeTimers`。禁止启动插件。

**Verify**: 实现前 `cd apps/obsidian-plugin && npx vitest run tests/scan.test.ts` → 失败（缺模块或断言红）。实现后同一命令 → 全绿。

### Step 2: parser 差分测试

新建 `tests/scan-parser-diff.test.ts`：

- `import { generateLedger } from '../bench/common'`（该模块会设 `TZ=Asia/Shanghai`，与 vitest config 一致）。
- **不要**搬 `packages/beancount-parser/test/fast-lexer.test.ts` 的 10 万 `PIECES`。
- 语料：`generateLedger(90)`（CI 可接受；不要 1500 天）+ 若干手写合法片段（含 `Expenses:餐饮`、`2026/01/02 *`、`2026-10-01!`、`\"`、`;` 在字符串内）。
- 对整份文本 `BeancountParser.parse`；若抛 `BeancountSyntaxError`，该语料跳过或缩小到能 parse 的子集（`generateLedger` 设计为合法账本，应能 parse）。
- 只在**双方都认的账户**上比：scanner 的 txn 日期/flag（`txn`→`*`）、payee 原文 span、posting.account（`ACCOUNT_SHAPE` 与 g4 交集）。parser 认而 scanner 因 `ACCOUNT_SHAPE` 不认的账户（根 NON_ASCII、无 `_` 差异的反例）**不要** assert 相等。
- scanner 多出来的 `damaged` 条目在合法账本上应为 0。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/scan-parser-diff.test.ts` → 全绿。

### Step 3: 迁移行级消费者（一次一个文件，保持测试绿）

顺序（降低互相破坏）：

1. **`token-suggest.ts`**：删除本地 `inStringOrComment`，改为 `scan.ts` 导出；`account-suggest.ts` 改 import。现有 `tests/token-suggest.test.ts` 必须绿。
2. **`align.ts`**：删除 `ACCOUNT_RE` / `isFlag` / `NUMBER_RE` / `COMMODITY_RE` / `parsePosting` / `endsInString` 函数体。`computeAlignment` / `isAmountDotInsert` 改用 `parsePostingLine` + `endsInString`。`blockRangeAt` / `scanBlocks` **保留**（这是对齐块，不是 Beancount 词法；#73 再动改写入口）。
3. **`format.ts`**：`collapseHeaderLine` 的引号/`;` 状态改调用 `endsInString`（或 scan 提供的同一扫描器）。不要重写 format 的 parser 路径。
4. **`flag-warnings.ts`**：`TXN_FLAG_RE` → `classifyLine === 'txn-header'` + header flag。`txn`→`*`。org 仍忽略。无空白形式继续算交易。
5. **`outline.ts`**：`TXN_RE` → `classifyLine` / `scanLedger` 的 header（日期**原样**，含 `/`）。org 标题逻辑保持（第 0 列 `*`）。`DIRECTIVE_RE`（open/close/balance）可改为 `classifyLine === 'directive'` 且 keyword 属于这三项；pad/price 仍不上大纲。
6. **`code-actions.ts`**：`TXN_HEADER_RE` / `HEADER_BANG_RE` / `parsePostingLine` / posting 的 ACCOUNT/NUMBER/COMMODITY/flag 正则删除，改 scan。`extractPairings` 仍按行扫描文件，但 header/posting 解析调 scan（**不要** `scanLedger` 出 Pairing 当 File facts）。`OPEN_LINE_RE` 可继续用 `ACCOUNT_SHAPE`（同一常量）。
7. **`balance-hints.ts` / `posting-hints.ts`**：私有 `classifyLine` / `parsePosting` / `TXN_RE` / `ACCOUNT_SRC` / `stripComment` 改 scan。hints 的余额算术、`toQty`、cache **留在原文件**。org 结束交易。
8. **`transaction-fold.ts`**：`DATED_HEADER` / `MAYBE_HEADER` / `stringOpenAfter` 删除。用 `classifyLine`/`entryAt`/`endsInString` 找候选切片，然后**仍然** `BeancountParser.parse`。001 之后不要重建 `fenceBodiesCache`；问 `ledgerDoc` 的 region。廉价 reject 可用「行是否像日期开头」而不复制 flag 集合。
9. **`posting-indent.ts`**：`DATED_ENTRY_RE` 改为 `classifyLine` 为 `txn-header` 或 `directive`。继续 `blockRangeInLedger`。**不要** `scanLedger`。**不要** import `beancount-mode`。

每改完一个文件跑该文件测试。

**Verify**（全部消费者迁完）: Step 的「行级消费者」vitest 命令 → 全绿。

### Step 4: grep 清副本 + CJK 回归

确认行级文件不再包含私有账户/flag/字符串扫描。补/迁 CJK：`parsePostingLine('  Expenses:餐饮  18.00 CNY')` 得到账户 `Expenses:餐饮`；`code-actions.test.ts` 里 CJK pad / Open account / `OpenFileIndex` 用例保持绿（#76 已定，#70 锁住）。

`Expenses:卡片・ローン`、带 `_` 的段必须被 scanner 认作账户（ACCOUNT_SHAPE），即使 parser/g4 不认——差分测试不得因此失败。

**Verify**: 见 Done criteria 的 grep。`cd apps/obsidian-plugin && npx vitest run tests/scan.test.ts tests/code-actions.test.ts tests/align.test.ts tests/posting-hints.test.ts` → 全绿。

### Step 5: CHANGELOG、类型检查、全量测试、bench

`CHANGELOG.md` 的 `## Unreleased` 下增加 `### Internal`（若还没有该小节就建）：

- `Ledger line scanner：插件内一份容错行扫描（#70）。`

若 align 输出因 CJK/`ACCOUNT_SHAPE` 相对本计划起点发生变化（以前不对齐的 posting 现在对齐）：**同时**写 `### Changed` 一句「以前不对齐的非 ASCII posting 现在按 Separator column 对齐」，并允许 `BENCH_UPDATE=1`。只写 Internal 或只写 Changed 都不合格。若哈希没变：**禁止** `BENCH_UPDATE`，也不写 Changed。

根 README 与 `plans/README.md` 都不动。`CONTEXT.md` 不动。

**Verify**:

```sh
pnpm lint
pnpm build
pnpm test
pnpm --filter beancount-obsidian bench
```

lint/build/test exit 0；bench 对 `align`、`format`、`format_md`、`outline`、`dot`、`enter` 哈希不变（或已按上面规则更新 expected 并写清 CHANGELOG）。

### Step 6: 提交

按 Git workflow 提交。不 push。**不要**改 `plans/README.md`。

**Verify**: `git log -3 --oneline` 含 `#70`；`git status` 无未提交的 in-scope 改动；`git diff --name-only` 不含 `plans/README.md`、`CONTEXT.md`。

## Test plan

**Seam**（新测试只打这些，不测私有循环变量）：`scanLedger`、`parsePostingLine`、`classifyLine`、`entryAt`、`endsInString`、`inStringOrComment`。

模式：表驱动，参考 `tests/align.test.ts`、`tests/token-suggest.test.ts` 的短字符串 fixture。差分测试参考 parser 的「能 parse 才比结构」，但**不要**复制 PIECES。

旧测试保持绿灯直到 cutover；不要为迁 import 改断言语义。

### BDD 地图（#70 原文 → 本计划硬验收）

| 场景 | 原注释 | #76 / grill | 写在 |
| --- | --- | --- | --- |
| 标题+缩进行为一项；空行与第 0 列 `;` 结束；下一笔独立 | 现有 align.test.ts 块测试（约 61–115 行） | 硬 | `scanLedger` 表：header/posting/metadata/comment/blank |
| 多行字符串跨越空行与第 0 列；内里不像 posting | 现有 fold 115–128；format 146–168 | 硬 | `scanLedger` + `classifyLine(..., inStringStart)` |
| `\"` 不结束字符串；字符串内 `;` 不是注释；注释里 `"` 不开启下一行字符串 | 现有 fold 126–128；balance-hints 278–281；token-suggest 118–125；payee-index 42–43 | 硬 | `endsInString` / `inStringOrComment` |
| `YYYY-MM-DD` 或 `YYYY/MM/DD`；空白或 tab；`txn` 或 g4 flag；outline 斜杠原样 | 现有 outline 97–131；flag-warnings 108–111；fold 无空白 77–80；code-actions 50–53 | 硬 | `classifyLine` + outline 回归 |
| **日期与 flag 无空白** `2026-10-01!` / `txn` 与有空白形式相同 | 原文「待产品决定」#75.12；**#76 已定算交易** | **硬验收，不再挂 #75** | `classifyLine`、fold、flag-warnings、Flag as okay（现有 code-actions 50） |
| posting：前置 flag、CJK、千分位、cost、price、行内注释 | 现有 align 133–176；format 171–185；posting-hints 160–190；payee-template 抽 posting（extract 不改） | 硬 | `parsePostingLine` |
| **CJK 在 quick fix / 添加 open 与补全一致** | 原文「缺失」；#76 已修 code-actions | **硬**；scan 上锁 `Expenses:餐饮`；不要重写 OpenFileIndex | `parsePostingLine` + 现有 `tests/code-actions.test.ts` 298–384 |
| 元数据行属于分项但不是 posting | 现有 align 61–75；posting-hints skip；fold | 硬 | `classifyLine` → `metadata` |
| org 标题不是交易；结束上一笔；大纲当节标题 | 现有 flag-warnings 127–129；outline 164–247；fold 不匹配无日期 `*` | 硬 | `classifyLine` → `org` |
| 一项语法损坏不影响相邻项 | 现有 fold 88–101 | 硬 | `scanLedger` 中间 `damaged: true`，两侧完整 |
| `scanLedger('')` 为零行零分录 | 本计划锁空串 | 硬 | `scanLedger` 表 |

缺失且旧 interface 也没有的：在 Step 1 直接写在 `scan.ts` 上，不必先改 fold。

### 禁止

- 测试里 `scanLedger(generateLedger(1500))`（太慢）。
- 为过 bench 在 `dot`/`enter` 里调用 `scanLedger`。
- characterization 去锁 beancount-mode 与 scanner 必须一致。

**Verification**: `cd apps/obsidian-plugin && npx vitest run tests/scan.test.ts tests/scan-parser-diff.test.ts` 以及 Step 3 消费者列表 → 全绿，含新建用例。

## Done criteria

ALL must hold:

- [ ] `pnpm lint`、`pnpm build`、`pnpm test` exit 0；覆盖率 statements/branches/functions/lines ≥ 90%。
- [ ] `apps/obsidian-plugin/scan.ts` 导出 `scanLedger` / `parsePostingLine` / `classifyLine` / `entryAt` / `canonicalTxnFlag`；测试 `tests/scan.test.ts`、`tests/scan-parser-diff.test.ts` 存在且通过。
- [ ] BDD 地图每一行都有对应断言（无空白 flag 与 CJK 为硬验收）。
- [ ] `rg -n 'function endsInString' apps/obsidian-plugin --glob '!scan.ts' --glob '!tests/**'` 无匹配（若 align re-export，文件里只能是 `export { endsInString } from './scan'`）。
- [ ] `rg -n 'function inStringOrComment' apps/obsidian-plugin --glob '!scan.ts' --glob '!tests/**'` 无匹配。
- [ ] `rg -n 'DATED_HEADER|stringOpenAfter|MAYBE_HEADER' apps/obsidian-plugin/transaction-fold.ts` 无匹配。
- [ ] `rg -n 'TXN_FLAG_RE' apps/obsidian-plugin/flag-warnings.ts` 无匹配。
- [ ] `rg -n 'TXN_HEADER_RE|HEADER_BANG_RE|function parsePostingLine' apps/obsidian-plugin/code-actions.ts` 无匹配。
- [ ] `rg -n 'ACCOUNT_SRC|FLAG_CHARS|function classifyLine|function parsePosting|function stripComment' apps/obsidian-plugin/balance-hints.ts` 无匹配。
- [ ] `rg -n 'const TXN_RE|export const TXN_RE' apps/obsidian-plugin/outline.ts apps/obsidian-plugin/posting-hints.ts` 无匹配。
- [ ] `rg -n 'DATED_ENTRY_RE' apps/obsidian-plugin/posting-indent.ts` 无匹配。
- [ ] `rg -n 'scanLedger' apps/obsidian-plugin/instant-alignment.ts apps/obsidian-plugin/posting-indent.ts` 无匹配。
- [ ] `rg -n '\[A-Z\]\[a-z\]\+\(\?::' apps/obsidian-plugin/align.ts apps/obsidian-plugin/balance-hints.ts` 无匹配。
- [ ] `rg -n 'ACCOUNT_RE = /\^\[A-Z\]\[a-z\]' apps/obsidian-plugin/beancount-mode.ts` **仍有匹配**（mode 未改）。
- [ ] `rg -n 'export function extractAccounts' apps/obsidian-plugin/account-index.ts` 仍有匹配（extract* 未改写成 scanLedger）。
- [ ] `rg -n "from '@repo/beancount-parser'" apps/obsidian-plugin/scan.ts` 无匹配（scanner 不依赖 parser）。
- [ ] `git diff --name-only` 相对本分支起点不含 `beancount-mode.ts`、`packages/beancount-parser/`、`main.ts`、`CONTEXT.md`、`plans/README.md`（除非 001/002 已改且你没再改）。
- [ ] CHANGELOG `## Unreleased` 有 Internal 一行提到 scanner / #70；若 CJK 对齐可见变化，同一 Unreleased 下还有 Changed 一行。
- [ ] `pnpm --filter beancount-obsidian bench` 对 align/format/outline/dot/enter 哈希符合 Step 5 规则。

## STOP conditions

Stop and report（不要即兴发挥）if:

- 「Current state」摘录与 live 代码不符（含 001 合并后 fold 已无 `fenceBodiesCache`——那是预期，**继续**用 001 的 `ledgerDoc`；若 001 **没**提供 `LedgerRegion.lines` / `hostStartLine` → STOP）。
- `docs/adr/0001-scanner-in-plugin.md` 或 `0002-editor-account-shape.md` 不存在。
- 某步验证连续失败两次。
- 修复看起来必须改 `beancount-mode.ts`、parser 包、`main.ts` 光标映射、或把 `extract*` 改成 File facts。
- 发现需要把 scanner 放进 `@repo/beancount-parser` 或抽出 `lex-shape.ts` 给 fast-lexer（否决项，ADR 0001）。
- 发现要对齐/补全改成 g4 账户（丢掉 `_·・` 或允许根 NON_ASCII）（否决项，ADR 0002 / 风险 4）。
- `dot` / `enter` bench 回退，而原因是对整缓冲 `scanLedger`——删掉该调用，不要 `BENCH_UPDATE` 掩盖。
- CJK 对齐改变了 `align` 哈希，但变化**不是**「以前不对齐的 posting 现在对齐」（例如 ASCII 账本空隙变了）→ STOP，不要 `BENCH_UPDATE`。
- `scan.ts` import `account-index.ts` 导致循环依赖或把 vault 索引拖进扫描器。
- 001 尚未合并（没有 `ledgerDoc`）却被要求开始本计划。

## 风险与约束

只列与 #70 相关的 grill 风险（Round 5 清单 4 / 8 / 10 + Q6）：

- **风险 4**：`ACCOUNT_SHAPE ≠ g4`。差分只在交集上比。`beancount-mode` 继续分叉；不要「顺便」改高亮。
- **风险 8**：`align.ts`/`format.ts` 本计划只换**行级解析**。不要把 `alignInEditor` 搬进 `edits.ts`。`main.ts` 本计划不碰。
- **风险 10**：bench 必跑 align/format/dot/enter/outline。`dot`/`enter` 禁止整篇 `scanLedger`。CJK 对齐若改哈希：必须 `BENCH_UPDATE` **且** Unreleased 同时写 Internal 与 Changed「以前不对齐的 posting 现在对齐」。
- **A6.2**：四套行号并存。scanner 只产出扫描文本相对 0-based 行；Host line 在调用方加 `hostStartLine`。
- **A4.6**：extract* 留给 #72；本 PR 与 #72 不合并。
- **#76 已锁定**：无空白 date+flag 算交易；不要再问产品。

## Maintenance notes

- #72（`plans/004-ledger-index.md`）必须**按 `LedgerRegion` 各扫一次**再并 File facts，禁止 `scanLedger(ledgerSource())`。本模块保持纯函数、无 vault。
- #71 的 `completionSlot` 应复用 `inStringOrComment`，不要第三份字符串扫描。
- #73 消费 `parsePostingLine` 做对齐 plan；不要在 #70 预建 `edits.ts`。
- Reviewer 应盯：fold 隐藏范围是否仍来自 parser `location`；Enter/`.` 是否仍无整篇扫描；mode 是否未被改；差分是否错误地要求 g4 账户。
- 显式推迟：File facts / `extract*`、CM 高亮与 scanner 对齐、把 scanner 推进 parser 包。

## CHANGELOG / README 预期

- CHANGELOG：每个 PR 一行 Internal（A1.4）。本 PR：`### Internal` — Ledger line scanner（#70）。
- CHANGELOG `### Changed`：仅当 CJK/ACCOUNT_SHAPE 导致用户能看见的对齐变化——此时 Internal **和** Changed 都要有。
- README：默认不动（无新命令/设置）。
