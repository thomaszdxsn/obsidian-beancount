# Beancount

Edit [Beancount](https://beancount.github.io/) ledgers in Obsidian: syntax
highlighting, account and payee completion, posting auto-indent, decimal point
alignment, date quick-insert, and `bean-check` validation on save.

Desktop only — validation runs the `bean-check` executable.

## Features

- **Beancount syntax highlighting**: `beancount`/`bean` fenced code blocks get
  highlighting through a CodeMirror stream mode ported from
  `beancount.tmLanguage`.
- **Account completion**: typing an account-shaped token (`Assets:Ca…`) in the
  editor suggests every account name found in the vault. Account names are
  extracted per file, cached, and refreshed when files are created, modified,
  deleted or renamed.
- **Payee completion**: typing the first quoted field of a transaction line
  (`2026-09-30 * "Am…`) suggests every payee found in the vault — that field
  of every historical transaction.
- **Posting auto-indent**: pressing Enter inside a beancount entry opens the
  next line already indented two spaces — the first posting under a
  transaction header, or the next posting/metadata line while the entry
  continues. Enter everywhere else behaves exactly as before.
- **Decimal point alignment**: the **Align decimal points** command lines up
  the decimal points of the posting amounts in the transaction block at the
  cursor — or in the selection, when there is one. Each block gets its own
  column; cost/price annotations stay put. An optional setting aligns every
  block of a markdown/beancount file whenever it is saved.
- **Date quick-insert**: the **Insert today's date** command inserts today's
  date as `YYYY-MM-DD` at the cursor, replacing the selection when there is
  one. Default hotkey: `Mod+Shift+D` (customizable in Settings → Hotkeys).
- **Save-time validation**: saving a `.bean` or `.beancount` file runs
  `bean-check` and marks every line it complains about — a wavy underline
  whose tooltip is the message, plus a dot in the gutter.

## Requirements

- Obsidian desktop.
- For validation: Beancount's `bean-check` (`pip install beancount`).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Align amounts on save | off | Re-align posting amounts whenever a markdown or beancount file is saved. |
| Bean-check executable | empty | Path to `bean-check`; empty runs `bean-check` from `PATH`. Only a `bean-check` binary is accepted. |
| Entry ledger | empty | Vault path of the ledger entry file (e.g. `main.bean`); its whole `include` chain is checked in one run. Empty validates each saved file on its own. |

## Installation

### Community plugins

Settings → Community plugins → Browse → search for **Beancount** → Install →
Enable.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/thomaszdxsn/obsidian-beancount/releases/latest)
into `<Vault>/.obsidian/plugins/beancount/`, then enable **Beancount** under
Settings → Community plugins.

## Development

pnpm + Turborepo monorepo; the plugin lives in `apps/obsidian-plugin`, while
`manifest.json` and `versions.json` stay in the repository root, where Obsidian
reads them.

```sh
pnpm install
pnpm build   # type-check + production bundle → apps/obsidian-plugin/main.js
pnpm test
pnpm dev     # watch mode
```

Set `ESBUILD_OUTFILE` to write the bundle straight into a test vault's
`.obsidian/plugins/beancount/main.js`; copy `manifest.json` and
`apps/obsidian-plugin/styles.css` next to it.

### Releasing

1. Update `minAppVersion` in `manifest.json` if needed.
2. In `apps/obsidian-plugin`, run `npm version patch|minor|major`: it bumps
   `package.json`, writes the version into `manifest.json` and records it in
   `versions.json`.
3. Commit, then push a tag that is exactly the version (no `v` prefix):
   `git tag -a 1.0.1 -m 1.0.1 && git push origin 1.0.1`.
   `.github/workflows/release.yml` checks the tag against `manifest.json`
   and `versions.json`, runs tests, builds, attests the assets and drafts a
   release with `main.js`, `manifest.json` and `styles.css` attached.
4. Add release notes to the draft and publish it.

## License

[MIT](LICENSE)
