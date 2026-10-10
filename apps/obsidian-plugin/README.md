# Beancount (Obsidian plugin)

User-facing documentation lives in the repository
[README](../../README.md). This package is `apps/obsidian-plugin`
(plugin id `beancount`; `manifest.json` lives at the repository root).

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
- **Ledger files**: `.bean` / `.beancount` files open in the markdown editor
  but are painted whole with the same beancount mode, in the monospace font,
  with markdown presentation reset (headings, tag pills, emphasis, links, list
  hanging indent; the org `*` shows as text). Live Preview widgets that
  replace text (embeds, checkboxes) can still render; Source mode avoids
  them. A dotted ruler marks the separator column (**Show separator ruler**).
- **Include links**: Mod-click the quoted path of `include "…"` (ledger files
  and fences) to open it, relative to the including file; a glob opens its
  first match; a missing target raises a Notice.
- **Pinyin matching** (off by default): with **Pinyin initials matching**, an
  ASCII query also matches the pinyin initials of CJK names in account,
  payee and narration completion (`Expenses:cy` → `Expenses:餐饮`). Initials
  data comes from vscode-beancount (MIT).
- **Account completion**: typing an account-shaped token (`Assets:Ca…`) in the
  editor suggests still-open account names found in the vault's ledger text:
  whole `.bean` / `.beancount` files, and only the `beancount` / `bean` fences
  of markdown notes (prose such as `PG_DATA_DIR:-x` never becomes a name).
  Names are extracted per file with a regex, cached, and invalidated when files are
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
- **Posting hints** (same toggle): the one posting that omits its amount
  shows the amount beancount will infer (3+ postings or several
  commodities), aligned on the decimal point; a transaction whose written
  amounts do not sum to zero beyond beancount's default tolerance (half a
  unit of the coarsest written precision) shows `≠ 0: …` on its header. Cost,
  price and arithmetic suppress both; the entry ledger does not.
- **Payee completion**: typing the first quoted field of a transaction line
  (`2026-09-30 * "Am…`) suggests every payee found in the vault — that field
  of every historical transaction. One vault scan feeds both completion
  indexes. Turn it off with **Complete payees**. Picking a payee closes an
  unclosed payee field. With **Autofill payee postings** (on), picking a
  payee on an entry with no postings yet inserts the postings of that
  payee's latest transaction; a two-leg entry keeps one amount and leaves
  the other leg implicit, each amount a Tab stop with the first selected.
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
  Alignment pads with spaces, so `.bean` / `.beancount` editors switch to the
  monospace font (`--font-monospace`); fences are already code blocks.
- **Date quick-insert**: the "Insert today's date" command drops today's date
  — `YYYY-MM-DD`, the beancount date shape — at the cursor, replacing the
  selection when there is one. It has no default hotkey; bind one under
  Settings → Hotkeys.
- **Save-time validation**: saving a `.bean` or `.beancount` file runs
  `bean-check` (debounced) and marks every line it complains about — a zigzag
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
  (or note's fences) is validated on its own. Unloading the plugin cancels
  pending timers and drops in-flight `bean-check` results: they do not mark
  the editor or raise a Notice. The process is not killed; only the report
  is discarded. Opening a ledger file, or a note with beancount fences,
  validates it too unless its target is unchanged since the last report (the
  stored markers are reapplied instead). **Show problems** opens a sidebar
  of the latest report grouped by file — include-chain files that are not
  open and `<load>` errors included; clicking a vault row jumps to the line.
- **QuickFix**: clicking a diagnostic gutter dot opens the fixes that line
  can take. `Flag as okay` turns a header `!` into `*` (or deletes a posting's
  leading flag). An unbalanced one-leg, one-commodity transaction can insert
  the posting that zeros it, inferring the other account from two-leg history
  (same payee first). `Invalid reference to unknown account` inserts an
  `open` directive — dated from the transaction, with the posting's commodity
  when there is one — into the vault file that already holds the most `open`
  lines.
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
| Show separator ruler | `showRuler` | `true` |
| Bean-check executable | `beanCheckPath` | `""` (PATH) |
| Entry ledger | `entryLedger` | `""` (check the saved file / fences alone) |
| Complete payees | `completePayee` | `true` |
| Autofill payee postings | `payeeAutofill` | `true` |
| Complete narrations | `completeNarration` | `false` |
| Pinyin initials matching | `pinyinMatching` | `false` |
| Fava executable | `favaPath` | `""` (PATH) |
| Fava port | `favaPort` | `5000` |
| Run Fava on activate | `runFavaOnActivate` | `false` |
| Incomplete transactions (!) | `flagWarnings["!"]` | `"warning"` |
| Cleared transactions (*) | `flagWarnings["*"]` | `null` (none) |

`entryLedger` is a vault path such as `main.bean`. With it set, a `.bean`
save checks that file's `include` chain; markdown fences are validated as if
included after the entry (opens and accounts apply).
