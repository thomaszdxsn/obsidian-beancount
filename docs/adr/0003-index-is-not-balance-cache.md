# 0003. 索引不是余额缓存

- **Status**: Accepted, 2026-10-28
- **Issue**: #72（随 #69 的文档 PR 一并合入；实现仍在 `plans/004-ledger-index.md`）

## Context

补全索引已经对每个 vault 文本文件 **read 一次**，把 `ledgerSource` 喂给 9 个 `VaultCache`（`main.ts:534-545`；`vault-index.ts:160-161`）。重复的是 rename/delete 与 9 次提取，不是「没读文件」。

余额是另一张图：`balances.ts` 的模块级 `parsedByPath` 按 **全文 + 严格 `BeancountParser.parse`**（`:156`、`:224-238`），再沿 `include` 链加载。`report-view.ts:132-153` 自己听 modify/create/delete/rename，只刷新 **include 链**。未 include 的文件可以在索引里、不在报表里；报表 source 仍只认 bean/beancount/md（`report-view.ts:257-260`）。

## Decision

`LedgerIndex` 持有 `Map<path, FileFacts>`：补全、模板、配对、open 统计。Suggest 继续拿窄接口（`match` / `remember`）。**不**并入 `parsedByPath`，**不**接管 report-view 的 vault 监听。include 图不是 File facts。

## Considered options

- **一个 `LedgerIndex` 删掉 9 个 cache，并吞掉 `parsedByPath` 与报表监听** — 否决。会把报表 debounce、glob include、`watchCreates` 拖进补全索引；#72 BDD 不要求改余额数字。
- **只抽公共 `renameByPrefix`，adapter 保留** — 否决。修不了「一次 read、九次正则」。
- **采用（本决策）**：同一 File facts 存储；余额与报表独立。

## Consequences

- 新事实（include 图、余额行）不得塞进 `FileFacts`。
- 索引按 Ledger region 各扫一次再并事实（ADR 0004），不对 `ledgerSource()` 连扫。
- 报表仍用严格 parser；语法坏的文件可以有 File facts、余额报 parse 错。
