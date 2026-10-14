# browseML — usage

How to use browseML, run it yourself, and check it. What it is and why: [explanation.md](explanation.md). The
internals: [technical.md](technical.md).

**Contents** · [Try it](#try-it) · [Run it yourself](#run-it-yourself) · [The browseML app](#the-browseml-app-your-controls) ·
[Build the engine](#build-the-engine) · [Check it](#check-it) · [Use the runtime in your page](#use-the-runtime-in-your-page)

---

## Try it

Open a page and ask. The first question offers the one-time model download (248 MB); bankML checks it, then answers
with a receipt.

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

Ask anything, or press a FAQ question. The field drops to the bottom left and the answer's window opens above it,
joined to it by a string, so you can find it from anywhere on the page. If the model is not in your browser yet, the
window says **Click to load the model in your browser** with an **Import browseML** button: the model is pulled once in
the background, checked against its sha256 pin, and your question is answered. Once loaded, each new window starts with
browseML's state: what was verified, threads, context, the memory it holds, the last answer's speed.

| control | where | what it does |
|---|---|---|
| **T** | in the field | opens the control panel (below): ON · OFF · CLEAR, the sliders, the dials, the diagnostics |
| **CPU** | dial | threads, 1 to every core the browser reports (8 at most) — applied on the next load |
| **RAM** | dial | the context (1k–8k tokens), shown as the most memory it can take — next load |
| **CACHE** | dial | the engine's prompt cache, 0–256 MiB — next load |
| **ANSWER** | dial | the longest answer — from the next question |
| **HELD** | gauge | the memory the engine holds right now |
| **LOAD / APPLY · UNLOAD · CLEAR CACHE · MEASURE** | buttons | reload with the dials · free the engine's memory · remove the kept model · measure the whole tab |
| **⧉** | in the field | dock the field in the page, or pop it out (drag, resize, dock to an edge) |
| **the control panel** | left edge | grows out of the field with your first interaction; **GPU** off · low · high (the card computes only where bankML found it exact and faster); drag any section by ⠿, hide it with –, SHOW brings it back; **NOW** at the top shows tok/s (a chart per answer) and memory; (the page itself just loads; on a phone, T opens it); **ON · OFF · CLEAR** at its top with the load as it happens (bar, rate, time left, source, verify clock) and the engine log; **CPU · RAM · GPU · CACHE** sliders to 100%; **PERSONA** (switch, make, import, export, an opening message); **BUILDER** (browseML fills a `.persona` from a description, writes a `.prompt`, keeps a `.memory` note); **SAMPLING** (Savante's dials); then receipts, models on this computer, HARD DRIVE (SAVE COPY, SAVE FOR bankML), the dials, diagnostics, the tool suite and limiters; the switch at its top right shelves it; also holds the menu and button panels (**+ panel**) when you drag buttons there |

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
`/client clear yes`, `/usage`, `/receipt`, `/shelf`.

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
| the prompt cache: save, restore, the same answer as a cold engine | `node testing/slot.mjs web/browseml.wasm MODEL.gguf FORK.json` | the model |
| answers identical to llama-server's record | `BANKML_MODELS=… tools/build.sh oracle` | the model and `oracle-forward/serve-Bonsai-1.7B-Q1_0.jsonl` |
| speed at any thread count, plus the oracle | `node testing/bench.mjs web/browseml-mt-relaxed.wasm MODEL.gguf FORK.json 4 ORACLE.jsonl 9` | the same |
| the page code | `cd app && npm run typecheck && npm test` | Node 20+ |
| a release: every check above that needs no browser, recorded | `testing/release.sh 0.6.8` → `testing/results/v0.6.8.txt` | the model, Node |
| a release: the browser checks, appended to the record | `testing/browser.sh 0.6.8` | Brave (headless, a throwaway profile) |

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
