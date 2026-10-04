# Beancount (Obsidian plugin)

User-facing documentation lives in the repository
[README](../../README.md). This package is `apps/obsidian-plugin`
(`manifest.json` id `beancount-obsidian`, version `0.0.1-alpha`).

Desktop only: save-time validation runs `bean-check`. Install Beancount
first:

```sh
pip install beancount
```

## Features

- **Beancount syntax highlighting**: `beancount`/`bean` fenced code blocks get
  highlighting through a CodeMirror stream mode ported from
  `beancount.tmLanguage`. Inside those fences, Cmd+/ toggles `; ` line
  comments (Obsidian's own command would wrap `%%` and break the ledger),
  `{` `[` `(` and `'` auto-close (`"` does not — narration uses it), and
  `;#region` / `;#endregion` fold. Matching-bracket highlight is not
  available: Obsidian paints the fence with a CM5 overlay, so the CM6 tree
  has no inner bracket nodes.
- **Account completion**: typing an account-shaped token (`Assets:Ca…`) in the
  editor suggests still-open account names found in the vault. Names are
  extracted per file with a regex, cached, and invalidated when files are
  created, modified, deleted or renamed. Segments after the capitalized root
  may hold non-ASCII letters and CJK middle dots (`Expenses:餐饮:午饭`,
  `Expenses:カード・ローン`); other punctuation and symbols (`，`, `：`, `☕`) end a
  name, so CJK prose does not index whole clauses.
  An account with a `close` directive
  is omitted unless a later `open` reopens it. The popup shows the latest
  open date and constrained currencies when those directives are present.
  Balances are not computed here: doing it in JS would reimplement
  beancount's booking, and a Python subprocess would add latency on every
  index refresh.
- **Account hover**: hovering a complete account name shows an info card with
  the latest open/close dates and constrained currencies when those directives
  are in the vault. Names the vault has never seen produce no tooltip. Closed
  accounts still hover — the card is how their close date is visible.
  Balances are not computed here, for the same reason as completion.
- **Balance inlay hints**: the **Balance inlay hints** setting is on by default.
  A `balance` line shows `Δ asserted-minus-accumulated` without changing the
  document; for example, `10.00 USD` accumulated and `12.50 USD` asserted
  displays `Δ +2.50 USD`. The toggle updates all open editors immediately.
  Hints update synchronously while typing, reuse their DOM, and coexist with
  diagnostic underlines and gutter markers.
  This is the single-commodity fallback, not a Beancount semantic engine:
  automatic postings (`__automatic__`) are not inferred. It uses explicit
  amounts in the current `.bean` / `.beancount` file, or all `bean` /
  `beancount` fences in the current Markdown note. Account descendants are
  included; transactions on the assertion date are excluded (start-of-day
  balance), regardless of source order. Earlier assertions do not reset totals.
  Unknown/inferred amounts, arithmetic expressions, costs/prices, multiple
  commodities, padding, or amounts beyond exact scaled-integer precision
  suppress affected hints. `include`, `plugin`, unsupported dated directives,
  or a configured entry ledger disable this local calculation. The displayed
  delta is not a tolerance-aware validation verdict; `bean-check` remains
  authoritative.
- **Payee completion**: typing the first quoted field of a transaction line
  (`2026-09-30 * "Am…`) suggests every payee found in the vault — that field
  of every historical transaction. One vault scan feeds both completion
  indexes. Turn it off with **Complete payees**.
- **Directive snippets**: typing a directive prefix at column 0 (`txn`, `open`,
  `balance`, …) in a `.bean` / `.beancount` file or a `beancount`/`bean` fence
  offers the vscode-beancount templates. `txn` expands to `YYYY-MM-DD * "" ""`
  with the caret in the payee quotes, so payee completion still runs. Tab walks
  `$1`-style stops; today's date fills `$CURRENT_*`.
- **Commodity completion**: typing a partial commodity where one carries an
  amount — a posting's unit after the number, a cost or price annotation, a
  `balance` amount, or after the `price` / `commodity` keyword of its
  directive — suggests every commodity found in those positions across the
  vault.
- **Tag and link completion**: typing `#` or `^` inside ledger text — a
  `.bean`/`.beancount` file, or a ```beancount / ```bean fence in a markdown
  note — suggests every tag or link found in the vault; picking one replaces
  the typed sigil and partial name in one step.
- **Narration completion** (off by default): with "Complete narrations"
  enabled, typing the second quoted field of a transaction line
  (`2026-09-30 * "Payee" "na…`) suggests narrations found in the vault, and
  picking one closes the field.
- **Posting auto-indent**: pressing Enter inside a beancount entry opens the
  next line already indented two spaces — the first posting under a
  transaction header, or the next posting/metadata line while the entry
  continues. Enter everywhere else — prose, blank lines, an open completion
  popover — behaves exactly as before.
- **Decimal point alignment**: the "Align decimal points" command lines up the
  decimal points of the posting amounts in the transaction block at the cursor
  — or in the selection, when there is one. Each block gets its own column:
  the amounts' `sign + integer` blocks right-align at it (integers at the
  units place) and cost/price annotations stay put. An optional setting walks
  every block of each markdown/beancount file the same way whenever it is
  saved. Instant alignment (on by default) intercepts `.` in a posting amount,
  aligns that transaction block onto the separator column (default 50), and
  leaves the caret just after the point — one undo restores the insert.
- **Date quick-insert**: the "Insert today's date" command drops today's date
  — `YYYY-MM-DD`, the beancount date shape — at the cursor, replacing the
  selection when there is one. It ships with the default hotkey `Mod+Shift+D`;
  a hotkey customized for this command wins over the default.
- **Save-time validation**: saving a `.bean` or `.beancount` file runs
  `bean-check` (debounced) and marks every line it complains about — a wavy
  underline whose tooltip is the message, plus a dot in the gutter. The
  message is parsed from stderr, which is the whole report: the exit code is
  not consulted. Markdown notes with ```beancount / ```bean fences are
  checked the same way: fence bodies are copied to a temp `.bean` file and
  error lines are mapped back onto the fence. Settings hold the executable
  path (empty uses `bean-check` from PATH; a missing one prompts to
  `pip install beancount`; only a `bean-check` binary is accepted) and an
  optional entry ledger. A `.bean` save checks that entry's whole `include`
  chain; a markdown save includes the entry first so the fence is checked
  against its opens and accounts. Without an entry ledger each saved file
  (or note's fences) is validated on its own.
- **Outline**: the "Show outline" command opens a sidebar of the active
  ledger. Org-mode `*` section titles nest the same way vscode-beancount's
  DocumentSymbolProvider does (including `_` fillers for skipped levels).
  Dated transactions, `open`, `close` and `balance` directives hang under
  consecutive date groups; clicking a row jumps the editor to that line.

## Markdown fences

Opening fence: 0–3 spaces, 3+ backticks or tildes, then `beancount` or `bean`
as the language. Saving a note extracts those bodies for `bean-check`.

````markdown
```beancount
2026-10-04 * "Coffee"
  Expenses:Food   12.00 CNY
  Assets:Cash
```
````

## Settings

| UI name | Key | Default |
| --- | --- | --- |
| Align amounts on save | `alignOnSave` | `false` |
| Instant alignment | `instantAlignment` | `true` |
| Separator column | `separatorColumn` | `50` |
| Bean-check executable | `beanCheckPath` | `""` (PATH) |
| Entry ledger | `entryLedger` | `""` (check the saved file / fences alone) |
| Complete payees | `completePayee` | `true` |
| Complete narrations | `completeNarration` | `false` |
| Fava executable | `favaPath` | `""` (PATH) |
| Run Fava on activate | `runFavaOnActivate` | `false` |
| Incomplete transactions (!) | `flagWarnings["!"]` | `"warning"` |
| Cleared transactions (*) | `flagWarnings["*"]` | `null` (none) |

`entryLedger` is a vault path such as `main.bean`. With it set, a `.bean`
save checks that file's `include` chain; markdown fences are validated as if
included after the entry (opens and accounts apply).
