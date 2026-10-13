// SPDX-License-Identifier: MIT OR Apache-2.0
// The GPU worker for Node (Dawn, the `webgpu` package): serves the engine's bankml_gpu_* calls, as the page's
// browseml-gpu-worker.js does on navigator.gpu. workerData: { memory, ctrl, power, dawn } (dawn: a directory whose
// node_modules holds `webgpu`).
import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { join } from "node:path";
import { adapterText, serveGpu } from "../web/browseml-gpu-host.js";

const { memory, ctrl, power = "high-performance", dawn } = workerData;
const { create, globals } = createRequire(join(dawn, "package.json"))("webgpu");
Object.assign(globalThis, globals);
const gpu = create([]);
const adapter = await adapterText(gpu, power);
serveGpu({ gpu, onMessage: (f) => parentPort.on("message", f), ctrl, memory, power });
parentPort.postMessage({ type: "ready", adapter });
