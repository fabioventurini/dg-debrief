#!/usr/bin/env bash
# Build the distributable Foundry module zip for dg-debrief.
set -euo pipefail
MOD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$MOD_DIR"
VERSION="$(node -pe 'require("./module.json").version')"
OUT="dg-debrief-v${VERSION}.zip"
INCLUDE=(module.json css scripts)
req_list=("scripts/dg-debrief.mjs" "scripts/debrief-harvest.mjs" "scripts/debrief-app.mjs")
for req in "${req_list[@]}"; do [[ -e "$req" ]] || { echo "MISSING runtime file: $req" >&2; exit 1; }; done
[[ -e css/dg-debrief.css ]] || { echo "MISSING runtime file: css/dg-debrief.css" >&2; exit 1; }
node --test test/*.test.mjs >/dev/null || { echo "tests FAILED" >&2; exit 1; }
echo "tests pass"
for f in scripts/*.mjs; do
  printf '%s\n' "${req_list[@]}" | grep -qx "$f" || { echo "GATE STALE: $f exists but is not in the required list" >&2; exit 1; }
done
rm -f "$OUT"; zip -rq "$OUT" "${INCLUDE[@]}" -x '*.DS_Store'
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
