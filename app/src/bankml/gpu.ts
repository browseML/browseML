// SPDX-License-Identifier: MIT
// The visitor's GPU, as this browser shows it, and measured: WebGPU's adapter (vendor, architecture, features,
// limits, whether it is a software fallback) with WebGL's renderer as the fallback report; then, on request, three
// compute probes on that GPU — whether its fused multiply-add is exact (the precondition bankML's GPU kernels are held
// to; see bankML/gpu/spirv.rs fma_exact), its f32 throughput, and its memory bandwidth — each timed by the browser.
// Nothing is sent anywhere. browseML answers on the CPU today; this is how a GPU earns its way into the engine: an
// exact kernel, proven bit for bit as bankML's Vulkan Q1_0 kernel is, never a faster approximate one.
// The approach follows the open references: the WebGPU spec and gpuweb/cts (BSD-3-Clause) for features and limits,
// webglreport (Apache-2.0) for the WebGL renderer; the code here is this repository's own.

export interface GpuReport {
  webgpu: boolean;
  /** Why there is no adapter (no WebGPU in this browser, the adapter refused, an error). */
  reason?: string;
  adapter?: {
    vendor: string; architecture: string; device: string; description: string;
    /** A software adapter (no real GPU behind it). */
    fallback: boolean;
    features: string[];
    limits: Record<string, number>;
  };
  webgl?: { vendor: string; renderer: string; version: string };
}

/** The limits worth showing for compute (the full set is in the adapter). */
export const KEY_LIMITS = [
  'maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupsPerDimension', 'maxStorageBuffersPerShaderStage',
] as const;
/** The features that matter for low-bit kernels. */
export const KEY_FEATURES = ['shader-f16', 'subgroups', 'timestamp-query', 'chromium-experimental-subgroup-matrix', 'float32-filterable'] as const;

type GpuLike = { requestAdapter(o?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<any> };
const gpuOf = (): GpuLike | null => (typeof navigator !== 'undefined' && (navigator as Navigator & { gpu?: GpuLike }).gpu) || null;

function webglReport(): GpuReport['webgl'] {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return undefined;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) || ''),
      renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '').replace(/^ANGLE \((.*)\)$/, '$1'),
      version: String(gl.getParameter(gl.VERSION) || ''),
    };
  } catch { return undefined; }
}

/** What this browser says about its GPU (no device is created, nothing is run). */
export async function readGpu(powerPreference: 'low-power' | 'high-performance' = 'high-performance'): Promise<GpuReport> {
  const webgl = webglReport();
  const gpu = gpuOf();
  if (!gpu) return { webgpu: false, reason: 'this browser has no WebGPU (or it is turned off)', webgl };
  try {
    const a = await gpu.requestAdapter({ powerPreference });
    if (!a) return { webgpu: false, reason: 'WebGPU is here, but no adapter was offered (a blocklisted driver, or none available)', webgl };
    const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
    const limits: Record<string, number> = {};
    for (const k of KEY_LIMITS) if (typeof a.limits?.[k] === 'number') limits[k] = a.limits[k];
    return {
      webgpu: true, webgl,
      adapter: {
        vendor: String(info.vendor ?? ''), architecture: String(info.architecture ?? ''), device: String(info.device ?? ''),
        description: String(info.description ?? ''), fallback: !!(info.isFallbackAdapter ?? a.isFallbackAdapter),
        features: [...(a.features ?? [])].map(String).sort(), limits,
      },
    };
  } catch (e) {
    return { webgpu: false, reason: `the adapter could not be read: ${String((e as Error).message || e)}`, webgl };
  }
}

export interface GpuProbe {
  /** fma(a, b, c) with a = 1 + 2⁻²³, b = 1 − 2⁻²³, c = −1: −2⁻⁴⁶ when fused (exact), 0 when rounded twice. */
  fma: { fused: boolean; value: number };
  /** a·b + c written apart: whether the shader compiler fuses it anyway (which an exact kernel must know). */
  contracted: boolean;
  /** f32 multiply-adds per second (as GFLOP/s, two flops each), timed around the dispatch. */
  gflops: number;
  /** Bytes read and written per second through a storage buffer (GB/s). */
  bandwidth: number;
  ms: number;
}

const FMA_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> inp: array<f32, 3>;
@group(0) @binding(1) var<storage, read_write> out: array<f32, 2>;
@compute @workgroup_size(1) fn main() {
  out[0] = fma(inp[0], inp[1], inp[2]);
  out[1] = inp[0] * inp[1] + inp[2];
}`;
// each invocation: 1024 iterations of 4 independent vec4 multiply-adds (32 flops each)
const FLOPS_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<vec4<f32>>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var a = vec4<f32>(f32(id.x) * 1e-7, 1.0, 0.5, 0.25);
  var b = a + vec4<f32>(0.1); var c = a + vec4<f32>(0.2); var d = a + vec4<f32>(0.3);
  let m = vec4<f32>(0.9999); let k = vec4<f32>(0.0001);
  for (var i = 0u; i < 1024u; i++) { a = fma(a, m, k); b = fma(b, m, k); c = fma(c, m, k); d = fma(d, m, k); }
  out[id.x] = a + b + c + d;
}`;
const COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read_write> dst: array<vec4<u32>>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&src)) { dst[id.x] = src[id.x]; }
}`;

/** Run the three probes on the GPU (a device for a moment, then destroyed). */
export async function probeGpu(powerPreference: 'low-power' | 'high-performance' = 'high-performance'): Promise<GpuProbe> {
  const gpu = gpuOf();
  if (!gpu) throw new Error('this browser has no WebGPU');
  const adapter = await gpu.requestAdapter({ powerPreference });
  if (!adapter) throw new Error('no WebGPU adapter was offered');
  const device = await adapter.requestDevice();
  const G = (globalThis as unknown as { GPUBufferUsage: Record<string, number>; GPUMapMode: Record<string, number> });
  const U = G.GPUBufferUsage, MAP = G.GPUMapMode;
  const t0 = performance.now();
  const run = async (code: string, buffers: { size: number; data?: ArrayBufferView; read?: boolean }[], groups: number) => {
    const module = device.createShaderModule({ code });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bufs = buffers.map(b => {
      const buf = device.createBuffer({ size: b.size, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
      if (b.data) device.queue.writeBuffer(buf, 0, b.data);
      return buf;
    });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    await device.queue.onSubmittedWorkDone();
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(groups); pass.end();
    const readIdx = buffers.findIndex(b => b.read);
    let staging: any = null;
    if (readIdx >= 0) {
      staging = device.createBuffer({ size: buffers[readIdx].size, usage: U.MAP_READ | U.COPY_DST });
      enc.copyBufferToBuffer(bufs[readIdx], 0, staging, 0, buffers[readIdx].size);
    }
    const t = performance.now();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t;
    let out: Float32Array | null = null;
    if (staging) { await staging.mapAsync(MAP.READ); out = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy(); }
    bufs.forEach(b => b.destroy());
    return { ms, out };
  };
  try {
    // 1. exactness: is fma fused, and does the compiler contract a separate multiply and add
    const a = 1 + 2 ** -23, b = 1 - 2 ** -23;
    const f = await run(FMA_WGSL, [{ size: 16, data: new Float32Array([a, b, -1, 0]) }, { size: 8, read: true }], 1);
    const fusedValue = f.out![0], contracted = f.out![1] !== 0;
    // 2. throughput: warm once, then time (65,536 invocations × 1024 iterations × 32 flops)
    const inv = 256 * 256;
    await run(FLOPS_WGSL, [{ size: inv * 16 }], 256);
    const t = await run(FLOPS_WGSL, [{ size: inv * 16, read: true }], 256);
    const gflops = (inv * 1024 * 32) / (t.ms / 1000) / 1e9;
    // 3. bandwidth: 64 MB read and 64 MB written
    const size = Math.min(64 << 20, Math.floor((adapter.limits?.maxStorageBufferBindingSize ?? 128 << 20) / 2));
    const n = size / 16;
    await run(COPY_WGSL, [{ size }, { size }], Math.ceil(n / 256));
    const c = await run(COPY_WGSL, [{ size }, { size }], Math.ceil(n / 256));
    const bandwidth = (2 * size) / (c.ms / 1000) / 1e9;
    return { fma: { fused: fusedValue === -(2 ** -46), value: fusedValue }, contracted, gflops, bandwidth, ms: performance.now() - t0 };
  } finally {
    device.destroy();
  }
}

/** A plain reading of what was found: where this GPU stands for browseML, honestly. */
export function gpuVerdict(r: GpuReport, p: GpuProbe | null): { level: 'ok' | 'warn' | 'bad'; text: string } {
  if (!r.webgpu) return { level: 'warn', text: `no WebGPU here (${r.reason}); browseML answers on the CPU` };
  if (r.adapter?.fallback) return { level: 'warn', text: 'WebGPU runs on a software adapter here (no real GPU): browseML answers on the CPU' };
  if (!p) return { level: 'ok', text: 'a WebGPU adapter is here; PROBE measures it (browseML answers on the CPU today)' };
  if (!p.fma.fused) return { level: 'warn', text: "this GPU's fma is not fused: an exact kernel would need bankML's exact-FMA route (as on the Vega 3)" };
  return { level: 'ok', text: `fma fused (exact) · ${p.gflops.toFixed(0)} GFLOP/s · ${p.bandwidth.toFixed(1)} GB/s: ready for an exact kernel when browseML has one` };
}
