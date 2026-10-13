# browseML — what comes next

Each item says what it is, what it needs, and how it will be checked. Done items move to the CHANGELOG with their
measurements. The rule throughout: a source, a kernel or a feature joins only when it is verified.

## Sources — where the model comes from

browseML takes a model from any source, and the sha256 pin decides. Two verified sources today:
[Hugging Face](https://huggingface.co/prism-ml/Bonsai-1.7B-gguf) and [browseML/models](https://github.com/browseML/models)
(each piece is asked of the source that answered last; a retry moves to the other).

| module | what | checked by |
|---|---|---|
| **IPFS** ([helia](https://github.com/interplanetaryfilesystem/helia), [ipfs-car](https://github.com/interplanetaryfilesystem/ipfs-car)) | the model by its content address (CID) from IPFS peers and gateways; its CID recorded in the pin beside the sha256 | the CID recomputed in the page, then bankML's sha256 |
| **Peer to peer** (WebRTC) | a browser that has the model serves it to another (same room, a signed offer); [wave-share](https://github.com/interplanetaryfilesystem/wave-share) for tiny files | each piece's hash against a piece list in the pin, then the whole sha256 |
| **Folder import** (File System Access API) | a whole folder of models chosen once (bankML's `.models`, Ollama's blobs), recognised by size and sha256 | `recognise()` (done for a single file) |
| **Origin Private File System** | the model and warm slots in OPFS (faster than Cache Storage for large files) | read back and hashed |
| **More models** | Ternary-Bonsai, SmolLM2 in `browseML/models`, each with its pin and `verify.mjs --source` | the oracle per model, as bankML |

## GPU — WebGPU, exactly ([browseML/webgpu](https://github.com/browseML/webgpu))

| module | what | checked by |
|---|---|---|
| Q1_0 · q8_0 mat-vec | **done**: WGSL, exact FMA, `exact()` against bankML's reference | 832/832 rows bit-exact; controls fail (110/256) |
| GPU in the forward pass | a GPU worker beside the engine: the engine hands each 1-bit matmul over shared memory and waits (Atomics) | the oracle's 9 answers identical with the GPU on |
| f16 attention, RoPE, norms in WGSL | the rest of the layer, each against its scalar reference | per-kernel exactness + the oracle |
| subgroups | faster reductions where `subgroups` exists, the same reduction order | the same tests |

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
