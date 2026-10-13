// SPDX-License-Identifier: MIT
// The control panel's tools: the classics (ping, speedtest, sysbench cpu and memory, a disk test, sensors) done the way
// a web page can, measured here and never sent anywhere — except the requests PING and SPEED make to the model's
// source. Each says what it measured and how; see docs/cpu-software.md for the tools they follow.
import { MODEL_BYTES } from '../bankml/caps';

const MODEL_URL = 'https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/210a9e99f79cb184909d49595906526eb2b3dd9a/Bonsai-1.7B-Q1_0.gguf';
const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1; return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : 0; };

export interface PingResult { sent: number; ok: number; min: number; median: number; max: number; jitter: number; times: number[] }
/** PING: timed HTTP HEAD requests to the model's source (a page cannot send ICMP). The first is DNS + TLS warm-up. */
export async function ping(count = 5, url = MODEL_URL): Promise<PingResult> {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = performance.now();
    try { await fetch(url, { method: 'HEAD', cache: 'no-store', redirect: 'manual' }); times.push(performance.now() - t); } catch { /* lost */ }
  }
  const d = times.slice(1).map((t, i) => Math.abs(t - times[i]));
  return { sent: count, ok: times.length, min: Math.min(...times), median: median(times), max: Math.max(...times), jitter: d.length ? median(d) : 0, times };
}

export interface SpeedResult { bytes: number; ms: number; mbps: number }
/** SPEED: an HTTP Range request for `mb` megabytes of the model (thrown away), MB/s over the body. */
export async function speed(mb = 16, url = MODEL_URL): Promise<SpeedResult> {
  const want = Math.min(MODEL_BYTES, Math.round(mb * 1e6));
  const r = await fetch(url, { headers: { Range: `bytes=0-${want - 1}` }, cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const reader = r.body!.getReader();
  let bytes = 0, t = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!t) t = performance.now();  // from the first byte: throughput, not latency
    bytes += value.length;
  }
  const ms = performance.now() - t;
  return { bytes, ms, mbps: bytes / 1e6 / (ms / 1000) };
}

/** The same work on every worker: integer mixing and float multiply-adds, for a fixed time; returns operations. */
const CPU_WORKER = `onmessage = (e) => {
  const end = performance.now() + e.data.ms; let ops = 0, x = 1 | 0, f = 1.000001;
  while (performance.now() < end) {
    for (let i = 0; i < 20000; i++) { x = (x ^ (x << 13)) | 0; x = (x ^ (x >>> 17)) | 0; x = (x ^ (x << 5)) | 0; f = f * 1.0000001 + 1e-9; }
    ops += 20000;
  }
  postMessage({ ops, sink: x + f });
};`;
export interface CpuResult { workers: number; perWorker: number; total: number; scaling: number; single: number }
/** CPU: one worker, then `workers` at once, the same work for `ms` each: Mops/s per worker and how it scales. */
export async function cpu(workers = navigator.hardwareConcurrency || 2, ms = 1500): Promise<CpuResult> {
  const url = URL.createObjectURL(new Blob([CPU_WORKER], { type: 'text/javascript' }));
  const run = (n: number) => Promise.all(Array.from({ length: n }, () => new Promise<number>(ok => {
    const w = new Worker(url);
    w.onmessage = e => { ok(e.data.ops); w.terminate(); };
    w.postMessage({ ms });
  })));
  try {
    const one = (await run(1))[0] / (ms / 1000) / 1e6;
    const many = (await run(workers)).reduce((a, b) => a + b, 0) / (ms / 1000) / 1e6;
    return { workers, single: one, total: many, perWorker: many / workers, scaling: many / one };
  } finally { URL.revokeObjectURL(url); }
}

export interface MemoryResult { mb: number; copy: number; triad: number }
/** MEMORY: STREAM's copy and triad over Float64Arrays of `mb` MB each (larger than the caches), GB/s, best of 3. */
export function memory(mb = 64): MemoryResult {
  const n = Math.floor((mb * 1e6) / 8);
  const a = new Float64Array(n), b = new Float64Array(n).fill(1), c = new Float64Array(n).fill(2);
  let copy = 0, triad = 0;
  for (let r = 0; r < 3; r++) {
    let t = performance.now(); a.set(b); let s = (performance.now() - t) / 1000;
    copy = Math.max(copy, (2 * n * 8) / s / 1e9);
    t = performance.now(); for (let i = 0; i < n; i++) a[i] = b[i] + 3 * c[i]; s = (performance.now() - t) / 1000;
    triad = Math.max(triad, (3 * n * 8) / s / 1e9);
  }
  return { mb, copy, triad };
}

export interface StorageResult { mb: number; write: number; read: number }
/** STORAGE: a blob of `mb` MB written to and read back from Cache Storage (MB/s), then removed. */
export async function storage(mb = 32): Promise<StorageResult> {
  const bytes = new Uint8Array(Math.round(mb * 1e6));
  for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i & 255;
  const c = await caches.open('browseml-tooltest');
  const key = 'https://browseml.invalid/tooltest';
  try {
    let t = performance.now();
    await c.put(key, new Response(bytes));
    const write = mb / ((performance.now() - t) / 1000);
    t = performance.now();
    const back = await (await c.match(key))!.arrayBuffer();
    const read = back.byteLength / 1e6 / ((performance.now() - t) / 1000);
    return { mb, write, read };
  } finally { await caches.delete('browseml-tooltest'); }
}

export interface Sensors {
  online: boolean;
  connection: { type?: string; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } | null;
  battery: { level: number; charging: boolean } | null;
  cores: number | null; memoryGB: number | null; isolated: boolean;
  heapMB: number | null;
}
/** SENSORS: what this browser reports about the device and its connection (no request is made). */
export async function sensors(): Promise<Sensors> {
  const n = navigator as Navigator & { connection?: Record<string, unknown>; deviceMemory?: number; getBattery?: () => Promise<{ level: number; charging: boolean }> };
  let battery: Sensors['battery'] = null;
  try { const b = await n.getBattery?.(); if (b) battery = { level: b.level, charging: b.charging }; } catch { /* not offered */ }
  const c = n.connection;
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  return {
    online: navigator.onLine,
    connection: c ? { type: c.type as string | undefined, effectiveType: c.effectiveType as string | undefined, downlink: c.downlink as number | undefined, rtt: c.rtt as number | undefined, saveData: c.saveData as boolean | undefined } : null,
    battery, cores: n.hardwareConcurrency || null, memoryGB: n.deviceMemory ?? null,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated, heapMB: heap ? heap / 1e6 : null,
  };
}

export interface Available { reported: number | null; available: number; claim: number; totals: number[]; ms: number }
/** How much processor this computer has free right now, measured: bursts of 1, 2, 3 … workers (up to `cap`); each
 *  worker that adds real throughput (≥ 12% more in total) is a thread available, and the count stops where adding one
 *  gains nothing (all cores busy, or another program has them). Past the cores the browser reports, too (Brave reports
 *  fewer). The claim leaves room for the unexpected: one thread when four or more are free. */
export async function availableThreads(cap = 8, ms = 220): Promise<Available> {
  const url = URL.createObjectURL(new Blob([CPU_WORKER], { type: 'text/javascript' }));
  const t0 = performance.now();
  const run = (n: number) => Promise.all(Array.from({ length: n }, () => new Promise<number>(ok => {
    const w = new Worker(url);
    w.onmessage = e => { ok(e.data.ops); w.terminate(); };
    w.postMessage({ ms });
  }))).then(v => v.reduce((a, b) => a + b, 0));
  try {
    const totals = [await run(1)];
    let available = 1;
    for (let n = 2; n <= cap; n++) {
      const t = await run(n);
      totals.push(t);
      if (t < totals[n - 2] * 1.12) break;
      available = n;
    }
    return { reported: navigator.hardwareConcurrency || null, available, claim: claimOf(available), totals, ms: Math.round(performance.now() - t0) };
  } finally { URL.revokeObjectURL(url); }
}
/** What browseML takes of `available` threads: all of them up to three, one fewer from four (room for the page and
 *  for anything unexpected). Pure, so tested. */
export function claimOf(available: number): number { return Math.max(1, available >= 4 ? available - 1 : available); }
