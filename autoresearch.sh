#!/usr/bin/env bash
# Benchmark entrypoint. Segment 2: per-keystroke editor costs.
# 1. bench/bench.ts (whole-document workloads, segment 1) still runs as an
#    output-hash regression gate; its METRIC lines are reported as secondaries.
# 2. bench/editor.ts: editor extensions/handlers on a 16.6k-line ledger;
#    primary metric editor_ms.
set -euo pipefail
cd "$(dirname "$0")/apps/obsidian-plugin"
export TZ=Asia/Shanghai
node bench/build.mjs
node bench/out/bench.mjs
node bench/build-editor.mjs
node bench/out/editor.mjs
