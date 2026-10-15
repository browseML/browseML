# browseML — what comes next

Each item says what it is, what it needs, and how it will be checked. Done items move to the CHANGELOG with their
measurements. The rule throughout: a source, a kernel or a feature joins only when it is verified.

## Sources — where the model comes from

browseML takes a model from any source, and the sha256 pin decides. Two verified sources today:
[Hugging Face](https://huggingface.co/prism-ml/Bonsai-1.7B-gguf) and [browseML/models](https://github.com/browseML/models)
(each piece is asked of the source that answered last; a retry moves to the other).

**Limits, measured 2026-10-13.** Hugging Face serves the model at its pinned revision (CORS, Range). browseML/models
serves it through Git LFS (`media.githubusercontent.com`: CORS, Range) — metered: 10 GiB of LFS bandwidth a month for a
free organisation (~40 full downloads; with a $0 budget LFS is blocked for the rest of the month, not billed), so it is
the second source, not the first. GitHub Release assets are not metered the same way but send no
`Access-Control-Allow-Origin`: a page cannot read them. **Self-hosting** joins as a third source under the same pin.

| module | what | checked by |
|---|---|---|
| **Self-hosted** | the model on browseML's own host (CORS + Range), a third source beside Hugging Face and GitHub | the pin, as for every source |
| **Folders on this computer** | **done**: models found in folders the visitor grants (gguf, Ollama and Hugging Face blobs named by sha256), persistent access as a toggle | `classify()` and the pin |
| **IPFS** ([helia](https://github.com/interplanetaryfilesystem/helia), [ipfs-car](https://github.com/interplanetaryfilesystem/ipfs-car)) | the model by its content address (CID) from IPFS peers and gateways; its CID recorded in the pin beside the sha256 | the CID recomputed in the page, then bankML's sha256 |
| **Peer to peer** (WebRTC) | a browser that has the model serves it to another (same room, a signed offer); [wave-share](https://github.com/interplanetaryfilesystem/wave-share) for tiny files | each piece's hash against a piece list in the pin, then the whole sha256 |
| **Folder import** (File System Access API) | a whole folder of models chosen once (bankML's `.models`, Ollama's blobs), recognised by size and sha256 | `recognise()` (done for a single file) |
| **Origin Private File System** | the model and warm slots in OPFS (faster than Cache Storage for large files). **Measured, inconclusive (0.8.0)**: 248 MB in headless Brave, the first read 26 s from Cache Storage against 5.8 s from OPFS, later reads 1.4–3.3 s either way, the OPFS write 99 s on a full disk; a fair cold-read comparison needs the system's file cache dropped | read back and hashed |
| **More models** | Ternary-Bonsai, SmolLM2 in `browseML/models`, each with its pin and `verify.mjs --source` | the oracle per model, as bankML |

## Speed — in bankML, each change bit-exact ([efficiency](efficiency.md))

**Where a token's time goes** (profile, `browseml-mt-relaxed.wasm`, 2 threads, one recorded turn, 2026-10-13): the
per-token Q1_0 kernel (`vec_dot_act`, writing) **55%**, the prefill tile (`mat_mul_act_rows`, reading the prompt)
**21%**, kernel work inlined in the pool's workers 8.8%, attention 6.5%, the model's sha256 at open 2.5%. Writing
streams ~0.85 GB/s of weights against ~10 GB/s of memory: it is bound by arithmetic, not memory.

| step | what | measured | checked by |
|---|---|---|---|
| WebAssembly prefill tile | **done** (bankML `1781a17`): one row decoded once for four prompt tokens | reading +34% (5.08 → 6.82 tok/s, 4 threads) | `wasm_act_tile_bit_exact`, the oracle |
| cheaper sign lanes | **done** (bankML `1c3c16c`): 0/1 lanes in 3 operations, not 5 | reading +6% (6.72 → 7.13); writing unchanged | the same test, now also per-token, the oracle |
| GPU in the forward pass | **done** (0.6.7–0.6.8): the 1-bit matmuls shared with the visitor's card where bankML measured it faster | quiet machine, Vega 3, 3 threads: reading 6.70–7.53 → 7.30–7.74, writing 2.88–3.34 → 3.14–3.41 tok/s | 12 of 12 answers identical with the GPU on |
| exact speculative decoding | a few tokens drafted (n-gram from the prompt, or a smaller model), checked in one batch through the prefill tile; greedy and seeded sampling give the same tokens, only faster when drafts are accepted | **simulated first, not built (0.8.0)**: prompt-lookup drafts (n = 3, k = 4) on the 9 recorded oracle turns and a browseML answer from its own 500-token prompt, at this laptop's costs (a token written ≈ 1/3 s, read in a batch ≈ 1/7 s): 50 of 427 tokens accepted, ×1.04 overall, ×1.13 on the browseML answer. Worth building with a draft model, or where reading is much cheaper than writing (a GPU) | the oracle, token for token |
| 2-row tile for writing on WebAssembly | **measured, not kept**: two rows against one activation, bit-exact, but no faster (writing 2.97 → 2.88 tok/s, 4 threads, two alternating runs) — as on x86; the per-row arithmetic, not the activation's loads, is the cost | 2.97 → 2.88 | `wasm_act_tile_bit_exact` (with the tile) |
| attention | f16 K·Q and V with the tile's ideas; 6.5% today, more at long contexts | — | the attention kernels' references, the oracle |
| the sha256 at open | 2.5% of a short session: hash the pieces as they download (overlapped, not after); a kept copy is still hashed in full at every open | — | the whole file's sha256 against the pin, unchanged |
| threads | **done** (browseML 0.6.5): the free threads measured, claimed with one spare | 4 free / 3 claimed where Brave reported 2 | `availableFrom`, the browser checks |

## GPU — WebGPU, exactly ([browseML/webgpu](https://github.com/browseML/webgpu))

| module | what | checked by |
|---|---|---|
| Q1_0 · q8_0 mat-vec | **done**: WGSL, exact FMA, `exact()` against bankML's reference | 832/832 rows bit-exact; controls fail (110/256) |
| exact on real AMD | **done** (0.6.6): TwoSum hidden from the driver's simplifier (`hide`); checked on a Radeon Vega 3 through Dawn | `testing/gpu.mjs`: every result, every shape |
| the fast kernel, many tokens, vendor workgroups | **done** (0.6.6): eight lanes per row, a token dimension, 64 AMD / 32 NVIDIA | the same bits at 32/64/128; 6.5× the simple kernel |
| bankML's GPU worker on WebGPU | **done in bankML** (`2c8192d`): `compute_webgpu.rs` behind the host's `bankml_gpu_*` imports; the on-card oracle and calibration unchanged; browseML's bridge (`browseml-gpu-host.js`, Atomics + a GPU worker) | through Dawn on the Vega 3: oracle passed, a share calibrated, 12 answers identical on and off |
| the page | **done** (0.6.7): `browseml-gpu-worker.js` on `navigator.gpu`, started by the engine worker with threads; every host given the imports; the GPU switch (OFF · LOW · HIGH) chooses it and APPLY restarts; bankML pinned at `a32f81c` | the browser checks (on "ready"), the oracle with the GPU on |
| the card was never used | **fixed in bankML** (`f383258`): the limiter read the available RAM from `/proc`, which a browser lacks, so an integrated card never got a matrix; now the heap's limit alone | through Dawn: 539 products on the card, 3 of 3 answers identical |
| prompt reading on the GPU, grouped submissions | **done in bankML** (`f383258`, `a32f81c`): `begin_many` / `finish_many` (the kernel's token dimension), `begin_group` / `finish_group` (Q/K/V and gate/up at once, one wait) | through Dawn, Vega 3, 3 threads, alternating: reading 5.05 → 5.41 and 5.10 → 5.60 tok/s, writing unchanged, 12 of 12 identical |
| the kernel is bankML's | **done** (`f383258`, `gpu/wgsl.rs`): the engine hands the GPU worker the shader and the vendor's workgroup; `testing/gpu.mjs` checks `browseml-gpu.js`'s copy is the same text | `testing/gpu.mjs` |
| back to the server's card | **done in bankML** (`bbe7419`, `f618309`): the token dimension in SPIR-V (`q1_0_mat_mul8`) and grouped submissions on Vulkan (four in flight); browseML 0.6.8 pins it | `bankml gpu --verify` and `gpu_submissions_in_flight` bit-exact; native answers byte-identical, speed-neutral on the 3-CU APU |
| bankML knows browseML | **done** (`f383258`, `host.rs`, `bankml hosts`): browseML is a client host, bankML serve a server host; the engine names itself at open and the page logs host and side | `host::tests` |
| discrete AMD and NVIDIA | measure on real cards (writing and reading); the calibration keeps the CPU wherever the card is slower | A/B per card; answers identical |
| a token tile for prompts | **done** (0.7.0, bankML `8f5e930`): `Q1_0_MM4`, four tokens per invocation | the kernel 1.14–1.18× at 64–512 tokens, bit-exact; the engine within the noise |
| EXACT on the engine's kernels | **done** (0.7.3): the fast and tiled kernels on five tokens, every result against bankML's reference | the browser checks; browseML/webgpu's page |
| what the card did, in DIAGNOSTICS | **done** (0.7.4): bankML's limiter after each answer — share, busy, products, shapes | the browser checks |
| measuring the GPU | the share is re-calibrated at every open and moves 38–56% run to run, more than any change measured; compare with `BANKML_GPU_SHARE` fixed. Tried with the share fixed, not kept: a second share for reading, the GPU's time at 100% as a speed-up, the duty cycle as fewer rows ([efficiency](efficiency.md)) | three alternating rounds, answers identical |
| f16 attention, RoPE, norms in WGSL | the rest of the layer, each against its scalar reference | per-kernel exactness + the oracle |
| subgroups | faster reductions where `subgroups` exists, the same reduction order | the same tests |

## Receipts banked — the ledger (bankML first, then browseML)

Asked 2026-10-14: bankML banks the token usage and the prompt/response receipts, exact to 18 decimal places, ready for
a blockchain by default, the chain an extensible module (iNFT and THOT), and the same counting for external inference.

| module | what | checked by |
|---|---|---|
| **amounts to 18 decimals** | token counts and costs as integers of 10⁻¹⁸ (as ERC-20's `uint256` with 18 decimals): parsed and printed exactly, checked arithmetic, never a float | unit tests: round trips, carries, overflow refused; the same vectors in Rust and in the page (BigInt) |
| **the ledger** | each receipt banked as an entry: model sha256, request and response sha256, prompt / completion / total tokens, cost at the entry's rate, the source, the time; each entry's hash (keccak256, the EVM's) covers the previous one's, so the head commits to all | append and re-verify; a changed entry breaks the chain at that entry |
| **server and client** | bankML serve banks to a file beside its slots; browseML banks in the visitor's browser (`.history` / `.memory` keep the receipts as today), the same format | the same vectors on both sides |
| **external inference** | an entry's source: bankML here, or an external provider with the counts it reports and its own rate; totals per source | entries from a recorded external response |
| **blockchain-ready, by module** | a connector interface: none by default (the ledger stands alone); THOT (`sAGI/thot.py`: the ledger's head as a commitment in the bundle) and iNFT (`sAGI/chain.py`: an unsigned transaction anchoring the head, the owner signs) as the first two; never signed or sent by bankML itself | THOT's spec vectors; the devnet mint path as in bankML 0.1.0 |

## Monitoring, the CPU and the GPU

| module | what | checked by |
|---|---|---|
| **the monitor** | **0.8.1**: battery, network, CPU pressure, the main thread's lag and long tasks, memory, what the card did, the engine's live speed — live, by the browser's events and one tick a second | the browser checks |
| **graphics cards recognised** | **0.8.1**: vendor, model, integrated · discrete · software · handheld, from WebGPU's adapter and WebGL's renderer | unit tests on real renderer strings |
| **battery limiter** | **0.8.1**: rest the fire effect on battery — unarmed by default | the browser checks |
| **handheld GPUs** (Adreno, Mali, Apple) | the engine's workgroup per vendor on handhelds (subgroups of 16–128), the page's layout at phone width, measured on a phone | the kernel's bits per vendor; the oracle |
| **CPU and GPU speed** | carry on: discrete AMD and NVIDIA measured, subgroups, f16 and attention on the card; each A/B with the GPU share held fixed | answers identical |

## The organisation's repositories

| repository | what it holds | first step |
|---|---|---|
| [browseML/models](https://github.com/browseML/models) | verified model copies, pins, `verify.mjs --source` | **done** |
| [browseML/persona](https://github.com/browseML/persona) | browseML's personas (`.persona` v1), the validator, the facts the FAQ is answered from | **started**: the persona, a 600-token budget, 4 tests |
| browseML/voaices (private) | voice in the browser: only verified answers spoken, on-device voices only | **started**, private as a reminder; continued at [cryptoAGI](https://github.com/cryptoAGI) |
| [browseML/embeddings](https://github.com/browseML/embeddings) | search in the browser: BM25 as Savante scores it, RRF; an embedding model next | **started**: BM25 equal to Savante's to 1e-12, 4 tests |
| [browseML/webgpu](https://github.com/browseML/webgpu) | the exact WGSL kernels and their tests | **started**: the Q1_0 kernel, bit-exact, and its test page |

## The page

- Deploy this runtime (two sources, the prompt cache, STOP, the control panel) to the Hugging Face Spaces
  (PYTHAI/browseML and the others), with the operator's go-ahead.
- Contribution, proven: node-issued challenges answered bit-exact, as decided for SHAMBA LUV rewards (proven work only,
  operator-settled).
