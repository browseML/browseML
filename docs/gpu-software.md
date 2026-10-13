# Graphics-card software — the existing landscape

What already exists for recognising, measuring, stressing, tuning and computing on a GPU, from the gaming community
to datacenter tools and the browser. Each entry says what it is, its licence (read from its repository on 2026-10-13;
† from the project's own pages; *proprietary* / *freeware* where it is closed), and what browseML takes from it. browseML runs in a web page: it can reach the
GPU only through **WebGPU** (and WebGL), never through a driver library such as NVML or ROCm SMI. Native tools are
listed because they set the standard for what to report, and because **bankML** (the engine, native) can use them.

> [!NOTE]
> **The rule for browseML:** reference what others built; write our own code. Code is borrowed only under a
> permissive licence (MIT, BSD, Apache-2.0) and credited; GPL code is read, never copied into the MIT/Apache tree.

**Contents** · [In the browser](#in-the-browser) · [Inference on the GPU](#inference-on-the-gpu) ·
[Information and reports](#information-and-reports-gpu-z-and-its-kin) · [Monitoring](#monitoring) ·
[Overlays (gaming)](#overlays-gaming-community) · [Benchmarks and stress](#benchmarks-and-stress) ·
[Tuning and control](#tuning-and-control) · [Vendor tools](#vendor-tools-nvidia-amd-intel) ·
[What browseML does with it](#what-browseml-does-with-it)

---

## In the browser

| software | licence | what it is | for browseML |
|---|---|---|---|
| **WebGPU** (W3C, [gpuweb/gpuweb](https://github.com/gpuweb/gpuweb)) | W3C | the browser's GPU compute and graphics API: adapters, features, limits, WGSL shaders | the only way a page reaches the GPU; `gpu.ts` reads the adapter and runs its probes through it |
| [gpuweb/cts](https://github.com/gpuweb/cts) | BSD-3-Clause | WebGPU's conformance test suite | how features and limits are probed correctly |
| [webgpureport.org](https://github.com/webgpu/webgpureport.org) | not stated | a page listing every WebGPU adapter property | the report format the control panel's GPU section follows |
| [webglreport](https://github.com/AnalyticalGraphicsInc/webglreport) | Apache-2.0 | WebGL capabilities and the unmasked renderer | the fallback report when there is no WebGPU |
| [pmndrs/detect-gpu](https://github.com/pmndrs/detect-gpu) | MIT | the gaming community's tiering: the renderer string matched against GFXBench frame rates → tier 0–3 | tiers by name; its data stopped updating Dec 2025, so browseML measures instead |
| [greggman/webgpu-utils](https://github.com/greggman/webgpu-utils) | MIT | helpers for WebGPU buffers and pipelines | reference for clean WebGPU plumbing |
| [Dawn](https://github.com/google/dawn) | BSD-3-Clause † | Chrome's native WebGPU implementation | how Chrome maps WGSL to D3D12, Metal, Vulkan |
| [wgpu](https://github.com/gfx-rs/wgpu) | Apache-2.0 / MIT | Firefox's (and Rust's) WebGPU implementation | the Rust route if browseML's GPU kernels are written in Rust |

## Inference on the GPU

| software | licence | what it is | for browseML |
|---|---|---|---|
| **llama.cpp `ggml-webgpu`** ([ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)) | MIT | llama.cpp's WebGPU backend: WGSL shaders for `mul_mat_vec`, quantised inner loops (Q4_0, Q8_0), flash attention, RoPE, norms | **the reference**: llama.cpp is bankML's oracle. No Q1_0 kernel yet, so browseML's Q1_0 WGSL kernel is its own, checked against this backend's style and against bankML bit for bit |
| bankML `bankML/gpu/` ([cryptoAGI/bankml](https://github.com/cryptoAGI/bankml)) | MIT OR Apache-2.0 | bankML's own Vulkan path: a SPIR-V assembler, a Q1_0 kernel, `fma_exact` for GPUs that do not fuse, the GPU oracle | **the in-house starting point**: the same kernel, written in WGSL, held to the same oracle |
| [web-llm](https://github.com/mlc-ai/web-llm) (MLC, [Apache TVM](https://github.com/apache/tvm)) | Apache-2.0 | LLMs in the browser on WebGPU, compiled by TVM | fast, but not exact against a reference: not browseML's engine |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | MIT | ONNX Runtime's WebGPU and WASM backends | the same: a fast runtime, no bit-exact guarantee |
| [transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | Hugging Face models in the browser (on onnxruntime-web) | the same |
| [rust-gpu](https://github.com/Rust-GPU/rust-gpu) | Apache-2.0 / MIT | Rust compiled to SPIR-V shaders | a possible route to share kernels between bankML (Vulkan) and browseML |
| [Ollama](https://github.com/ollama/ollama) | MIT | local model server over llama.cpp (CUDA, ROCm, Metal) | native; what bankML's `serve` is measured against |

## Information and reports (GPU-Z and its kin)

| software | licence | platform | what it shows |
|---|---|---|---|
| GPU-Z (TechPowerUp) | freeware, proprietary | Windows | the classic card sheet: chip, memory, clocks, BIOS, sensors |
| [GPU-T](https://github.com/lseurttyuu/GPU-T) | MIT | Linux | a GPU-Z-style sheet for Linux: hardware lookup, sensor logging, Resizable BAR |
| [VulkanCapsViewer](https://github.com/SaschaWillems/VulkanCapsViewer) / gpuinfo.org | LGPL-3.0 | all | every Vulkan capability, uploaded to a public database |
| [Vulkan-Tools](https://github.com/KhronosGroup/Vulkan-Tools) (`vulkaninfo`) | Apache-2.0 | all | the Vulkan driver's view of each GPU |
| [clinfo](https://github.com/Oblomov/clinfo) | CC0 † | all | every OpenCL platform and device |
| HWiNFO | freeware, proprietary | Windows | whole-system sensors and reports |
| AIDA64 | proprietary | Windows | system information, stress tests and benchmarks |
| [CUDA-Z](http://cuda-z.sourceforge.net/) | GPL-2.0 † | Windows, Linux | CUDA device info and bandwidth; unmaintained since 2015 |

## Monitoring

| software | licence | GPUs | what it is |
|---|---|---|---|
| `nvidia-smi` (in the driver) | proprietary | NVIDIA | utilisation, memory, temperature, power, processes |
| [nvtop](https://github.com/Syllo/nvtop) | GPL-3.0 | NVIDIA, AMD, Intel, Apple, Huawei | an htop for GPUs |
| [nvitop](https://github.com/XuehaiPan/nvitop) | Apache-2.0 | NVIDIA | an interactive process viewer for NVIDIA GPUs |
| [gpustat](https://github.com/wookayin/gpustat) | MIT | NVIDIA | a one-line status per GPU |
| [amdgpu_top](https://github.com/Umio-Yasuno/amdgpu_top) | MIT | AMD | AMD GPU usage, sensors, per-process |
| [radeontop](https://github.com/clbr/radeontop) | GPL-3.0 | AMD | AMD GPU utilisation |
| `intel_gpu_top` (igt-gpu-tools) | MIT † | Intel | Intel GPU engine usage |
| [glances](https://github.com/nicolargo/glances) | LGPL-3.0 | NVIDIA, AMD | whole-system monitor with a GPU plugin |
| [btop](https://github.com/aristocratos/btop) | Apache-2.0 | NVIDIA, AMD, Intel | resource monitor with GPU panels |

## Overlays (gaming community)

| software | licence | what it is |
|---|---|---|
| [MangoHud](https://github.com/flightlessmango/MangoHud) | MIT | Vulkan/OpenGL overlay: FPS, frame times, CPU/GPU load, temperatures, logging |
| MSI Afterburner + RivaTuner Statistics Server | freeware, proprietary | the Windows standard overlay, with fan curves and overclocking |
| NVIDIA FrameView / GeForce overlay | proprietary | frame time and power per frame |
| AMD Adrenalin metrics overlay | proprietary | AMD's in-driver overlay |
| Steam overlay performance monitor | proprietary | FPS and system load in Steam games |

## Benchmarks and stress

| software | licence | what it measures |
|---|---|---|
| [glmark2](https://github.com/glmark2/glmark2) | GPL-3.0 | OpenGL (ES) 2.0 rendering score |
| [vkmark](https://github.com/vkmark/vkmark) | LGPL-2.1 | Vulkan rendering score |
| 3DMark (UL) | proprietary | the reference gaming benchmark suite |
| Unigine Heaven / Valley / Superposition | freeware, proprietary | engine-based rendering and stability |
| GFXBench (Kishonti) | proprietary | cross-platform GPU benchmark; detect-gpu's data source |
| FurMark (Geeks3D) | freeware, proprietary | thermal and power stress |
| OCCT | freeware, proprietary | GPU (and CPU) stability and VRAM error tests |
| [ROCm Validation Suite](https://github.com/ROCm/ROCmValidationSuite) | MIT | AMD compute stress, bandwidth and validation |
| [NVIDIA DCGM](https://github.com/NVIDIA/DCGM) (`dcgmi diag`) | Apache-2.0 | NVIDIA datacenter diagnostics: memory, PCIe, stress, health |

## Tuning and control

| software | licence | what it controls |
|---|---|---|
| [LACT](https://github.com/ilya-zlobintsev/LACT) | MIT | Linux GPU configuration and monitoring: clocks, power, fans (AMD, NVIDIA, Intel) |
| CoreCtrl | GPL-3.0 † | Linux AMD profiles: power, clocks, fans |
| GreenWithEnvy | GPL-3.0 † | Linux NVIDIA tuning and fans |
| MSI Afterburner | freeware, proprietary | Windows overclocking and fan curves |
| `nvidia-settings` / `nvidia-smi -pl` | proprietary | NVIDIA power limits and clocks |

## Vendor tools (NVIDIA, AMD, Intel)

| vendor | software | licence | what it is |
|---|---|---|---|
| NVIDIA | NVML ([go-nvml](https://github.com/NVIDIA/go-nvml) bindings) | Apache-2.0 bindings over the driver's library | the management library behind `nvidia-smi` |
| NVIDIA | [DCGM](https://github.com/NVIDIA/DCGM) | Apache-2.0 | datacenter health, diagnostics, policies |
| NVIDIA | Nsight Systems / Compute | proprietary | profilers |
| AMD | AMD SMI (ROCm, [ROCm/rocm-systems](https://github.com/ROCm/rocm-systems)) | per component (open) | the successor to ROCm SMI: management and monitoring |
| AMD | [ROCm Validation Suite](https://github.com/ROCm/ROCmValidationSuite) | MIT | validation and stress |
| AMD | Radeon GPU Profiler, GPUOpen tools | MIT (most GPUOpen) † | profilers and analysers |
| Intel | igt-gpu-tools (`intel_gpu_top`) | MIT † | Intel GPU tests and monitoring |
| Intel | VTune | proprietary | profiler |

## What browseML does with it

| need | the established tool | browseML, in the page |
|---|---|---|
| which GPU is this | GPU-Z, GPU-T, `vulkaninfo`, webgpureport | `gpu.ts readGpu`: WebGPU adapter (vendor, architecture, device, fallback), features, limits; WebGL renderer as fallback |
| how fast is it | 3DMark, GFXBench, glmark2, vkmark | `probeGpu`: f32 multiply-add throughput (GFLOP/s) and storage bandwidth (GB/s), measured on this GPU |
| can it compute exactly | DCGM / RVS (validation) | `probeGpu`: is `fma` fused (exact), does the compiler contract `a·b + c`: the precondition for a bankML-exact kernel |
| what is it doing now | nvtop, amdgpu_top, MangoHud | the control panel's GPU section (WebGPU reports no live utilisation or temperature to a page; only what it runs and measures) |
| how much may it take | LACT, Afterburner power limits | the control panel's limiters (the GPU probe on request only; low-power or high-performance adapter) |

**Next, in-house:** browseML's Q1_0 matrix-vector kernel in WGSL, ported from bankML's Vulkan kernel, held bit for bit
to the CPU engine (its scalar reference) and to llama.cpp, and used only on a GPU whose probe says it can be exact.
