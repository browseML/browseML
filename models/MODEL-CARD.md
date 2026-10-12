---
license: apache-2.0
library_name: llama.cpp
pipeline_tag: text-generation
tags:
- 1-bit
- gguf
- llama-cpp
- cuda
- metal
- on-device
- prismml
- bonsai
base_model:
- prism-ml/Bonsai-1.7B-unpacked
---

<p align="center">
  <img src="./assets/bonsai-logo.svg" width="280" alt="Bonsai">
</p>

<p align="center">
  <a href="https://prismml.com"><b>Prism ML Website</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/PrismML-Eng/Bonsai-demo/blob/main/1-bit-bonsai-8b-whitepaper.pdf"><b>Whitepaper</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/PrismML-Eng/Bonsai-demo"><b>Demo &amp; Examples</b></a> &nbsp;|&nbsp;
  <a href="https://colab.research.google.com/drive/1EzyAaQ2nwDv_1X0jaC5XiVC3ZREg9bdG?usp=sharing"><b>Colab Notebook</b></a> &nbsp;|&nbsp;
  <a href="https://discord.gg/prismml"><b>Discord</b></a>
</p>

# Bonsai-1.7B-GGUF-1bit

End-to-end 1-bit language model for llama.cpp (CUDA, Metal, CPU)

> **13.9x** smaller than FP16 | **3.0x** faster on RTX 4090 | runs on any device

## Highlights

- Deployed footprint — runs on virtually any device
- **End-to-end 1-bit weights** across embeddings, attention projections, MLP projections, and LM head
- **GGUF Q1_0 (g128)** format for 1-bit packing of weights with shared scales for each group (group size 128).
- **Cross-platform**: CUDA (RTX/datacenter), Metal (Mac), Swift (iPhone/iPad), Android
- **MLX companion**: also available as [MLX 1-bit g128](https://huggingface.co/prism-ml/Bonsai-1.7B-mlx-1bit) for native Apple Silicon inference

<p align="center">
  <img src="./assets/frontier.svg" width="680" alt="Frontier Efficiency">
</p>

## Resources

- **[Google Colab](https://colab.research.google.com/drive/1EzyAaQ2nwDv_1X0jaC5XiVC3ZREg9bdG?usp=sharing)** — try Bonsai in your browser, no setup required
- **[Whitepaper](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/1-bit-bonsai-8b-whitepaper.pdf)** — for more details on Bonsai, check out our whitepaper
- **[Demo repo](https://github.com/PrismML-Eng/Bonsai-demo)** — comprehensive examples for serving, benchmarking, and integrating Bonsai
- **[Discord](https://discord.gg/prismml)** — join the community for support, discussion, and updates
- **1-bit kernels**: [llama.cpp fork](https://github.com/PrismML-Eng/llama.cpp) (CUDA + Metal) · [MLX fork](https://github.com/PrismML-Eng/mlx) (Apple Silicon) · [mlx-swift fork](https://github.com/PrismML-Eng/mlx-swift) (iOS/macOS)
- **[Locally AI](https://locallyai.app/)** — we have partnered with Locally AI for iPhone support

## Model Overview

| Item           | Specification                                                            |
| :------------- | :----------------------------------------------------------------------- |
| Parameters     | 1.7B (~1.4B non-embedding)                                               |
| Architecture   | Qwen3-1.7B dense: GQA (16 query / 8 KV heads), SwiGLU MLP, RoPE, RMSNorm |
| Layers         | 28 Transformer decoder blocks                                            |
| Context length | 32,768 tokens                                                            |
| Vocab size     | 151,936                                                                  |
| Weight format  | GGUF Q1_0                                                                |
| Deployed size  | **0.24 GB** (14.2x smaller than FP16)                                    |
| 1-bit coverage | Embeddings, attention projections, MLP projections, LM head              |
| License        | Apache 2.0                                                               |

## Quantization Format: Q1_0

Each weight is a single bit: `0` maps to `−scale`, `1` maps to `+scale`. Every group of 128 weights shares one FP16 scale factor.

Effective bits per weight: **1.125** (1 sign bit + 16-bit scale amortized over 128 weights).


### Memory Requirement

Parameter memory only (weights and scales loaded into memory):

| Format             | Size        | Reduction | Ratio     |
| :----------------- | ----------: | --------: | --------: |
| FP16               | 3.44 GB     | —         | 1.0x      |
| **GGUF Q1_0     ** | **0.24 GB** | **93.0%** | **14.2x** |
| MLX 1-bit g128     | 0.27 GB     | 92.2%     | 12.8x     |

The GGUF file on disk is 0.25 GB (~6.2 MB larger) because the format embeds the tokenizer, chat template, and model metadata alongside the weights.

## Best Practices

### Generation Parameters

| Parameter          | Default | Suggested range |
| :----------------- | :------ | :-------------- |
| Temperature        | 0.5     | 0.5 -- 0.7      |
| Top-k              | 20      | 20 -- 40        |
| Top-p              | 0.9     | 0.85 -- 0.95    |
| Repetition penalty | 1.0     |                 |
| Presence penalty   | 0.0     |                 |

### System Prompt

You can use a simple system prompt such as:

```
You are a helpful assistant
```

## Quickstart

### llama.cpp (CUDA)

```bash
# Clone the PrismML fork of llama.cpp (includes Q1_0 kernels)
git clone https://github.com/PrismML-Eng/llama.cpp
cd llama.cpp

# Build with CUDA support
cmake -B build -DGGML_CUDA=ON && cmake --build build -j

# Run inference
./build/bin/llama-cli \
    -m Bonsai-1.7B-Q1_0.gguf \
    -p "Explain quantum computing in simple terms." \
    -n 256 \
    --temp 0.5 \
    --top-p 0.85 \
    --top-k 20 \
    -ngl 99
```

### llama.cpp (Metal / macOS)

```bash
# Clone the PrismML fork of llama.cpp (includes Q1_0 kernels)
git clone https://github.com/PrismML-Eng/llama.cpp
cd llama.cpp

# Build with Metal support (default on macOS)
cmake -B build && cmake --build build -j

# Run inference
./build/bin/llama-cli \
    -m Bonsai-1.7B-Q1_0.gguf \
    -p "Explain quantum computing in simple terms." \
    -n 256 \
    --temp 0.5 \
    --top-p 0.85 \
    --top-k 20 \
    -ngl 99
```

### llama.cpp Server

```bash
./build/bin/llama-server \
    -m Bonsai-1.7B-Q1_0.gguf \
    --host 0.0.0.0 \
    --port 8080 \
    -ngl 99
```

Open the web UI at [http://127.0.0.1:8080](http://127.0.0.1:8080), or see our [llama.cpp fork](https://github.com/PrismML-Eng/llama.cpp) for more examples.

## Cross-Platform Throughput

| Platform     | Backend         | TG128 (tok/s) | FP16 TG (tok/s) | TG vs FP16 | PP512 (tok/s) | FP16 PP512 (tok/s) |
| :----------- | :-------------- | ------------: | --------------: | ---------: | ------------: | -----------------: |
| RTX 4090     | llama.cpp CUDA  | 674           | 224             | **3.0x**   | 31,899        | 30,630             |
| M4 Pro 48 GB | llama.cpp Metal | 250           | 65              | **3.8x**   | 2,305         | 2,291              |

## Citation

If you use 1-bit Bonsai 1.7B, please cite:

```bibtex
@techreport{bonsai,
    title   = {Bonsai: End-to-End 1-bit Language Model Deployment
               Across Apple, GPU, and Mobile Runtimes},
    author  = {Prism ML},
    year    = {2026},
    month   = {March},
    url     = {https://prismml.com}
}
```

## Contact

For questions, feedback, or collaboration inquiries: **contact@prismml.com**