#!/bin/sh
# SPDX-License-Identifier: MIT OR Apache-2.0
# browseML: build bankML's engine for the browser into web/, where a page serves it beside browseml.js:
# browseml.wasm (wasm32-wasip1, one thread), browseml-mt.wasm (wasm32-wasip1-threads, its pool on Web Workers, for
# cross-origin-isolated pages) and browseml-mt-relaxed.wasm (the same with relaxed SIMD, used only where exact).
#   tools/build.sh            build
#   tools/build.sh oracle     build, then check it against llama-server b11192's recorded answers (Node 20+)
#   tools/build.sh test       the engine's kernel tests (wasm_simd, f16, q1_0) on wasm32-wasip1 under Node's WASI, with
#                             SIMD and with relaxed SIMD — bankML's own tests, in bankml/ (or BANKML_PATH)
# BANKML_PATH=/path/to/bankml builds against that checkout instead of the pinned submodule (a cargo [patch]).
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD"
CFG=""
if [ -n "${BANKML_PATH:-}" ]; then
  mkdir -p target
  printf '[patch."%s"]\nbankml = { path = "%s" }\n' "$ROOT/bankml" "$(cd "$BANKML_PATH" && pwd)" > target/bankml-path.toml
  CFG="--config target/bankml-path.toml"
fi
if [ "${1:-}" = test ]; then
  BANKML_PATH="${BANKML_PATH:-$ROOT/bankml}"
  rustup target list --installed | grep -qx wasm32-wasip1 || rustup target add wasm32-wasip1
  cd "$BANKML_PATH"
  export CARGO_TARGET_WASM32_WASIP1_RUNNER="node --no-warnings $ROOT/testing/wasi-run.mjs"
  for f in +simd128 +simd128,+relaxed-simd; do
    # --allow-undefined: the test binary links the GPU loader's dlopen/dlsym (LTO drops them from the real builds);
    # the runner traps if one is called. Tests that start a thread pool or need the models are skipped.
    CARGO_TARGET_DIR="$ROOT/target/wasm-test" RUSTFLAGS="-C target-feature=$f -C link-arg=--allow-undefined" \
      cargo test --release --target wasm32-wasip1 --lib -p bankml -- wasm_simd f16::tests q1_0::tests --skip avx2_equals --skip par_ --skip oracle --test-threads=1
  done
  exit
fi
for t in wasm32-wasip1 wasm32-wasip1-threads; do rustup target list --installed | grep -qx $t || rustup target add $t; done
OUT="$ROOT/target"
# shellcheck disable=SC2086
cargo build --release --target wasm32-wasip1 $CFG
cargo build --release --target wasm32-wasip1-threads $CFG
# the relaxed-SIMD threaded build: RUSTFLAGS replaces .cargo/config.toml's for this one
CARGO_TARGET_DIR="$OUT/relaxed" RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd -C link-arg=--max-memory=4294967296" \
  cargo build --release --target wasm32-wasip1-threads $CFG
cp "$OUT/wasm32-wasip1/release/browseml.wasm" web/browseml.wasm
cp "$OUT/wasm32-wasip1-threads/release/browseml.wasm" web/browseml-mt.wasm
cp "$OUT/relaxed/wasm32-wasip1-threads/release/browseml.wasm" web/browseml-mt-relaxed.wasm
for f in web/browseml.wasm web/browseml-mt.wasm web/browseml-mt-relaxed.wasm; do echo "$f: $(wc -c < $f) bytes, sha256 $(sha256sum $f | cut -c1-16)…"; done
if [ "${1:-}" = oracle ]; then
  MODELS="${BANKML_MODELS:?set BANKML_MODELS to a directory with Bonsai-1.7B-Q1_0.gguf and oracle-forward/serve-Bonsai-1.7B-Q1_0.jsonl}"
  node testing/oracle.mjs web/browseml.wasm "$MODELS" Bonsai-1.7B-Q1_0 web/browseML/Bonsai-1.7B-Q1_0.gguf.FORK.json "${BROWSEML_TURNS:-}"
fi
