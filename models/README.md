# The model: Bonsai-1.7B Q1_0

`Bonsai-1.7B-Q1_0.gguf` (248,302,272 bytes) is **prism-ml's** 1-bit Bonsai-1.7B, kept here byte for byte (Git LFS)
so browseML can be built, tested and served without reaching Hugging Face.

| | |
|---|---|
| source | [huggingface.co/prism-ml/Bonsai-1.7B-gguf](https://huggingface.co/prism-ml/Bonsai-1.7B-gguf) |
| revision | `210a9e99f79cb184909d49595906526eb2b3dd9a` ([the file at that revision](https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/blob/210a9e99f79cb184909d49595906526eb2b3dd9a/Bonsai-1.7B-Q1_0.gguf)) |
| sha256 | `3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3` — the pin in [`web/browseML/Bonsai-1.7B-Q1_0.gguf.FORK.json`](../web/browseML/Bonsai-1.7B-Q1_0.gguf.FORK.json), equal to Hugging Face's LFS sha256 |
| licence | Apache-2.0, prism-ml: [`LICENSE`](LICENSE) and [`NOTICE.txt`](NOTICE.txt), as published with the model |
| card | [`MODEL-CARD.md`](MODEL-CARD.md), prism-ml's model card at that revision |

The pages still download the model from Hugging Face at the pinned revision (`web/browseml.js`, `MODEL.url`) and
bankML refuses any file whose sha256 is not the pin, wherever it came from. This copy is for the oracle and the
benchmark (`BANKML_MODELS=models tools/build.sh oracle` needs the oracle's records beside it), for serving the model
from the same origin as a page, and as a record of exactly what browseML was verified on.

Check it: `sha256sum models/Bonsai-1.7B-Q1_0.gguf`.
