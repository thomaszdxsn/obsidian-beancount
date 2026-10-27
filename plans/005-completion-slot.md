# Plan 005: Completion slot 只判断一次光标处该谁补全

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. `plans/README.md` 由编排者维护；本计划完成后
> **不要**改该索引。
>
> **Drift check (run first)**:
> `git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/slot.ts apps/obsidian-plugin/account-suggest.ts apps/obsidian-plugin/token-suggest.ts apps/obsidian-plugin/payee-suggest.ts apps/obsidian-plugin/snippet-suggest.ts apps/obsidian-plugin/posting-indent.ts apps/obsidian-plugin/suggest.ts apps/obsidian-plugin/main.ts apps/obsidian-plugin/tests/slot.test.ts apps/obsidian-plugin/tests/account-suggest.test.ts apps/obsidian-plugin/tests/token-suggest.test.ts apps/obsidian-plugin/tests/payee-suggest.test.ts apps/obsidian-plugin/tests/snippet-suggest.test.ts apps/obsidian-plugin/tests/posting-indent.test.ts apps/obsidian-plugin/tests/plugin.test.ts apps/obsidian-plugin/tests/plugin-lifecycle.test.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> 本计划写于 `8b75729`。
> **API 依赖**：001 的 `editorLedger` / `lineIsLedger`；003 `scan.ts` 的 `inStringOrComment`（函数体可搬家，**不得**改名）。
> **串行顺序**：执行时 001–004 已在 main（A1.2/A1.3）。002 的 `Clock` / `FakeClock` / `vault-path.ts` 与 004 的 `scanLedger` / `LedgerIndex` **本 module 不 import**。
> 不要重开 #76 已定行为。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: **API** — `plans/001-ledger-regions.md`（`editorLedger` / `lineIsLedger`）、`plans/003-ledger-line-scanner.md`（`scan.ts` 的 `inStringOrComment`）。**串行** — 排在 004 之后以免并行改 suggester；002/004 符号本 module 不调用
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/71

## Why this matters

7 个 `EditorSuggest` 每次按键各自判断槽位。`AccountSuggest.onTrigger` 为了不抢别人，import 了 tag/link/commodity 前缀正则；每加一种补全都要回头改 Account 的排除表。Enter/Tab keymap 拿到 7 个实例数组再轮询 `.context`。测试按 `registrations.editorSuggests[n]` 下标取 suggester，注册顺序一变就碎。

本计划落地 **Completion slot**：一行文本 + 光标 + `lineIsLedger` + `completeNarration` → 互斥槽位与 query 范围。adapter 只把槽位映射到索引与选中行为。新增补全种类只改 `slot.ts` 与新 adapter，不再改 Account。

## Current state

HEAD `8b75729`（001–004 尚未落地；摘录是当时的真实代码。执行时用 001/003 的符号替换 `editorLineIsLedger` / `inStringOrComment` 的**调用点**，不要把下面旧签名抄进新代码。）

相关文件：

- `apps/obsidian-plugin/account-suggest.ts` — Account 补全；排除表在 `onTrigger`
- `apps/obsidian-plugin/token-suggest.ts` — Tag/Link/Commodity/Narration + `inStringOrComment`
- `apps/obsidian-plugin/payee-suggest.ts` — Payee `onTrigger` / `selectSuggestion` / autofill
- `apps/obsidian-plugin/snippet-suggest.ts` — Snippet `onTrigger` + `snippetTabExtension(session, suggests)`
- `apps/obsidian-plugin/posting-indent.ts` — `postingIndentExtension(suggests)` 轮询 `.context`
- `apps/obsidian-plugin/suggest.ts` — `IndexSuggest.triggerInfo`（空候选不打开）
- `apps/obsidian-plugin/main.ts` — 注册 7 个 suggest，把数组传给 Enter/Tab
- `apps/obsidian-plugin/token-index.ts` / `account-index.ts` / `payee-index.ts` / `snippets.ts` — 前缀正则与 `SNIPPETS` 表（slot 复用，不复制）
- `apps/obsidian-plugin/fences.ts` — HEAD 上的 `editorLineIsLedger`（001 后由 `editorLedger(...).lineIsLedger` 取代）
- 测试：`tests/account-suggest.test.ts`、`token-suggest.test.ts`、`payee-suggest.test.ts`、`snippet-suggest.test.ts`、`posting-indent.test.ts`、`plugin.test.ts`、`plugin-lifecycle.test.ts`

`AccountSuggest` 排除表（执行后必须消失）。`8b75729` 原文：

```33:51:apps/obsidian-plugin/account-suggest.ts
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Mid-token edits (an account character right after the cursor, CJK
		// included) would make selection replace only the typed prefix and
		// garble the rest.
		const after = line.charAt(cursor.ch);
		if (after !== '' && ACCOUNT_CHAR_RE.test(after)) return null;
		const prefix = line.slice(0, cursor.ch);
		// `^Tr` / `#Tr` are link/tag text (their sigils are account-token
		// boundaries) and `10.00 U` on a posting is a commodity unit. Payee
		// and narration fields are unclosed strings, so `inStringOrComment`
		// already leaves them to those suggesters.
		if (LINK_PREFIX_RE.test(prefix) || TAG_PREFIX_RE.test(prefix)) return null;
		if (COMMODITY_PREFIX_RE.test(prefix)) return null;
		const match = ACCOUNT_PREFIX_RE.exec(prefix);
		if (!match) return null;
		if (inStringOrComment(prefix) || !editorLineIsLedger(editor, cursor.line, file)) return null;
		return this.triggerInfo(cursor, match[1]);
	}
```

`inStringOrComment`（003 后从 `scan.ts` 引用，禁止再抄循环）：

```31:44:apps/obsidian-plugin/token-suggest.ts
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

Snippet 行首 = **宿主列 0**（A2.6；缩进 fence 的 `  txn` 不打开 snippet）：

```107:121:apps/obsidian-plugin/snippet-suggest.ts
	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const after = line.charAt(cursor.ch);
		if (after !== '' && after !== ' ' && after !== '\t') return null;
		const query = line.slice(0, cursor.ch);
		if (query.length === 0) return null;
		if (query.includes(' ') || query.includes('\t')) return null;
		if (!SNIPPETS.some((snippet) => snippet.prefix.startsWith(query))) return null;
		if (!editorLineIsLedger(editor, cursor.line, file)) return null;
		return {
			start: { line: cursor.line, ch: 0 },
			end: cursor,
			query,
		};
	}
```

Enter / Tab 收实例数组：

```124:128:apps/obsidian-plugin/posting-indent.ts
export function postingIndentExtension(suggests: readonly SuggestState[]): Extension {
	const run = (view: EditorView): boolean => {
		if (suggests.some((suggest) => suggest.context !== null)) return false;
```

```157:159:apps/obsidian-plugin/snippet-suggest.ts
export function snippetTabExtension(session: SnippetSession, suggests: readonly SuggestState[]): Extension {
	const run = (view: EditorView): boolean => {
		if (suggests.some((suggest) => suggest.context !== null)) return false;
```

`main.ts` 注册顺序（account→payee→commodity→tag→link→narration→snippet）与 `popovers` 数组：

```546:578:apps/obsidian-plugin/main.ts
		const accountSuggest = new AccountSuggest(this.app, accounts);
		const payeeSuggest = new PayeeSuggest(this.app, payees, () => this.settings.completePayee, {
			enabled: () => this.settings.payeeAutofill,
			templateFor: (payee) => {
				const template = payeeTemplates.get(payee);
				return template !== null && template.postings.length > 0 ? template.postings : null;
			},
			session: snippetSession,
		});
		const commoditySuggest = new CommoditySuggest(this.app, commodities);
		const tagSuggest = new TagSuggest(this.app, tags);
		const linkSuggest = new LinkSuggest(this.app, links);
		const narrationSuggest = new NarrationSuggest(this.app, narrations, () => this.settings.completeNarration);
		const snippetSuggest = new SnippetSuggest(this.app, snippetSession);
		this.registerEditorSuggest(accountSuggest);
		this.registerEditorSuggest(payeeSuggest);
		this.registerEditorSuggest(commoditySuggest);
		this.registerEditorSuggest(tagSuggest);
		this.registerEditorSuggest(linkSuggest);
		this.registerEditorSuggest(narrationSuggest);
		this.registerEditorSuggest(snippetSuggest);
		const popovers = [
			accountSuggest,
			payeeSuggest,
			commoditySuggest,
			tagSuggest,
			linkSuggest,
			narrationSuggest,
			snippetSuggest,
		];
		// Enter opens the next line of a beancount entry already indented;
		// the binding defers to the completion popovers while they are open.
		this.registerEditorExtension(postingIndentExtension(popovers));
```

以及 `snippetTabExtension(snippetSession, popovers)`：

```599:599:apps/obsidian-plugin/main.ts
		this.registerEditorExtension(snippetTabExtension(snippetSession, popovers));
```

空候选由 adapter 决定不打开（slot **不查索引**）：

```53:62:apps/obsidian-plugin/suggest.ts
	protected triggerInfo(cursor: EditorPosition, query: string): EditorSuggestTriggerInfo | null {
		if (this.candidates(query).length === 0) return null;
		return {
			start: { line: cursor.line, ch: cursor.ch - query.length },
			end: cursor,
			query,
		};
	}
```

测试按下标取 suggester（必须删掉 `[n]` 取法）：

- `tests/plugin.test.ts:204` 解构前 5 个
- `tests/plugin.test.ts:222`、`:242`、`:269` → `[0]` Account
- `tests/plugin.test.ts:299`、`:317` → `[5]` Narration
- `tests/plugin.test.ts:335` 解构前 2 个 Account/Payee
- `tests/plugin-lifecycle.test.ts:268` → `[1]` Payee
- `tests/plugin.test.ts:358` 已用 `.find`（可保留这种写法或改 `instanceof`）
- `tests/plugin.test.ts:479` 遍历全部 `.context` 测 Enter

约定：错误处理 / 测试风格跟现有 suggest 单测（`tests/account-suggest.test.ts` 的 `trigger()` helper；表驱动可参考 `tests/balance-hints.test.ts` 的 `it.each`）。插件测试继续用 `tests/fakes.ts` 的 `FakeVault` / `createEditor` / `flush`。禁止 `vi.useFakeTimers`（本计划不需要时钟；`snippet-suggest.test.ts` 里已有的 `vi.useFakeTimers({ toFake: ['Date'] })` 不要扩散、不要改成校验用 fake timers）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift | `git diff --stat 8b75729..HEAD -- <in-scope paths>` | 若有 diff，先对照 Current state |
| Slot 单测 | `cd apps/obsidian-plugin && npx vitest run tests/slot.test.ts` | 全部通过 |
| Suggest 单测 | `cd apps/obsidian-plugin && npx vitest run tests/account-suggest.test.ts tests/token-suggest.test.ts tests/payee-suggest.test.ts tests/snippet-suggest.test.ts tests/posting-indent.test.ts` | 全部通过 |
| 插件装配 | `cd apps/obsidian-plugin && npx vitest run tests/plugin.test.ts tests/plugin-lifecycle.test.ts` | 全部通过 |
| 类型检查 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0 |
| Lint | 仓库根 `pnpm lint` | exit 0 |
| Build | 仓库根 `pnpm build` | exit 0 |
| 全量测试 | 仓库根 `pnpm test` | 全绿（基线 1064；本计划会增加 `slot.test.ts` 条数），覆盖率 ≥90% |
| Bench | （可选）仓库根 `pnpm --filter beancount-obsidian bench` | 本计划不强制。若跑：哈希须与 `bench/expected.json` / `bench/editor-expected.json` 一致。**禁止** `BENCH_UPDATE=1` |

## Suggested executor toolkit

- 若环境有 `tdd` skill：本计划 Step 3→4 严格 red→green（先 `slot.test.ts`，再 `slot.ts`）。
- 参考：issue #71 BDD（下方已逐条映射）；根 `CONTEXT.md` 术语 **Completion slot** / **Ledger text** / **Host line** / **Fence body**。
- **不要**写 ADR（grill A6：7 个 EditorSuggest 不写 ADR，易逆）。
- **不要**改根 `CONTEXT.md`（术语已有；`PopoverOpen` 是实现词，禁止写入 CONTEXT）。

## Scope

**In scope**（只改这些）：

- 新建 `apps/obsidian-plugin/slot.ts`
- 新建 `apps/obsidian-plugin/tests/slot.test.ts`
- `apps/obsidian-plugin/account-suggest.ts`
- `apps/obsidian-plugin/token-suggest.ts`（四个 Suggest 的 `onTrigger`；`inStringOrComment` 若 003 已迁走则删本地副本与 re-export）
- `apps/obsidian-plugin/payee-suggest.ts`（仅 `onTrigger`）
- `apps/obsidian-plugin/snippet-suggest.ts`（`onTrigger` + `snippetTabExtension` 签名）
- `apps/obsidian-plugin/posting-indent.ts`（`postingIndentExtension` 签名）
- `apps/obsidian-plugin/suggest.ts` — **默认不改**。adapter 继续调已有 `triggerInfo`。禁止改 `selectSuggestion` / 排序
- `apps/obsidian-plugin/main.ts`（构造 `PopoverOpen`、`popovers.add`、extension 传参；**不要**顺手拆校验/Fava）
- `apps/obsidian-plugin/tests/account-suggest.test.ts`
- `apps/obsidian-plugin/tests/token-suggest.test.ts`
- `apps/obsidian-plugin/tests/payee-suggest.test.ts`
- `apps/obsidian-plugin/tests/snippet-suggest.test.ts`
- `apps/obsidian-plugin/tests/posting-indent.test.ts`
- `apps/obsidian-plugin/tests/plugin.test.ts`（删 `[n]`；槽位场景下沉）
- `apps/obsidian-plugin/tests/plugin-lifecycle.test.ts`（`[1]` → `instanceof PayeeSuggest`）
- 根 `CHANGELOG.md`（`## Unreleased` 下一行 Internal）

**Out of scope**（看起来相关也禁止动）：

- 把 7 个 adapter 收成 1 个调度 `EditorSuggest`（A5.1 否决 B；风险 1 的退路是 Q5.1 **C**，且只在实机双 popover 之后，本 PR 不做）
- `selectSuggestion`、payee autofill、`planPayeeAutofill`、frecency、拼音、`SNIPPETS` 表内容
- `postingIndentPlan` / `wantsIndent` 逻辑（只改「谁拥有 Enter」的查询）
- `scan.ts` / `fences.ts` 的实现（只 **调用** `inStringOrComment` 与 `editorLedger`）
- `clock.ts` / `FakeClock` / `vault-path.ts` / `validation.ts` / Fava / align / format / parser
- `vault-index.ts`、`account-index.ts` 提取逻辑、`token-index.ts` 提取逻辑（slot **import 现有前缀正则**，不复制、不改提取）
- 根 `README.md`（无用户可见行为变化）
- `plans/README.md`、其它 `plans/*.md`
- 禁止 `vi.useFakeTimers`

## Git workflow

- Branch: `refactor/71-completion-slot`，基于**最新 main**（001–004 已合并）
- 提交信息：中文 conventional commits。例：`refactor: Completion slot 光标处槽位只判断一次（#71）`
- 可按逻辑单元提交（先 `slot.ts`+测试，再 adapter/keymap，再删下标）。不要一个巨型 WIP。
- **不要** push、**不要**开 PR（编排者负责）。

## 前序 PR 必须已提供的符号

执行 Step 2 时用 grep 确认，缺一则 STOP：

| 符号 | 来自 | 用途 |
|------|------|------|
| `editorLedger(editor, file).lineIsLedger(hostLine0)` | 001 `fences.ts` | adapter 把 Editor 译成 slot 的 `lineIsLedger` |
| `inStringOrComment(prefix: string): boolean` | 003 `scan.ts` | `completionSlot` 内部；tag/link/commodity/account 在未闭合引号与 `;` 注释里安静 |
| 前缀正则 | 已存在 | `ACCOUNT_PREFIX_RE` / `ACCOUNT_CHAR_RE`、`PAYEE_PREFIX_RE`、`TAG_PREFIX_RE`、`LINK_PREFIX_RE`、`COMMODITY_PREFIX_RE`、`NARRATION_PREFIX_RE`、`SNIPPETS` |

`completionSlot` **不**接收 `Editor`，**不**查 vault 索引。

## 模块边界 / 公开签名（A5.1、A5.2）

新建 `apps/obsidian-plugin/slot.ts`：

```ts
export type SlotKind =
  | 'snippet'
  | 'payee'
  | 'narration'
  | 'account'
  | 'commodity'
  | 'tag'
  | 'link';

export interface CompletionSlot {
  kind: SlotKind;
  query: string;
  startCh: number;
  endCh: number;
}

export function completionSlot(input: {
  line: string;
  ch: number;
  lineIsLedger: boolean;
  completeNarration: boolean;
}): CompletionSlot | null;

export class PopoverOpen {
  add(suggest: { context: unknown }): void;
  get isOpen(): boolean; // 任一已登记 suggest.context !== null
}
```

判定顺序（互斥；与现行 `onTrigger` 一致，不是任意优先）：

1. `lineIsLedger === false` → `null`（#76：Account/Payee/Narration 与 tag/link/commodity/snippet 都只在 Ledger text）。
2. **snippet**：宿主列 0（`line.slice(0, ch)` 不含空格/Tab、非空；`ch` 处字符为 `''` / 空格 / Tab；`SNIPPETS` 中有 prefix 以此 query 为前缀）。缩进后的 `  txn` 不是 snippet（A2.6）。
3. **payee**：`PAYEE_PREFIX_RE`；`ch` 处为 `''` 或 `"`（紧贴闭引号仍打开）。
4. **narration**：仅当 `completeNarration`；`NARRATION_PREFIX_RE`；同样允许紧贴 `"`。
5. 其余种类：若 `inStringOrComment(line.slice(0, ch))` → `null`（#76 #75.11：account 也安静）。
6. **tag**：`TAG_PREFIX_RE`；裸交易 flag `YYYY-MM-DD #`（可无空白，现行 `TagSuggest` 用 `^[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}[ \\t]*#$`）不是 tag；token 字符在 `ch` 之后则安静。
7. **link**：`LINK_PREFIX_RE`；同样 mid-token 安静。
8. **commodity**：`COMMODITY_PREFIX_RE`；必须先于 account（`10.00 U` 也能子序列匹配账户）。
9. **account**：`ACCOUNT_PREFIX_RE` + 其后不是 `ACCOUNT_CHAR_RE`。

`endCh` 恒为 `ch`。`startCh`：snippet 为 0；其余为 query 在 `line` 中的起始列（与现行 `triggerInfo`：`ch - query.length` 一致；tag/link 的 query **含** `#`/`^`）。

**不要**把 `completePayee` / 空候选 / 拼音放进 `completionSlot`。Payee 设置关闭、索引无匹配 → adapter 返回 `null`，slot 仍可报 `kind: 'payee'`。

## Steps

### Step 1: Drift check + 确认 001/003 符号

跑上面的 `git diff --stat`。然后：

```sh
grep -n "export function editorLedger" apps/obsidian-plugin/fences.ts
grep -n "lineIsLedger" apps/obsidian-plugin/fences.ts
grep -n "export function inStringOrComment" apps/obsidian-plugin/scan.ts
```

**Verify**：`editorLedger` 与字符串/注释函数可 import。若 `scan.ts` 不存在或未导出判断函数 → STOP。若 `editorLineIsLedger` 仍在而 `editorLedger` 没有 → STOP（001 未按约定合并）。

### Step 2: 分支

```sh
git checkout main && git pull
git checkout -b refactor/71-completion-slot
```

**Verify**：`git branch --show-current` → `refactor/71-completion-slot`。

### Step 3: RED — `tests/slot.test.ts` 表驱动（先于实现）

新建测试。**不要** import obsidian mock、**不要** `loadPlugin`、**不要** vault。

Helper：`|` 标光标（与 `tests/payee-index.test.ts` 的 `typedBefore` 同类）：

```ts
function caret(marked: string): { line: string; ch: number } {
  const ch = marked.indexOf('|');
  return { line: marked.replace('|', ''), ch };
}
```

默认 `lineIsLedger: true`，`completeNarration: true`，除非行内写明。

用 `it.each` 覆盖下方「BDD 测试地图」里所有 **判定槽位** 行（选中/frecency/autofill/拼音不在本文件）。至少包括：

| marked / 输入 | 期望 |
|---------------|------|
| `txn|` / `tx|` | snippet，query `txn`/`tx`，startCh 0 |
| 笔记 fence 外等价、`lineIsLedger: false` | `null` |
| `2026-10-04 txn|` | `null`（行内空格） |
| `tx|n` | `null`（前缀中间） |
| `  txn|` | `null`（非宿主列 0） |
| `2026-10-02 * "Ex|` | payee，query `Ex`，startCh = 开引号后 |
| `  Expenses:Fo|` | account，query `Expenses:Fo` |
| `2026-09-30 * "Shell" "Fu|`，`completeNarration: true` | narration，query `Fu` |
| 同上，`completeNarration: false` | `null`（不是 payee，也不是 account） |
| `2026-09-30 * "Shel|` | payee |
| `  Assets:Ca|` | account |
| `  Assets:Cash  10.00 US|` | commodity，query `US`（account 不得胜） |
| `  Assets:Cash  10.00 U|` | commodity，query `U` |
| `#fo|` | tag，query `#fo` |
| `^re|` | link，query `^re` |
| `2026-09-30 #|` | `null`（裸 flag） |
| `2026-09-30 * #|` | tag，query `#` |
| `Assets:|Cash`、`#t|r`、`^r|e`、`10.00 U|S`、`"Who|le Foods"`、`"Fu|el"` | `null` |
| `2026-09-30 * "Shel|"` / narration `"Fu|"` | 对应 payee / narration |
| `"Shell" "Fix #|`、`; leftover #fo|`、`; see ^re|`、`; bought 10.00 US|`、`  invoice: "#fo|` | `null` |
| `2026-09-30 * "Say \\"hi" #tr|` | tag（转义引号后） |
| `lineIsLedger: false` 的 `#tr|`、`^re|`、`  Assets:Cash  10.00 US|`、`txn|` | `null` |

另写 `describe('PopoverOpen')`：登记 `{ context: null }` → `isOpen === false`；把 `context` 设为 `{}` → `true`；再置 `null` → `false`。多个登记时任一非 null 即 open。

**Verify**：`npx vitest run tests/slot.test.ts` → **失败**（模块不存在或函数未实现）。若已通过 → STOP（不要空测）。

### Step 4: GREEN — 实现 `slot.ts`

按上面的顺序实现 `completionSlot` 与 `PopoverOpen`。Import 现有前缀正则与 `SNIPPETS`；字符串/注释从 `scan.ts` import。

**Verify**：`npx vitest run tests/slot.test.ts` → 全绿。

### Step 5: adapter `onTrigger` 只问 slot

每个 `onTrigger` 变成：

```ts
const line = editor.getLine(cursor.line);
const slot = completionSlot({
  line,
  ch: cursor.ch,
  lineIsLedger: editorLedger(editor, file).lineIsLedger(cursor.line),
  completeNarration, // NarrationSuggest: this.enabled()；其它 adapter 传 true
});
if (slot?.kind !== '<this kind>') return null;
return this.triggerInfo(cursor, slot.query); // SnippetSuggest 自己组 { start:{line,ch:0}, end:cursor, query }
```

PayeeSuggest 继续先看 `this.enabled()`（`completePayee`，不是 slot 输入）。

adapter：`import { editorLedger } from './fences'`。`slot.ts`：`import { inStringOrComment } from './scan'`。

`AccountSuggest` **删除**对 `token-index` 的 `TAG_PREFIX_RE` / `LINK_PREFIX_RE` / `COMMODITY_PREFIX_RE` import，以及 `inStringOrComment` import。`token-suggest.ts` 的四个 class 不再各自跑前缀/字符串/ledger 检查。若 `inStringOrComment` 已无调用方，删除本文件定义（以 `scan.ts` 为准）。

**Verify**：

```sh
cd apps/obsidian-plugin && npx vitest run tests/account-suggest.test.ts tests/token-suggest.test.ts tests/payee-suggest.test.ts tests/snippet-suggest.test.ts
```

全绿。`grep -nE 'TAG_PREFIX_RE|LINK_PREFIX_RE|COMMODITY_PREFIX_RE' apps/obsidian-plugin/account-suggest.ts` 无匹配。

现有 onTrigger 单测：**保留**依赖索引的（空候选、`completePayee` off、render/select）。纯形状互斥（payee 不抢 account、commodity 对 `10.00 U`）可改为先 `expect(completionSlot(...).kind)` 再（可选）`onTrigger`；不要删掉 adapter 在「slot 为 account 但索引无匹配 → null」上的覆盖。

### Step 6: Enter / Tab 只问 `PopoverOpen`

- `postingIndentExtension(popovers: PopoverOpen)`：`if (popovers.isOpen) return false;`
- `snippetTabExtension(session, popovers: PopoverOpen)`：同样。
- 删除两处本地 `SuggestState` 与 `suggests.some(...)`。

更新 `tests/posting-indent.test.ts` 的 `runOf`、`tests/snippet-suggest.test.ts` 的 `tabRun`：构造 `new PopoverOpen()`，`add` 一个 `{ context }` 夹具。

`main.ts`：

```ts
const popovers = new PopoverOpen();
popovers.add(accountSuggest);
popovers.add(payeeSuggest);
popovers.add(commoditySuggest);
popovers.add(tagSuggest);
popovers.add(linkSuggest);
popovers.add(narrationSuggest);
popovers.add(snippetSuggest);
this.registerEditorExtension(postingIndentExtension(popovers));
this.registerEditorExtension(snippetTabExtension(snippetSession, popovers));
```

**禁止**再把 7 元素数组传入 extension。

**Verify**：

```sh
cd apps/obsidian-plugin && npx vitest run tests/posting-indent.test.ts tests/snippet-suggest.test.ts
```

全绿。

### Step 7: 删 `registrations.editorSuggests[n]`

自己 grep：

```sh
grep -n 'editorSuggests\[' apps/obsidian-plugin --include='*.ts'
```

HEAD 清单（必须处理每一处）：

| 位置 | 改法 |
|------|------|
| `tests/plugin.test.ts:204` 解构 5 个 | `instanceof AccountSuggest` 等，或 `.find` |
| `:222` `:242` `:269` `[0]` | `instanceof AccountSuggest` |
| `:299` `:317` `[5]` | 槽位/设置场景已由 `slot.test.ts` + `NarrationSuggest` 单测覆盖：插件侧改成 **至多 1 个装配冒烟**（onload 后 `editorSuggests` 里能 `instanceof NarrationSuggest`，且 `settings.completeNarration` 默认 off 时 `onTrigger` 为 null、打开设置为 true 时有 query）。不要保留「靠下标 5」 |
| `:335` 前两个 | 互斥场景已在 `slot.test.ts`；插件测试改为 instanceof 或删除该 it（优先删除重复的 onTrigger 装配，避免两套真相） |
| `tests/plugin-lifecycle.test.ts:268` `[1]` | `instanceof PayeeSuggest` |
| `:358` `.find` | 可留 |
| `:479` 遍历 context | 对**已登记**的某一个 suggest 设 `context = {}`，断言 Enter 的 keymap `run` 为 false；不要依赖「数组里每一个」 |

索引接线测试（`wires every completion index`、fence 仅账本文本、frecency reload）**保留**，只是取 suggester 的方式改为 `instanceof`，因为它们测的是 vault index 不是槽位。

A5.5：本 issue 插件冒烟 ≤1 条专门测「suggest 已注册」。不要再加 `loadPlugin`+`onTrigger` 表。

**Verify**：

```sh
grep -n 'editorSuggests\[' apps/obsidian-plugin --include='*.ts'
```

无匹配（`mocks/obsidian.ts` 的 `editorSuggests: unknown[]` 属性声明与 `push` 不是 `[n]` 下标，保留）。

```sh
cd apps/obsidian-plugin && npx vitest run tests/plugin.test.ts tests/plugin-lifecycle.test.ts
```

全绿。

### Step 8: CHANGELOG

根 `CHANGELOG.md` 的 `## Unreleased` 增加 `### Internal`（若还没有）一行，例如：

- Completion slot：光标处该谁补全只判断一次（#71）。

**不要**改 README。**不要**写 Changed（无用户可见行为）。

**Verify**：`git diff CHANGELOG.md` 只有 Internal 一行量级。

### Step 9: 全量门禁

仓库根：

```sh
pnpm lint && pnpm build && pnpm test
```

**Verify**：lint/build/test exit 0；覆盖率 statements/branches/functions/lines 均 ≥90%。

Bench **不强制**（A1.4：#71 不在必跑 bench 的 issue 列表）。若执行者仍跑 `pnpm --filter beancount-obsidian bench`：哈希必须与 expected 一致，**禁止** `BENCH_UPDATE=1`。哈希变了 → STOP，不要改 expected。

## Test plan

- **新文件** `tests/slot.test.ts`：表驱动 `completionSlot` + `PopoverOpen`（Step 3 表）。结构可参考 `tests/balance-hints.test.ts` 的 `it.each` 与 `tests/payee-index.test.ts` 的 `|` 光标。
- **现有 suggest 单测**：保留 select / 空候选 / 设置开关 / fence 编辑器适配（`editorLedger`）；形状互斥以下沉到 slot 为准。
- **keymap**：`posting-indent.test.ts`「lets an open completion popover keep Enter」、`snippet-suggest.test.ts`「leaves Tab to an open completion popover」改为 `PopoverOpen`。
- **禁止**新的 `editorSuggests[n]`。
- **Verification**：Step 9 命令全绿，含新增 slot 测试。

### BDD 测试地图（#71 场景 → 文件）

`# 待产品决定` 且 #76 已定的改为**硬验收**（A1.5）。选中/autofill/frecency/拼音不是 slot 纯函数的职责，仍在原 adapter 测试。

| Issue 场景 | # 现有 | 落点 | 备注 |
|------------|--------|------|------|
| 第 0 列 snippet 只属于 Ledger file 或 Fence body 行首；行内空格 / `tx\|n` / fence 外安静；fence 体内行首仍打开 | `tests/snippet-suggest.test.ts:41` | **`slot.test.ts` 硬**；snippet adapter 可留 1 条 `onTrigger` 接 `editorLedger` | A2.6 宿主列 0 |
| 第一段引号归 payee，account 不抢；posting 行归 account | `tests/plugin.test.ts:282`（行号已漂到 ~327） | **`slot.test.ts` 硬** | 删插件里靠下标的重复 it |
| 第二段引号归 narration（开启时）；关闭时安静；`"Shel` 仍 payee | `tests/token-suggest.test.ts:291` | **`slot.test.ts` 硬** + NarrationSuggest 设置单测 | |
| posting 账户 / 金额后 commodity / `#` / `^` 互斥；裸 `#` 不是 tag；`10.00 U` 不是 account | account-suggest `:51` `:129`；token-suggest `:218` `:128` | **`slot.test.ts` 硬** | |
| token/字段中间安静；紧贴闭引号仍打开 | account `:103`；payee `:63` | **`slot.test.ts` 硬** | |
| tag/link/commodity 在未闭合引号与 `;` 注释安静；转义 `\"` 之后仍是 tag | token-suggest `:109` `:118` | **`slot.test.ts` 硬** | |
| **account 在注释与元数据字符串里安静** | 原文 `# 待产品决定` #75.11 | **`slot.test.ts` 硬** | #76 已定；`account-suggest.test.ts:151` 已有 characterization，迁到 slot |
| 只在 Ledger file 或 Fence body 触发；开/闭标记与 fence 外正文不打开 | token `:62` `:52` `:203`；原文 account/payee/narration「不检查上下文」为 `# 待产品决定` #75.1 | **`slot.test.ts` 硬**（`lineIsLedger: false` → 所有 kind 为 null） | #76 已定：Account/Payee/Narration **也**要求账本文本 |
| 选中只替换 query 范围、是否补闭引号 | payee `:152` `:172`；token `:346`；pinyin `:154` | 留原文件 | 非 slot |
| payeeAutofill 模板 posting + Tab | `payee-template.test.ts:322` | 留原文件 | 非 slot |
| 选中记 frecency；完整字符串不出现在候选 | account `:271` `:194`；token `:376` | 留原文件 | `triggerInfo`/index |
| 有 popover 时 Enter 不缩进 | `plugin.test.ts:425`（~475） | `posting-indent.test.ts` + 至多 1 条插件冒烟，走 `PopoverOpen` | |
| 有 popover 时 Tab 不推进 snippet；展开 txn 后 payee 仍可开 | snippet `:258` `:184` | keymap：`snippet-suggest.test.ts`；payee 槽：`slot.test.ts`（`"\|` 在 txn 展开后的行） | |
| 拼音声母查询写原文 | `pinyin.test.ts:154` `:188` | 留原文件 | 非 slot；slot 不看索引 |

缺失场景：#71 BDD 在 HEAD 已基本有 characterization。按 A1.5 **不要**再在旧 `onTrigger` 上加一套；直接在 `completionSlot` 上 TDD。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm lint` exit 0
- [ ] `pnpm build` exit 0
- [ ] `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` exit 0
- [ ] `pnpm test` exit 0；`tests/slot.test.ts` 存在且覆盖上表所有「硬」判定行
- [ ] 覆盖率地板 90%（`apps/obsidian-plugin/vitest.config.mts`）
- [ ] `grep -n 'editorSuggests\[' apps/obsidian-plugin --include='*.ts'` 无匹配（`mocks/obsidian.ts` 的 `editorSuggests: unknown[]` 属性声明与 `push` 不是 `[n]` 下标，保留）
- [ ] `grep -nE 'TAG_PREFIX_RE|LINK_PREFIX_RE|COMMODITY_PREFIX_RE' apps/obsidian-plugin/account-suggest.ts` 无匹配
- [ ] `grep -n "from './token-index'" apps/obsidian-plugin/account-suggest.ts` 无匹配
- [ ] `grep -nE 'postingIndentExtension\(|snippetTabExtension\(' apps/obsidian-plugin --include='*.ts' | grep -v tests` 的生产调用传入 `PopoverOpen`，不再传入数组
- [ ] `grep -nE 'suggests\.some\(\(suggest\) => suggest\.context' apps/obsidian-plugin --include='*.ts'` 无匹配
- [ ] 仍有且仅有 7 次 `registerEditorSuggest`（`grep -c registerEditorSuggest apps/obsidian-plugin/main.ts` → 7）
- [ ] `CHANGELOG.md` `## Unreleased` 有 Internal 条目提到 #71；`README.md` 无本计划 diff
- [ ] `git status` 无 Scope 外文件
- [ ] 测试无新的 `vi.useFakeTimers`

## STOP conditions

Stop and report back（do not improvise）if:

- Current state 摘录与 live 代码不符（drift）。001/003 把 `editorLineIsLedger` / 本地 `inStringOrComment` 换成新符号是预期，对照调用点即可。
- `fences.ts` 没有 `export function editorLedger`，或 `scan.ts` 没有 `export function inStringOrComment`（001/003 未按约定合并或改名）。不要自己发明别名。
- 某步验证连续失败两次。
- 修复看起来必须改 Out of scope 文件（例如合并成 1 个 `EditorSuggest`、改 parser、改 select/autofill 产品行为）。
- 实现 `completionSlot` 后，**现有** adapter 单测（#76 已定的 fence 外安静、注释/字符串安静、`10.00 U` 不是 account）对不上：只许改 slot 判定以匹配现行行为，不许改产品。若发现 HEAD 行为与 #76 冲突 → STOP，不要选边。
- 官方/类型文件突然写明多 `EditorSuggest` 仲裁且与「互斥 slot + 7 adapter」不兼容：不要改成 Q5.1 B。记下证据；退路是 Q5.1 C（6 个字符串一个调度、snippet 独立），**本 PR 不做**。
- 覆盖率跌破 90%。若跑了 bench 且哈希变了（本 PR 不应改对齐/format 输出）→ STOP。

## 风险与约束（本 issue 相关）

1. **Obsidian 多个 `EditorSuggest` 的仲裁未在 d.ts/文档证实。** A5.1 用互斥 Completion slot 兜底：任一光标至多一个 `kind`，7 个 adapter 即使重叠触发也只有一个 `onTrigger` 非 null。若实机出现双 popover，下一轮才考虑 Q5.1 C，不必先做单例调度（B）。本 PR 不写 ADR。
2. 本计划不涉及：双 StateField、`ledgerSource()` 空行、ACCOUNT_SHAPE≠g4、FakeClock、TempFilePort、`setFile` 原文、`clock.ts`、`vault-path.ts`（Round 6 修正属于 001–004/006/007）。

## Maintenance notes

- 新增补全种类：在 `completionSlot` 的互斥表加 `SlotKind` + 表测试 + 新 adapter 的 `slot?.kind !== '…'`。**不要**再改 `AccountSuggest`。
- 评审应盯：`account-suggest.ts` 零前缀排除表；keymap 零 suggest 数组；`completionSlot` 无 Editor/无索引；snippet 宿主列 0；commodity 先于 account。
- Follow-up 显式推迟：实机双 popover 时的 Q5.1 C；不把 7 个 adapter 合成 1 个。
- `PopoverOpen` 读 Obsidian 的 `context`（`close()` 置 null，见 `suggest.ts:48-49`）。不要另做计数器（A5.2 否决 C）。
