# browseML — how it works, and why

browseML runs a language model **in your web browser, on your own CPU**, and proves to you that the model and its
answers are what they claim to be. This page explains the ideas. The commands are in [usage.md](usage.md); the
kernels, builds and measurements in [technical.md](technical.md).

---

## The idea

Most AI on the web runs on someone else's server: you send your words away and trust what comes back. browseML
inverts that. The page sends you **files only** — the engine and, once, the model — and your computer does the work.
Nothing you type leaves your device.

That raises a fair question: *how do you know the engine in your browser is the real one, and the answer really came
from it?* browseML answers it in three steps.

| | |
|---|---|
| **1 · The model is checked before it speaks** | The engine reads the model's header (the GGUF guard) and then the sha256 of all 248 MB, and compares it with a pin published with the code. A file that fails either check is refused — no answer at all. |
| **2 · Every answer carries a receipt** | The engine returns the same receipt `bankml serve` gives: hashes of the request, the model and the answer, with the token counts. The page recomputes the answer's sha256 itself and shows **✓** or **✗** under it. |
| **3 · Exact before fast** | The engine's answers are tested against llama.cpp's own recorded answers (llama-server b11192): every word, every token count, the reason it stopped. Speed-ups are kept only where the answers stay identical, bit for bit. |

## Where it comes from

browseML *is* [bankML](https://github.com/cryptoAGI/bankml) — a zero-dependency Rust runtime for 1-bit and ternary
models, bit-exact against llama.cpp — compiled to WebAssembly. Nothing was rewritten for the browser: the same
forward pass, the same sampler, the same verification and receipts. This repository adds what turns it into a
browser engine: a thin export layer, a small runtime in JavaScript, the pages, and the tests. bankML is pinned as a
git submodule, so every build says exactly which engine it is.

browseML was a surprise on bankML's road to 0.5.0, its hardware milestone: the visitor's browser turned out to be a
piece of hardware worth running on. Its first public appearances are mapped in [HISTORY.md](../HISTORY.md).

## The model

**Bonsai-1.7B, 1-bit (Q1_0)**, by prism-ml, Apache-2.0: 1.7 billion weights at about 1.1 bits each, so the whole
model is 248 MB. It is downloaded once from Hugging Face at a pinned revision and kept in the browser's cache; the
repository also carries a byte-for-byte copy in [`models/`](../models/README.md).

## Fast, without giving up exactness

A browser offers two ways to go faster, and browseML uses both only where they cannot change an answer.

**Threads.** On a page that is *cross-origin isolated* (the server sends two security headers), the browser allows
shared memory between Web Workers, so the engine's thread pool can run on every core. The pool's results do not
depend on how many threads there are, so the answers are the same on one thread or eight. Without those headers,
the engine runs on one thread — slower, same answers.

**SIMD.** Modern browsers run WebAssembly SIMD (four calculations at once). browseML's kernels are written so each
lane computes exactly what the scalar reference computes. A newer feature, *relaxed SIMD*, can fuse a multiply and
an add into one step — but whether it fuses depends on the machine. Fused, it is exactly the reference; unfused, it
is not. So the fastest build tests the machine when it starts and refuses to run where the result would differ; the
page then uses the plain build. Three builds, one engine, the same answers.

| on this computer… | the page uses | speed |
|---|---|---|
| isolated page, relaxed SIMD that fuses (Chrome, Edge, Brave) | `browseml-mt-relaxed.wasm` | fastest |
| isolated page, otherwise (Firefox, or no fused multiply-add) | `browseml-mt.wasm` | fast |
| not isolated, or Safari | `browseml.wasm` | one thread |

On a 2-core laptop this means about **5 tokens a second reading** and **2.7 writing** with four threads, against
roughly 0.2 for the first, straightforward build.

## Built for the real world

Two problems showed up only on real machines, and both are solved in the code:

- **Connections drop.** Brave on Linux cut the 248 MB download mid-way where `curl` got the whole file, so browseML
  failed on desktops while working on phones. The download now comes in 16 MB pieces; a cut piece is asked for again
  from the exact byte where it stopped. In a test, Brave's network changed at 43 MB and the download simply carried on.
- **Memory is precious.** The engine used to hold two copies of the model (531 MB). It now reads the model straight
  into place and holds it once (317 MB, measured) — the difference between working and not on a laptop with little
  free RAM.

## Your controls: ultimate-clientside

[`app/`](../app/README.md) is browseML behind the *ultimate input field*, with this computer's controls in plain
view: how many CPU threads it may take, how much memory (the context), a prompt cache, the answer length — turned
on DreamKnob dials — and diagnostics built only from what actually ran here: the download's speed, the time to
verify, the memory the engine really took, each answer's reading and writing speed. Its advice (fewer threads, a
smaller context) comes from those measurements, never from guesses.

## What it does not do (yet)

- **One model size.** The browser runs Bonsai-1.7B; the 8B models are for `bankml serve` on your own machine.
- **No stopping mid-answer.** The engine runs until the answer ends or reaches its length limit.
- **Speed is your CPU's.** A 2-core laptop writes a few tokens a second; more cores help.
- **Safari runs on one thread.**
