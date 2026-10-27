# 0004. Temp ledger 不是 Ledger text

- **Status**: Accepted, 2026-10-28
- **Issue**: #69（随 #69 的文档 PR 一并合入；实现在 `plans/001-ledger-regions.md`）

## Context

今日已有两份「从 fence 拼出来的文本」，语义不同：

- `ledgerSource(path, content)`：markdown 只拼 fence body，region 之间 **单个 `\n`、不插空行**（`fences.ts:158-162`）。给索引，避免散文形状漏进 token。
- `buildFenceLedger`：可选 `include` 前导、fence **之间空行**、1-based `hostLine` 映射（`fences.ts:240-270`）。给 bean-check 与余额报表，因为工具要一份可解析文件，且错误行号要映回宿主。

两段 fence 若按 `ledgerSource()` 直连再整串扫描，上一段的 header 会吞下一段的 posting。

## Decision

索引与扫描走 Ledger region（或 `ledgerSource()` 那种无空行拼接，且 **禁止** 对拼接串 `scanLedger`）。bean-check / 报表走 Temp ledger（空行 + 可选 include + 1-based 映射）。`LedgerDoc` 必须同时提供两者，不得合并成一个拼接函数。`LedgerIndex` 吃 vault **原文 + path**，对 `regions` 各扫一次再并 File facts。

## Considered options

- **单一拼接函数伺候两边** — 否决。空行与 include 是校验实现细节；无空行是索引防泄漏合同。合并后 #50 类散文泄漏与 fence 跨段分录无法同时测。
- **改 `ledgerSource()` 为 fence 间插空行，以允许一次连扫** — 否决。推翻「Ledger text 不含 fence 间空行」，并让散文泄漏更难测。
- **#69 不提供 `tempLedger()`，校验内联再拼** — 否决。行号映射会在 #68 分叉。
- **采用（本决策）**：两套文本，名称钉死。

## Consequences

- `tempLedger()` 只造文本+映射；落盘是 #68 的 `TempFilePort`（名字避免与 Temp ledger 撞车）。
- #72 单测必须覆盖「两段 fence、第一段 header、第二段 posting」——直连会吞分录。
- 领域上说 Ledger text / Temp ledger；`ledgerSource()` 只保留为方法名。
