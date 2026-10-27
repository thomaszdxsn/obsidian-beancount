# 0002. 编辑器账户跟 `ACCOUNT_SHAPE`

- **Status**: Accepted, 2026-10-28
- **Issue**: #70（随 #69 的文档 PR 一并合入；实现仍在 `plans/003-ledger-line-scanner.md`）

## Context

Parser 的账户：根可以是 `NON_ASCII`（`餐:饮`），段为 `[A-Za-z0-9-]` 或 `NON_ASCII`，**无** `_`（`Beancount.g4:399-400`；`fast-lexer.ts:40`）。

插件补全/索引用的 `ACCOUNT_SHAPE`：根必须 ASCII `[A-Z]`，段含 Unicode 字母数字与 `_·・`（`account-index.ts:30-33`）。#76 刚用它修了 CJK quick fix（`Expenses:卡片・ローン`）。对齐/mode/hints 仍有另一套 `[A-Z][a-z]+(?::[^\s:]+)+`（`align.ts:82`、`beancount-mode.ts:93`）。

#70 必须选定 scanner 认哪一种，否则对齐与补全会再次分叉。

## Decision

编辑器规范 = g4 的 flag / 字符串 / 注释 / 可选空白 + **现行 `ACCOUNT_SHAPE`**。与 parser 的差分测试只在双方都认的账户上比结构。`beancount-mode.ts` 继续用旧正则，允许高亮与对齐/补全分叉。`2026-10-01!`（日期与 flag 无空白）继续算交易。

## Considered options

- **scanner 完全跟 g4**（无 `_·・`，根可 NON_ASCII，flag = 全套 `* # !&?% A-Z txn`） — 否决。会让带 `_`/`·`/`・` 的账户退出补全与对齐，这是用户可见回退，且推翻 #76 的 CJK 修复。
- **三套并存，scanner 只包一层** — 否决。等于没做 #70。
- **采用（本决策）**：编辑器跟 `ACCOUNT_SHAPE`；mode 本轮不动。

## Consequences

- `scan.ts` / 对齐 / 补全 / 索引认同一账户形状；`align.ts` 的窄 `ACCOUNT_RE` 在 #70 换成 scanner。
- 高亮（`beancount-mode`）可以继续漏掉 CJK/`_` 账户，不要在 #70 顺手改。
- 差分语料必须过滤「只有一边认」的账户，否则假失败。
