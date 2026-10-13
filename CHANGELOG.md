# Changelog

## 0.3.0 — 2026-10-13 — the browseML app: ask, load with one click, a FAQ browseML answers

- **One click to load.** Asked before the model is in the browser, the answer's window says *Click to load the model in
  your browser* with **Import browseML**; the model is pulled once in the background, checked against its sha256 pin,
  and the question is answered. Loaded, a new window starts with browseML's state (what was verified, threads,
  context, memory held, the last answer's speed). Checked in Brave: import, then the held question answered, ✓.
- **Ask, and find it anywhere.** An inquiry drops the field to the bottom left; its window opens above it, joined by a
  string (the field's tethers, on by default).
- **A FAQ answered by browseML**, from `web/browseml.persona` (a short factual persona, in place of bankML's 10 KB one).
- **browseML only.** Hugging Face is where the model comes from, nothing more: the free-CPU and provider answerers,
  the credential bridge, the answerer tabs and the install guide are gone from `app/`.
- **The page** is `app.html`, titled *browseML — machine learning in your browser*, with the logo.
- The field (`app/src`): message widgets (`widgets`), windows above the field (`outputPlace: 'above'`).

## 0.2.0 — 2026-10-12 — public; ultimate-clientside; the docs

- **Public**, with the organization's profile (browseML/.github).
- **`app/` — ultimate-clientside**: the ultimate input field with this computer's controls (DreamKnob dials for
  threads, memory, prompt cache and answer length; load, unload, clear, measure) and diagnostics from actual usage,
  behind 🛠 in the field and in a sidebar that appears when a button is dragged off the field. Built beside the
  landing page into one folder (`npm run build` → `dist/`: `index.html`, `clientside.html`). From the bankML UIF
  working tree at `cc56466`, without the GPL credential module, THOT, iNFT or the other pages.
- **The docs**: the README explains the project; the detail is in [docs/usage.md](docs/usage.md),
  [docs/explanation.md](docs/explanation.md) and [docs/technical.md](docs/technical.md).
- **The runtime**: `load()` and `chat()` take optional callbacks; `bankml.persona` served beside the pages.

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
