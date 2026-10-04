# Changelog

## 0.0.1-alpha

Initial alpha of the Obsidian Beancount plugin (`beancount-obsidian`).

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
- **Align decimal points** command (default `Mod+Shift+.`); optional `alignOnSave`; instant
  alignment when typing `.` (`instantAlignment`, `separatorColumn`).
- **Insert today's date** (`YYYY-MM-DD`, default `Mod+Shift+D`).
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
  Flag warnings. **Run Fava** command (`favaPath`, `runFavaOnActivate`).
