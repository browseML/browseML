// SPDX-License-Identifier: MIT OR Apache-2.0
// browseML — bankML in this browser. The model is downloaded once from its Hugging Face repository at a pinned
// revision and kept in this browser's Cache Storage; bankML's own engine, compiled to WebAssembly, verifies it
// against its FORK.json (the guard, then the sha256 pin) before it answers, and puts a receipt on every answer —
// the same receipt `bankml serve` gives. The visitor's CPU does the work: no server, no account, no quota.

export const MODEL = {
  name: "Bonsai-1.7B-Q1_0.gguf",
  title: "Bonsai-1.7B · 1-bit (Q1_0)",
  bytes: 248302272,
  url: "https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/210a9e99f79cb184909d49595906526eb2b3dd9a/Bonsai-1.7B-Q1_0.gguf",
  fork: "browseML/Bonsai-1.7B-Q1_0.gguf.FORK.json",
  // two verified sources, the same bytes: Hugging Face (the model's home, at its pinned revision) and browseML/models
  // (a copy at a pinned commit, checked against the source's own hashes). The pin decides whichever answered.
  sources: [
    "https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/210a9e99f79cb184909d49595906526eb2b3dd9a/Bonsai-1.7B-Q1_0.gguf",
    "https://media.githubusercontent.com/media/browseML/models/95747a39b6373f44cc4ddbc155b61d5c674334a4/bonsai-1.7b-q1_0/Bonsai-1.7B-Q1_0.gguf",
  ],
};
const CACHE = "browseml-models";

let worker = null, ready = null, busy = null, stopFlag = null, ending = null;
/** The engine's WebAssembly memory after its last open or answer, in bytes (0 when not loaded). */
export let memoryBytes = 0;
/** bankML's GPU limiter after the last open or answer (the card, share, busy, products on the card and on the CPU,
 *  shapes decided): what the card actually did. null without a verified card. */
export let gpuStatus = null;
const readGpu = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** The most threads the engine takes, however many cores the browser reports. */
export const MAX_THREADS = 8;
/** Threads are possible here at all (cross-origin isolated, SharedArrayBuffer). */
export const isolated = () => !!(globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined");
/** Threads for the engine by default: every core this browser reports (up to MAX_THREADS), when the page is cross-origin
 *  isolated (COOP and COEP); otherwise one. A visitor may ask for up to MAX_THREADS: some browsers (Brave) report
 *  fewer cores than the computer has. */
export const threads = () => (isolated() ? Math.max(1, Math.min(MAX_THREADS, navigator.hardwareConcurrency || 1)) : 1);

/** The model in this browser's cache, or null. */
async function cached() {
  try { const c = await caches.open(CACHE); const r = await c.match(MODEL.url); return r ? await r.arrayBuffer() : null; } catch { return null; }
}

/** The download in pieces: one long response can be cut mid-body (seen in Brave on Linux: "TypeError: network error"
 *  at 57 MB and at 219 MB of 248, where curl on the same machine got the whole file), and a cut late in one stream
 *  would cost the whole download. Each piece is an HTTP Range request, retried on its own, so a cut costs at most one
 *  piece's remainder (asked for again from the byte where it was cut) and the download goes on. */
export const PIECE = 16 * 1024 * 1024;
const TRIES = 6;
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Download the model (or take it from the cache), with progress as (bytes, total, phase); phase "retry" when a cut
 *  piece is asked for again (bytes: where it resumes). */
async function fetchModel(progress, { signal } = {}) {
  const kept = await cached();
  if (kept && kept.byteLength === MODEL.bytes) { progress(kept.byteLength, MODEL.bytes, "cache"); return kept; }
  const buf = await download(MODEL.sources, MODEL.bytes, progress, { signal });
  // kept for the next visit (put finishes reading the buffer before it is handed to the engine); a private window or
  // a full disk just means downloading again
  try { const c = await caches.open(CACHE); await c.put(MODEL.url, new Response(buf, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(MODEL.bytes) } })); } catch {}
  return buf.buffer;
}

/** `total` bytes from `url` (or a list of sources holding the same bytes) in pieces, each retried from the byte where it
 *  was cut — on the next source when there is one; progress as fetchModel's. */
export async function download(url, total, progress, { signal, piece = PIECE, pauseMs = 500 } = {}) {
  const sources = Array.isArray(url) ? url : [url];
  let prefer = 0;  // the source that answered last: the next piece asks it first
  const buf = new Uint8Array(total);
  let got = 0;
  const seen = (n) => { got = n; progress(n, total, "download"); };
  while (got < total) {
    const end = Math.min(total, got + piece) - 1;
    for (let tryNo = 1; ; tryNo++) {
      // a retry asks from the exact byte: what arrived of the cut piece is already in buf
      const from = got;
      try {
        // the source that answered last first; a retry moves to the next one (and back), so one source down is no stop
        const at = (prefer + tryNo - 1) % sources.length;
        const r = await fetch(sources[at], { headers: { Range: `bytes=${from}-${end}` }, signal });
        if (r.status === 200 && from === 0) {
          // a server that ignores Range sends the whole file: take it as one stream
          await readInto(r, buf, 0, total, seen);
          if (got !== total) throw new Error(`the download stopped at ${got} of ${total} bytes`);
          break;
        }
        if (r.status !== 206) throw Object.assign(new Error(`the model could not be downloaded: HTTP ${r.status}`), { final: r.status >= 400 && r.status < 500 });
        await readInto(r, buf, from, end + 1, seen);
        if (got !== end + 1) throw new Error(`a piece stopped at ${got} of ${end + 1} bytes`);
        prefer = at;
        break;
      } catch (e) {
        if ((signal && signal.aborted) || e.final) throw e;  // stopped, or refused (a 4xx is not a cut)
        if (tryNo >= TRIES) throw new Error(`the download failed at ${got} of ${total} bytes after ${TRIES} tries: ${e.message || e}`);
        progress(got, total, "retry");
        await pause(Math.min(8000, pauseMs * 2 ** (tryNo - 1)));
      }
    }
  }
  return buf;
}

/** Read a response's body into buf from `at`, never past `limit`; `seen` gets the running end. */
async function readInto(r, buf, at, limit, seen) {
  const reader = r.body.getReader();
  let n = at;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (n + value.length > limit) throw new Error("the download is longer than the model");
      buf.set(value, n); n += value.length;
      seen(n);
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
}

export const isReady = () => !!ready;
export const isBusy = () => !!busy;
/** Stop the engine and free its memory (the model stays in the browser's cache): new settings apply on the next load. */
export function unload() {
  if (busy) throw new Error("browseML is writing an answer: wait for it to finish");
  if (worker) worker.terminate();
  worker = null; ready = null; memoryBytes = 0; gpuStatus = null;
}
/** Exit cleanly (the page going away, or RESET): an answer being written is stopped and its caller told so, the engine
 *  worker is terminated — and with it its thread workers and its GPU worker, which release their memory and the card —
 *  whatever it was doing. Unlike `unload`, it never refuses. The model stays in this browser. */
export function exit() {
  if (stopFlag) { try { Atomics.store(stopFlag, 0, 1); } catch {} }
  if (ending) { try { ending(); } catch {} }
  if (worker) { try { worker.terminate(); } catch {} }
  worker = null; ready = null; busy = null; loading = null; memoryBytes = 0; gpuStatus = null;
}
/** The model's bytes in this browser's cache, or 0. */
export async function cachedBytes() { try { const r = await (await caches.open(CACHE)).match(MODEL.url); return r ? +(r.headers.get("Content-Length") || MODEL.bytes) : 0; } catch { return 0; } }
export async function isCached() { try { return !!(await (await caches.open(CACHE)).match(MODEL.url)); } catch { return false; } }
export async function forget() { try { await caches.delete(CACHE); await caches.delete(SLOTS); } catch {} }

/**
 * Load bankML in this browser: the model (downloaded or cached), the engine, and bankML's verification.
 * @param {(bytes:number, total:number, phase:string) => void} progress
 * @param {(level:number, text:string) => void} log
 * @returns {Promise<{model, sha256, guard, engine, arch, version, threads}>} what bankML verified, and its threads
 */
let loading = null;
/** A load in progress (a download, the verification), or null. */
export const isLoading = () => !!loading;
export const whenLoaded = () => loading;
export function load(progress = () => {}, log = () => {}, opts = {}) {
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;  // one download at a time: a second caller waits for the first
  loading = loadOnce(progress, log, opts).finally(() => { loading = null; });
  return loading;
}
/** The last load, measured: when each phase ended (ms from the start), the bytes fetched (0: from this browser's
 *  cache), retried pieces, and the engine's WebAssembly memory once open. null before a load finishes. */
export let loadStats = null;
async function loadOnce(progress, log, { threads: want, ctx = 4096, cacheRam = 0, gpu = "off", gpuTime = 80, bytes: given = null, from = "" } = {}) {
  const t0 = performance.now(), st = { fetched: 0, retries: 0, source: "download" };
  const seen = (got, total, phase) => {
    if (phase === "retry") st.retries++;
    else if (phase === "cache") st.source = "cache";
    else if (phase === "download") st.fetched = got;
    progress(got, total, phase);
  };
  // the model's bytes: handed over (read from a folder on this computer: no download, nothing kept here), or from
  // this browser's cache, or downloaded from its sources
  if (given) { st.source = from || "folder"; progress(given.byteLength, MODEL.bytes, "folder"); }
  const [bytes, fork] = await Promise.all([given ? Promise.resolve(given) : fetchModel(seen), fetch(MODEL.fork).then((r) => { if (!r.ok) throw new Error("the model's FORK.json is missing"); return r.text(); })]);
  st.modelMs = Math.round(performance.now() - t0);
  progress(MODEL.bytes, MODEL.bytes, "verify");
  worker = new Worker(new URL("./browseml-worker.js", import.meta.url), { type: "module" });
  const verified = await new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "log") log(m.level, m.text);
      else if (m.type === "opened") { memoryBytes = m.memory || 0; gpuStatus = readGpu(m.gpu); m.rc === 0 ? resolve({ ...JSON.parse(m.out), threads: m.threads, ctx, build: m.build }) : reject(new Error(m.out)); }
    };
    worker.onerror = (e) => reject(new Error(e.message || "the engine could not start"));
    // the STOP flag: shared memory where the page is cross-origin isolated (else stop() ends the engine)
    stopFlag = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated ? new Int32Array(new SharedArrayBuffer(4)) : null;
    worker.postMessage({ type: "open", name: MODEL.name, bytes, fork, threads: Math.max(1, Math.min(isolated() ? MAX_THREADS : 1, want || threads())), ctx, cacheRam, gpu, gpuTime, stop: stopFlag && stopFlag.buffer }, [bytes]);
  });
  loadStats = { ...st, openMs: Math.round(performance.now() - t0) - st.modelMs, totalMs: Math.round(performance.now() - t0), memory: memoryBytes, threads: verified.threads, ctx, cacheRam, gpu, gpuTime, build: verified.build };
  ready = verified;
  return verified;
}

/** The engine's work in order: an answer, a warm-up or a slot waits for the one before it (one engine, one slot). */
let lane = Promise.resolve();
const inLane = (job) => { const run = lane.then(job); lane = run.catch(() => {}); return run; };

/**
 * One answer: an OpenAI-shaped request (messages, max_tokens, …), the pieces as they are written, and the
 * `/v1/chat/completions` object at the end (usage, timings, bankml_receipt). Asked while the engine is busy (an answer,
 * a warm-up), it waits its turn.
 */
export function chat(request, onPiece, log = () => {}) {
  if (!ready) return Promise.reject(new Error("browseML is not loaded"));
  const job = () => new Promise((resolve, reject) => {
    if (!worker) return reject(new Error("browseML is not loaded"));
    busy = true;
    if (stopFlag) Atomics.store(stopFlag, 0, 0);
    ending = () => { busy = null; ending = null; reject(new Error("stopped: the engine was ended (load it again to ask)")); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "piece") onPiece(m.text);
      else if (m.type === "log") log(m.level, m.text);
      else if (m.type === "done") {
        busy = null; ending = null;
        memoryBytes = m.memory || memoryBytes;
        if (m.gpu !== undefined) gpuStatus = readGpu(m.gpu);
        if (m.rc === -99) { ready = null; worker.terminate(); worker = null; }  // the engine trapped: load it again
        const j = (() => { try { return JSON.parse(m.out); } catch { return { error: { message: m.out } }; } })();
        m.rc === 0 ? resolve(j) : reject(new Error(j.error ? j.error.message : m.out));
      }
    };
    worker.postMessage({ type: "chat", request });
  });
  return inLane(job);
}

/**
 * STOP: the answer being written ends at its next piece, and comes back as written so far, with its receipt. Where
 * the page is not cross-origin isolated (no shared memory to reach the busy engine), the engine itself is ended: the
 * model stays in this browser and the next question loads it again.
 * @returns {"stopped"|"ended"|"idle"}
 */
export function stop() {
  if (!busy) return "idle";
  if (stopFlag) { Atomics.store(stopFlag, 0, 1); return "stopped"; }
  if (worker) worker.terminate();
  worker = null; ready = null; memoryBytes = 0; gpuStatus = null;
  if (ending) ending();
  return "ended";
}

/** The engine's slot to or from bytes: "save" resolves to the slot file, "restore" to {tokens, bytes}. */
function slot(action, bytes) {
  return inLane(() => new Promise((resolve, reject) => {
    if (!worker) return reject(new Error("browseML is not loaded"));
    busy = true;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type !== "slotted") return;
      busy = null;
      const j = (() => { try { return JSON.parse(m.out); } catch { return { error: { message: m.out } }; } })();
      if (m.rc !== 0) return reject(new Error(j.error ? j.error.message : m.out));
      resolve(action === "save" ? { ...j, file: new Uint8Array(m.bytes) } : j);
    };
    worker.postMessage({ type: "slot", action, name: "warm.slot", bytes }, bytes ? [bytes] : []);
  }));
}

/** Warm slots, kept in this browser beside the model: one per prompt (each system prompt, context and model has its
 *  own), up to `keep` of them, the least recently used removed first. An index beside them names each one. */
const SLOTS = "browseml-slots";
const INDEX = "https://browseml.invalid/slots-index";
const hex = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function readIndex(c) { try { const r = await c.match(INDEX); return r ? await r.json() : {}; } catch { return {}; } }
async function writeIndex(c, ix) { try { await c.put(INDEX, new Response(JSON.stringify(ix), { headers: { "Content-Type": "application/json" } })); } catch { /* full */ } }
/** The prompts kept, most recently used first: {key, label, tokens, bytes, ctx, created, used}. */
export async function slots() {
  try {
    const c = await caches.open(SLOTS), ix = await readIndex(c), keys = new Set((await c.keys()).map((r) => r.url));
    return Object.entries(ix).filter(([k]) => keys.has(k)).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.used - a.used);
  } catch { return []; }
}
/** Remove one kept prompt (its slot and its line in the index). */
export async function forgetSlot(key) {
  try { const c = await caches.open(SLOTS); await c.delete(key); const ix = await readIndex(c); delete ix[key]; await writeIndex(c, ix); } catch { /* off */ }
}
/** Keep at most `keep` prompts (the least recently used go first; `spare` is never removed). */
async function prune(c, keep, spare) {
  const ix = await readIndex(c);
  // a slot kept before the index (one prompt, browseML ≤ 0.6.4) is not named in it: removed
  for (const r of await c.keys()) if (r.url !== INDEX && r.url !== spare && !ix[r.url]) await c.delete(r);
  const old = Object.entries(ix).filter(([k]) => k !== spare).sort((a, b) => a[1].used - b[1].used);
  while (old.length && old.length + 1 > keep) { const [k] = old.shift(); await c.delete(k); delete ix[k]; }
  await writeIndex(c, ix);
}

export async function warm(system, { log = () => {}, label = "", keep = 4 } = {}) {
  if (!ready) throw new Error("browseML is not loaded");
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  const key = `https://browseml.invalid/slot/${await hex(`${ready.sha256}\n${ready.ctx}\n${system}`)}`;
  let c = null;
  try { c = await caches.open(SLOTS); } catch { /* no Cache Storage: warm for this visit only */ }
  try {
    const kept = c && (await c.match(key));
    if (kept) {
      const r = await slot("restore", await kept.arrayBuffer());
      const ix = await readIndex(c);
      ix[key] = { ...(ix[key] || { label, tokens: r.tokens, bytes: r.bytes, ctx: ready.ctx, created: Date.now() }), label: label || ix[key]?.label || "", used: Date.now() };
      await writeIndex(c, ix);
      return { how: "restored", tokens: r.tokens, bytes: r.bytes, ms: ms(), key };
    }
  } catch (e) { log(1, `the kept slot was not used (${e.message || e}): reading the prompt again`); }
  try {
    // the system prompt and an empty question, one token written and thrown away: what stays is the slot
    await chat({ messages: [{ role: "system", content: system }, { role: "user", content: "" }], max_tokens: 0, temperature: 0 }, () => {});
    const saved = await slot("save");
    if (c) {
      try {
        await prune(c, Math.max(1, keep), key);
        await c.put(key, new Response(saved.file, { headers: { "Content-Type": "application/octet-stream" } }));
        const ix = await readIndex(c);
        ix[key] = { label, tokens: saved.tokens, bytes: saved.bytes, ctx: ready.ctx, created: Date.now(), used: Date.now() };
        await writeIndex(c, ix);
      } catch { /* storage full: warm for this visit only */ }
    }
    return { how: "warmed", tokens: saved.tokens, bytes: saved.bytes, ms: ms(), key };
  } catch (e) {
    return { how: "failed", ms: ms(), error: String(e.message || e) };
  }
}
