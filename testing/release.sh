#!/bin/sh
# SPDX-License-Identifier: MIT OR Apache-2.0
# browseML's release gate: every check that does not need a browser, in order, its output kept as the release's record
# (testing/results/v<version>.txt). The browser checks (testing/browser/*.mjs, headless Brave or Chrome) are run by
# testing/browser.sh and appended to the same record.
#   testing/release.sh 0.6.2            (BANKML_MODELS: a directory with Bonsai-1.7B-Q1_0.gguf and
#                                        oracle-forward/serve-Bonsai-1.7B-Q1_0.jsonl; default ../bankml/.models)
set -u
cd "$(dirname "$0")/.."
V="${1:?the version, e.g. 0.6.2}"
MODELS="${BANKML_MODELS:-$HOME/bML/bankml/.models}"
FORK=web/browseML/Bonsai-1.7B-Q1_0.gguf.FORK.json
OUT="testing/results/v$V.txt"
mkdir -p testing/results
FAILED=0
step() {  # step "name" command…: runs it, keeps its output, notes pass or fail
  name="$1"; shift
  printf '\n== %s\n$ %s\n' "$name" "$*" >> "$OUT"
  t0=$(date +%s)
  if "$@" >> "$OUT" 2>&1; then r=pass; else r=FAIL; FAILED=$((FAILED + 1)); fi
  printf -- '-- %s: %s (%ss)\n' "$name" "$r" "$(( $(date +%s) - t0 ))" | tee -a "$OUT"
}
{
  echo "browseML v$V — release gate, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit $(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo ' (with uncommitted changes)') · bankml/ $(git -C bankml rev-parse --short HEAD)"
  echo "machine: $(uname -sm) · $(nproc) threads · $(free -m | awk '/Mem:/{print $2" MB RAM, "$7" MB available"}') · load $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "node $(node --version) · $(rustc --version 2>/dev/null) · model $MODELS"
} > "$OUT"

step "engines: build the three .wasm"            tools/build.sh
step "engines: sha256 of what was built"         sh -c 'sha256sum web/browseml.wasm web/browseml-mt.wasm web/browseml-mt-relaxed.wasm'
step "kernels: wasm_simd, f16, q1_0 under Node's WASI (SIMD, relaxed SIMD)"  tools/build.sh test
step "download: pieces, cuts, two sources"       node testing/download.mjs
step "oracle: browseml.wasm, 9 conversations"    node testing/oracle.mjs web/browseml.wasm "$MODELS" Bonsai-1.7B-Q1_0 "$FORK"
step "oracle: browseml-mt-relaxed.wasm, 2 threads, 9 conversations" \
  node testing/bench.mjs web/browseml-mt-relaxed.wasm "$MODELS/Bonsai-1.7B-Q1_0.gguf" "$FORK" 2 "$MODELS/oracle-forward/serve-Bonsai-1.7B-Q1_0.jsonl" 9
step "prompt cache: save, restore, the cold engine's answer" \
  node testing/slot.mjs web/browseml.wasm "$MODELS/Bonsai-1.7B-Q1_0.gguf" "$FORK"
step "app: typecheck"                            sh -c 'cd app && npx tsc --noEmit'
step "app: unit tests"                           sh -c 'cd app && npx vitest run'
step "app: build"                                sh -c 'cd app && npx vite build'
step "model copy: the pin"                       sh -c "sha256sum models/Bonsai-1.7B-Q1_0.gguf | grep -q \$(node -e 'console.log(require(\"./$FORK\").files[0].sha256)') && echo 'models/Bonsai-1.7B-Q1_0.gguf matches the pin'"

echo "" | tee -a "$OUT"
[ "$FAILED" -eq 0 ] && echo "release gate v$V: every step passed" | tee -a "$OUT" || echo "release gate v$V: $FAILED step(s) failed" | tee -a "$OUT"
exit "$FAILED"
