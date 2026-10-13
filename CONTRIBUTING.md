# Contributing

Bug reports, ledger samples that trip the plugin up, and pull requests are
welcome. Please open an [issue](https://github.com/thomaszdxsn/obsidian-beancount/issues)
before starting on a large change so the approach can be agreed first.

## Reporting a bug

Include:

- Obsidian version, operating system, and plugin version (Settings →
  Community plugins).
- The smallest ledger snippet that reproduces the problem — a `.bean` file
  or a ```` ```beancount ```` fence. Replace real amounts and names.
- For validation problems: the output of `bean-check <your ledger>` run in a
  terminal, and the **Bean-check executable** / **Entry ledger** settings.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/obsidian-plugin` | The plugin (`main.ts` is the entry point), its tests and benchmarks. |
| `packages/beancount-parser` | Beancount lexer/parser: a hand-written fast path plus the ANTLR parser generated from `src/grammar/Beancount.g4`. |
| `manifest.json`, `versions.json` | Plugin manifest and the Obsidian version map, at the root where Obsidian expects them. |

## Setup

pnpm + Turborepo, Node `>=22.12.0`.

```sh
pnpm install
pnpm dev     # watch build → apps/obsidian-plugin/main.js
```

To try a build in a vault, set `ESBUILD_OUTFILE` to
`<Vault>/.obsidian/plugins/beancount/main.js` and copy the root
`manifest.json` and `apps/obsidian-plugin/styles.css` next to it. Use a test
vault, not the one holding your real ledgers.

## Before opening a pull request

```sh
pnpm lint    # eslint-plugin-obsidianmd, the rule set Obsidian's community review uses
pnpm build   # type-check + production bundle
pnpm test    # vitest, with a 90% coverage floor for the plugin
```

All three must pass; the release workflow runs the same commands.

- Add or update a test for any behaviour change. Tests live in
  `apps/obsidian-plugin/tests` and `packages/beancount-parser/test`.
- Update the [README](./README.md) when a command, setting, or visible
  behaviour changes, and add an entry under a new version heading in
  [CHANGELOG.md](./CHANGELOG.md).
- Avoid `eslint-disable` comments. If one is unavoidable, give it a reason:
  `// eslint-disable-next-line <rule> -- why`.
- Performance-sensitive changes (parser, formatter, completion, anything run
  per keystroke): run `pnpm --filter beancount-obsidian bench`. It times
  whole-document work (`bench/bench.ts`) and the editor path
  (`bench/editor.ts`) on a generated 16.6k-line ledger and hashes each
  workload's output against `bench/expected.json` /
  `bench/editor-expected.json`; `BENCH_UPDATE=1` rewrites those after an
  intended behaviour change.

### Grammar changes

Edit `packages/beancount-parser/src/grammar/Beancount.g4`, then regenerate:

```sh
pnpm --filter @repo/beancount-parser generate
```

This runs `antlr-ng` and `scripts/tidy-generated.mjs`; commit the regenerated
`src/parser/*.ts` unchanged. Mirror the change in the hand-written
`src/fast-lexer.ts` / `src/fast-parser.ts` — the differential tests compare
both paths.

## Releases

Maintainers only. Release assets are built by CI so the published `main.js`
matches the source and carries a GitHub build-provenance attestation; never
upload a locally built file.

1. From `apps/obsidian-plugin`, run `npm version <x.y.z>`. This bumps
   `package.json` and writes the version into the root `manifest.json` and
   `versions.json`.
2. Push a tag equal to that version (no `v` prefix).
   `.github/workflows/release.yml` lints, builds, tests, attests, and drafts a
   GitHub release with `main.js`, `manifest.json`, and `styles.css`.
3. Publish the draft.

## License

Contributions are released under the [MIT License](./LICENSE).
