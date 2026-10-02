# Obsidian Sample Plugin

This is a sample plugin for Obsidian (https://obsidian.md).

## Features

- **Beancount syntax highlighting**: `beancount`/`bean` fenced code blocks get
  highlighting through a CodeMirror stream mode ported from
  `beancount.tmLanguage`.
- **Account completion**: typing an account-shaped token (`Assets:Ca…`) in the
  editor suggests still-open account names found in the vault. Names are
  extracted per file with a regex, cached, and invalidated when files are
  created, modified, deleted or renamed. An account with a `close` directive
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
  of every historical transaction. One vault scan feeds both completion
  indexes.
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

This project uses Typescript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in Typescript Definition format, which contains TSDoc comments describing what it does.

**Note:** The Obsidian API is still in early alpha and is subject to change at any time!

This sample plugin demonstrates some of the basic functionality the plugin API can do.
- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open Sample Modal" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and output 'click' to the console.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

## Adding your plugin to the community plugin list

- Check https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint (optional)
- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code. 
- To use eslint with this project, make sure to install eslint from terminal:
  - `npm install -g eslint`
- To use eslint to analyze this project use this command:
  - `eslint main.ts`
  - eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder:
  - `eslint .\src\`

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## API Documentation

See https://github.com/obsidianmd/obsidian-api
