# RENDER_RUST: the DeltaVerse / rage audio render in Rust

**Status: an exploration and design, plus a scratch proof of concept (`render/`, uncommitted, not wired into
browseML).** Written 2026-10-12. Every figure below says whether it was **measured** (where, how) or **estimated**
(from what).

The question was: should the Python render pipeline that voices the rage articles (NEURAL, JAIMLA, OVERLORD, SAVANTE)
be rebuilt in Rust, so that it runs natively on the VPS and as WebAssembly in browseML or voaice? The OVERLORD voice
costs 3.66 times as much wall time per word as NEURAL, and its DSP and alignment layer looked like the obvious place
to start.

**Short answer:**

* **Rewriting the DSP in Rust will not make the server meaningfully faster.** Production's DSP already runs as
  compiled code: numba for the loops, pocketfft (C) for the FFTs. Measured, it takes about 8% of OVERLORD's CPU. The
  other ~90% is two piper (VITS) inferences per sentence.
* **The big server-side gains don't need Rust:**
  1. Find out where the time actually goes. The code accounts for about 2.3× NEURAL, but production measures 3.66×.
  2. Keep one piper process per voice per article instead of two spawns per sentence.
  3. An operator decision: build OVERLORD from the NEURAL and JAIMLA audio that the queue already renders for the same
     article.
* **The Rust crate is worth building for portability.** One exact implementation of the OVERLORD and SAVANTE signal
  chain, callable from Python on the server (C ABI + ctypes, the way docspeech already calls libsndfile) and from a
  browser worker as wasm32. The proof of concept shows it can be held **bit-exact** to the Python reference where no
  FFT is involved, natively and in wasm, and to **≥ 280 dB SNR** where an FFT is involved.

---

## 1. Where the time goes

### 1.1 What each renderer does (from reading the code)

| renderer | synthesis | DSP | encode |
|---|---|---|---|
| `render_neural.py` | docspeech `Piper.synth`: **one piper subprocess per block** (en_GB-alan-medium, pinned to 1 core, niced) | none | docspeech `encode_ogg`: chunked linear resample 22050 → 24000 Hz in Python, then system libsndfile Opus via ctypes |
| `render_jaimla.py` | **one piper subprocess per block** (en_GB-jenny_dioco-medium, rate 168; pitch is reached by declaring the rate) | none | `opus_pipe`: raw PCM piped to `opusenc --bitrate 24` (its resampler applies the declared-rate pitch) |
| `render_savante.py` | docspeech `Layered`, single-layer path: **one piper subprocess per block** (en_US-kristin-medium, speed 0.939, pitch 0.927 → declared at 20440 Hz) | `_eq`: one whole-block rFFT EQ, `tanh` soft knee, peak normalise | `encode_ogg`: resample 20440 → 24000 in Python, libsndfile Opus |
| `render_overlord.py` (v4) | **two piper subprocesses per *sentence*** (alan ×1.10 pace with noise 0.45/0.55; jenny), via a raw `subprocess.run` that is neither pinned nor niced | per sentence: `pitch_shift` of the body by −1 (resample + WSOLA), `exciter`, `align_map` (log-mel ×2 + DTW), `warp` of jenny (WSOLA), `residual_lag_ms` (log-mel ×2 + DTW again, a diagnostic only), octave divider f/2 and f/4, overtones \|z\|cos(nθ), `offset_samples` ×3 (a diagnostic only), the fifth (`pitch_shift` −7 + lowpass), low shelf. Per document: streamed `finish_document` (hall overlap-add, hop-level compressor, int16) | `opus_pipe` → opusenc |

Production numbers (from the queue's own `queue.json`, given in the brief): wall seconds per word are **neural 0.564,
jaimla 0.588, savante 0.519, OVERLORD 2.063**. `render_ledger.py` also records **0.81 CPU-s per audio-second** for
SAVANTE (piper + EQ + encode), measured on production.

### 1.2 Measured locally (this box, not the VPS)

The machine was an AMD Ryzen 3 3200U (2 cores / 4 threads, AVX2, no AVX-512), heavily loaded (load average 3.4–7.6
during the runs). Every run was `nice -n 10` and pinned to one core with `taskset`. Treat the absolute numbers as
noisy. The **ratios** are what carry over.

**OVERLORD v4 DSP, one sentence.** The input was 5.16 s of audio, 19 words, rendered with piper en_GB-cori-high
(public domain). A second take with different length and noise stood in for jenny. Steady state, mean of 3 runs, after
warm-up. Script: `scratchpad/scripts/prof_overlord.py`; it calls `overlord_dsp.py` unchanged.

| stage (per sentence) | numba 0.68 | numba absent (`NUMBA_DISABLE_JIT=1`) |
|---|--:|--:|
| harmonic_overtones | 126 ms (19%) | 117 ms |
| offset_samples ×3 *(diagnostic)* | 115 ms (17%) | 100 ms |
| fifth: pitch_shift −7 + lowpass | 89 ms (14%) | 19,871 ms |
| warp jenny (WSOLA) | 88 ms (13%) | 20,887 ms |
| pitch_shift body (resample + WSOLA) | 71 ms (11%) | 24,819 ms |
| align_map (log-mel ×2 + DTW) | 41 ms (6%) | 372 ms |
| residual_lag_ms *(diagnostic: log-mel ×2 + DTW again)* | 38 ms (6%) | 319 ms |
| octave_divider f/2, f/4 | 30 + 29 ms | 30 + 28 ms |
| exciter, low_shelf | 23 + 8 ms | 23 + 8 ms |
| **total** | **0.662 s = 7.8× realtime = 0.128 CPU-s per audio-s** | **66.6 s = 0.08× realtime** |

The per-document stages: `finish_document` on 60 s took **0.36 s (167× realtime)**. The libsndfile Opus encode of the
same 60 s, including docspeech's Python resample, took **1.43 s (42× realtime)**.

**piper (C++ 1.2.0 + onnxruntime 1.14.1, en_GB-cori-high, 114 MB, the only voice on this box).**
* A one-word run took 2.2–3.5 s wall, which is mostly model load.
* The 5.16 s sentence took 9.6–10.6 s wall (piper's own log: infer 8.5 s, RTF 1.72).
* Five sentences as five processes took 62.6 CPU-s; the same five as one process (`--output_dir`) took 58.2 CPU-s.
  That is ≈ 1.1 CPU-s per extra spawn, which is noisy. A medium model is about half the size, so expect less.

**Note on "user > wall".** Even under `taskset`, piper's user time exceeded its wall time. onnxruntime sets its own
thread affinity, so a single-core mask does not hold it to one core. Note it for the "no interruption" gate below.

### 1.3 What that means on production (estimated)

| component, per audio-second of body | NEURAL | OVERLORD |
|---|--:|--:|
| piper inference (≈ SAVANTE's measured 0.81 CPU-s/audio-s minus EQ and encode) | ~0.75 | ~0.75 alan + ~0.75 jenny, both at ×1.10 pace |
| piper spawns | 1 per block (~18 words) | 2 per sentence (~12–15 words) |
| DSP | 0 | ~0.13 (the local numba figure; the VPS Xeon is probably faster) |
| finish + encode | ~0.03 | ~0.03 |

**From the code, OVERLORD should cost about 2.2–2.4× NEURAL.** The two piper inferences account for ~90% of its CPU
and the DSP for ~7–8%. **Production measures 3.66×**, so about a third of OVERLORD's wall time is not accounted for by
reading the code. The candidates, none of them verified:

* the per-sentence spawns, which are double NEURAL's and unpinned;
* v3 renders still inside the 30-render median, with their whole-document float64 finish and memory-reclaim stalls
  (rage-1548 stalled for 19 h);
* contention with the trainer;
* numba missing on production.

**Is numba on production? Inferred yes, not verified.** Without numba, the v4 DSP alone measured 12.9 CPU-s per
audio-second here, about 5 CPU-s per word. That cannot fit inside a 2.063 s/word total on a 2-vCPU host under a CPU cap.
**Open question for the operator:** run `/home/mindx/mindX/.mindx_env/bin/python -c "import numba"` on the VPS. If it
fails, `pip install numba` is a roughly 100× speedup on WSOLA, and that should come before any Rust.

**Recommended first step (Python, no Rust): instrument.** Wrap each stage of `render_overlord.py` in
`time.process_time()` and `time.perf_counter()`, and write `timing.cpu` and `timing.wall` per stage into the manifest:
piper alan, piper jenny, align, warp, layers, fifth, finish, encode. That costs nothing, and the next render then
answers what the code reading cannot.

---

## 2. Options for each stage in Rust

### 2.1 VITS / piper inference (90% of the cost)

| option | native | wasm32 | exactness | verdict |
|---|---|---|---|---|
| **`ort` crate** (onnxruntime bindings) | same engine as today, so **same speed** | no: onnxruntime is native C++ (the browser equivalent is onnxruntime-web, a JS package) | identical to piper (same ORT) | buys nothing on the server except removing the subprocess |
| **piper's own process, kept alive** (`--json-input` / `--output_dir`, or piper-tts's Python `PiperVoice` in-process) | removes the per-sentence model load | n/a | identical | **do this first: a Python change** |
| **tract** (pure Rust ONNX) | usually slower than ORT on convolution-heavy graphs | yes (pure Rust; SIMD128) | f32, op order differs | VITS's `RandomNormalLike` and other ops would need checking |
| **RTen** (pure Rust ONNX) | a piper discussion reports it running piper voices, ~2 MB binary, wasm32-wasi via wasmtime, without the phonemizer ([piper#504](https://github.com/rhasspy/piper/discussions/504)) | yes | f32 | **the best ready-made candidate for the browser** |
| **candle** | no complete ONNX importer for VITS; a hand rewrite into candle | yes (wasm, SIMD) | own | no advantage over a hand port |
| **existing crates**: [piper-rs](https://lib.rs/crates/piper-rs) 0.1.9 (docs.rs build failing), [piper-plus](https://github.com/ayutaz/piper-plus/) (ONNX Runtime; a wasm feature and its own G2P), piper1-rs (libpiper bindings, Linux only) | | | | none is zero-dependency and none is exact; useful as references |
| **a hand port, bankML / voaice.rs style** (text encoder, duration predictor, flow, HiFi-GAN decoder in our own kernels) | the only route that could **beat ORT** (voaice.rs runs the whisper encoder 3.7× faster than whisper.cpp at one thread) | yes, with relaxed SIMD where exact | oracle = ORT on the same `.onnx` | **the long-term route; months, not days** |

Browser JavaScript packages for piper/VITS also exist and are useful references:
[piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web) and
[vits-web](https://github.com/diffusionstudio/vits-web) (both onnxruntime-web).

**Exactness trap.** VITS injects noise (`noise_scale`, `noise_w`) from the graph's own random op, so **piper is not
deterministic run to run**, and a golden output of the synthesis is impossible as shipped. Any oracle needs one of:

* the `.onnx` re-exported with the noise as an input tensor (golden noise in, golden audio out), or
* tests at `noise_scale = 0`.

This is the first thing to establish before any VITS port claims "exact".

### 2.2 Phonemisation (the hard part for wasm, and a licence question)

piper uses espeak-ng IPA through piper-phonemize. espeak-ng is **GPL-3.0-or-later**; browseML is MIT OR Apache-2.0.

| option | notes |
|---|---|
| espeak-ng compiled to wasm (espeakng.js exists) | works, ~1–2 MB with data. Shipping it makes that artefact GPL; it would have to be a separate, separately-licensed module. |
| a rule- or lexicon-based G2P (piper-plus's approach) | MIT-friendly, but **not the phonemes the voice was trained on**, so it is a different voice. Fails the exactness bar by construction. |
| **server-side phoneme IDs (recommended)** | the server already runs espeak-ng 1.51 (visemes, docspeech). It publishes, per article, the phoneme-ID sequence piper would feed the model (one small JSON sidecar beside `manifest.json`, keyed by `docHash`). The browser runs only the network. No espeak in the browser, no GPL artefact shipped, phonemes identical to the server's by construction, and the article text is public anyway. Free text in the browser would still need a G2P; that is a later, separate decision. |

### 2.3 DSP (DTW, WSOLA, Hilbert, FFT filters, hall, compressor)

* **FFT.** `rustfft` / `realfft` are the fast, mature choice (SIMD for AVX/NEON/wasm-simd128). The house doctrine
  (bankML, voaice.rs, streamair) is zero crates, so the proof of concept carries its own FFT: radix-2, a half-size real
  transform, and Bluestein for the arbitrary-length `analytic`. Neither can be bit-exact against numpy's pocketfft,
  because the butterfly order differs. Hold FFT stages to an SNR bar (§3.2).
* **WSOLA** is 37% of the numba DSP (three calls per sentence). Its hot loop is 353 candidate offsets × 176 taps per
  hop. It can be vectorised **without breaking bit-exactness** by putting **different candidates in different SIMD
  lanes**: each candidate's sum keeps the reference's sequential order. Vectorising inside one dot product would
  reassociate the sum and change the bits. Estimated 2–4× on AVX2 / simd128.
* **Shared work, exact and possible in Python too.** octave f/2, octave f/4 and the overtones each recompute
  `fundamental`, `envelope` and `voiced_gate` of the same body: 3× the same three FFT filters. Compute them once.
  `offset_samples` ×3 and `residual_lag_ms` are manifest diagnostics, 23% of the DSP; sample them (e.g. every 8th
  sentence) or compute them from the alignment already done.
* **DTW** is cheap (2 ms per sentence). For block-level alignment (option R2 below), a banded DTW keeps memory bounded.
* **wasm32.** All of the above is plain f64 arithmetic plus `cos`, `sin`, `tanh`, `atan2`, `hypot`, `pow`. Two caveats:
  * wasm32 lacks f64 FMA (none of this needs it; the reference uses none).
  * Rust's wasm32 `cos` and friends are a libm port, not glibc. That matters, see §3.2.

  Memory is ~10 f64 copies of one sentence (≈ 10 MB), well inside wasm32's 4 GB. `finish_document` is already
  streamed and holds one f32 copy of the document plus int16.

### 2.4 Opus encoding

| where | option | notes |
|---|---|---|
| server, native | `audiopus` / `opus` crates (libopus FFI) | the same libopus 1.4 the server uses through libsndfile / opusenc, so byte-identical given the same settings and resampler |
| server and browser | **streamair** (`~/cryptoAGI/streamair`, zero-dependency) | already writes the **Ogg/Opus container**, proven against opus-tools 0.2 / libopus 1.4. Its own CELT encoder is its roadmap's 0.1.0, not done. **Use it as the muxer today.** |
| browser | WebCodecs `AudioEncoder` (`codec: "opus"`) | native speed, zero download, but the bytes are the browser's libopus build, not the server's. Fine for listening, not a bit-exact artefact. Raw packets go into streamair's Ogg writer. Check Safari support before relying on it. |
| browser, exact | libopus compiled to wasm (BSD, ~300 KB), **fixed-point build** | the fixed-point build is the one whose bytes do not depend on the platform's floating point |

One encoding difference matters for exactness on the server too. NEURAL and SAVANTE encode through libsndfile after a
**Python linear resample** to 24 kHz. JAIMLA and OVERLORD use opusenc's own resampler. A Rust path has to name which
one it reproduces.

---

## 3. Recommendation

### 3.1 Order of work, by return

| # | change | language | expected effect | voice changes? |
|---|---|---|---|---|
| R0 | instrument per-stage CPU and wall into the manifest; check numba on the VPS | Python | finds the missing ~35% | no |
| R1 | one piper process per voice per article (no per-sentence spawns), pinned and niced like docspeech | Python | **estimated** −5…15% of OVERLORD wall (spawn cost not measured on prod) | no (same model, params, text) |
| R1b | compute `fundamental`/`envelope`/`gate` once; sample the diagnostics | Python | DSP −~40%, **≈ −3% of OVERLORD** | no (exact refactor) |
| R2 | **build OVERLORD from the NEURAL and JAIMLA PCM** the queue already renders for the same article (alignment per block or per split sentence, banded DTW) | Python | OVERLORD's marginal cost from ~3.66× NEURAL to **~0.2–0.3×** (DSP + encode only) | **yes**: v4's pace ×1.10 and noise 0.45/0.55 would come from DSP (WSOLA stretch) or be dropped. **Operator decision.** |
| R3 | **`overlord-dsp` Rust crate**: the v4 chain (and SAVANTE's EQ + soft knee) exact against the Python reference; a C ABI called from Python via ctypes, and wasm32 for a browser worker | Rust | **server: ~1× as ported** (measured, §3.3); 2–4× DSP after the exact SIMD work (estimated), so ≈ −5% of OVERLORD wall. **Browser: makes the DSP shippable at all.** | no |
| R4 | browser SAVANTE: kristin VITS in a worker (RTen first, a hand port later) on server-provided phoneme IDs → R3's EQ → WebCodecs Opus or libopus-wasm → streamair Ogg | Rust + JS | renders move to the listener's CPU for the **open** voice only | no |
| R5 | a hand-ported VITS (bankML discipline) | Rust | the only route to beating ORT on the server; unknown until measured | no |

**Port first: the OVERLORD DSP (R3), as the PoC began.** It is ours (no licence issue), self-contained, small (~900
lines with tests), and the piece both targets need. Be honest about why: it is **not** the server speed fix. R0–R2 are.
It is the portable, verified core that browseML or voaice can carry, the substrate for an open-voice browser render
(R4), and the place where "exact before fast" can be shown end to end.

**Licence line (hard).** alan, jenny, lessac and anything fine-tuned from lessac never leave the server, so NEURAL,
JAIMLA and OVERLORD **bodies** are server-only forever. In the browser the crate may carry:

* the OVERLORD DSP, applied to open voices only. A browser "OVERLORD-open" would need open bodies, for example the
  public-domain en_US-bryce / john / norman (male) and kristin / cori (female). That is a **different, separately
  named** voice, never OVERLORD.
* SAVANTE (kristin, public domain via PYTHAI/voaice).

The crate must never fetch a restricted `.onnx` in a browser build. Enforce that in code: an allowlist of model sha256s
taken from `voaice/piper-voices.json` entries whose licence is public domain / CC0 / CC-BY.

### 3.2 Exactness: how it stays verifiable (bankML's "exact before fast")

1. **Goldens come from the reference itself.** `render/tools/golden.py` runs `overlord_dsp.py` unchanged (numpy +
   numba, like production) on a fixed input and writes every intermediate as little-endian f64/i64. The Rust tests
   read those files. When the Python changes, regenerate; a Rust change is accepted only against them.
2. **Three bars, per stage:**
   * **E0, bit-exact.** Stages with no FFT inside: WSOLA, DTW (the path), `np.interp` on an integer grid,
     `np.linspace`, `pitch_shift`, `np.hanning`. Same operations in the same order, no FMA contraction (numba without
     fastmath has none). **Measured: 0 differing bits natively.**
   * **E0-events, exact.** Integer decisions taken after an FFT: the divider's zero-crossing indices, the argmax
     inside `offset_samples`. A moved crossing flips the square for a whole cycle, so events must match exactly even
     where samples only match to an SNR.
   * **E1, SNR ≥ 100 dB.** Stages through an FFT: `fft_filter`, `fundamental`, `envelope`, `gate`, `analytic`, the
     layers. 100 dB is below int16's ~96 dB floor, so it cannot be heard and rarely moves an output sample by one LSB.
     **Measured: 281–303 dB.**
3. **The argmax lesson (found by the PoC).** WSOLA picks each segment by an argmax over correlations, and an argmax is
   discontinuous. On wasm32, Rust's libm `cos` moved **14 of 704** window values by one ulp. That was enough to flip
   segment choices, after which every later choice diverged: **`pitch_shift` fell to −1.3 dB SNR** (a different but
   valid WSOLA path). Fed the reference's own window bits, wasm32 WSOLA is **bit-exact again (0 differ)**. So:
   * every transcendental that reaches a decision (the window; the pitch ratio `2^(s/12)`) must come from one
     target-independent source: a table generated once from the reference, or an in-crate correctly-rounded `cos` /
     `pow` (CORE-MATH style) used on every target;
   * SNR bars are meaningless for decision-making stages. Hold those to E0.
4. **End to end.** The rendered int16 matches the Python render with at most 1 LSB difference in a stated fraction of
   samples. The Opus bytes are identical when the same libopus build and the same resampler are used; otherwise compare
   decoded PCM. VITS: see the noise trap in §2.1.

### 3.3 Measured: the proof of concept

`render/` (crate `overlord-dsp` 0.0.1, zero dependencies, Rust 1.99, its own workspace root so browseML's `Cargo.toml`
is untouched). It ports:

* `fft` (radix-2 / real / Bluestein);
* `hanning`, `wsola`, `warp`, `dtw`, `linspace`, `interp_arange`, `pitch_shift`;
* `fft_filter`, `lowpass`, `fundamental`, `envelope`, `percentile` (numpy's two-sided lerp), `voiced_gate`, `analytic`;
* `harmonic_overtones`, `crossings`, `octave_divider`.

**Exactness** (`cargo test --release`: 7 tests, all pass natively):

| stage | native x86_64 | wasm32-wasip1 + simd128 (Node 24 WASI) |
|---|---|---|
| hanning(704) | 0 bits differ | **14 differ** (libm cos) |
| WSOLA (jenny warp) | 0 bits differ | 4,659 differ, 328 dB (window-driven) |
| WSOLA with the reference window | 0 differ | **0 differ** |
| pitch_shift −1 (body) | **0 bits differ** | diverges, −1.3 dB (window → argmax, §3.2) |
| DTW path (513 × 605) | identical | identical |
| crossings f/2 (595), f/4 (298) | identical | identical |
| fundamental / envelope / gate | 303 / 281 / 288 dB | 303 / 281 / 288 dB |
| octave f/2, f/4, overtones | 302 / 302 / 289 dB | 302 / 302 / 289 dB |

**Speed**, same input, same core, `nice -n 10 taskset -c 2`, median of 9, two interleaved rounds on a loaded box:

| stage | Python numba (round 1 / 2) | Rust native (1 / 2) | Rust wasm32 (Node 24) |
|---|--:|--:|--:|
| pitch_shift −1 | 73 / 46 ms | 62 / 48 ms | 50–96 ms |
| pitch_shift −7 | 68 / 48 | 64 / 44 | 50 |
| warp jenny | 63 / 42 | 59 / 42 | 48 |
| dtw | 0.8 / 0.9 | 1.8 / 1.5 | 6.4–7.5 |
| octave f/2, f/4 | 48+45 / 38+36 | 50+54 / 36+35 | 38+38 |
| overtones | 187 / 166 | 261 / 212 | 217–265 |
| **total of ported stages** | **485 / 377 ms** | **553 / 418 ms** | **497 ms** |

**What this measures.** A straight, exact, scalar Rust port is **at parity with numpy + numba**: 0.88–0.90× in total,
equal on the WSOLA stages, behind on the FFT-heavy overtones (this FFT against pocketfft) and on DTW. wasm32 runs at
~0.84× native. **No speedup is claimed.** The design's speed gains (the exact lane-parallel WSOLA, shared fundamental,
a better real FFT and mixed-radix in place of Bluestein) are **estimates of 2–4× on the DSP**. By Amdahl's law that is
≈ −5% of OVERLORD's server wall time.

### 3.4 Where it lives

* **Its own crate, opt-in, outside browseML's runtime.** It sits at `browseML/render/` only as a scratch location. The
  proposed long-term home is the **voaice.rs family** (`cryptoAGI/voaicers`), beside `streamair`, which already owns
  Ogg/Opus and depends on `voaice`. The render chain is "text → sound → .opus", streamair's stated purpose.
* **Server.** Build it as a `cdylib` with a small `extern "C"` surface (f64 pointer + length in, out-buffer). Python
  calls it through ctypes over numpy arrays, the same pattern as `utils/docspeech/ogg.py`'s libsndfile. No PyO3, so the
  crate stays dependency-free. `overlord_dsp.py` stays the reference and the fallback.
* **Browser.** Build the same crate as `wasm32-wasip1` (single thread is enough: the DSP is ~10× realtime per core)
  using browseML's existing WASI shim pattern. It loads only on an explicit opt-in in **its own worker**. **Nothing is
  wired into browseML's runtime, pages or worker** until §4 passes.

---

## 4. Acceptance gate: when browseML may adopt it (operator, 2026-10-12)

browseML will **not** use the Rust render until it passes both parts below. Until then it stays a separate, opt-in
module and nothing in `web/`, `browseml*.js` or the engine's workers references it.

### 4.1 Gate A: proven speed, exact output

The **same text** (a fixed corpus: 3 rage articles of short, medium and long length plus the golden sentence) is
rendered by the Python reference and by the Rust path on the same host.

| measured | pass bar |
|---|---|
| exactness, per stage | E0 stages: 0 differing bits. E0-events: identical. E1 stages: ≥ 100 dB SNR (§3.2). On **every** target that ships: x86_64 native, wasm32, wasm32 + relaxed SIMD (relaxed SIMD only where proven exact, as browseML does). |
| exactness, end to end | int16 output: ≤ 1 LSB difference in ≤ 0.1% of samples; decoded Opus PCM ≥ 60 dB SNR against the reference's decode when the encoders differ, or byte-identical when they are the same libopus build |
| speed | CPU-seconds per audio-second of the replaced stages: **Rust ≤ 0.5× the reference** (≥ 2×) on the production host, median of ≥ 5 runs, interleaved, under the same cgroup slice. Report the whole-render effect too, so a stage win is never presented as a render win. |
| reproducibility | goldens regenerated from the reference at a pinned commit; the test log with every figure committed beside the change |

### 4.2 Gate B: does not interrupt model processing

**Browser.**
* The render runs in **its own dedicated worker**, never on the main thread or inside the engine's workers or thread
  pool.
* It works in bounded chunks (one sentence, ≤ 50 ms of CPU each), checks for a "model busy" message from the page
  between chunks, and **yields while the engine is decoding**.
* It runs at most 1 thread and has a stated memory ceiling (e.g. 64 MB).

**Server.** The render runs in the speak slice (cgroup v2, `scripts/apply_processor_shares.sh` policy: ≤ 15% per slot,
10% reserve), niced, with onnxruntime's threads pinned by affinity **and** an explicit `intra_op_num_threads=1`.
onnxruntime overrides a plain `taskset` (§1.2).

**How "no interruption" is shown (measured, not asserted):**

| test | measured | pass bar |
|---|---|---|
| browser A/B | browseML's tokens/s (prefill and decode) on the oracle prompts, **alone vs with a concurrent render** of a long article in the render worker; same device, ≥ 5 alternating runs; Chrome and Firefox on a 4-core laptop and a phone | decode tok/s with render ≥ **97%** of alone (median); no token latency spike > 2× the alone p99; oracle output still identical (exactness of the engine is never affected) |
| browser yield | time from "model busy" posted to the render worker's last CPU slice ending | ≤ 50 ms p99 |
| server A/B | Ollama / bankml-serve tok/s and the trainer's steps/s, alone vs during a Rust render, under production's cgroup layout | ≥ 97% of alone; the render's own cgroup CPU stays inside its slice quota (`cpu.stat` throttling shows the cap holding, not the neighbour) |
| server isolation | `cpu.pressure` of the inference and trainer cgroups during the render | no rise in `some avg10` beyond run-to-run noise (stated) |

When both gates pass, the evidence is written into this file and the CHANGELOG, and only then is a browseML change
proposed. That change would be opt-in: a setting, off by default.

---

## 5. Open questions

1. **Is numba installed in production's `.mindx_env`?** Inferred yes from the timings, not verified (I did not touch
   the VPS).
2. **What is the missing ~35% of OVERLORD's cost?** R0's instrumentation answers it. Does the 2.063 s/word median still
   contain v3 renders?
3. **R2 (reuse NEURAL/JAIMLA PCM for OVERLORD)** is the biggest available saving and a change to the voice. Operator
   call.
4. **piper determinism.** Should the oracle re-export the voices with noise as an input, or test at noise 0?
5. **Phoneme IDs as a published sidecar.** Acceptable as a new artefact of the render store? It would also give the
   browser path free-text-free operation.
6. **Crate home.** voaice.rs family (beside streamair) vs a `browseML/render` module. This doc recommends the former,
   with browseML consuming it opt-in.
7. **Encoder of record.** libsndfile (+ Python linear resample) or opusenc (+ its resampler). The store currently uses
   both. A Rust path needs one named reference.
8. **A browser "OVERLORD-open"** from public-domain voices (bryce/john/norman + kristin/cori) is technically possible.
   It needs a name and an operator decision. It is not OVERLORD.

## Appendix: reproducing the PoC numbers

```sh
cd browseML/render
# goldens, from the Python reference (numpy + numba; any two s16le 22050 Hz takes of one sentence, open voice)
python tools/golden.py body.raw other.raw /path/to/mindX/mindx_backend_service/deltaverse/render
cargo test --release --test golden -- --nocapture --test-threads=1
cargo build --release && taskset -c 2 target/release/overlord-bench testdata 9
taskset -c 2 python tools/bench_py.py testdata 9
# wasm32 (Node 24's WASI, browseML's runner)
CARGO_TARGET_WASM32_WASIP1_RUNNER="node --no-warnings ../testing/wasi-run.mjs" RUSTFLAGS="-C target-feature=+simd128" \
  cargo test --release --target wasm32-wasip1 --test golden -- --nocapture --test-threads=1
```

The goldens (`testdata/*.f64`, `*.i64`, ~12 MB) are generated, not committed (`render/.gitignore`). The PoC input was
piper en_GB-cori-high (public domain); no restricted voice was used.
