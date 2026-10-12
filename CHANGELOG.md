# Changelog

## 0.1.0 — 2026-10-12 — browseML on its own

- **Its own repository**, out of bankML: the WebAssembly exports (`src/lib.rs`), the browser runtime (`web/browseml.js`,
  worker, thread, WASI shim, the model's pin), the landing page from PYTHAI/browseML (`web/index.html`, `app.js`,
  `style.css`), the tests (`testing/`: oracle, bench, download, the WASI runner) and the build (`tools/build.sh`).
  The engine is bankML itself, the submodule `bankml/` pinned at `0346076`. The first public experiments are mapped
  in [HISTORY.md](HISTORY.md).
- **The download in pieces**: 16 MB HTTP Range requests, each retried from the byte where the connection cut it;
  a 4xx stops at once; a server that ignores Range is read as one stream. Brave on Linux cut the single 248 MB
  response mid-body; `testing/download.mjs` checks the fix against a server that cuts. The landing page says when it
  asks for a piece again.
- **The model held once** in the engine's memory (bankML `0346076`, `gguf::Mmap` without mmap): 531 → 317 MB after
  open for Bonsai-1.7B, measured.
- **The page sets the prompt cache** (`load(…, { cacheRam })` → `BANKML_CACHE_RAM`), and **`loadStats`** measures
  every load (where the model came from, bytes, retried pieces, download and open times, memory).
