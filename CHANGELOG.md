# Changelog

## 0.5.0 — 2026-10-13 — the GPU, exactly; two verified sources; a model you already have

- **bankML's Q1_0 kernel on WebGPU, bit-exact** (`web/browseml-gpu.js`): the dot product in WGSL as `vec_dot_ref`
  does it, f16 decoded with integer operations, the outer multiply-add as bankML's `fma_exact` (TwoSum and
  round-to-odd: WGSL's `fma()` may round twice). `exact()` holds it to bankML's own reference (the new export
  `browseml_q1_dot_ref`). In Brave (SwiftShader): 832/832 rows bit-exact over three shapes; the controls — plain
  multiply-add and WGSL's `fma()` — 110/256: the test is sharp. `web/gpu-exact.html` runs it in any WebGPU browser;
  the control panel's **EXACT** tool runs it on the visitor's GPU and the GPU verdict uses it.
- **Two verified sources:** Hugging Face and [browseML/models](https://github.com/browseML/models) (the model at a
  pinned commit, checked against Hugging Face's own LFS sha256 and Git blob ids by its `verify.mjs --source`). Each
  piece is asked of the source that answered last; a retry moves to the other. `testing/download.mjs`: one source
  down, the other serves the file whole (one request wasted).
- **A model you already have:** pick a `.gguf` on this computer; recognised by size, then sha256 against the pin
  (`recognise()`, tested), and used with no download. **Overwrite with a fresh copy** when the kept model cannot be
  used. (Unit-tested; the in-browser check waits for the operator's browser to be free.)
- `docs/TODO.md`: sources (IPFS, peer to peer, folders, OPFS), the GPU forward pass, the organisation's repositories.

## 0.4.0 — 2026-10-13 — the control panel, the prompt cache, the GPU recognised, the software catalogues

- **The prompt cache, across visits.** The engine's slot (the prompt already read) is saved after the first reading
  and kept in Cache Storage; the next visit restores it. `src/lib.rs` `browseml_slot(save|restore)` over bankML's own
  slot save/restore; a writable `/slots` in the WASI shim; `browseml.js` `warm(system)`, keyed by the sha256 of the
  model, the context and the prompt. Measured: `testing/slot.mjs` — the answer after a restore is the cold engine's,
  word for word; prompt reading 211.8 s → 12.9 s (one thread, Node). In Brave: visit 1 reads 464 tokens once (91 s)
  then answers from 5.7 s; visit 2 restores them in 0.6 s. The thread count left the prompt (Brave varies the cores it
  reports), so the key stays the same.
- **Asking is the go-ahead.** A question starts the model's download in the background, its progress in the window
  ("Loading the model in your browser…"), then answers; the *ask before downloading* limiter (on when the browser
  saves data) brings back the button.
- **STOP that stops.** Where the page is cross-origin isolated, a shared flag ends the answer at its next piece, with
  its receipt; elsewhere the engine is ended and the next question loads it again. The field's Stop uses it.
- **The control panel** (the left sidebar; **T** in the field opens it): a live strip (state, tok/s, MB held, with
  sparklines), TOOLS (STOP, CLEAR), the DreamKnob DIALS with the WARM stage (orange with red flares while the prompt is
  read), DIAGNOSTICS (network, CPU, RAM, GPU), the TOOL SUITE (PING, SPEED, CPU, MEMORY, STORAGE, GPU, SENSORS — each
  with its dial and RUN), LIMITERS (spare a core, low memory, ask before downloading, warm in background, GPU probe),
  ADVICE AND RECORDS. It shelves to a tab with the switch in its top-right corner (hover peeks, a press pins it),
  resizes by its right edge, folds its sections and remembers them; buttons dragged onto it reorder.
- **The GPU, recognised and measured** (`app/src/bankml/gpu.ts`): WebGPU's adapter, features and limits, WebGL's
  renderer; compute probes for fma exactness, GFLOP/s and GB/s. browseML answers on the CPU; a GPU kernel joins only
  when exact.
- **The software catalogues:** [graphics cards](docs/gpu-software.md), [CPU, memory and network](docs/cpu-software.md),
  [JavaScript tooling, client-side files and the historical collections](docs/js-software.md), licences read from
  each repository. bankML (the engine) and browseML (the client) explained side by side.

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
