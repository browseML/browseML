// SPDX-License-Identifier: MIT OR Apache-2.0
// The GPU worker in the browser: holds the WebGPU device (navigator.gpu) and serves the engine's bankml_gpu_* calls,
// as testing/gpu-worker.mjs does through Dawn in Node. The engine worker starts it before the engine, and talks to it
// through a MessagePort while its own thread blocks in Atomics.wait.
//   engine worker → here  {type: "init", port, ctrl, memory, power}
//   here → engine worker  {type: "ready", adapter}   (adapter "" when this browser offers no WebGPU here)
import { adapterText, serveGpu } from "./browseml-gpu-host.js";

onmessage = async (e) => {
  const { type, port, ctrl, memory, power = "high-performance" } = e.data;
  if (type !== "init") return;
  const gpu = self.navigator && self.navigator.gpu;
  let adapter = "";
  try { adapter = await adapterText(gpu, power); } catch { adapter = ""; }
  if (adapter) {
    serveGpu({ gpu, onMessage: (f) => { port.onmessage = (m) => f(m.data); }, ctrl, memory, power });
  }
  postMessage({ type: "ready", adapter });
};
