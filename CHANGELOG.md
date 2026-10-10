# Changelog

## 0.1.1

Clears the community directory's automated review findings.

### Changed

- Settings are declared through `getSettingDefinitions()` on Obsidian 1.13+,
  so they show up in settings search; older versions render the same table
  imperatively.
- Diagnostic underlines are a gradient zigzag instead of
  `text-decoration: wavy`.
- Mod-click on `include` paths reads the OS from Obsidian's `Platform`.
- DOM is built with Obsidian's `createEl` helpers; timers and globals go
  through `window` for popout windows.
- Root `pnpm build` runs the workspace build directly instead of through
  Turborepo, so a clean `pnpm install && pnpm run build` succeeds.
- Release assets carry GitHub build provenance attestations.

## 0.1.0

First community plugin release (`beancount`).

### Added

- Syntax highlighting for `beancount` / `bean` fenced code blocks
  (CodeMirror stream mode from `beancount.tmLanguage`).
- Account completion and hover from vault `open` / `close` directives
  (CJK account segments; closed accounts omitted from completion).
- Completion ranking: prefix matches first, then subsequence fuzzy match;
  pick count and recency (`completionUsage` in `data.json`) float frequent
  accounts/payees to the top. A corrupt usage bag does not block startup.
- Payee completion from historical transaction payees.
- Directive snippets (vscode-beancount prefixes plus `txn`): type a prefix at
  column 0 to expand; `txn` → `YYYY-MM-DD * "" ""` with the caret in the payee
  field. Tab walks `$n` stops; dates resolve to today.
- Posting auto-indent on Enter inside a beancount entry.
- **Align decimal points** command; optional `alignOnSave`; instant
  alignment when typing `.` (`instantAlignment`, `separatorColumn`).
- **Insert today's date** (`YYYY-MM-DD`).
- Save-time `bean-check` diagnostics (inline + gutter) for `.bean` /
  `.beancount` files and markdown fences. Settings: `beanCheckPath`,
  `entryLedger`. Requires `pip install beancount`.
- **Show outline** sidebar (`*` sections, date groups, transactions,
  `open` / `close` / `balance`).
- Balance assertion inlay hints (single-commodity delta at the end of
  `balance` lines; hidden when an entry ledger is set). Setting:
  `inlayHints`.
- Commodity completion: typing a partial commodity after an amount
  (`10.00 U`) or after the `price` / `commodity` keyword suggests
  commodities found in those positions across the vault.
- Tag completion (`#`) and link completion (`^`) inside ledger text —
  `.bean` / `.beancount` files and beancount fences.
- Narration completion: typing the second quoted field of a transaction
  suggests vault narrations and closes the field on pick. Off by default
  (`completeNarration`). Payee completion can be turned off (`completePayee`).
- Transaction flag markers (`flagWarnings`): `!` is a warning by default, `*`
  is unmarked, so mixed incomplete/cleared ledgers get distinct underline
  styles. Settings tab groups Alignment / Validation / Completion / Fava /
  Flag warnings. **Start Fava** / **Stop Fava** (`favaPath`, `favaPort`, `runFavaOnActivate`).
- Whole-file beancount presentation for `.bean` / `.beancount` files
  (beancount-mode colors, monospace, markdown styling reset) and a separator
  ruler (`showRuler`).
- Inferred-amount hint on the posting that omits its amount and `≠ 0`
  warning on transactions that do not balance within beancount's default
  tolerance (pure JS; cost/price/arithmetic skipped).
- Pinyin initials matching for completion (`pinyinMatching`, off by default).
- Payee pick autofills the postings of that payee's latest transaction
  (`payeeAutofill`).
- Validation when a ledger file or fenced note is opened, and a **Show
  problems** sidebar listing the latest `bean-check` report across files.
- Mod-click on `include "…"` paths opens the included file.

### Fixed

- In-flight `bean-check` results are discarded when the plugin unloads, so a
  late report cannot mark the editor or raise a Notice.
- Account completion and hover read markdown notes' `beancount` / `bean`
  fences only, so colon-joined prose (`PG_DATA_DIR:-supabase-db-data`,
  `LangGraph长期记忆SDK:Semantic`) no longer shows up as an account.
- `.bean` / `.beancount` editors use the monospace font, so space-padded
  amounts line up even when the text font is proportional.
- Account hover card has padding.
