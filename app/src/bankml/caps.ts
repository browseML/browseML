// SPDX-License-Identifier: MIT
// What this browser and this device can do, read here and never sent: for browseML (WebAssembly SIMD, threads,
// storage, memory) and for voice input. Everything comes from the
// browser's own APIs (navigator.userAgentData, navigator.platform, hardwareConcurrency, deviceMemory,
// crossOriginIsolated, navigator.storage); no request is made and no IP address is read (a page cannot know it and
// does not need it). The decisions are pure functions of what was read, so they are tested.

// ── WebAssembly features ─────────────────────────────────────────────────────────────────────────────────────────
/** The smallest module that uses a v128 instruction (i8x16.splat): valid only where WebAssembly SIMD is. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 8, 1, 6, 0, 65, 1, 253, 15, 11]);
/** The same with a relaxed SIMD instruction (f32x4.relaxed_madd): validates where relaxed SIMD is compiled. Whether
 *  it is fused (exact) here is checked by bankML itself when the engine opens; it falls back to plain SIMD if not. */
const RELAXED_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 1, 253, 15, 65, 1, 253, 15, 253, 133, 2, 11]);

const validates = (bytes: Uint8Array<ArrayBuffer>) => {
  try { return typeof WebAssembly === 'object' && WebAssembly.validate(bytes); } catch { return false; }
};

export interface Caps {
  wasm: boolean;
  simd: boolean;
  relaxedSimd: boolean;
  /** crossOriginIsolated and SharedArrayBuffer: threads possible. */
  isolated: boolean;
  cores: number | null;
  /** GB, as the browser rounds it (at most 8); null where it is not reported (Firefox, Safari). */
  memoryGB: number | null;
  speech: 'webkit' | 'standard' | null;
  storage: boolean;
  persist: boolean;
}

export function readCaps(g: typeof globalThis = globalThis): Caps {
  const n = (g as { navigator?: Navigator }).navigator as (Navigator & { deviceMemory?: number }) | undefined;
  const w = g as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown; crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
  return {
    wasm: typeof WebAssembly === 'object',
    simd: validates(SIMD_PROBE),
    relaxedSimd: validates(RELAXED_PROBE),
    isolated: !!w.crossOriginIsolated && typeof w.SharedArrayBuffer !== 'undefined',
    cores: n?.hardwareConcurrency || null,
    memoryGB: n?.deviceMemory || null,
    speech: w.SpeechRecognition ? 'standard' : w.webkitSpeechRecognition ? 'webkit' : null,
    storage: !!n?.storage?.estimate,
    persist: !!n?.storage?.persist,
  };
}

/** The model, and what browseML needs besides it, in bytes. */
export const MODEL_BYTES = 248_302_272;
/** Bonsai-1.7B (Qwen3-1.7B's shape): 28 layers, 8 KV heads of 128, f16 keys and values. */
export const KV_BYTES_PER_TOKEN = 2 * 28 * 8 * 128 * 2;
/** Scratch the engine holds besides the weights and the KV cache: an estimate from its WebAssembly memory. */
export const ENGINE_OVERHEAD = 96e6;
/** RAM browseML needs for a context of `ctx` tokens and a prompt cache of `cacheMiB`: an estimate, the most it can
 *  take (weights + a full KV cache + scratch + the cache); the diagnostics measure what it does take. */
export const ramEstimate = (ctx: number, cacheMiB = 0) => MODEL_BYTES + ctx * KV_BYTES_PER_TOKEN + ENGINE_OVERHEAD + cacheMiB * 1048576;

export interface Verdict { level: 'ok' | 'warn' | 'bad'; text: string }

/** Whether browseML can run here, and how, in plain words: one line each, the worst first. */
export function browseVerdicts(c: Caps, opts: { phone?: boolean; available?: number | null; ctx?: number } = {}): Verdict[] {
  const out: Verdict[] = [];
  if (!c.wasm || !c.simd) {
    out.push({ level: 'bad', text: 'browseML is unavailable in this browser: it needs WebAssembly SIMD, which this browser does not have.' });
    return out;
  }
  out.push(c.isolated
    ? { level: 'ok', text: `threads: yes — this page is cross-origin isolated, so bankML can use up to ${Math.min(8, c.cores ?? 1)} of ${c.cores ?? '?'} cores` }
    : { level: 'warn', text: 'threads: one — this page is not cross-origin isolated (no SharedArrayBuffer), so bankML runs on one thread: slower, same answer' });
  out.push(c.relaxedSimd
    ? { level: 'ok', text: 'relaxed SIMD: compiled here; bankML uses it only where it is exact (it checks when it opens), else plain SIMD' }
    : { level: 'ok', text: 'relaxed SIMD: not in this browser; bankML uses plain SIMD (exact, a little slower)' });
  const need = MODEL_BYTES;
  if (opts.available != null) {
    out.push(opts.available >= need * 1.1
      ? { level: 'ok', text: `storage: ${mb(opts.available)} available here for the ${mb(need)} model` }
      : { level: 'bad', text: `storage: only ${mb(opts.available)} available here; the model needs ${mb(need)}` });
  } else if (!c.storage) out.push({ level: 'warn', text: 'storage: this browser does not say how much room there is; the download may fail if it is full' });
  const ctx = opts.ctx ?? 4096, cap = ctxCapFor(c.memoryGB), ram = ramEstimate(ctx);
  if (cap !== null && ctx > cap) {
    out.push({ level: 'warn', text: `memory: this ${opts.phone ? 'phone' : 'device'} reports ${c.memoryGB} GB; keep the context at ${cap} tokens or less (now ${ctx}, about ${mb(ram)}, an estimate), or the browser may close the tab.` });
  } else if (c.memoryGB !== null && c.memoryGB * 1e9 < ram * 2.5) {
    out.push({ level: 'warn', text: `memory: this ${opts.phone ? 'phone' : 'device'} reports ${c.memoryGB} GB; browseML needs about ${mb(ram)} (an estimate) — the tab may be closed by the browser. A smaller context helps.` });
  }
  return out;
}

/** Bytes as MB (or KB under 0.1 MB, so a 6.8 KB file is not "0.0 MB"). */
export const mb = (n: number) => (n > 0 && n < 1e5 ? `${(n / 1e3).toFixed(1)} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);

/** The largest context to advise on a device that reports little memory (navigator.deviceMemory, rounded by the
 *  browser and capped at 8): one rule for the import card, the controls and the default. null: no limit to advise. */
export function ctxCapFor(memoryGB: number | null | undefined): number | null {
  if (memoryGB == null) return null;
  return memoryGB <= 2 ? 1024 : memoryGB <= 4 ? 2048 : null;
}
