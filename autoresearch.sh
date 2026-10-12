#!/usr/bin/env bash
# Benchmark entrypoint: bundles apps/obsidian-plugin/bench/bench.ts with esbuild
# (es2022, like the plugin build) and runs it under node. Prints METRIC lines.
set -euo pipefail
cd "$(dirname "$0")/apps/obsidian-plugin"
export TZ=Asia/Shanghai
node bench/build.mjs
node bench/out/bench.mjs
