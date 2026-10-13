# Changelog

## 0.6.2 — 2026-10-13 — the page just loads; the panel opens on the first interaction; HARD DRIVE; a release gate

- **The page just loads.** Nothing starts until the visitor's first interaction (a press or a key anywhere): then the
  control panel pops out on the left and browseML starts from a model already on this computer (kept in the browser,
  or a remembered folder; nothing is downloaded by this). Shelved by the visitor, the panel stays shelved for the
  visit; on a phone it is not opened for them (T opens it). A download starting also brings it out.
- **START, STOP, CLEAR** in the panel's TOOLS: START starts browseML from what is here, else imports it (pulled once,
  checked against its pin).
- **The panel opening moves the field and windows clear of it**: a dropped field and the windows on its side shift
  right of the panel instead of lying over it.
- **HARD DRIVE** in the control panel: the browser's storage (used of what the site may use), whether the browser
  keeps it under pressure (KEEP STORAGE asks), the model kept here, CLEAR (with a confirm), "remove the model after
  the session", and **keep a copy of the model on this computer's disk**: written into a folder the visitor chooses
  (File System Access, its size checked; with persistent access on, the folder is remembered and the next visit
  starts from that copy) or, where the browser cannot write folders, saved to the downloads.
- **The response window does not ask:** a question loads the model straight away, the window showing its progress;
  the "Import browseML" button appears only with the *ask before downloading* limiter, now off by default (it used to
  follow the browser's data-saver hint). A remembered folder's model is tried before any download.
- **The control panel opens with the response window** (each new one, on a desktop), the field dropping beside it.
  Each visit starts with the page alone, whatever the panel was last time.
- **Room before the download:** the browser's quota for the site is checked before 248 MB are pulled, with what is
  left and what to do, instead of failing after the download.
- **HARD DRIVE knows the disk:** the room left for the site; when the model is on the disk twice (a remembered folder's
  copy and the browser's), FREE THE BROWSER'S COPY.
- **Measured** (`docs/efficiency.md`, `testing/results/measure-v0.6.2.txt`): 1, 2 and 4 threads, relaxed against
  plain SIMD, peak memory, the prompt cache, and the usage diagnostics run on those records. Relaxed SIMD: +51%
  reading, +33% writing at 4 threads; 2 threads: 83% of 4 threads' speed for 35% less CPU time on a 2-core machine.
- **Usage diagnostics:** new advice when half the threads give most of the speed (≥ 80%) — cores that share in pairs.
- Fixed: a folder read through the folder input showed its name twice (`my-models/my-models/…`).
- Fixed: the response window's card crashed (React #300) when browseML became ready while it was showing.
- **The release gate** (`testing/release.sh <version>`): every check that needs no browser, in order — the three
  engines built and their sha256, the kernels under Node's WASI (SIMD, relaxed SIMD), the download (pieces, cuts, two
  sources), the oracle's 9 conversations on `browseml.wasm` and on `browseml-mt-relaxed.wasm` with 2 threads, the
  prompt cache (save, restore, the cold engine's answer), the app's typecheck, unit tests and build, the model copy
  against its pin — kept as the release's record in `testing/results/v<version>.txt`.
- **The browser checks** (`app/tests/browser.mjs`, run by `testing/browser.sh`, appended to the same record): headless
  Brave on a throwaway profile, the built page served cross-origin isolated — the page and FAQ, T opening the control
  panel with its sections, the tool suite (MEMORY, CPU, STORAGE, SENSORS, EXACT), a model found in a folder and used
  with no download, a FAQ answer with its receipt a closed accordion, kept in `.history` and `.memory`, the RECEIPTS
  fold and its toggle, the prompt cache restored on the next visit, `gpu-exact.html`, and a question with no model
  going straight to loading it. `playwright-core` is a dev dependency (it drives the installed browser; no download).
- `testing/bench.mjs`: with an oracle record, an answer that differs now fails the run.
- Versions aligned: the crate and the app are 0.6.2 (the crate said 0.1.0). Each release from here: +0.0.1.

## 0.6.1 — 2026-10-13 — receipts in closed accordions, kept in .history and .memory

- **Each answer's receipt is a closed accordion** (`Receipt.tsx`): one line — ✓ receipt, prompt → completion tokens,
  tok/s — that opens to the delivery in full and the receipt's fields (bankML's version, the model's, the request's and
  the answer's sha256, the counts) and the receipt as bankML wrote it. The "browseML ready" card folds the same way.
- **RECEIPTS in the control panel:** the *view receipts* toggle (off: receipts are kept, not shown under answers) and
  the last 30 receipts kept, each an accordion.
- **Kept twice:** with each exchange in `.history` (as before), and now as a **delivery record** in `.memory` — the
  question, the verdict, the receipt, the counts, the model — which `.memory` keeps but never sends to the model, so
  the prompt (and its warm slot) is unchanged.

## 0.6.0 — 2026-10-13 — models already on this computer, folder control, persistent access

- **Folders on this computer** (`app/src/bankml/folders.ts`): the visitor grants a folder (read-only, File System
  Access API); browseML finds the models in it — `*.gguf` anywhere (bankML's `.models`, LM Studio, llama.cpp), and blobs
  named by their sha256 (Ollama's `blobs/sha256-…`, the Hugging Face cache's `blobs/…`), recognised by name at once —
  and uses its own with no download (bankML still checks the sha256 as it opens). Where the API is missing or off
  (Firefox, Safari; Brave until `brave://flags/#file-system-access-api` is on), a folder input reads a folder for that
  visit. 5 tests: what a file is, which one browseML runs, a nested scan with its skips and limits.
- **Persistent access, a toggle** (off by default): granted folders kept in IndexedDB; the next visit starts the model
  from its folder with no prompt when the browser kept the grant, or offers RECONNECT. Turning it off forgets them.
- **Keep a copy, a toggle:** off, the model is read from its folder each visit — nothing kept in the browser (248 MB
  saved).
- **Folder control** in the control panel (MODELS ON THIS COMPUTER): add, rescan, reconnect, remove; every model found
  with its verdict and USE. **Look in a folder** in the response window's card.
- `docs/TODO.md`: the sources' limits, measured (Git LFS metered at 10 GiB a month for a free organisation; GitHub
  Release assets send no CORS header); self-hosting as the third source.

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
