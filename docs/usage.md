# browseML — usage

How to use browseML, run it yourself, and check it. What it is and why: [explanation.md](explanation.md). The
internals: [technical.md](technical.md).

**Contents** · [Try it](#try-it) · [Run it yourself](#run-it-yourself) · [ultimate-clientside](#ultimate-clientside-your-controls) ·
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

## ultimate-clientside: your controls

```sh
cd app
npm install
npm run dev            # http://localhost:5173/clientside.html  (cross-origin isolated)
npm run build          # dist/: index.html (landing) + clientside.html, ready to host
```

| control | where | what it does |
|---|---|---|
| **🛠 Tools** | in the field | opens the tray: the DreamKnob dials and the diagnostics |
| **CPU** | dial | threads, 1 to every core the browser reports (8 at most) — applied on the next load |
| **RAM** | dial | the context (1k–8k tokens), shown as the most memory it can take — next load |
| **CACHE** | dial | the engine's prompt cache, 0–256 MiB — next load |
| **ANSWER** | dial | the longest answer — from the next question |
| **HELD** | gauge | the memory the engine holds right now |
| **LOAD / APPLY · UNLOAD · CLEAR CACHE · MEASURE** | buttons | reload with the dials · free the engine's memory · remove the kept model · measure the whole tab |
| **⧉** | in the field | dock the field in the page, or pop it out (drag, resize, dock to an edge) |
| **the sidebar** | left edge | appears the first time you drag a button off the field; holds the menu, the same dials and diagnostics, and button panels (**+ panel**) |

The diagnostics record every load and answer **in your browser only** (the last 50 of each) and work out their advice
from those records: the thread count that measured fastest, a smaller context when conversations use little of it,
memory against what the device reports. Save them as JSON or clear them from the panel.

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
| answers identical to llama-server's record | `BANKML_MODELS=… tools/build.sh oracle` | the model and `oracle-forward/serve-Bonsai-1.7B-Q1_0.jsonl` |
| speed at any thread count, plus the oracle | `node testing/bench.mjs web/browseml-mt-relaxed.wasm MODEL.gguf FORK.json 4 ORACLE.jsonl 9` | the same |
| the page code | `cd app && npm run typecheck && npm test` | Node 20+ |

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
