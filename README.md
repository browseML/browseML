<div align="center">

<img src="docs/assets/browseML.png" width="200" alt="browseML">

### bankML in your browser — verified, with a receipt on every answer

[![Licence: MIT OR Apache-2.0](https://img.shields.io/badge/licence-MIT%20OR%20Apache--2.0-0ECB81?style=flat-square)](#licence)
[![WebAssembly SIMD](https://img.shields.io/badge/WebAssembly-SIMD%20%C2%B7%20threads-654FF0?style=flat-square&logo=webassembly&logoColor=white)](docs/technical.md#three-builds-one-engine)
[![Oracle: 9 of 9 identical](https://img.shields.io/badge/oracle-9%2F9%20identical%20to%20llama.cpp-0ECB81?style=flat-square)](docs/technical.md#measured)
[![Model: Bonsai-1.7B 1-bit](https://img.shields.io/badge/model-Bonsai--1.7B%201--bit%20%C2%B7%20248%20MB-F7931A?style=flat-square)](models/README.md)
[![Try it on Hugging Face](https://img.shields.io/badge/try%20it-Hugging%20Face-FFD21E?style=flat-square&logo=huggingface&logoColor=black)](https://huggingface.co/spaces/PYTHAI/browseML)

</div>

**browseML** runs a language model in your web browser, on your own CPU. Its engine is
[bankML](https://github.com/cryptoAGI/bankml) (a separate project) compiled to WebAssembly; browseML is the client side:
the runtime, the pages and the controls, on the CPU today and on the GPU (WebGPU) next. There's nothing to install, no account
to make, and no server answers for you: the page only serves files, and nothing you type leaves your device.

<table>
<tr>
<td width="33%" valign="top">

**Verified before it speaks**

The engine checks the model's header and the sha256 of all 248 MB against a published pin. A file that fails is
refused.

</td>
<td width="33%" valign="top">

**A receipt on every answer**

Each answer carries `bankml serve`'s receipt. The page recomputes the answer's hash and shows ✓ or ✗ under it.

</td>
<td width="33%" valign="top">

**Exact before fast**

Identical to llama.cpp's recorded answers, word for word and token for token, on one thread or many.

</td>
</tr>
<tr>
<td valign="top">

**Your CPU, all of it**

Threads on every core where the page is cross-origin isolated; SIMD kernels proven lane for lane.

</td>
<td valign="top">

**Survives real networks**

The download comes in 16 MB pieces, each resumed from the exact byte a dropped connection cut.

</td>
<td valign="top">

**Your controls**

[The browseML app](app/README.md): dials for threads, memory and cache, diagnostics measured from what ran, and a FAQ browseML answers itself.

</td>
</tr>
</table>

## Try it

| | |
|---|---|
| **[PYTHAI/browseML](https://huggingface.co/spaces/PYTHAI/browseML)** | the landing page: ask, watch it download and verify, read the receipt |
| **[PYTHAI/bankml](https://huggingface.co/spaces/PYTHAI/bankml)** | the full bankML Space, where browseML first appeared on 2026-10-09 |
| **[PYTHAI/bankML-UIF](https://huggingface.co/spaces/PYTHAI/bankML-UIF)** | bankML behind the ultimate input field |

## Run it yourself

```sh
git clone --recurse-submodules https://github.com/browseML/browseML.git
cd browseML && python3 -m http.server -d web 8000     # open http://localhost:8000
```

`web/` is ready to serve as it is. For threads, serve it with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` ([usage](docs/usage.md#run-it-yourself)).

## What's inside

| | |
|---|---|
| [`web/`](web) | the browser runtime, the three prebuilt engines (`.wasm`) and the landing page |
| [`app/`](app/README.md) | the browseML app: ask, load the model with one click, your controls and diagnostics, a FAQ answered by browseML |
| [`src/`](src/lib.rs) | the WebAssembly exports over bankML's engine |
| [`bankml/`](https://github.com/cryptoAGI/bankml/tree/browseml) | the engine itself, pinned as a git submodule |
| [`models/`](models/README.md) | the model, byte for byte (Git LFS), with its licence and card |
| [`testing/`](testing) · [`tools/`](tools/build.sh) | the oracle, the benchmark, the download test · the build |

## Documentation

<table>
<tr>
<td width="25%" valign="top">

**[Usage →](docs/usage.md)**

Try it, run it, the controls, build and check, use the runtime in your page.

</td>
<td width="25%" valign="top">

**[Explanation →](docs/explanation.md)**

How it works and why: verification, receipts, exactness, threads, the model.

</td>
<td width="25%" valign="top">

**[Technical →](docs/technical.md)**

The kernels, the three builds, measurements, where the time goes, limits. [Efficiency →](docs/efficiency.md)

</td>
<td width="25%" valign="top">

**[History →](HISTORY.md)**

The first public experiments on Hugging Face, mapped to the code they ran.

</td>
</tr>
<tr>
<td valign="top" colspan="4">

**Software catalogues** — what exists, with licences, and what browseML takes from it:
[graphics cards →](docs/gpu-software.md) · [CPU, memory and network →](docs/cpu-software.md) ·
[JavaScript tooling and client-side files →](docs/js-software.md)

</td>
</tr>
</table>

## Licence

browseML is `MIT OR Apache-2.0`, at your choice ([MIT](LICENSE-MIT) · [Apache-2.0](LICENSE-APACHE)); `app/` is MIT.
The model is prism-ml's Bonsai-1.7B, Apache-2.0 ([licence](models/LICENSE) · [notice](models/NOTICE.txt)), built from
Qwen3-1.7B. *Created using Bonsai by Prism ML.* The dials are [DreamKnob](app/vendor/dreamknob/README.md) (MIT,
Dreamodus Software Inc.).

<sub>By Professor Codephreak and Gregory L. Magnusson · <a href="https://github.com/cryptoAGI">cryptoAGI</a> · <a href="CHANGELOG.md">changelog</a></sub>
