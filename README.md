# Obsidian Beancount

Edit [Beancount](https://beancount.github.io/) ledgers in Obsidian: syntax
highlighting, account/payee completion, directive snippets, posting auto-indent,
decimal-point alignment, date insert, outline, and `bean-check` validation on
save.

Desktop only — validation shells out to the `bean-check` executable.

Plugin id: `beancount-obsidian`. Source: `apps/obsidian-plugin`.

## Requirements

- Obsidian desktop (`minAppVersion` 0.15.0).
- For save-time validation: Beancount's `bean-check`:

  ```sh
  pip install beancount
  ```

  Then either leave **Bean-check executable** empty (uses `bean-check` on
  `PATH`) or set `beanCheckPath` to the binary. Only a program named
  `bean-check` is accepted.

## Markdown fences

Ledger snippets in notes use a `beancount` or `bean` info-string (backticks
or tildes; an extra suffix like `linenums` is ignored):

````markdown
```beancount
2026-10-04 * "Coffee"
  Expenses:Food   12.00 CNY
  Assets:Cash
```
````

Saving a markdown note copies those fence bodies into a temporary `.bean`
file, runs `bean-check`, and maps errors back onto the fence lines.

## Settings

Configured in **Settings → Beancount**. Keys match `data.json`.

| Setting | Key | Default | Description |
| --- | --- | --- | --- |
| Align amounts on save | `alignOnSave` | off | Re-align posting amounts whenever a markdown or beancount file is saved (debounced). |
| Instant alignment | `instantAlignment` | on | Typing `.` in a posting amount aligns that transaction block and leaves the caret after the point. |
| Separator column | `separatorColumn` | `50` | 1-based display column of the decimal point for instant alignment (wide accounts still push past it). |
| Bean-check executable | `beanCheckPath` | empty | Path to `bean-check`; empty runs `bean-check` from `PATH`. |
| Entry ledger | `entryLedger` | empty | Vault path of the ledger entry file (e.g. `main.bean`). |
| Complete payees | `completePayee` | on | Suggest historical payees in the first quoted field. |
| Complete narrations | `completeNarration` | off | Suggest vault narrations in the second quoted field. |
| Fava executable | `favaPath` | empty | Path to `fava`; empty runs `fava` from `PATH`. Only a program named `fava` is accepted. |
| Fava port | `favaPort` | `5000` | TCP port Fava binds on `127.0.0.1` (`-p`). |
| Run Fava on activate | `runFavaOnActivate` | off | Start Fava against the entry ledger (or the active ledger file) when the plugin loads. |
| Incomplete transactions (!) | `flagWarnings["!"]` | warning | Marker style for `!` transactions (`none` / `warning` / `error`). |
| Cleared transactions (*) | `flagWarnings["*"]` | none | Marker style for `*` / `txn` transactions. |

**`entryLedger` behaviour**

- Saving a `.bean` / `.beancount` file checks that entry's whole `include`
  chain.
- Saving a markdown note with ` ```beancount ` / ` ```bean ` fences checks
  those fences: with an entry ledger they are validated as if included after
  it (opens and accounts apply); without one, the fences are checked on their
  own.
- Empty: each saved ledger file (or note's fences) is validated alone.

A missing or rejected `bean-check` shows:

> bean-check not found — install beancount (`pip install beancount`) or set
> the bean-check path in the plugin settings.

## Commands

| Command | Notes |
| --- | --- |
| Align decimal points | Current transaction block, or the selection when there is one. Default hotkey `Mod+Shift+.` (Obsidian has no default for that chord). |
| Insert today's date | `YYYY-MM-DD` at the cursor. Default hotkey `Mod+Shift+D`. |
| Show outline | Sidebar of `*` sections, date groups, transactions, `open` / `close` / `balance`. |
| Start Fava | Starts Fava (`-H 127.0.0.1 -p <favaPort>`) on the entry ledger or the active `.bean` file, then opens the UI. Repeating the command reuses the live process. |
| Stop Fava | Kills the Fava process started by this plugin. |

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
  Suggestions rank prefix matches first, then case-insensitive subsequence
  matches; within a rank, names picked more often / more recently float to
  the top. Pick counts persist in the plugin `data.json` (`completionUsage`);
  a corrupt bag is ignored so the plugin still starts.
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
- **Payee completion**: typing the first quoted field of a transaction line
  (`2026-09-30 * "Am…`) suggests every payee found in the vault — that field
  of every historical transaction. Ranking matches account completion
  (prefix, then subsequence, then frecency). One vault scan feeds both
  completion indexes.
- **Directive snippets**: typing a directive prefix at column 0 (`txn`, `open`,
  `balance`, …) offers the vscode-beancount templates. `txn` expands to
  `YYYY-MM-DD * "" ""` with the caret in the payee quotes, so payee completion
  still runs. Tab walks `$1`-style stops; today's date fills `$CURRENT_*`.
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
  (or note's fences) is validated on its own. Unloading the plugin cancels
  pending timers and drops in-flight `bean-check` results: they do not mark
  the editor or raise a Notice. The process is not killed; only the report
  is discarded.
- **Outline**: the "Show outline" command opens a sidebar of the active
  ledger. Org-mode `*` section titles nest the same way vscode-beancount's
  DocumentSymbolProvider does (including `_` fillers for skipped levels).
  Dated transactions, `open`, `close` and `balance` directives hang under
  consecutive date groups; clicking a row jumps the editor to that line.

## Install

Copy `apps/obsidian-plugin/main.js`, `manifest.json`, and `styles.css` into:

```
<Vault>/.obsidian/plugins/beancount-obsidian/
```

Enable **Beancount** under Settings → Community plugins.

## Development

pnpm + Turborepo. Node `>=22.12.0`.

```sh
pnpm install
pnpm build   # type-check + production bundle → apps/obsidian-plugin/main.js
pnpm test
pnpm dev     # watch mode
```

Set `ESBUILD_OUTFILE` to write the bundle into a test vault's
`.obsidian/plugins/beancount-obsidian/main.js`; copy `manifest.json` and
`styles.css` next to it.

See [CHANGELOG.md](./CHANGELOG.md) for the `0.0.1-alpha` notes.
