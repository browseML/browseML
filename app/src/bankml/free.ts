// SPDX-License-Identifier: MIT
// browseML: bankML itself in this browser (bankML compiled to WebAssembly). The model (Bonsai-1.7B Q1_0, 248 MB) is
// pulled from its pinned source only when the visitor imports it, in the background, with progress, pause and cancel
// (download()); bankML checks its sha256 before it answers and puts a receipt on every answer, checked here. The
// visitor's settings (threads, context, prompt cache, answer length) are kept in localStorage.
import type { Turn, Verdict } from './engine';
import { sha256hex } from './engine';
import { ctxCapFor, mb } from './caps';
import { recordAnswer, recordLoad, recordWarm } from './usage';
import { activity, noteRate, setActivity, setReady, surge, token } from './pulse';
import { getLimits } from '../clientside/limits';

const esm = (url: string): Promise<any> => import(/* @vite-ignore */ url);
const MAX_TOKENS = 384;

// ── settings: what the visitor chose for browseML, kept in this browser ─────────────────────────────────────────
export interface BrowseSettings {
  /** Threads for the engine; null: as many as it may take here. Applied on the next load. */
  threads: number | null;
  /** Context (tokens): the KV cache's size. Applied on the next load. */
  ctx: number;
  /** The longest answer, in tokens: applied to the next question. */
  maxTokens: number;
  /** Remove the model from this browser when the visit ends. */
  removeAfterSession: boolean;
  /** The engine's prompt cache, in MiB (serve's --cache-ram; 0 off): memory that lets a repeated prompt prefix skip
   *  its reading. Applied on the next load. */
  cacheRam: number;
  /** Sampling, as Savante's dials set it (bankML's request fields); null: the engine's default. Applied to the next
   *  question. */
  sampling: Sampling;
  /** Prompts kept read (warm slots in this browser), each persona's or prompt's own; the least recently used go first. */
  keptPrompts: number;
}
export interface Sampling {
  temperature: number | null; top_p: number | null; top_k: number | null; min_p: number | null; repeat_penalty: number | null; seed: number | null;
  /** The advanced tools, llama-server's own samplers as bankML reproduces them (its `oracle_samplers`): DRY, XTC and
   *  dynamic temperature. */
  dry_multiplier: number | null; dry_base: number | null; dry_allowed_length: number | null;
  xtc_probability: number | null; xtc_threshold: number | null;
  dynatemp_range: number | null; dynatemp_exponent: number | null;
}
export const NO_SAMPLING: Sampling = {
  temperature: null, top_p: null, top_k: null, min_p: null, repeat_penalty: null, seed: null,
  dry_multiplier: null, dry_base: null, dry_allowed_length: null, xtc_probability: null, xtc_threshold: null, dynatemp_range: null, dynatemp_exponent: null,
};
/** Fields that only take whole numbers. */
export const SAMPLING_INT: ReadonlySet<keyof Sampling> = new Set(['top_k', 'seed', 'dry_allowed_length']);
/** Each sampling field's range (out of range: the engine's default). */
export const SAMPLING_RANGE: Record<keyof Sampling, [number, number]> = {
  temperature: [0, 1.5], top_p: [0.05, 1], top_k: [0, 200], min_p: [0, 0.5], repeat_penalty: [1, 1.5], seed: [0, 2147483647],
  dry_multiplier: [0, 2], dry_base: [1, 3], dry_allowed_length: [1, 8], xtc_probability: [0, 1], xtc_threshold: [0, 0.5],
  dynatemp_range: [0, 1.5], dynatemp_exponent: [0.5, 4],
};
const SETTINGS = 'browseml:settings';
export const CTX_CHOICES = [1024, 2048, 4096, 8192] as const;
export const MAXTOK_CHOICES = [128, 256, 384, 512, 1024, 2048] as const;
export const CACHE_CHOICES = [0, 16, 32, 64, 128, 256] as const;
export const DEFAULT_SETTINGS: BrowseSettings = { threads: null, ctx: 4096, maxTokens: MAX_TOKENS, removeAfterSession: false, cacheRam: 0, sampling: NO_SAMPLING, keptPrompts: 4 };
/** Settings as stored, each value checked (a stored value out of range falls back to the default). */
export function parseSettings(raw: unknown, memoryGB: number | null = null): BrowseSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // the default context fits the device: a phone that reports little memory starts at the context it is advised
  const cap = ctxCapFor(memoryGB), defCtx = cap !== null ? Math.min(DEFAULT_SETTINGS.ctx, cap) : DEFAULT_SETTINGS.ctx;
  const int = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) ? x : null);
  const t = int(o.threads);
  return {
    threads: t !== null && t >= 1 && t <= 64 ? t : null,
    ctx: (CTX_CHOICES as readonly number[]).includes(int(o.ctx) ?? -1) ? (o.ctx as number) : defCtx,
    // any length from 1 (the single-token proof) to 2048; the knob's stops are MAXTOK_CHOICES
    maxTokens: (() => { const m = int(o.maxTokens); return m !== null && m >= 1 && m <= 2048 ? m : DEFAULT_SETTINGS.maxTokens; })(),
    removeAfterSession: o.removeAfterSession === true,
    cacheRam: (CACHE_CHOICES as readonly number[]).includes(int(o.cacheRam) ?? -1) ? (o.cacheRam as number) : DEFAULT_SETTINGS.cacheRam,
    keptPrompts: (() => { const k = int(o.keptPrompts); return k !== null && k >= 1 && k <= 8 ? k : DEFAULT_SETTINGS.keptPrompts; })(),
    sampling: (() => {
      const r = (o.sampling && typeof o.sampling === 'object' ? o.sampling : {}) as Record<string, unknown>;
      const out = { ...NO_SAMPLING };
      for (const k of Object.keys(SAMPLING_RANGE) as (keyof Sampling)[]) {
        const v = r[k], [lo, hi] = SAMPLING_RANGE[k];
        if (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi && (!SAMPLING_INT.has(k) || Number.isInteger(v))) out[k] = v;
      }
      return out;
    })(),
  };
}
function deviceGB(): number | null {
  try { const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory; return typeof m === 'number' ? m : null; } catch { return null; }
}
let settings: BrowseSettings = (() => {
  try { return parseSettings(JSON.parse(localStorage.getItem(SETTINGS) || '{}'), deviceGB()); } catch { return parseSettings({}, deviceGB()); }
})();
const settingsFns = new Set<() => void>();
export const browseSettings = () => settings;
export function setBrowseSettings(patch: Partial<BrowseSettings>) {
  settings = parseSettings({ ...settings, ...patch }, deviceGB());
  try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch { /* storage off */ }
  settingsFns.forEach(f => f());
}
export function onBrowseSettings(f: () => void) { settingsFns.add(f); return () => { settingsFns.delete(f); }; }

// ── bankML in this browser ──────────────────────────────────────────────────────────────────────────────────
export interface Browsed { model: string; sha256: string; version: string; threads: number; ctx?: number; build?: string; guard?: string; cacheRam?: number; gpu?: GpuMode; gpuNote?: string; host?: string; side?: string }
/** The GPU the engine was asked to use: the control panel's GPU switch (OFF · LOW · HIGH). */
export type GpuMode = 'off' | 'low-power' | 'high-performance';
export const gpuMode = (): GpuMode => { const l = getLimits(); return l.gpuProbe ? l.power : 'off'; };
/** What bankML said about the GPU at its last start: the card it verified and its share, or why it computes nothing. */
let gpuNote = '';
let browseml: any = null;
let browsed: Browsed | null = null;
const mod = async () => (browseml ??= await esm(new URL('browseml.js', location.href).href));
const CACHE = 'browseml-models';
const MBs = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

// ── threads, when the visitor has not chosen: what was measured free on this computer (`availableThreads`) ─────
let autoThreads: number | null = null;
export const measuredThreads = () => autoThreads;
export function setMeasuredThreads(n: number | null) { autoThreads = n; settingsFns.forEach(f => f()); }
/** A measure under way: the engine waits for it before it starts (so it starts with the threads found free). */
let pendingMeasure: Promise<unknown> | null = null;
export function setPendingMeasure(p: Promise<unknown> | null) { pendingMeasure = p; }

// ── the engine log: bankML's own lines (its log levels) and the page's steps, the last 300, for the control panel ──
export interface LogLine { at: number; kind: 'error' | 'warn' | 'engine' | 'ok' | 'step'; text: string }
const logLines: LogLine[] = [];
const logFns = new Set<() => void>();
export function engineLog(kind: LogLine['kind'], text: string) {
  logLines.push({ at: Date.now(), kind, text });
  if (logLines.length > 300) logLines.shift();
  logFns.forEach(f => f());
}
/** bankML's log callback: level 0 error, 1 warning, else the engine's own line. */
const fromEngine = (level: number, text: string) => {
  if (/\bGPU\b|WebGPU/.test(text) && !/^\(thread\)/.test(text)) { gpuNote = text.replace(/^bankml:\s*/, ''); if (/verified/.test(text)) surge('gpu', 1); }
  if (level === 0) surge('error', 0.9);
  engineLog(level === 0 ? 'error' : level === 1 ? 'warn' : 'engine', text);
};
export const engineLogLines = () => logLines;
export function onEngineLog(f: () => void) { logFns.add(f); return () => { logFns.delete(f); }; }
export function clearEngineLog() { logLines.length = 0; logFns.forEach(f => f()); }

/** What bankML verified when it loaded in this browser (null: not loaded). */
export const browseState = () => browsed;
export async function browseCached(): Promise<boolean> {
  try { return await (await mod()).isCached(); } catch { return false; }
}
/** The last progress browseML reported while loading (download, cache, verify), or null. */
let lastProgress: { phase: string; got: number; total: number } | null = null;
/** bankML in this browser as a page's diagnostics read it: nothing is loaded or downloaded by asking. */
export interface BrowseDiag {
  /** browseml.js was imported (it is, once anything asked about bankML in this browser). */
  script: boolean;
  loading: boolean;
  progress: { phase: string; got: number; total: number } | null;
  verified: Browsed | null;
  /** The engine's WebAssembly memory after its last open or answer (0: not loaded). */
  memoryBytes: number;
  /** Threads the engine would take here, and the most it takes. */
  threads: number | null;
  maxThreads: number | null;
  model: { title: string; bytes: number } | null;
}
export function browseDiag(): BrowseDiag {
  const b = browseml;
  return {
    script: !!b,
    loading: !!b?.isLoading?.(),
    progress: lastProgress,
    verified: browsed,
    memoryBytes: Number(b?.memoryBytes) || 0,
    threads: b?.threads ? b.threads() : null,
    maxThreads: b?.MAX_THREADS ?? null,
    model: b?.MODEL ? { title: String(b.MODEL.title), bytes: Number(b.MODEL.bytes) } : null,
  };
}
/** Import browseml.js (a script beside the page; no model is fetched) and say how much of the model is kept here. */
export async function browseCachedBytes(): Promise<number> {
  try { return Number(await (await mod()).cachedBytes()) || 0; } catch { return 0; }
}
/** The most threads browseML may take here: every core up to its cap when isolated, else one. */
export async function browseMaxThreads(): Promise<{ max: number; cap: number; isolated: boolean }> {
  const b = await mod().catch(() => null);
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
  return { max: b?.threads ? b.threads() : 1, cap: b?.MAX_THREADS ?? 8, isolated };
}

/** Start bankML in this browser from the model kept here (download() puts it there); progress as one line. */
export async function loadBrowse(progress: (line: string, phase?: string) => void = () => {}, from?: { bytes: ArrayBuffer; name: string }): Promise<Browsed> {
  const b = await mod();
  if (b.isReady() && browsed) return browsed;
  const MB = (n: number) => `${(n / 1e6).toFixed(0)} MB`;
  if (pendingMeasure) await pendingMeasure.catch(() => {});
  const s = settings;
  let lastLogged = '';
  const gpu = gpuMode();
  gpuNote = '';
  engineLog('step', `starting bankML: ${s.threads ?? (autoThreads ? `${autoThreads} (measured free)` : 'default')} threads, context ${s.ctx}, cache ${s.cacheRam} MiB, GPU ${gpu === 'off' ? 'off' : gpu.replace('-', ' ')}`);
  browsed = await b.load((got: number, total: number, phase: string) => {
    lastProgress = { phase, got, total };
    if (phase !== 'download' && phase !== lastLogged) { lastLogged = phase; engineLog('step', phase === 'cache' ? `the model from this browser (${MB(got)}): no download` : phase === 'verify' ? 'bankML: the guard, then the sha256 of the whole model against its pin' : phase === 'folder' ? `the model from this computer: ${from?.name ?? 'a folder'}` : `${phase}: ${MB(got)} of ${MB(total)}`); }
    if (phase === 'download') progress(`downloading ${b.MODEL.title}: ${MB(got)} of ${MB(total)} (once; it stays in this browser)`, phase);
    else if (phase === 'cache') progress(`the model is in this browser (${MB(got)}): no download`, phase);
    else if (phase === 'verify') progress('checking sha256… (bankML checks the model against its pin)', phase);
    else if (phase === 'retry') progress(`the connection dropped at ${MB(got)}: asking for that piece again`, phase);
    else if (phase === 'folder') progress(`the model from this computer (${from?.name ?? 'a folder'}): no download`, phase);
  }, fromEngine, { threads: s.threads ?? autoThreads ?? undefined, ctx: s.ctx, cacheRam: s.cacheRam, gpu, ...(from ? { bytes: from.bytes, from: 'folder' } : {}) });
  setReady(true);
  browsed = { ...browsed!, cacheRam: s.cacheRam, gpu, gpuNote: gpuNote || (gpu === 'off' ? 'GPU off: the CPU computes everything' : browsed!.threads > 1 ? 'no WebGPU device here: the CPU computes everything' : 'one thread (not cross-origin isolated): the CPU computes everything') };
  engineLog('ok', `verified ${browsed.model} · sha256 ${browsed.sha256} · guard ${browsed.guard ?? '?'} · bankML ${browsed.version} · ${browsed.threads} thread(s) · ${browsed.build ?? 'browseml.wasm'} · context ${browsed.ctx}${browsed.host ? ` · host ${browsed.host}, ${browsed.side ?? 'client'} side` : ''}`);
  engineLog(browsed.gpuNote && /computes \d+%/.test(browsed.gpuNote) ? 'ok' : 'step', `GPU: ${browsed.gpuNote}`);
  // an import (download()) put the model in the cache first: the record says it was downloaded
  if (b.loadStats) recordLoad(b.loadStats.source === 'cache' && lastDownload
    ? { ...b.loadStats, source: 'download', fetched: lastDownload.fetched, retries: lastDownload.retries, modelMs: lastDownload.ms + b.loadStats.modelMs, totalMs: lastDownload.ms + b.loadStats.totalMs }
    : b.loadStats);
  lastDownload = null;
  return browsed!;
}
/** Stop the engine (the model stays kept): the next load applies new threads or context. */
export async function unloadBrowse(): Promise<void> {
  const b = await mod();
  b.unload();
  browsed = null;
  warmedFor = '';
  setWarm({ phase: 'cold' });
}

// ── the download, under the visitor's control ─────────────────────────────────────────────────────────────────
export type DownloadPhase = 'idle' | 'downloading' | 'paused' | 'saving' | 'verifying' | 'verified' | 'failed' | 'cancelled';
export interface DownloadState {
  phase: DownloadPhase;
  got: number;
  total: number;
  /** Bytes per second over the last few seconds; null before there is a measure. */
  rate: number | null;
  /** Seconds left at that rate; null when unknown. */
  eta: number | null;
  error?: string;
  /** A network failure kept the bytes so far (in this tab's memory): Retry asks for the rest with a Range request. */
  resumable?: boolean;
  /** Pieces asked for again after the connection cut them (each retried on its own, automatically). */
  retries?: number;
  /** The host the last piece came from (one of the model's verified sources). */
  source?: string;
  /** When this download started (performance.now()), for the elapsed time. */
  started?: number;
  verified?: Browsed;
}
let dl: DownloadState = { phase: 'idle', got: 0, total: 248_302_272, rate: null, eta: null };
const dlFns = new Set<(s: DownloadState) => void>();
const setDl = (patch: Partial<DownloadState>) => {
  dl = { ...dl, ...patch }; dlFns.forEach(f => f(dl));
  // the pulse: the download and the verification heat the fire; anything after them lets it cool
  if (dl.phase === 'downloading' || dl.phase === 'saving') { if (activity() !== 'loading') { setActivity('loading'); surge('load', 0.5); } }
  else if (dl.phase === 'verifying') setActivity('verifying');
  else if (activity() === 'loading' || activity() === 'verifying') { setActivity('idle'); if (dl.phase === 'failed') surge('error', 0.8); }
};
export const downloadState = () => dl;
export function onDownload(f: (s: DownloadState) => void) { dlFns.add(f); return () => { dlFns.delete(f); }; }

let abort: AbortController | null = null;
/** The last finished import, for the next load's usage record. */
let lastDownload: { fetched: number; retries: number; ms: number } | null = null;
/** The bytes so far, kept in this tab's memory only while paused or after a dropped connection (resumed with an HTTP
 *  Range request); a reload loses them. */
let partial: Uint8Array<ArrayBuffer> | null = null;

/** Rate over a sliding window of samples (time ms, bytes). Pure, so it is tested. */
export function rateOf(samples: { t: number; got: number }[]): number | null {
  if (samples.length < 2) return null;
  const a = samples[0], b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  return dt > 0.25 ? (b.got - a.got) / dt : null;
}

/** The download's piece (one HTTP Range request) and how often a cut piece is asked for again. */
export const PIECE = 16 * 1024 * 1024;
const PIECE_TRIES = 6;
/** A response's body into buf from `at`, never past `limit`; `seen` gets the running end. */
async function readBody(r: Response, buf: Uint8Array, at: number, limit: number, seen: (n: number) => void) {
  const reader = r.body!.getReader();
  let n = at;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (n + value.length > limit) throw new Error('the download is longer than the model');
      buf.set(value, n); n += value.length;
      seen(n);
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
}

/**
 * Download the model (only when the visitor pressed "Download and verify"), keep it in this browser's Cache Storage,
 * then start bankML, which checks its sha256 against the pin. Pause keeps the bytes in this tab's memory and resumes
 * with a Range request; cancel aborts and keeps nothing. Resolves to what bankML verified, or null if paused or
 * cancelled; a failure is in downloadState().error.
 */
export async function download(): Promise<Browsed | null> {
  if (dl.phase === 'downloading' || dl.phase === 'saving' || dl.phase === 'verifying') return null;
  const b = await mod();
  const M = b.MODEL;
  if (await b.isCached()) return verifyKept();
  // room for it first: a full disk (the browser's quota for this site) found before 248 MB are pulled, not after
  const room = await storageEstimate();
  if (room && room.quota - room.usage < M.bytes - (partial ? dl.got : 0) + (16 << 20)) {
    setDl({ phase: 'failed', error: `not enough room on this computer for the model: the browser lets this site keep ${mb(Math.max(0, room.quota - room.usage))} more, the model needs ${mb(M.bytes)}. Free disk space (or CLEAR old copies in HARD DRIVE), or use a copy you already have.`, resumable: false, rate: null, eta: null });
    return null;
  }
  abort = new AbortController();
  const from = partial && (dl.phase === 'paused' || (dl.phase === 'failed' && dl.resumable)) ? dl.got : 0;
  setDl({ phase: 'downloading', error: undefined, resumable: false, rate: null, eta: null, total: M.bytes, got: from, retries: 0, started: performance.now() });
  engineLog('step', `downloading ${M.title} (${MBs(M.bytes)})${from ? ` from byte ${from}` : ''}: 16 MB pieces from its pinned sources`);
  // the bytes in hand, exactly (the state's count is updated a few times a second); whether a failure now leaves bytes
  // that a Range request can resume from
  let got = from, streaming = false, retries = 0, prefer = 0;
  const started = performance.now();
  try {
    if (!partial || got === 0) { partial = new Uint8Array(M.bytes); got = 0; }
    const buf = partial;
    const samples: { t: number; got: number }[] = [{ t: performance.now(), got }];
    let shown = 0;
    const seen = (n: number) => {
      got = n;
      const t = performance.now();
      samples.push({ t, got });
      while (samples.length > 2 && t - samples[0].t > 5000) samples.shift();
      if (t - shown > 150) {
        shown = t;
        const rate = rateOf(samples);
        setDl({ got, rate, eta: rate ? (M.bytes - got) / rate : null });
      }
    };
    streaming = true;
    // in pieces (browseml.js PIECE): one long response can be cut mid-body (Brave on Linux cut it at 57 MB and at
    // 219 MB where curl got the whole file); each piece is retried on its own, from the byte where it was cut
    while (got < M.bytes) {
      const end = Math.min(M.bytes, got + PIECE) - 1;
      for (let tryNo = 1; ; tryNo++) {
        // a retry asks from the exact byte: what arrived of the cut piece is already in buf
        const start = got;
        try {
          // the verified sources in turn: a retry asks the next one (Hugging Face, then browseML/models); the pin decides
          const sources: string[] = M.sources?.length ? M.sources : [M.url];
          const at = (prefer + tryNo - 1) % sources.length;
          const r = await fetch(sources[at], { signal: abort.signal, headers: { Range: `bytes=${start}-${end}` } });
          { const host = (() => { try { return new URL(sources[at], location.href).host; } catch { return ''; } })(); if (host !== dl.source) setDl({ source: host }); }
          if (r.status === 200 && start === 0) {
            // a server that ignores Range sends the whole file: one stream
            await readBody(r, buf, 0, M.bytes, seen);
            if (got !== M.bytes) throw new Error(`the download stopped at ${got} of ${M.bytes} bytes`);
            break;
          }
          if (r.status !== 206) {
            // a 4xx is a refusal, not a cut: no retry, nothing to resume
            if (r.status >= 400 && r.status < 500) streaming = false;
            throw new Error(`the model could not be downloaded: HTTP ${r.status}`);
          }
          await readBody(r, buf, start, end + 1, seen);
          if (got !== end + 1) throw new Error(`a piece stopped at ${got} of ${end + 1} bytes`);
          prefer = at;  // the source that answered: asked first for the next piece
          break;
        } catch (e) {
          if (abort?.signal.aborted || !streaming || tryNo >= PIECE_TRIES) throw e;
          // after a pause that grows
          setDl({ got, retries: ++retries });
          await new Promise(ok => setTimeout(ok, Math.min(8000, 500 * 2 ** (tryNo - 1))));
        }
      }
    }
    if (got !== M.bytes) throw new Error(`the download stopped at ${got} of ${M.bytes} bytes`);
    streaming = false;
    setDl({ got, phase: 'saving', rate: null, eta: null });
    try {
      const c = await caches.open(CACHE);
      await c.put(M.url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(M.bytes) } }));
    } catch (e) {
      throw new Error(`the model could not be kept in this browser (${String((e as Error).message || e)}): free some storage and retry`);
    }
    partial = null;
    lastDownload = { fetched: M.bytes - from, retries, ms: Math.round(performance.now() - started) };
    engineLog('ok', `downloaded ${MBs(M.bytes - from)} in ${(lastDownload.ms / 1000).toFixed(1)} s (${((M.bytes - from) / 1e6 / Math.max(0.001, lastDownload.ms / 1000)).toFixed(1)} MB/s)${retries ? `, ${retries} piece(s) asked for again` : ''}${dl.source ? ` · from ${dl.source}` : ''}`);
    return verifyKept();
  } catch (e) {
    // paused or cancelled: pause() and cancel() set the state; a pause resumes from the exact byte
    if (abort?.signal.aborted) { if (dl.phase === 'paused') setDl({ got }); return null; }
    // the connection dropped mid-file (a phone, Wi-Fi that changes): keep the bytes so far, Retry resumes there
    const resumable = streaming && !!partial && got > 0 && got < M.bytes;
    if (!resumable) partial = null;
    engineLog('error', `download: ${String((e as Error).message || e)}${resumable ? ` (${MBs(got)} kept: Retry resumes there)` : ''}`);
    setDl({ phase: 'failed', error: String((e as Error).message || e), resumable, got: resumable ? got : dl.got, rate: null, eta: null });
    return null;
  } finally {
    abort = null;
  }
}
// ── a model already on this computer, and overwriting a kept one ───────────────────────────────────────────────
export type Recognised =
  | { ok: true; name: string; sha256: string; verified: Browsed | null }
  | { ok: false; reason: string; sha256?: string };

/** The rule, pure (so tested): a file is this model only when its size and its sha256 are the pinned ones. */
export function recognise(file: { name: string; size: number; sha256?: string }, model: { title: string; bytes: number; sha256: string }): Recognised | null {
  if (file.size !== model.bytes) return { ok: false, reason: `${file.name} is ${mb(file.size)}; ${model.title} is ${mb(model.bytes)}: not this model` };
  if (file.sha256 === undefined) return null;  // the size fits: its sha256 decides
  if (file.sha256.toLowerCase() !== model.sha256.toLowerCase()) {
    return { ok: false, reason: `${file.name}'s sha256 is ${file.sha256.slice(0, 16)}…, the pin is ${model.sha256.slice(0, 16)}…: not the model browseML answers from`, sha256: file.sha256 };
  }
  return { ok: true, name: model.title, sha256: file.sha256.toLowerCase(), verified: null };
}

/** The pin browseML answers from: the model's sha256, from its FORK.json beside the page. */
async function pinnedSha(): Promise<string> {
  const b = await mod();
  const fork = JSON.parse(await (await fetch(new URL(b.MODEL.fork, location.href).href)).text());
  const f = (fork.files ?? []).find((x: { path?: string }) => x.path === b.MODEL.name);
  if (!f?.sha256) throw new Error('the model has no pin');
  return String(f.sha256).toLowerCase();
}

/**
 * A model file already on this computer (bankML's, Ollama's, an earlier download): recognised by size, then by its
 * sha256 against the pin, here in the page. Recognised, it is kept in this browser as if downloaded and bankML
 * checks it again as it starts (its own sha256); not recognised, nothing of it is kept.
 */
export async function useLocalModel(file: File, progress: (line: string) => void = () => {}, { keep = true, named }: { keep?: boolean; named?: string } = {}): Promise<Recognised> {
  const b = await mod();
  const want = await pinnedSha();
  const model = { title: b.MODEL.title, bytes: b.MODEL.bytes, sha256: want };
  const bySize = recognise({ name: file.name, size: file.size }, model);
  if (bySize) return bySize;
  progress(`reading ${file.name}…`);
  const bytes = await file.arrayBuffer();
  // a blob named by its sha256 (Ollama, the Hugging Face cache) is recognised by its name; anything else is hashed here.
  // Either way bankML hashes it again as it opens, and refuses it if it is not the pin.
  let got = named?.toLowerCase();
  if (!got || got !== want) {
    progress(`checking ${file.name}'s sha256 against the pin…`);
    got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const r = recognise({ name: file.name, size: file.size, sha256: got }, model)!;
  if (!r.ok) return r;
  if (!keep) {
    // read from the folder each visit: nothing kept in this browser
    progress('recognised: bankML checks it as it starts (nothing kept in this browser)…');
    try {
      const b2 = await mod();
      if (b2.isReady()) b2.unload();
      browsed = null;
      const v = await loadBrowse(line => progress(line), { bytes, name: file.name });
      setDl({ phase: 'verified', verified: v });
      return { ok: true, name: model.title, sha256: got, verified: v };
    } catch (e) { return { ok: false, reason: `recognised, but bankML could not start it: ${String((e as Error).message || e)}`, sha256: got }; }
  }
  progress('recognised: keeping it in this browser, then bankML checks it as it starts…');
  try {
    const c = await caches.open(CACHE);
    await c.put(b.MODEL.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(b.MODEL.bytes) } }));
  } catch (e) { return { ok: false, reason: `recognised, but it could not be kept in this browser: ${String((e as Error).message || e)}`, sha256: got }; }
  lastDownload = null;
  return { ok: true, name: b.MODEL.title, sha256: got, verified: await verifyKept() };
}

/** The kept model could not be started (bankML refused it, or it gave no response): the card offers the overwrite. */
export function markKeptBad(error: string) { setDl({ phase: 'failed', error, resumable: false, got: 0, rate: null, eta: null }); }

/** Overwrite: the kept model (and its warm slots) removed and a fresh copy pulled from its pinned source, then
 *  checked by bankML. For a kept model that cannot be used, or when the visitor wants a clean copy. */
export async function overwriteModel(): Promise<Browsed | null> {
  const b = await mod();
  if (b.isReady()) { try { b.unload(); } catch { /* writing an answer: the download still replaces the file */ } }
  browsed = null; warmedFor = ''; setWarm({ phase: 'cold' });
  try { for (const n of await caches.keys()) if (n.startsWith('browseml')) await caches.delete(n); } catch { /* off */ }
  partial = null;
  setDl({ phase: 'idle', got: 0, verified: undefined, error: undefined, resumable: false });
  return download();
}

async function verifyKept(): Promise<Browsed | null> {
  setDl({ phase: 'verifying', got: dl.total, rate: null, eta: null });
  try {
    const v = await loadBrowse();
    setDl({ phase: 'verified', verified: v });
    return v;
  } catch (e) {
    setDl({ phase: 'failed', error: String((e as Error).message || e) });
    return null;
  }
}
export function pauseDownload() {
  if (dl.phase !== 'downloading' || !abort) return;
  setDl({ phase: 'paused', rate: null, eta: null });
  abort.abort();
}
export function cancelDownload() {
  if (dl.phase === 'downloading') abort?.abort();
  partial = null;
  setDl({ phase: 'cancelled', got: 0, rate: null, eta: null, error: undefined, resumable: false });
}

// ── what browseML keeps in this browser ─────────────────────────────────────────────────────────────────────────
export interface KeptFile { name: string; bytes: number; where: 'Cache Storage' | 'HTTP cache' }
/** Every file browseML keeps: the model in Cache Storage (exact bytes), and the engine's files as the browser loaded
 *  them (its HTTP cache, which the browser manages; sizes as it reports them). */
export async function keptFiles(): Promise<KeptFile[]> {
  const out: KeptFile[] = [];
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith('browseml')) continue;
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const r = await c.match(req);
        const len = Number(r?.headers.get('Content-Length')) || (r ? (await r.clone().blob()).size : 0);
        out.push({ name: decodeURIComponent(req.url.split('?')[0].split('/').pop() || req.url), bytes: len, where: 'Cache Storage' });
      }
    }
  } catch { /* Cache Storage off (a private window) */ }
  try {
    const seen = new Set<string>();
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const f = e.name.split('?')[0].split('/').pop() || '';
      if (!/^browseml.*\.(wasm|js)$/.test(f) || seen.has(f)) continue;
      seen.add(f);
      if (e.decodedBodySize) out.push({ name: f, bytes: e.decodedBodySize, where: 'HTTP cache' });
    }
  } catch { /* no resource timing */ }
  return out;
}
/** Remove browseML's Cache Storage (the model): the bytes it freed. The engine, if loaded, keeps running. */
export async function clearBrowseCache(): Promise<number> {
  const freed = (await keptFiles()).filter(f => f.where === 'Cache Storage').reduce((n, f) => n + f.bytes, 0);
  try { for (const n of await caches.keys()) if (n.startsWith('browseml')) await caches.delete(n); } catch { /* off */ }
  if (!browsed) setDl({ phase: 'idle', got: 0, verified: undefined });
  return freed;
}
/** A prompt kept read in this browser (a warm slot): whose, its size, when it was read and last used. */
export interface KeptPrompt { key: string; label: string; tokens: number; bytes: number; ctx: number; created: number; used: number }
export async function keptPrompts(): Promise<KeptPrompt[]> { try { return await (await mod()).slots(); } catch { return []; } }
/** One kept prompt removed (the one in use stays loaded in the engine; the next visit reads it again). */
export async function forgetPrompt(key: string): Promise<void> {
  try { await (await mod()).forgetSlot(key); } catch { /* off */ }
  if (warmState.phase !== 'cold' && 'key' in warmState && warmState.key === key) { warmedFor = ''; }
  engineLog('step', 'a kept prompt removed');
}
/** The prompt cache's kept slot removed (the next start reads browseML's prompt again): the bytes freed. */
export async function clearWarmSlot(): Promise<number> {
  let n = 0;
  try {
    const c = await caches.open('browseml-slots');
    for (const k of await c.keys()) n += (await (await c.match(k))?.blob())?.size ?? 0;
    await caches.delete('browseml-slots');
  } catch { /* off */ }
  warmedFor = ''; setWarm({ phase: 'cold' });
  return n;
}
/** The model kept in this browser (Cache Storage), to copy to the disk: its file name, size and bytes (null: none). */
export async function keptModel(): Promise<{ name: string; bytes: number; response: Response } | null> {
  try {
    const b = await mod();
    const r = await (await caches.open(CACHE)).match(b.MODEL.url);
    if (!r) return null;
    const name = decodeURIComponent(String(b.MODEL.url).split('?')[0].split('/').pop() || 'model.gguf');
    return { name, bytes: Number(r.headers.get('Content-Length')) || Number(b.MODEL.bytes), response: r };
  } catch { return null; }
}
/** Whether this browser keeps the site's storage under pressure (persisted), and asking it to. */
export async function persisted(): Promise<boolean | null> {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { return null; }
}
export async function askPersist(): Promise<boolean | null> {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : null; } catch { return null; }
}
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e?.quota ? { usage: e.usage ?? 0, quota: e.quota } : null; } catch { return null; }
}
/** "Remove the model after this session": the session is this tab's (sessionStorage), so a reload or a link within the
 *  tab keeps the model, and the next visit in a new tab or window starts by removing what the last one kept. Nothing
 *  is removed on pagehide: it fires on a reload too (which would throw the 248 MB away and download them again), and a
 *  closing tab gives no reliable time to delete them anyway. */
const SESSION_MARK = 'browseml:session';
const dropCaches = () => { try { void caches.keys().then(ks => ks.filter(n => n.startsWith('browseml')).forEach(n => caches.delete(n))).catch(() => {}); } catch { /* off */ } };
let cleanupOn = false;
export function sessionCleanup() {
  if (cleanupOn) return;
  cleanupOn = true;
  let fresh = false;
  try { fresh = !sessionStorage.getItem(SESSION_MARK); sessionStorage.setItem(SESSION_MARK, '1'); } catch { /* off */ }
  if (fresh && settings.removeAfterSession) dropCaches();
}

/** The system prompt browseML is asked with: the page's (persona, memory) and where it runs. The same text is warmed
 *  (warmBrowse), so a question finds it already read. */
export function systemFor(composed: string, v: Browsed): string {
  const where = `WHERE YOU ARE RUNNING (measured by bankML just now): ${v.model} (sha256 ${v.sha256.slice(0, 16)}…), verified by bankML ${v.version}, ` +
    // no thread count here: it never changes an answer's bits, and Brave varies the cores it reports from one visit to
    // the next, which would make a new prompt (and a new warm slot) every time
    `in the visitor's own web browser, compiled to WebAssembly (browseML), on the visitor's CPU; nothing is sent anywhere.`;
  return composed + '\n\n' + where;
}

// ── the prompt cache across visits: the system prompt read once, its slot kept ───────────────────────────────────
export type WarmState =
  | { phase: 'cold' }
  | { phase: 'warming'; since: number }
  | { phase: 'restored' | 'warmed'; tokens: number; bytes: number; ms: number; key?: string }
  | { phase: 'failed'; error: string };
let warmState: WarmState = { phase: 'cold' };
let warmedFor = '';
const warmFns = new Set<() => void>();
export const browseWarm = () => warmState;
export function onBrowseWarm(f: () => void) { warmFns.add(f); return () => { warmFns.delete(f); }; }
const setWarm = (w: WarmState) => {
  warmState = w; warmFns.forEach(f => f());
  if (w.phase === 'warming') setActivity('warming'); else if (activity() === 'warming') setActivity('idle');
  if (w.phase === 'cold') setReady(false);
};

/** Read `composed` (the page's system prompt) into the engine now, or restore it from a slot kept on an earlier visit,
 *  so the next question reads only itself. Once per prompt and engine; a question asked meanwhile waits its turn. */
export async function warmBrowse(composed: string, label = ''): Promise<WarmState> {
  const b = await mod();
  if (!b.isReady() || !browsed) return warmState;
  const system = systemFor(composed, browsed);
  const key = `${browsed.sha256}|${browsed.ctx}|${system}`;
  if (key === warmedFor && warmState.phase !== 'failed') return warmState;
  warmedFor = key;
  setWarm({ phase: 'warming', since: Date.now() });
  engineLog('step', 'the prompt cache: restoring the kept slot, or reading browseML\'s prompt once');
  const r = await b.warm(system, { log: fromEngine, label, keep: settings.keptPrompts });
  engineLog(r.how === 'failed' ? 'warn' : 'ok', r.how === 'failed' ? `prompt cache: ${r.error}` : `prompt cache ${r.how}: ${r.tokens} tokens, ${MBs(r.bytes)} in ${(r.ms / 1000).toFixed(1)} s`);
  setWarm(r.how === 'failed' ? { phase: 'failed', error: r.error ?? 'unknown' } : { phase: r.how, tokens: r.tokens, bytes: r.bytes, ms: r.ms, key: r.key });
  if (r.how !== 'failed') recordWarm({ how: r.how, tokens: r.tokens, bytes: r.bytes, ms: r.ms, threads: browsed?.threads ?? 1 });
  return warmState;
}

/** STOP the answer being written: it ends at its next piece (shared memory), or the engine is ended (no shared
 *  memory here; the next question loads the kept model again). */
export async function stopBrowse(): Promise<'stopped' | 'ended' | 'idle'> {
  const b = await mod();
  const how = b.stop();
  if (how !== 'idle') { surge('stop', 1); setActivity('idle'); }
  if (how === 'ended') { browsed = null; warmedFor = ''; setWarm({ phase: 'cold' }); }
  return how;
}

export async function* askBrowse(composed: string, turns: Turn[], message: string, done: (v: Verdict) => void, maxTokens = settings.maxTokens, signal?: AbortSignal): AsyncGenerator<string> {
  const b = await mod();
  // the field's Stop reaches the engine
  signal?.addEventListener('abort', () => { void stopBrowse(); }, { once: true });
  if (!b.isReady()) {
    // nothing is downloaded unasked: the response window's card offers the import
    if (!(await browseCached())) throw new Error('browseML is not imported yet: press "Import browseML" (248 MB once)');
    await loadBrowse();
  }
  const v = browsed!;
  const pieces: string[] = [];
  let wake: (() => void) | null = null, end = false, err: unknown = null, result: any = null;
  // sampling: only what the visitor set (the rest is the engine's default)
  const sampling = Object.fromEntries(Object.entries(settings.sampling).filter(([, x]) => x !== null));
  setActivity('reading'); surge('ask', 0.7);
  engineLog('step', `asking: ${maxTokens} tokens at most${Object.keys(sampling).length ? ` · ${Object.entries(sampling).map(([k, x]) => `${k} ${x}`).join(' · ')}` : ' · the engine\'s sampling defaults'}`);
  b.chat({ messages: [{ role: 'system', content: systemFor(composed, v) }, ...turns, { role: 'user', content: message }], max_tokens: maxTokens, ...sampling },
    (p: string) => { pieces.push(p); token(); wake?.(); }, fromEngine)
    .then((r: any) => { result = r; end = true; wake?.(); }, (e: unknown) => { err = e; end = true; wake?.(); });
  let text = '';
  for (;;) {
    while (pieces.length) { const p = pieces.shift()!; text += p; yield p; }
    if (end) break;
    await new Promise<void>(r => { wake = r; });
    wake = null;
  }
  setActivity('idle');
  if (err) { surge('error', 0.9); throw err; }
  const receipt = result?.bankml_receipt ?? null, u = result?.usage ?? {}, tm = result?.timings ?? {};
  noteRate(Number(tm.predicted_per_second) || 0);
  recordAnswer({
    threads: v.threads, ctx: v.ctx ?? 4096, cacheRam: v.cacheRam ?? 0, build: v.build ?? '',
    prompt: Number(u.prompt_tokens) || 0, completion: Number(u.completion_tokens) || 0, cached: Number(tm.cache_n) || 0,
    promptPerSec: Number(tm.prompt_per_second) || 0, genPerSec: Number(tm.predicted_per_second) || 0,
    promptMs: Number(tm.prompt_ms) || 0, genMs: Number(tm.predicted_ms) || 0, memory: Number(b.memoryBytes) || 0,
  });
  const ok = !!receipt && (await sha256hex(text)) === receipt.response_sha256;
  surge(ok ? 'receipt' : 'error', ok ? 0.5 : 0.9);
  engineLog(ok ? 'ok' : 'error', `${ok ? 'receipt ✓' : receipt ? 'receipt ✗ (the text does not match its sha256)' : 'no receipt'} · ${u.prompt_tokens ?? '?'} prompt (${tm.cache_n ?? 0} reused) + ${u.completion_tokens ?? '?'} tokens · reading ${Number(tm.prompt_per_second || 0).toFixed(2)}, writing ${Number(tm.predicted_per_second || 0).toFixed(2)} tok/s`);
  done({
    ok, receipt,
    usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, cache_n: tm.cache_n, finish: result?.choices?.[0]?.finish_reason },
    line: `${ok ? '✓ receipt' : receipt ? '✗ receipt: the answer does not match its sha256' : '✗ no receipt'} · bankML ${v.version} in this browser · ${v.model} · ` +
      `${u.prompt_tokens ?? '?'} + ${u.completion_tokens ?? '?'} tokens · ${Number(tm.predicted_per_second || 0).toFixed(2)} tok/s · free`,
  });
}
