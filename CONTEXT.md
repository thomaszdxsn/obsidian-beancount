# CONTEXT.md

Obsidian Beancount 插件的领域术语。实现细节、文件名、测试词不写在这里。

## 账本身份与区域

**Ledger file**  
扩展名为 `bean` / `beancount` 的 vault 文件，整份都是 Ledger text。  
_Avoid_: 「账本」单说、`ledger source`。

**Ledger kind**  
缓冲分类：`ledger-file` 或 `fenced`（含无文件、`.txt`、笔记）。  
_Avoid_: 用扩展名字符串当领域词。

**Ledger text**  
按 kind 抽出的 Beancount 字符（文件含注释空行；否则为已剥 indent 的 fence body）。  
_Avoid_: 把 temp 文件或 `ledgerSource()` 拼接叫 Ledger text。

**Ledger region**  
宿主里一段连续 Ledger text（文件恰好一段；每个 fence body 一段，含空 body）。  
_Avoid_: 与 Fence body 混称文件那一段。

**Fence body**  
由 `beancount`/`bean` 开 fence 产生的 region；开/闭标记不是 Ledger text。  
_Avoid_: 把 Ledger file 的那一段也叫 Fence body；把开/闭标记算进 Ledger text。

**Host line**  
宿主缓冲的 0-based 行。  
_Avoid_: 与 CM `doc.line`（1-based）混用。

## 校验与临时账本

**Temp ledger**  
给 bean-check/余额报表的拼接文件（可选 `include`、fence 间空行、1-based 映射）。  
_Avoid_: Ledger text、`ledgerSource()`。

**Entry ledger**  
设置项；校验 Ledger file 时的默认 bean-check 路径；笔记 temp ledger 可 `include` 它。  
_Avoid_: Run target、Fava 活动文件。

**Run target**  
一次校验去重键：fenced 笔记=自身 path；Ledger file=Entry ledger 或该 path。  
_Avoid_: checkPath（可能是 `fences.bean`）。

**Marker owner**  
某 vault 文件上 bean-check 标所属的 Run target。  
_Avoid_: 把 Run target 本身当成 owner；把 flag 标的归属算进来。

**Replay**  
同事 mtime 且无在途 run 时重发缓存的 bean-check 标，不跑 runner。  
_Avoid_: 把仍在 debounce/飞行中的 open 重放叫 Replay；把重跑 bean-check 叫 Replay。

**Quiet run**  
得到（可空）bean-check 报告且无未映射路径；`fail` 不是。  
_Avoid_: 把失败/`fail`/未映射错误当成 Quiet run。

## 扫描与索引

**Scanned entry**  
容错切分出的一笔（标题+附着缩进行）；坏笔仍有边界。  
_Avoid_: parser `Directive`、AST。

**File facts**  
一路径上各 region 的 scan 归并出的补全/模板/配对/open 统计。  
_Avoid_: `BeancountParser.parse` 结果、余额 include 图。

## 补全与对齐

**Completion slot**  
光标处互斥的补全字段及 query 范围。  
_Avoid_: EditorSuggest 实例、popover。

**Separator column**  
设置的小数点列（命令/保存/Format/按 `.` 共用）。  
_Avoid_: 每条改写入口各自一套「对齐列」。
