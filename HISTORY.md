# browseML's first public experiments, mapped

browseML was built inside [bankML](https://github.com/cryptoAGI/bankml) (`browseML/`, `hf/space/browseml*.js`,
`tools/browseml.sh`) and first shown in public on Hugging Face Spaces. This file ties each public experiment to the
bankML source it ran, so any page can be traced back to the code and the measurements behind it. Times are UTC, read
from the Hub's commit history and from bankML's git log on 2026-10-12. The operator's live index of every Space is
[deltaverse.pythai.net/hfindex](https://deltaverse.pythai.net/hfindex) (machine-readable:
[hfindex.json](https://deltaverse.pythai.net/hfindex.json)).

## The source, in bankML (branch `browseml`)

| bankML commit | date | what it added |
|---|---|---|
| `9c63fa1` | 2026-10-08 | browseML: the engine compiled to WebAssembly, verified (guard, sha256 pin), with `serve`'s receipt |
| `ed8b113` | 2026-10-08 | exact on all nine of the oracle's conversations, about 7× faster (glibc's `sinf`/`cosf`; the activation kernel) |
| `8352491` | 2026-10-08 | threads (`wasm32-wasip1-threads` on Web Workers, cross-origin-isolated pages); the ultimate input field and this computer's controls on the Space |
| `83abd70` | 2026-10-08 | relaxed SIMD where it is exact (1.4–1.7× on threads); no silent wait — download, verify, read, write |
| `8265ddb` | 2026-10-09 | the f16 paths and the tiled attention kernel in exact WebAssembly SIMD, kernel tests under Node's WASI |
| `0346076` | 2026-10-12 | the desktop: a download in 16 MB pieces that survives cuts (Brave on Linux), the model held once in memory (531 → 317 MB) — this repository's pinned `bankml/` |

## The public experiments, in order

| when (UTC) | Space · commit | what was shown | bankML source |
|---|---|---|---|
| 2026-10-09 03:15 | [PYTHAI/bankml](https://huggingface.co/spaces/PYTHAI/bankml) · `dbcfb9e6` | **the first public browseML**: bankML in the browser, verified, a receipt on every answer, on 4 threads where the page is cross-origin isolated; the ultimate input field; this computer's controls and diagnostics | `8352491` (+ `ed8b113`) |
| 2026-10-09 05:30 | PYTHAI/bankml · `daef2b2a` | relaxed SIMD where exact (4 threads on a 2-core laptop: prompt 5.2, writing 2.7 tok/s); an activity line for every phase | `83abd70` |
| 2026-10-09 07:22 | [Gregory-L/Savante](https://huggingface.co/spaces/Gregory-L/Savante) · `896261f2` | Savante, interactive edition: Savante in this browser (browseML) as one of four carriers | `83abd70`–`8265ddb` |
| 2026-10-09 07:46 | Gregory-L/Savante · `74d71c31` | sAGI mode, magnetic docking; delivery details kept in `.memory` | — |
| 2026-10-09 08:48 | [Gregory-L/ultimate-webgpu](https://huggingface.co/spaces/Gregory-L/ultimate-webgpu) · `65bce6f8` | Qwen3-0.6B and Agate on WebGPU, with bankML (browseML) as the separate, verified CPU engine | `8265ddb` |
| 2026-10-10 03:27 | PYTHAI/bankml · `e14b0dea` | bankML 0.4.3 pages: Savante's input → response pattern, bankML in this browser by default | `8265ddb` |
| 2026-10-10 03:28 | [PYTHAI/browseML](https://huggingface.co/spaces/PYTHAI/browseML) · `2d10ddcc` | **browseML's own Space**: the landing page this repository's `web/` starts from; runtime copied from PYTHAI/bankml, sha256s in its `COPIED.json` ("8265ddb with uncommitted changes") | `8265ddb` |
| 2026-10-10 03:28 | [PYTHAI/bankML-UIF](https://huggingface.co/spaces/PYTHAI/bankML-UIF) · `98f89da8` | bankML behind the ultimate input field (React), browseML the first answerer on a first visit; formerly PYTHAI/ultimate-bankml-ui (live since 2026-10-07 as a front end to your own `bankml serve`) | `8265ddb` |
| 2026-10-10 07:26 | PYTHAI/browseML · `1f9a1582`, PYTHAI/bankml · `36a3c9b3`, PYTHAI/bankML-UIF · `d3ab5839` | the same pages, refreshed together | `8265ddb` |

Before browseML, the same Spaces carried bankML through other answerers: PYTHAI/bankml (2026-10-07, bankML 0.4.0:
your own `bankml serve` with receipts) and [Gregory-L/mindXhfgradio](https://huggingface.co/spaces/Gregory-L/mindXhfgradio)
(Bonsai on the Space's free CPU through llama.cpp — not bankML's engine, no receipt; still the "free CPU" answerer).

## What came after the Spaces

- **The desktop** (2026-10-12, `0346076`): browseML worked on phones and not in Brave on Linux. The single 248 MB
  download was cut mid-body; it now comes in pieces, each retried from where it was cut (in a test run Brave hit
  `ERR_NETWORK_CHANGED` at 43 MB and carried on). The engine held the model twice; it now holds it once.
- **ultimate-clientside** (2026-10-12, in the bankML UIF repository, not yet public): the input field with this
  computer's controls — threads, memory (context), prompt cache, answer length, cache clear, unload — on DreamKnob
  knobs, and diagnostics from actual usage; docks in the page or pops out; buttons drag onto a sidebar menu and
  button panels.
- **This repository** (2026-10-12): browseML on its own, under the browseML organization; public the same day.
