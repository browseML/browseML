# browseML — usage

How to use browseML, run it yourself, and check it. What it is and why: [explanation.md](explanation.md). The
internals: [technical.md](technical.md).

**Contents** · [Try it](#try-it) · [Run it yourself](#run-it-yourself) · [The browseML app](#the-browseml-app-your-controls) ·
[Build the engine](#build-the-engine) · [Check it](#check-it) · [Use the runtime in your page](#use-the-runtime-in-your-page)

---

## Try it

Open a page and ask. Asking is the go-ahead: the model (248 MB) is pulled once in the background, checked against its
sha256 pin, and your question is answered with a receipt. The next visit starts from the copy kept in your browser.

| page | what it is |
|---|---|
| [PYTHAI/browseML](https://huggingface.co/spaces/PYTHAI/browseML) | the landing page |
| [PYTHAI/bankml](https://huggingface.co/spaces/PYTHAI/bankml) | the full bankML Space, browseML among its answerers |
| [PYTHAI/bankML-UIF](https://huggingface.co/spaces/PYTHAI/bankML-UIF) | bankML behind the ultimate input field |

> [!TIP]
> Use Chrome, Edge, Brave or Firefox on a desktop for threads. Safari runs browseML on one thread.

## Run it yourself

```sh
git clone --recurse-submodules https://github.com/browseML/browseML.git
cd browseML
python3 -m http.server -d web 8000        # then open http://localhost:8000
```

`web/` is ready to serve as it is: the landing page, the runtime and the three prebuilt `.wasm` files. Any static
server works. For **threads**, the server must send two headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Without them browseML still runs, on one thread. The `app/` build below serves with them already.

## The browseML app: your controls

```sh
cd app
npm install
npm run dev            # http://localhost:5173/app.html  (cross-origin isolated)
npm run build          # dist/: index.html (landing) + app.html, ready to host
```

The page just loads; nothing starts until you interact with it. Ask anything, or press a FAQ question: the field drops
to the bottom left, the answer's window and the **control panel** grow out of it, and the model loads straight away
(from a folder or the browser's copy if you have one, otherwise downloaded once and checked). Each window is joined to
the field by a string, so you can find it from anywhere on the page. With the *ask before downloading* limiter on, the
window offers **Import browseML** instead.

**In the field**

| control | what it does |
|---|---|
| **T** | opens and closes the control panel |
| **⧉** | docks the field in the page, or pops it out (drag, resize, dock to an edge) |
| **⋯** on a window | adds a reply field to that window, or to every window |
| drag a button off the field | puts it in a sidebar menu or a button panel (**+ panel**) |

**The control panel** (left edge; the switch at its top right shelves it to a tab that a hover peeks and a press opens;
on a phone it opens only with T). Every section can be dragged by its grip ⠿, hidden with –, and brought back with
SHOW; RESET LAYOUT restores the order. The layout is kept in this browser.

| section | what you can do there |
|---|---|
| **NOW** | the engine (ON/OFF, threads, context), writing and reading tok/s with a chart per answer, memory held and its peak, the prompt cache's size |
| **TOOLS** | **ON · OFF · CLEAR** (OFF stops an answer, with its receipt, and frees the engine's memory); the load as it happens: bar, MB/s, time left, source, PAUSE · RESUME · CANCEL, the verify clock |
| **CPU · RAM · GPU · CACHE** | sliders to 100%: threads 1–8 (AUTO takes what was measured free, one spare; RE-MEASURE), the context against the device's memory, the GPU off · low · high (the card computes only where bankML found it exact and faster) and **its time**, 25–100% (80% by default; at 100% the card never rests), the prompt cache's size and kept prompts (1–8); APPLY restarts the engine with them |
| **PERSONA** | switch personas, make one (name, opening message, prompt), import and export `.persona` files |
| **BUILDER** | browseML fills a `.persona` from a description, writes a `.prompt` for a task, keeps a `.memory` note |
| **SAMPLING** | max tokens (from 1, the single-token proof), temperature, top-p; under *more* top-k, min-p, repeat penalty, seed; under *advanced* **DRY**, **XTC** and **dynamic temperature**, each with an ON/OFF switch. The chips at the top are what the next question sends (✕ removes one); COPY AS JSON. Drag a slider (the value rides above it), use the arrow keys, double-click for the engine's default, click the value to type one |
| **ENGINE LOG** | bankML's own lines (verification, the GPU's verdict and share, host and side) and the page's steps |
| **RECEIPTS** | the last 30 receipts, each a closed accordion; *view receipts* shows or hides them under answers |
| **MODELS ON THIS COMPUTER** | add a folder, rescan, reconnect, remove; every model found with its verdict and USE (below) |
| **HARD DRIVE** | the browser's storage and the model kept (below); SAVE A COPY, SAVE FOR bankML |
| **DIALS** | the DreamKnob dials: CPU, RAM, CACHE, ANSWER, HELD; LOAD / APPLY, UNLOAD, CLEAR CACHE, MEASURE |
| **DIAGNOSTICS** · **TOOL SUITE** | network, CPU, RAM and GPU from what ran (the GPU **in the engine**: its share of rows, busy against its limit, products on the card and on the CPU, shapes decided) (and **the fire's own cost**: frames a second, milliseconds a frame, its share of the page's main thread); PING, SPEED, CPU, MEMORY, STORAGE, GPU, SENSORS and **EXACT** (bankML's GPU kernels bit-exact on this card: the simple one and the two the engine runs, fast and tiled), each with RUN |
| **LIMITERS** · **ADVICE AND RECORDS** | spare a core, low memory, ask before downloading, warm in background, GPU probe, **the processor's fire** (flames behind the page that follow the engine's work, 15 fps while it computes; electrical surges across it on its events: blue-white GPU, green receipt or speed record, red error or STOP); advice from your own records, saved as JSON or cleared |

The diagnostics record every load and answer **in your browser only** (the last 50 of each) and work out their advice
from those records: the thread count that measured fastest, a smaller context when conversations use little of it,
memory against what the device reports. Save them as JSON or clear them from the panel.

**Models already on this computer.** In the control panel, MODELS ON THIS COMPUTER → ADD FOLDER (or *Look in a folder*
in the response window's card): choose a folder, read-only. browseML lists every model in it — `.gguf` files, Ollama and
Hugging Face blobs (recognised by their sha256 names) — and USE starts its own with no download. *Persistent access*
remembers the folders for the next visit; *keep a copy* off reads the model from its folder each time. In Brave, turn
on `brave://flags/#file-system-access-api` to remember folders; without it a folder is read for that visit.

**HARD DRIVE.** In the control panel: how much of the browser's storage browseML uses, whether the browser keeps it
(KEEP STORAGE asks), CLEAR, *remove the model after the session*, and *keep a copy of the model on this computer's
disk* — SAVE A COPY writes it into a folder you choose (its size checked; with persistent access on, the next visit
starts from it, even after the browser's storage is cleared), or to your downloads where the browser cannot write
folders (Brave until `brave://flags/#file-system-access-api` is on, Firefox, Safari).

Slash commands in the field: `/client threads|ram|cache|answer <n>`, `/client apply|unload|measure`,
`/client clear yes`, `/usage` (the advice from your records), `/receipt` (the last receipt), `/shelf`.

## Build the engine

The `.wasm` files are built from bankML (the `bankml/` submodule) with Rust 1.99 (`rustup` installs it).

```sh
tools/build.sh                              # → web/browseml.wasm, browseml-mt.wasm, browseml-mt-relaxed.wasm
BANKML_PATH=~/bankml tools/build.sh         # against another bankML checkout instead of the submodule
```

## Check it

| check | command | needs |
|---|---|---|
| kernels, bit for bit (SIMD and relaxed SIMD) | `tools/build.sh test` | Node 20+ |
| the download survives cut connections | `node testing/download.mjs` | Node 20+ |
| the GPU kernel, bit for bit, with its controls | open `web/gpu-exact.html` (any static server) and press Run, or EXACT in the control panel | a WebGPU browser |
| the GPU kernels on this machine's card, and bankML's WGSL the same text | `node testing/gpu.mjs --dawn DIR` | Node 20+, the `webgpu` package (Dawn) in `DIR` |
| speed with the GPU on, and what the card did | `GPU=DIR node testing/bench.mjs web/browseml-mt-relaxed.wasm MODEL.gguf FORK.json 3 ORACLE.jsonl 3` | the model, Dawn |
| the same at another share of the GPU's time | `BANKML_GPU_LIMIT=1.0 GPU=DIR node testing/bench.mjs …` | the model, Dawn |
| a sampling tool on the engine itself (no browser) | `EXTRA='{"temperature":0.8,"seed":1,"xtc_probability":0.5}' SHOW=1 node testing/bench.mjs web/browseml-mt-relaxed.wasm MODEL.gguf FORK.json 3` | the model |
| the prompt cache: save, restore, the same answer as a cold engine | `node testing/slot.mjs web/browseml.wasm MODEL.gguf FORK.json` | the model |
| answers identical to llama-server's record | `BANKML_MODELS=… tools/build.sh oracle` | the model and `oracle-forward/serve-Bonsai-1.7B-Q1_0.jsonl` |
| speed at any thread count, plus the oracle | `node testing/bench.mjs web/browseml-mt-relaxed.wasm MODEL.gguf FORK.json 4 ORACLE.jsonl 9` | the same |
| the page code | `cd app && npm run typecheck && npm test` | Node 20+ |
| a release: every check above that needs no browser, recorded | `testing/release.sh 0.6.9` → `testing/results/v0.6.9.txt` | the model, Node |
| a release: the browser checks, appended to the record | `testing/browser.sh 0.6.9` | Brave (headless, a throwaway profile) |

The model for the oracle is in [`models/`](../models/README.md) (Git LFS: `git lfs pull`); the recorded answers come
from bankML's importer.

## Use the runtime in your page

Serve `web/browseml*.js`, the three `.wasm` and `web/browseML/` beside your page, then:

```js
import * as browseml from "./browseml.js";

const verified = await browseml.load(
  (got, total, phase) => console.log(phase, got, total),   // "download" · "retry" · "cache" · "verify"
  (level, text) => console.log(text),
  { threads: browseml.threads(), ctx: 4096, cacheRam: 0 },
);
// verified: { model, sha256, guard, engine, version, threads, build }

const answer = await browseml.chat(
  { messages: [{ role: "user", content: "Hello" }], max_tokens: 128 },
  (piece) => console.log(piece),
);
// answer: an OpenAI-shaped chat.completion with usage, timings and bankml_receipt
```

`browseml.loadStats` measures each load (where the model came from, bytes, retried pieces, times, memory);
`browseml.unload()` frees the engine; `browseml.forget()` removes the kept model.
