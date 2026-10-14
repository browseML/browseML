// SPDX-License-Identifier: MIT OR Apache-2.0
// The GPU for bankML's engine in a browser: the engine's `bankml_gpu_*` imports (bankML's gpu/compute_webgpu.rs) and
// the GPU worker that serves them. bankML's own GPU worker — its verification of the card, its calibration, its
// limiter — runs unchanged on top: a WebGPU device computes rows only after it reproduced the CPU kernel's bits.
//
//   engine thread (a worker; may block)                    GPU worker (owns the WebGPU device)
//   gpuEnv(bridge).bankml_gpu_write/submit  ── post ──▶    writeBuffer · dispatch · copy the result
//   gpuEnv(bridge).bankml_gpu_wait          ◀─ Atomics ──  into the output's mirror in the engine's memory
//
// It needs the threaded build's shared memory (the GPU worker writes results into it), which cross-origin isolation —
// already needed for threads — gives. With no bridge, every import answers "no GPU", so any host can load the engine.
//
// The kernels are bankML's (gpu/wgsl.rs): the engine hands over each shader's text and the vendor's workgroup size,
// and the GPU worker compiles what it is given. browseML's copy (browseml-gpu.js, for EXACT and the tests) is checked
// identical to the engine's by the release gate (testing/gpu.mjs).

/** The engine's imports. `bridge`: from `connectGpu`, or null (no GPU). */
export function gpuEnv(bridge) {
  if (!bridge) {
    const no = () => 0;
    return { bankml_gpu_adapter: no, bankml_gpu_open: no, bankml_gpu_buffer: no, bankml_gpu_write: no, bankml_gpu_free: () => {},
             bankml_gpu_pipeline: no, bankml_gpu_submit: no, bankml_gpu_wait: no, bankml_gpu_allocated: no };
  }
  const mem = () => bridge.memory.buffer;
  let nextId = 1;
  const sizes = new Map();
  return {
    bankml_gpu_adapter(out, cap) {
      const b = new TextEncoder().encode(bridge.adapter || "");
      if (!b.length || b.length > cap) return 0;
      new Uint8Array(mem(), out, b.length).set(b);
      return b.length;
    },
    bankml_gpu_open: () => bridge.call({ op: "open" }),
    bankml_gpu_buffer(bytes) { const id = nextId++; sizes.set(id, bytes); bridge.post({ op: "buffer", id, bytes }); return id; },
    bankml_gpu_write: (id, ptr, len, wait) => (wait ? bridge.call({ op: "write", id, ptr, len }) : (bridge.post({ op: "write", id, ptr, len }), 1)),
    bankml_gpu_free(id) { sizes.delete(id); bridge.post({ op: "free", id }); },
    bankml_gpu_pipeline(code, len, wg, bindings, tile = 1) {
      // the shader's text, copied out of the engine's memory now (the GPU worker compiles it in order); tile: tokens
      // per invocation (bankML's Q1_0_MM4 reads prompts four at a time)
      const id = nextId++, text = new TextDecoder().decode(new Uint8Array(mem(), code, len).slice());
      bridge.post({ op: "pipeline", id, code: text, wg, bindings, tile: tile || 1 });
      return id;
    },
    bankml_gpu_submit(pipe, idsPtr, n, pushPtr, np, outPtr, outLen) {
      const ids = Array.from(new Uint32Array(mem(), idsPtr, n)), push = Array.from(new Uint32Array(mem(), pushPtr, np));
      bridge.post({ op: "submit", pipe, ids, push, outPtr, outLen });
      return 1;
    },
    bankml_gpu_wait: () => bridge.call({ op: "wait" }),
    bankml_gpu_allocated: () => [...sizes.values()].reduce((a, b) => a + b, 0),
  };
}

/** The engine's side of the bridge: `port` reaches the GPU worker; `ctrl` is a SharedArrayBuffer(8) both hold; `memory`
 *  the engine's (shared) WebAssembly.Memory; `adapter` the text `serveGpu` reported. `call` blocks this thread. */
export function connectGpu({ port, ctrl, memory, adapter }) {
  const c = new Int32Array(ctrl);
  return {
    memory, adapter,
    post: (m) => port.postMessage(m),
    call(m) { Atomics.store(c, 0, 0); port.postMessage({ ...m, signal: true }); Atomics.wait(c, 0, 0); return Atomics.load(c, 1); },
  };
}

/** What the GPU worker reports about its adapter: "vendor\tarchitecture\tdescription\tkind\theap\tsubgroup" ("" when
 *  none; subgroup: the largest subgroup size, 0 when unknown — bankML picks the workgroup from it and the vendor). */
export async function adapterText(gpu, power = "high-performance") {
  const a = gpu && (await gpu.requestAdapter({ powerPreference: power }));
  if (!a) return "";
  const i = a.info || {};
  const kind = i.isFallbackAdapter || a.isFallbackAdapter ? "cpu" : "integrated";  // WebGPU does not say discrete; the calibration decides
  return [i.vendor || "", i.architecture || "", i.description || i.device || "", kind, String(a.limits.maxBufferSize || 0), String(i.subgroupMaxSize || 0)].join("\t");
}

/** The GPU worker: serve the engine's calls on `gpu` (navigator.gpu, or Dawn's in Node). `onMessage(f)` registers the
 *  message handler; `ctrl` and `memory` as in `connectGpu`. Calls run strictly in order. */
export function serveGpu({ gpu, onMessage, ctrl, memory, power = "high-performance" }) {
  const c = new Int32Array(ctrl);
  const U = globalThis.GPUBufferUsage, MAP = globalThis.GPUMapMode;
  // pending: every submit since the last wait (bankML may put several in flight: Q/K/V, gate/up); each output buffer
  // has its own staging buffer, so their results never share one
  let device = null, chain = Promise.resolve(), pending = [];
  const bufs = new Map(), pipes = new Map(), groups = new Map(), staging = new Map();
  const signal = (v) => { Atomics.store(c, 1, v); Atomics.store(c, 0, 1); Atomics.notify(c, 0); };
  const view = (ptr, len) => new Uint8Array(memory.buffer, ptr, len);

  const ops = {
    async open() {
      const a = await gpu.requestAdapter({ powerPreference: power });
      if (!a) return 0;
      device = await a.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxBufferSize: a.limits.maxBufferSize } });
      device.lost.then(() => { device = null; });
      return 1;
    },
    buffer({ id, bytes }) {
      bufs.set(id, device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }));
      return 1;
    },
    write({ id, ptr, len }) {
      // copied out of the shared memory at once (a SharedArrayBuffer view may not go to the device directly)
      const pad = Math.ceil(len / 4) * 4, src = view(ptr, len);
      const data = new Uint8Array(pad); data.set(src);
      device.queue.writeBuffer(bufs.get(id), 0, data);
      return 1;
    },
    free({ id }) { bufs.get(id)?.destroy(); bufs.delete(id); staging.get(id)?.destroy(); staging.delete(id); groups.forEach((_, k) => { if (k.split(",").includes(String(id))) groups.delete(k); }); return 1; },
    pipeline({ id, code, wg, tile = 1 }) {
      // bankML's kernel (gpu/wgsl.rs), its workgroup the vendor's (bankML chooses it)
      const module = device.createShaderModule({ code });
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main", constants: { WG: wg } } });
      pipes.set(id, { pipeline, wg, tile, uniform: device.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }) });
      return 1;
    },
    submit({ pipe, ids, push, outPtr, outLen }) {
      // rows, blocks per row, activations (one, or a micro-batch's tokens when the engine reads a prompt), the zero
      const p = pipes.get(pipe), [rows, nb, cols = 1] = push;
      device.queue.writeBuffer(p.uniform, 0, new Uint32Array([rows, nb, cols, 0]));
      const key = `${pipe}:${ids.join(",")}`;
      if (!groups.has(key)) groups.set(key, device.createBindGroup({ layout: p.pipeline.getBindGroupLayout(0),
        entries: [...ids.map((i) => bufs.get(i)), p.uniform].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
      const size = Math.ceil(outLen / 4) * 4, oid = ids[ids.length - 1];
      let st = staging.get(oid);
      if (st && st.size < size) { st.destroy(); st = null; }
      if (!st) { st = device.createBuffer({ size, usage: U.MAP_READ | U.COPY_DST }); staging.set(oid, st); }
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass(); pass.setPipeline(p.pipeline); pass.setBindGroup(0, groups.get(key));
      pass.dispatchWorkgroups(Math.ceil((rows * 8) / p.wg), Math.ceil(cols / p.tile)); pass.end();
      enc.copyBufferToBuffer(bufs.get(ids[ids.length - 1]), 0, st, 0, size);
      device.queue.submit([enc.finish()]);
      pending.push(st.mapAsync(MAP.READ, 0, size).then(() => {
        view(outPtr, outLen).set(new Uint8Array(st.getMappedRange(0, size)).subarray(0, outLen));
        st.unmap();
        return true;
      }, () => false));
      return 1;
    },
    async wait() { const all = pending; pending = []; return (await Promise.all(all)).every(Boolean) ? 1 : 0; },
  };

  onMessage((m) => {
    chain = chain.then(async () => {
      let r = 0;
      try { r = device || m.op === "open" ? await ops[m.op](m) : 0; } catch { r = 0; }
      if (m.signal) signal(r);
    });
  });
}
