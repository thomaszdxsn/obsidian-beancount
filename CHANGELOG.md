# Changelog

## Unreleased

UI/UX fixes from the architecture review (#75).

### Changed

- **Align decimal points**, **Align amounts on save** and **Format ledger**
  put decimal points on the **Separator column** (default 50), like typing
  `.` and the dotted ruler, instead of the tightest column of each
  transaction; wide accounts still push past it. Before, saving with
  **Align amounts on save** pulled amounts that typing `.` had just aligned
  back to the left. Set the separator column to 1 for the tight layout.
- Completion popups, Enter's posting indent, instant alignment,
  **Align decimal points** and **Align amounts on save** act only on ledger
  text: `.bean` / `.beancount` files and the beancount fences of notes. Text
  outside fences is never changed, and a note without fences is not
  re-aligned on save.
- On untitled buffers and `.txt` files, folding, inlay hints, include
  links and flag markers apply only inside `beancount`/`bean` fence
  bodies, matching completion. A buffer without those fences is not
  treated as a ledger. **Show account balances** still only uses a
  `.bean` / `.beancount` file or a markdown note.
- **Start Fava** opens the browser once Fava answers on its port instead of
  right after launching it, and says why when Fava exits (quoting the last
  line it printed) or does not answer within 30 seconds. A Fava that stops
  later says so too.

### Fixed

- Typing an ordinary capitalized word such as `The`, `I` or `Tea` in a
  note's prose no longer opens account completion, where Enter would replace
  the word with an account name. Account completion also stays quiet in `;`
  comments and quoted strings, like tag, link and commodity completion.
- Payee and narration completion, payee autofill templates, the balancing
  posting quick fix and the file chosen for a new `open` directive ignore
  text outside a note's fences, as account, commodity, tag and link
  completion already did.
- In a note, a `"` in prose above a fence (`a 27" monitor`) no longer stops
  **Align decimal points**, **Align amounts on save** or typing `.` from
  aligning the postings in that fence.
- Quick fixes understand account names with non-ASCII segments such as
  `Expenses:餐饮`: the file holding their `open` directives is found, the
  balancing posting is inferred from their history, and **Open account**
  adds the posting's commodity.
- Transactions written without a space between date and flag
  (`2026-10-01!`, `2026-10-01*`, `2026-10-01txn`) fold, get flag markers
  and offer **Flag as okay**, like the spaced form.
- When `bean-check` cannot run (not installed, a traceback, a timeout, too
  much output, or a temporary fence ledger that cannot be written),
  **Show problems** lists `bean-check could not run: …` for that ledger until
  it reports again, and the Notice is shown again after a later clean run
  instead of never for the rest of the session. A failing temp ledger no
  longer fails silently.
- Changing the entry ledger clears the underlines of the dropped report
  together with the Problems list; flag markers stay.
- **Start Fava** says when it reuses a Fava still bound to an older port,
  and with no ledger to open it says to set **Entry ledger** or open a
  `.bean` / `.beancount` file.
- The plugin's `tsconfig.json` names `@types/node` explicitly, so the
  community review's type-checked lint resolves `fs`, `path`,
  `child_process` and `process` instead of treating them as `any`
  (the `no-unsafe-*` and "Unresolved `error` type" findings).

### Internal

- Ledger regions (`ledgerDoc` / `editorLedger`) answer where ledger text
  is; editor features no longer scan fences or inspect the file extension
  to decide line-level context (#69).

## 0.2.2

Clears the Obsidian community review findings (#65) and rewrites the README
as a getting-started guide.

### Changed

- The **Beancount outline** and **Beancount problems** sidebars use sentence
  case in their titles.
- The README opens with a quick start, ways to organize a ledger,
  troubleshooting, and a privacy and permissions section listing every
  program the plugin runs and what it reads and writes outside the vault
  API, with screenshots of entry, validation, and the sidebars taken in a
  demo vault. Development and release steps moved to `CONTRIBUTING.md`.

### Fixed

- `main.js` no longer depends on how dependencies were installed: bundled
  module markers drop the package manager's store path
  (`node_modules/.pnpm/…`), so rebuilding the same source after an npm or
  pnpm install gives the same file. `antlr4ng`, the one bundled dependency,
  is pinned to an exact version.
- Lint findings from the review: errors thrown as `Error` objects, an
  unchecked workspace lookup, redundant type assertions, and the unused code
  and undescribed `eslint-disable` comment in the generated ANTLR parser
  (now stripped by `pnpm generate`).

### Added

- `pnpm lint` runs `eslint-plugin-obsidianmd`'s recommended rules over the
  repository; the release workflow runs it before building.
- `CONTRIBUTING.md`.

## 0.2.1

Performance on large ledgers; no behaviour changes.

### Changed

- Large ledgers are much faster; behaviour is unchanged (#62). On a
  16.6k-line ledger: parsing 277 → 6 ms, **Format ledger** 312 → 13 ms
  (fenced notes 297 → 16 ms), opening the balances view on a three-file
  include chain 274 → 12 ms.
  Editing: re-indexing after each save (and per file at startup) 882 → 12 ms,
  a keystroke's inlay hints / flag warnings / include links 12 → 3 ms in a
  ledger and 20 → 3 ms in a fenced note, scrolling 10 → 0.3 ms, the `.` and
  Enter keys about 1 ms.
- `@repo/beancount-parser` lexes and parses with a hand-written lexer and
  recursive-descent parser that mirror `Beancount.g4`; any lexer or syntax
  error re-parses through the ANTLR parser, so error messages are unchanged.
  Differential tests compare both paths.

## 0.2.0

Transaction folding, ledger formatting, and an account balances view, built
on the bundled `@repo/beancount-parser`.

### Added

- **Format ledger** command: normalizes posting and metadata indents, collapses
  header whitespace (leaving strings and `;` comments intact), strips trailing
  whitespace, and aligns decimal points. A `.bean` / `.beancount` file is one
  ledger; any other note formats each ```beancount / ```bean fence. A syntax
  error names the document line and changes nothing.
- Transactions fold to their header line in ledger files and fences
  (including fences indented under list items). Each entry is parsed on its
  own, so an entry with a syntax error loses only its own fold; an entry
  over 300 lines gets no fold.
- **Show account balances**: a sidebar table of per-account unit balances
  (one line per currency), following the entry ledger's `include` chain or
  the active ledger / note fences. Missing amounts are interpolated from
  posting weights and quantized like beancount; `pad` / `balance` insert the
  start-of-day difference when it exceeds tolerance. A parse or interpolation
  error replaces the numbers.

### Changed

- The bundle targets ES2022 with esbuild 0.25, so the bundled Beancount
  parser runs about 6x faster than with ES2018 output.
- `include "**/…"` globs match zero or more directories, as beancount's
  recursive glob does (Mod-click and the balance view).

### Fixed

- Decimal alignment skips a line that continues an open string, so a
  posting-shaped line inside a string is left alone — on Align decimal
  points and save-time alignment too.

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
