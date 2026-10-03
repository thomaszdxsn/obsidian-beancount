# Changelog

## 0.0.1-alpha

Initial alpha of the Obsidian Beancount plugin (`beancount-obsidian`).

### Added

- Syntax highlighting for `beancount` / `bean` fenced code blocks
  (CodeMirror stream mode from `beancount.tmLanguage`).
- Account completion and hover from vault `open` / `close` directives
  (CJK account segments; closed accounts omitted from completion).
- Payee completion from historical transaction payees.
- Posting auto-indent on Enter inside a beancount entry.
- **Align decimal points** command; optional `alignOnSave`; instant
  alignment when typing `.` (`instantAlignment`, `separatorColumn`).
- **Insert today's date** (`YYYY-MM-DD`, default `Mod+Shift+D`).
- Save-time `bean-check` diagnostics (inline + gutter) for `.bean` /
  `.beancount` files and markdown fences. Settings: `beanCheckPath`,
  `entryLedger`. Requires `pip install beancount`.
- **Show outline** sidebar (`*` sections, date groups, transactions,
  `open` / `close` / `balance`).
