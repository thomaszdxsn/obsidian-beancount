# 0001. 容错行扫描留在插件

- **Status**: Accepted, 2026-10-28
- **Issue**: #70（随 #69 的文档 PR 一并合入；实现仍在 `plans/003-ledger-line-scanner.md`）

## Context

`@repo/beancount-parser` 的合同是全对或抛：`parse()` 永不返回部分恢复的文件（`packages/beancount-parser/README.md:43-44`）。`fast-lexer` 产出 token 流给 AST，ACCOUNT 字符类是 `[A-Za-z0-9-]` 或 `NON_ASCII`，不含 `_`/`·`（`fast-lexer.ts:40`、`:378-392`；`Beancount.g4:353-400`）。

编辑器要的是另一件事：坏掉一笔仍有边界、邻居还能对齐/折叠/补全（#70 BDD）。插件里账户、flag、字符串扫描已有多份正则；CM stream mode（`beancount-mode.ts`）已声明不共用扫描器。

## Decision

容错行扫描放在插件 `apps/obsidian-plugin/scan.ts`。不改 `fast-lexer`，不从 parser 抽共享字符类。差分测试只在 **parser 能 parse 的生成账本** 上比 date/flag/account/payee 结构；损坏分录只跑 BDD 表，不搬 lexer 的 10 万 `PIECES`。`beancount-mode.ts` 本轮不改。

## Considered options

- **放进 `@repo/beancount-parser` 的 `scan()`，与 `lexAll` 共用字符类** — 否决。把「容错编辑器切分」塞进「严格 AST」包，改 g4 会同时破坏 format 与补全；scanner 还必须接受 parser 拒绝的 `_·・` 账户（见 ADR 0002）。
- **抽出 `lex-shape.ts`，fast-lexer 与插件 scanner 都 import** — 否决。要动 fast-lexer 热循环，超出 #70。
- **采用（本决策）**：scanner 在插件；差分只在合法交集上比。

## Consequences

- parser 继续「全对或抛」；编辑器切分的损坏语义留在插件测试。
- 账户形状跟编辑器规范（ADR 0002），不跟 g4。
- 若将来真要把 scanner 跨包，再补 `CONTEXT-MAP.md` 与跨包 ADR，而不是先拆上下文。
