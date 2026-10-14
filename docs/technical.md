# browseML — technical reference

The engine, the runtime, the kernels and the measurements, in detail. For what browseML is and why it works the way
it does, read [explanation.md](explanation.md); to run, build and check it, [usage.md](usage.md).

**Contents** · [Technical summary](#technical-summary) · [Versions](#versions-from-the-first-experiments-to-068) ·
[The pieces](#the-pieces) · [Three builds, one engine](#three-builds-one-engine) · [The GPU](#the-gpu-webgpu-exactly) ·
[Measured](#measured) · [Where the time goes](#where-the-time-goes-and-what-is-next) ·
[What a visitor sees](#what-a-visitor-sees-while-it-works) · [Limitations](#limitations)

## Technical summary

State at **0.6.8** (2026-10-13), engine bankML `f618309` (branch `browseml`).

| | |
|---|---|
| **what runs** | bankML's own forward pass, sampler, verification and receipts, compiled from Rust to WebAssembly (`wasm32-wasip1`, `wasm32-wasip1-threads`); nothing rewritten for the browser |
| **model** | Bonsai-1.7B Q1_0 (248 MB, Apache-2.0), pinned by sha256; from Hugging Face or [browseML/models](https://github.com/browseML/models), in 16 MB resumable pieces, or from a folder on the visitor's computer |
| **trust** | the GGUF guard and the whole file's sha256 before the first token; `bankml serve`'s receipt on every answer, its hash recomputed by the page; answers identical to llama-server b11192's record (9 of 9 conversations, one thread and two) |
| **CPU** | WebAssembly SIMD kernels bit-identical to the scalar reference; relaxed SIMD only where `relaxed_madd` is fused; a thread pool on Web Workers where the page is cross-origin isolated, its size measured (free threads, one spare) |
| **GPU** | WebGPU through a GPU worker: bankML's own WGSL kernel (`gpu/wgsl.rs`), bit-exact on the card before it is given work; the 1-bit matrices shared with the card per shape, only where bankML measured the card faster; prompt reading and grouped submissions |
| **memory** | the model held once (317 MB of engine memory once open); the keys and values grow to the context chosen (470 MB at 4096) |
| **prompt cache** | the read prompt saved as a slot in Cache Storage, per persona (up to 8, least recently used removed): 397 tokens restored in 0.6 s where reading took 203 s |
| **client controls** | the control panel: ON · OFF · CLEAR, CPU · RAM · GPU · CACHE sliders to 100%, the engine log, personas and a builder, sampling, receipts, models on this computer, HARD DRIVE, diagnostics from actual usage |
| **server and client** | bankML's host registry (`host.rs`) names browseML a client host — the visitor's machine, nothing leaves it — and `bankml serve` a server host; engine work lands in bankML first and is pinned here |
| **checked by** | `testing/release.sh` (engines, kernels under Node's WASI, the download, both oracles, the prompt cache, the app, the model's pin) and `testing/browser.sh` (headless Brave), recorded in `testing/results/v<version>.txt` |

## Versions, from the first experiments to 0.6.12

Before this repository, browseML lived in bankML (`browseML/`, from `9c63fa1`, 2026-10-08) and was shown on Hugging
Face Spaces; [HISTORY.md](../HISTORY.md) maps each experiment to its code. The details of each release are in the
[CHANGELOG](../CHANGELOG.md).

| version | date | what it brought | bankML |
|---|---|---|---|
| (bankML `browseML/`) | 2026-10-08 – 10-10 | the engine in WebAssembly, verified, with receipts; exact on 9 of 9 conversations; threads; relaxed SIMD where exact; f16 and tiled attention in SIMD; public on PYTHAI/bankml and PYTHAI/browseML | `9c63fa1` – `8265ddb` |
| 0.1.0 | 2026-10-12 | its own repository; the download in 16 MB pieces (Brave on Linux); the model held once (531 → 317 MB) | `0346076` |
| 0.2.0 | 2026-10-12 | public; ultimate-clientside (the field with this computer's controls); the docs split into usage, explanation, technical | `0346076` |
| 0.3.0 | 2026-10-13 | the browseML app: ask, one click to load, a FAQ browseML answers; Hugging Face only as the model's source | `0346076` |
| 0.4.0 | 2026-10-13 | the control panel; the prompt cache across visits (211.8 s → 12.9 s); STOP that stops; the GPU recognised; the software catalogues | `0346076` |
| 0.5.0 | 2026-10-13 | bankML's Q1_0 kernel bit-exact on WebGPU (EXACT); two verified sources; a model you already have | `0346076` |
| 0.6.0 | 2026-10-13 | models in folders on this computer; persistent access as a toggle | `0346076` |
| 0.6.1 | 2026-10-13 | receipts as closed accordions, kept in `.history` and `.memory` | `0346076` |
| 0.6.2 | 2026-10-13 | the page just loads, the panel opens on the first interaction; HARD DRIVE; measured ([efficiency](efficiency.md)); the release gate. Not released alone: its browser checks found the lost first click | `0346076` |
| 0.6.3 | 2026-10-13 | ON · OFF · CLEAR; the load as it happens; sliders to 100%; the engine log; personas and a builder; sampling; SAVE FOR bankML | `0346076` |
| 0.6.4 | 2026-10-13 | windows and the panel grow out of the field; reply fields by choice; NOW with tok/s charts; every section dragged and hidden | `0346076` |
| 0.6.5 | 2026-10-13 | the prefill tile in WebAssembly (reading +34%); the free threads measured; prompts kept per persona | `1781a17` |
| 0.6.6 | 2026-10-13 | cheaper sign lanes (reading +6%); the time profiled; WebGPU exact on a real AMD card; the fast eight-lane kernel | `1c3c16c` |
| 0.6.7 | 2026-10-13 | the visitor's GPU in the forward pass, exactly; the GPU switch chooses it; bankML owns the kernel and knows its hosts | `a32f81c` |
| 0.6.8 | 2026-10-13 | the GPU measured on a quiet machine; the same lessons in bankML's Vulkan backend (the token dimension, grouped submissions) | `f618309` |
| 0.6.9 | 2026-10-13 | SAMPLING deeper: DRY, XTC and dynamic temperature; glass sliders; depth on borders | `f618309` |
| 0.6.10 | 2026-10-14 | the processor's fire across the page; prompts read on the GPU four tokens per invocation (the kernel 1.14–1.18×, the engine within the noise) | `8f5e930` |
| 0.6.11 | 2026-10-14 | the GPU's time, a slider to 100% | `51ec905` |
| 0.6.12 | 2026-10-14 | 0.6.11's speed claim corrected with the GPU share held fixed; the fire measures its own cost | `dab9771` |

## The pieces

| piece | what it does |
|---|---|
| `src/lib.rs` | the WebAssembly exports (`browseml_open`, `browseml_chat`, `browseml_slot`, `browseml_gpu_status`, `browseml_wgsl`, `browseml_hosts`). It only moves bytes across the boundary, as `capi/` does for C, and names the host (`BANKML_HOST=browseml`) at open. |
| `web/browseml-wasi.js` | the few WASI calls the engine makes, answered in memory: one read-only `/models` directory holding the downloaded file, the clocks, random bytes, environment and stderr. Anything else is refused, never faked. |
| `web/browseml-worker.js` | runs the engine in a Web Worker, so the page stays responsive. On a cross-origin-isolated page it chooses the fastest threaded build that compiles here and is exact here (below) and starts the pool's threads first |
| `web/browseml-thread.js` | one thread of the engine's pool: a Web Worker running the same module on the same shared memory (`wasi.thread-spawn` → `wasi_thread_start`) |
| `web/browseml.js` | downloads the model with progress, caches it, loads it (one load at a time) and chats with it |
| `web/browseml-gpu-worker.js`, `web/browseml-gpu-host.js` | the GPU: a worker holding the WebGPU device, serving the engine's `bankml_gpu_*` imports while the engine's thread waits on `Atomics`; the WGSL text and workgroup size come from bankML |
| `web/browseml-gpu.js`, `web/gpu-exact.html` | the WGSL kernels with their exactness test and its controls (EXACT in the control panel; a page any WebGPU browser opens) |
| `web/browseML/*.FORK.json` | the model's pin |
| `web/index.html`, `app.js`, `style.css` | the landing page (as on PYTHAI/browseML): ask, the download and verification shown as they happen, a receipt under every answer |
| `app/` | the browseML app: the ultimate input field with this computer's controls and diagnostics, built beside the landing page ([app/README.md](../app/README.md)) |
| `testing/oracle.mjs`, `testing/bench.mjs`, `testing/download.mjs`, `testing/slot.mjs`, `testing/gpu.mjs` | exactness against llama-server's record; timing at any thread count (with `GPU=`, on this machine's GPU through Dawn); the download against a server that cuts; the prompt cache; the WGSL kernels bit-exact on a real card |
| `testing/release.sh`, `testing/browser.sh` | the release gate and the browser checks, each release's record in `testing/results/` |

## Three builds, one engine

| file | target | where the page uses it |
|---|---|---|
| `browseml-mt-relaxed.wasm` | `wasm32-wasip1-threads`, SIMD + relaxed SIMD | cross-origin isolated, the browser compiles relaxed SIMD (Chrome, Edge) and `relaxed_madd` is fused on this machine |
| `browseml-mt.wasm` | `wasm32-wasip1-threads`, SIMD | cross-origin isolated, otherwise (Firefox; or `relaxed_madd` not fused) |
| `browseml.wasm` | `wasm32-wasip1`, SIMD | not isolated, or no `SharedArrayBuffer`: one thread |

The Space sends `cross-origin-opener-policy: same-origin` and `cross-origin-embedder-policy: credentialless`
(`custom_headers` in its README), and huggingface.co embeds it with `allow="cross-origin-isolated"`, so threads work
both on the Space page and at pythai-bankml.static.hf.space. `credentialless` rather than `require-corp`, because the
page loads scripts from deltaverse.pythai.net and jsDelivr.

### Threads

The engine's pool (`par::Pool`, whose results do not depend on the thread count) runs on Web Workers
sharing the module's memory. A thread that waits cannot start a worker, so the page creates the pool's workers
before the engine starts; `wasi.thread-spawn` then hands each one a thread. The WASI shim copies out of shared
memory where `TextDecoder` and `getRandomValues` refuse a `SharedArrayBuffer` view.

### Relaxed SIMD, exactly

`f32x4.relaxed_madd` may be fused or not, by the implementation; fused, it *is* the
reference's `mul_add`. So the relaxed build checks at open (`q1_0::relaxed_madd_is_fused`:
(1 + 2⁻²³)·(1 − 2⁻²³) − 1 is −2⁻⁴⁶ fused and 0 unfused) and refuses to open where it is not fused; the page then
loads `browseml-mt.wasm`. Its kernel (`q1_0::relaxed_core`):
- **Sign sums:** computed as llama.cpp's AVX2 "sel" kernel does, Σ±q = 2·Σ₊q − Σq. Σ₊q comes from
  `relaxed_dot_i8x16_i7x16` against the weights' bits as 0 or 1, deterministic everywhere because the second operand
  never has its top bit set. (With ±1 it is not: V8 on x86 reads that operand as unsigned.) Σq is precomputed per
  activation. This applies only to activations without a −128, where ggml's i8 negation wraps; those keep
  `simd128_core`.
- **Inner multiply-adds:** `d1·s` is exact in f32 (11 + 10 significant bits), so they are the same bits fused or not.
- **Outer `d0·ab + acc`:** one fused instruction instead of the f64 emulation.

### What the engine needed for WebAssembly

The engine needed six small changes for WebAssembly, and none of them changes the native build:
- **`gguf::Mmap`** reads the file into memory where there is no `mmap`, one shared copy per path.
- **`serve::ident`** has a non-unix form.
- **The Vulkan loader** reports "no card" on WebAssembly.
- **The prompt cache's 8 GiB default** fits a 32-bit `usize`.
- **An unseeded request's seed** comes from the clock alone, because WebAssembly has no process id.
- **Rope's `cosf` and `sinf` are glibc's algorithm** (`bankML/sincosf.rs`, ported from ARM's optimized-routines,
  which glibc adopted). The reference builds its rope cache with glibc's functions. Rust's WebAssembly libm
  differs from them in the last bit on about 1 % of the rope's angles: 1,987 cosines and 2,917 sines out of 262,144,
  for positions 0–4095. That was enough to part one of the oracle's nine conversations from the reference late in
  the answer. The port matches glibc's x86-64 FMA build on all 2³² inputs (`sincosf_matches_glibc_on_every_float`).
  `exp`, `ln` and `powf` already agree bit for bit.

### The 1-bit kernel in SIMD

The theory behind every kernel on this page — reference equivalence, the three lemmas that make most of the work
free to reorganise, the emulated FMA's exactness condition, the `hide` hazard and the evidence, with the literature —
is bankML's kernel treatise, [KERNELS.md](https://github.com/cryptoAGI/bankml/blob/browseml/docs/KERNELS.md).

Q1_0's dot product has a WebAssembly SIMD kernel (`q1_0::simd128_core`, used by `vec_dot` and the forward pass's
`vec_dot_act`) that is bit-identical to the scalar reference:
- **The integer sums are vectorised.** Signs are applied as `(q ^ m) − m`, then two pairwise widening adds.
- **The inner multiply-adds are plain multiply then add.** The q8 scale is f16-exact (11 bits) and each lane sum
  is an integer of at most 10 bits, so their product is exact in f32. A fused and an unfused multiply-add are then
  the same bits.
- **The outer fused multiply-adds go through f64 SIMD.** A product of two f32 is exact in f64; when the f64 sum
  is exact (TwoSum error zero), one rounding to f32 is the fused result. The rare inexact lanes that land on an
  f32 halfway point, or are subnormal or non-finite, use the scalar `mul_add`. WebAssembly has no deterministic
  SIMD FMA, and the software `fmaf` was a third of the time.

### The f16 paths and the tiled attention kernel

The **f16 paths and the tiled attention kernel** have WebAssembly SIMD too (`bankML/wasm_simd.rs`), each bit-identical
to its scalar definition:
- **`f16::vec_dot`** (the KV cache's dot products) keeps the reference's four 8-lane accumulators, as eight f32x4, and
  its reduction order. Both factors are f16 (11 significant bits), so each product is exact in f32 and the fused
  multiply-add is a multiply then an add.
- **`f16::widen`** widens four f16 at a time exactly (the bits shifted into place, scaled by 2¹¹²; infinities and NaNs
  set apart); `f16::mad` and `f16::scale` (the reference kernel's V accumulator) use it, then round each lane to f16 as
  the scalar path does.
- **The tiled kernel's score chains and V update** run four lanes at a time through `wasm_simd::fmadd`: the fused
  `relaxed_madd` in the relaxed build, otherwise the f64 route above, with the scalar `mul_add` for the rare lanes
  where rounding twice could differ.

### Kernel tests

`tools/build.sh test` runs these kernels' unit tests, and `q1_0`'s, on `wasm32-wasip1` under Node's WASI
(`testing/wasi-run.mjs`), with SIMD and with relaxed SIMD: all 65,536 f16 values through `widen4`, and about a million
`fmadd` lanes against `mul_add`. Those lanes include sums that land on an f32 midpoint after the f64 rounding, which is
exactly where rounding twice goes wrong; with the fix removed, the test fails.

## The GPU: WebGPU, exactly

The GPU joins on the CPU's terms: a card computes a row only after bankML's kernel has reproduced the CPU kernel's bits
on it, and keeps a matrix shape only where it measured the card faster.
- **The bridge.** The engine runs in a worker; its `bankml_gpu_*` imports (`web/browseml-gpu-host.js`) post each call
  to a GPU worker (`web/browseml-gpu-worker.js`) that holds the WebGPU device, and the engine's thread waits on
  `Atomics` until the result is in shared memory. That needs shared memory, so the GPU works only on a cross-origin
  isolated page, with the threaded builds; elsewhere the engine is told there is no card.
- **The kernel is bankML's** (`gpu/wgsl.rs`, handed to the page by `browseml_wgsl`): Q1_0 against q8_0 activations,
  eight invocations per row (one per lane of the CPU kernel, lane 0 adding the eight in the CPU's order), a token
  dimension for prompts, the workgroup size by vendor (AMD 64, NVIDIA 32; 32/64/128 give the same bits). WGSL has no
  exact fused multiply-add, so the outer multiply-add is TwoSum with round-to-odd; each intermediate passes through an
  OR with a zero the compiler only learns at run time, because Mesa's compiler simplified `(a + b) − a` and lost the
  error term on AMD (found in 0.6.6). `testing/gpu.mjs` checks `browseml-gpu.js`'s copy is the same text.
- **The on-card oracle and calibration**, unchanged from bankML's Vulkan worker: layer-shaped products compared bit
  for bit at open; then each shape timed on the card and on the CPU, decided per shape; the card's share of rows set
  by the limiter (the heap's limit where there is no `/proc`, as in a browser — before 0.6.7 an integrated card was
  never given a matrix for lack of it).
- **Prompt reading** (`begin_many` / `finish_many`): a micro-batch's tokens in one dispatch, four tokens per
  invocation (`Q1_0_MM4`, 0.6.10: each weight word decoded once for four tokens, the bits unchanged). **Grouped submissions**
  (`begin_group` / `finish_group`): Q/K/V and gate/up submitted together, the CPU's rows of all of them in one wake of
  the pool, one wait — each wait is a round trip to the GPU worker.
- **The GPU switch** (OFF · LOW · HIGH, the panel's GPU slider) chooses the adapter's power preference or no card,
  and **its time** (25–100%, 0.6.11) is bankML's limiter, `BANKML_GPU_LIMIT`; APPLY restarts the engine. The panel and the engine log show the card, its share and the shapes on card and CPU.
- **Back to the server:** the token dimension and grouped submissions are in bankML's Vulkan backend too
  (`q1_0_mat_mul8`, `Gpu::IN_FLIGHT`), bit-exact on the same card.

## Measured

The first measurements, from bankML's `browseML/` before 0.1.0 (`8265ddb`): Bonsai-1.7B Q1_0 on a Ryzen 3 3200U (2
cores, 4 threads), in Node (`testing/bench.mjs`: a 20-token prompt, 48 tokens written; the machine otherwise idle):

| build | threads | prompt | writing |
|---|---|---|---|
| scalar reference, first build | 1 | ~0.2 tok/s | ~0.2 tok/s |
| `browseml.wasm` (SIMD) | 1 | 1.43 tok/s | 1.11 tok/s |
| `browseml-mt.wasm` | 2 | 2.59 | 1.57 |
| `browseml-mt-relaxed.wasm` | 2 | 3.53 | 2.19 |
| `browseml-mt.wasm` | 4 | 2.96 | 1.91 |
| `browseml-mt-relaxed.wasm` | 4 | **5.16** | **2.71** |

The f16 and attention SIMD (`wasm_simd.rs`), measured old against new, interleaved (3 rounds in both orders, load
average 1.4–2.3): writing on 2 threads with relaxed SIMD, median 2.76 against 2.31 tok/s (+19 %, ahead in 6 of 6);
on one thread, 1.62 against 1.52 (+6 %, ahead in 5 of 6, at the edge of the noise). Reading a 20-token prompt
did not change beyond the noise: attention is a small share at that length.

Every build gives the oracle's answers, the same text: `browseml.wasm` 9 of 9 (`testing/oracle.mjs`),
`browseml-mt-relaxed.wasm` on 2 threads 9 of 9 (`testing/bench.mjs … oracle.jsonl 9`), and through 4 threads in
Chrome the first three likewise.

### Since 0.6.2, on the same laptop

Three recorded turns of the oracle per run (prompts of 53–85 tokens, 64 written), `browseml-mt-relaxed.wasm`, every
answer identical to the record. The raw numbers are in `testing/results/` and [efficiency.md](efficiency.md).

| release | change | threads | reading | writing |
|---|---|---:|---|---|
| 0.6.2 | measured baseline | 4 | 5.63 tok/s | 3.36 tok/s |
| 0.6.5 | the prefill tile (bankML `1781a17`) | 4 | 5.08 → 6.82 (+34%) | unchanged |
| 0.6.6 | cheaper sign lanes (bankML `1c3c16c`) | 4 | 6.72 → 7.13 (+6%) | unchanged |
| 0.6.8 | the GPU on, AMD Radeon Vega 3 through Dawn, quiet machine | 3 | 6.70–7.53 → 7.30–7.74 | 2.88–3.34 → 3.14–3.41 |

**Measuring the GPU is mostly measuring noise** (0.6.10–0.6.12). bankML calibrates the card's share at every open, and
on this machine that calibration moves 38–56% from run to run — more than any change measured since. Comparisons
of GPU changes therefore hold the share fixed (`BANKML_GPU_SHARE=0.42` through `testing/bench.mjs`) and alternate
three rounds. Held fixed, the GPU's time at 80% or 100%, a separate share for reading prompts, and the duty cycle as
fewer rows all landed within a few percent of each other (reading 5.6–6.3 tok/s, writing 2.2–2.5, 3 threads, every
answer identical). The tiled kernel is faster on the card alone (1.14–1.18× at 64–512 tokens); on a 3-compute-unit
integrated card the CPU's share of the rows, not the kernel, sets the speed.

The GPU row is the best measured so far for a card: an integrated GPU with 3 compute units, which bankML gives about
38% of the rows of the shapes it decided for the card (5 of 9 shapes). The prompt cache matters more than any of
these for the first answer of a visit: 397 prompt tokens restored in 0.6 s where reading them took 203 s.

## Where the time goes, and what is next

Profiled in 0.6.6 (`browseml-mt-relaxed.wasm`, 2 threads, one recorded turn): the per-token Q1_0 kernel
(`vec_dot_act`, writing) **55%**, the prefill tile (reading the prompt) **21%**, kernel work inlined in the pool's
workers 8.8%, attention **6.5%**, the model's sha256 at open 2.5%. Writing streams about 0.85 GB/s of weights against
about 10 GB/s of memory: it is bound by arithmetic, not memory. This laptop has 2 physical cores; past 2 threads its
hyperthreads share the SIMD units, so a visitor with more cores gains more from threads.

Next ([TODO](TODO.md)), each bit-exact: exact speculative decoding (drafts checked in one batch through the prefill
tile), attention with the tile's ideas, hashing the model while it downloads, subgroup reductions on the GPU, and the
GPU measured on discrete AMD and NVIDIA cards.

## What a visitor sees while it works

Nothing is a silent wait. In the browseML app:
- **The load, as it happens**, at the top of the control panel: a progress bar, MB of MB, MB/s, time left, elapsed, the
  source host, pieces asked for again, PAUSE · RESUME · CANCEL; a clock while bankML verifies; "ready in" with the
  download and open times; errors with what to do.
- **NOW**: the engine (ON/OFF, threads, context), writing and reading tok/s with a chart per answer, memory held and
  its peak, the prompt cache's size, the last prompt's reading time.
- **The ENGINE LOG**: bankML's own lines (verification, the GPU's verdict and share, the host and side) and the page's
  steps (download, verify, prompt cache, each receipt).
- **Under each answer**, its receipt as a closed accordion: ✓, prompt → completion tokens, tok/s; opened, every field.
- **The WARM stage** on the dials (orange with red flares) while a prompt is read.

## Limitations

What browseML does not do, or does only under conditions, at 0.6.12.

**Where it runs**
- **Threads need cross-origin isolation** (COOP `same-origin`, COEP `credentialless` or `require-corp`). Without it,
  and in Safari, the engine runs on one thread.
- **At most 8 threads.** The runtime caps the pool at 8 (`MAX_THREADS` in `web/browseml.js`) and the free-thread
  measure tries 1 to 8. A 64-thread machine still runs 8; within that cap browseML takes what it measured free, with
  one spare. Raising the cap would not change any answer (the pool's results do not depend on its size), but each
  thread is a Web Worker with its own instance and stack, and past the physical cores the gain was small on the
  machine measured.
- **Relaxed SIMD only where it is exact.** Firefox does not compile it, and a machine whose `relaxed_madd` is not
  fused gets the plain threaded build: same answers, slower.
- **The GPU needs isolation too** (the bridge waits on shared memory) and a browser that exposes WebGPU
  (`navigator.gpu`; on Linux it may sit behind a flag). Without either, the CPU computes everything, with the same
  answers. On phones the panel is not opened for the visitor (T opens it).

**The model and the engine**
- **One model in the browser:** Bonsai-1.7B Q1_0. The 8B and ternary models are for `bankml serve`.
- **One answer at a time.** A question asked while the engine writes is refused until it finishes or is stopped;
  one conversation slot is read at a time (the prompt cache keeps up to 8 prompts' slots).
- **STOP** ends an answer at its next piece, with its receipt, on an isolated page; elsewhere it ends the engine, and
  the next question loads it again.
- **Every open hashes the whole model** (2.5% of a short session), even when it was hashed before.

**Speed**
- **The CPU decides it.** About 7 tok/s reading and 3 writing on a 2-core laptop; writing is bound by arithmetic.
- **The GPU's gain is small and measured on one card.** An integrated AMD Radeon Vega 3 (3 compute units): reading
  +5–10%, writing +3–9% (medians of two rounds), through Dawn in Node. Its share is calibrated at each open and moves
  38–56% run to run on that card, which is larger than any tuning measured since. Discrete AMD and NVIDIA cards have not been measured; the headless
  browser checks run WebGPU on SwiftShader (software), which checks exactness, not speed.
- **Attention, norms and RoPE stay on the CPU;** only the 1-bit matrix products go to the card.

**Memory and storage**
- **Memory:** the engine holds 317 MB once open; the tab holds the downloaded bytes too while it opens. The keys and
  values grow with the context (470 MB at 4096). WebAssembly memory never shrinks: OFF frees it by ending the engine.
  In Node the process peaked at 636 MB (one thread) to 943 MB (four); the tab's own figure is measured only where the
  browser allows (MEASURE).
- **One copy per site:** the browser keeps the model per origin, and may evict it under pressure unless storage is
  kept (KEEP STORAGE asks).
- **Folders on this computer** need the File System Access API to be remembered: Chrome and Edge; Brave behind
  `brave://flags/#file-system-access-api`; Firefox and Safari read a folder for that visit only.

**Sources**
- **Two verified sources:** Hugging Face and browseML/models (Git LFS, 10 GiB a month for a free organisation).
  Self-hosting, IPFS and peer to peer are not built yet.
- **The download comes in 16 MB pieces** (HTTP Range), each retried from the byte where it was cut: Brave on Linux cut
  the single 248 MB response mid-body where curl got the whole file. A server that ignores Range is read as one stream.
