# Efficiency — measured, and what to optimise next

Measured 2026-10-13 on an AMD Ryzen 3 3200U (2 cores × 2 threads, 5.8 GB RAM, a nearly full disk), browseML v0.6.2,
Bonsai-1.7B Q1_0, three recorded turns of the oracle per run — every answer identical to llama.cpp b11192's record.
The raw numbers: [`testing/results/measure-v0.6.2.txt`](../testing/results/measure-v0.6.2.txt). Nothing here is an
estimate unless it says so.

## Speed and cost

| engine | threads | reading the prompt | writing | wall time | CPU time | peak memory (process) |
|---|---:|---:|---:|---:|---:|---:|
| `browseml.wasm` (SIMD) | 1 | 1.97 tok/s | 1.40 tok/s | 4:12 | 250 s | 636 MB |
| `browseml-mt-relaxed.wasm` | 2 | 5.02 tok/s | 2.79 tok/s | 1:56 | 217 s | 910 MB |
| `browseml-mt-relaxed.wasm` | 4 | 5.63 tok/s | 3.36 tok/s | 1:40 | 333 s | 943 MB |
| `browseml-mt.wasm` (plain SIMD) | 4 | 3.74 tok/s | 2.52 tok/s | 2:18 | 482 s | 938 MB |

- **Relaxed SIMD pays:** at 4 threads it reads 51% faster and writes 33% faster than plain SIMD, for 31% less CPU
  time — with the same answers, bit for bit. browseML already picks it where it compiles.
- **Half the threads, most of the speed:** 2 threads write at 83% of 4 threads' speed with 35% less CPU time. On this
  2-core machine the second thread of each core adds little. The usage diagnostics now say so (below).
- **The prompt cache is the biggest win measured:** 397 prompt tokens read in 203 s on one thread, restored from the
  kept slot in 0.6 s; the first answer of a visit went from 259 s to 57 s (`testing/slot.mjs`).

## Memory

- The engine's WebAssembly memory is **317 MB** once open (the 248 MB model mapped once, not copied: bankML's
  `gguf::Mmap`). The usage diagnostics report this number.
- The process holds more: **636 MB** on one thread, **910–943 MB** with threads. In this harness that includes the
  model bytes Node read to hand to the engine and the threads' shared memory; how much of it a browser tab holds is
  not measured here. The tab's real cost is between the two. MEASURE in the dials reads it where the browser allows
  (`measureUserAgentSpecificMemory`).
- **Context:** the default is 4096 tokens, which caps the keys and values at 470 MB; the longest exchange measured held
  149 tokens. The diagnostics already advise a 1024-token context (117 MB) from what was actually used.

## The disk — locally and from browseML's side

- **One copy per site.** A browser keeps browseML's model per origin, so every address it was served from holds its own
  248 MB. On this machine, Brave's default profile held **7 copies (≈ 2.1 GB of its 2.3 GB Cache Storage)**, one per
  localhost port and Space it was tried on. For visitors that is one site and one copy; for development, serve from
  one fixed port, and clear old ports' site data.
- **The same file several times on disk:** the model is in `browseML/models/` and again in that repo's Git LFS store
  (`.git/lfs`, 237 MB), likewise in `browseML-models`, and in bankML's `.models`. A hard link (as the browser checks
  do) or one shared directory avoids the copies.
- **Room before the download (new):** browseML now checks the browser's quota for the site before pulling the model,
  and says how much room is left, instead of failing at the end after 248 MB.
- **HARD DRIVE (new):** shows the room left for the site, and when the model is on the disk twice — a remembered
  folder's copy and the browser's — offers FREE THE BROWSER'S COPY (and reads it from the folder each visit).

## Usage diagnostics, on these records

From `app/src/bankml/usage.ts` (the advice the control panel shows from what ran in the visitor's browser):

```
warn 2 threads wrote 2.82 tok/s, 82% of 4 (3.42) with half the threads: this computer's cores likely share in pairs — 2 leave it free for the rest, 4 for the most speed
ok   the engine took 317 MB at most, 8% of the 4 GB this device reports
ok   the longest exchange held 149 of 4096 tokens: a 1024-token context would hold it with room, and cap the keys and values at 117 MB instead of 470 MB
ok   the prompt cache: 397 prompt tokens restored in 0.6 s, where reading them took 203 s
```

The first line is new in 0.6.2. Before, the advice offered fewer threads only within 10% of the fastest, so it said
"4 threads, fastest" and nothing about what they cost.

## 0.6.5: the prefill tile

bankML `1781a17` gives WebAssembly the tile x86 already had: a weight row decoded once for four prompt tokens, the
same bits. A/B on the same machine (`browseml-mt-relaxed.wasm`, 4 threads, three recorded turns, two alternating runs
each): reading **5.08 → 6.82 tok/s (+34%)**; writing unchanged (2.80–3.08 tok/s, noise); all answers identical.

## What to optimise next, by what it would save

1. **Read the prompt in bigger tiles (bankML).** Done for four tokens per row in 0.6.5 (+34%); wider tiles and
   sharing the activation scales are next.
   *Earlier finding:* **read the prompt in batches.** Reading runs at only 1.4–1.8× the writing speed. Batched engines read
   many times faster than they write, because a batch reuses each weight row across many tokens. A batched Q1_0
   matrix–matrix kernel, bit-exact like the rest, would cut the first answer of a visit the most; it is the one
   number users wait on.
2. **Default the context to what is used:** 1024–2048 tokens instead of 4096 would save 230–350 MB on small devices.
3. **Default threads to the cores, not the threads,** where the measurement shows pairs (as above). The advice now
   says it, and APPLY sets it.
4. **Measure the tab, then drop any copy of the model the page still holds** once the engine has it (to check:
   MEASURE in a browser), to bring the tab closer to the engine's 317 MB.
5. **The GPU:** the Q1_0 kernel is bit-exact on WebGPU (`EXACT`), but not yet in the forward pass.
