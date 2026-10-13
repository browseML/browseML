// SPDX-License-Identifier: MIT
// browseML: bankML itself in this browser (bankML compiled to WebAssembly). The model (Bonsai-1.7B Q1_0, 248 MB) is
// pulled from its pinned source only when the visitor imports it, in the background, with progress, pause and cancel
// (download()); bankML checks its sha256 before it answers and puts a receipt on every answer, checked here. The
// visitor's settings (threads, context, prompt cache, answer length) are kept in localStorage.
import type { Turn, Verdict } from './engine';
import { sha256hex } from './engine';
import { ctxCapFor } from './caps';
import { recordAnswer, recordLoad, recordWarm } from './usage';

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
}
const SETTINGS = 'browseml:settings';
export const CTX_CHOICES = [1024, 2048, 4096, 8192] as const;
export const MAXTOK_CHOICES = [128, 256, 384, 512, 1024, 2048] as const;
export const CACHE_CHOICES = [0, 16, 32, 64, 128, 256] as const;
export const DEFAULT_SETTINGS: BrowseSettings = { threads: null, ctx: 4096, maxTokens: MAX_TOKENS, removeAfterSession: false, cacheRam: 0 };
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
    maxTokens: (MAXTOK_CHOICES as readonly number[]).includes(int(o.maxTokens) ?? -1) ? (o.maxTokens as number) : DEFAULT_SETTINGS.maxTokens,
    removeAfterSession: o.removeAfterSession === true,
    cacheRam: (CACHE_CHOICES as readonly number[]).includes(int(o.cacheRam) ?? -1) ? (o.cacheRam as number) : DEFAULT_SETTINGS.cacheRam,
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
export interface Browsed { model: string; sha256: string; version: string; threads: number; ctx?: number; build?: string; guard?: string; cacheRam?: number }
let browseml: any = null;
let browsed: Browsed | null = null;
const mod = async () => (browseml ??= await esm(new URL('browseml.js', location.href).href));
const CACHE = 'browseml-models';

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
export async function loadBrowse(progress: (line: string, phase?: string) => void = () => {}): Promise<Browsed> {
  const b = await mod();
  if (b.isReady() && browsed) return browsed;
  const MB = (n: number) => `${(n / 1e6).toFixed(0)} MB`;
  const s = settings;
  browsed = await b.load((got: number, total: number, phase: string) => {
    lastProgress = { phase, got, total };
    if (phase === 'download') progress(`downloading ${b.MODEL.title}: ${MB(got)} of ${MB(total)} (once; it stays in this browser)`, phase);
    else if (phase === 'cache') progress(`the model is in this browser (${MB(got)}): no download`, phase);
    else if (phase === 'verify') progress('checking sha256… (bankML checks the model against its pin)', phase);
    else if (phase === 'retry') progress(`the connection dropped at ${MB(got)}: asking for that piece again`, phase);
  }, () => {}, { threads: s.threads ?? undefined, ctx: s.ctx, cacheRam: s.cacheRam });
  browsed = { ...browsed!, cacheRam: s.cacheRam };
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
  verified?: Browsed;
}
let dl: DownloadState = { phase: 'idle', got: 0, total: 248_302_272, rate: null, eta: null };
const dlFns = new Set<(s: DownloadState) => void>();
const setDl = (patch: Partial<DownloadState>) => { dl = { ...dl, ...patch }; dlFns.forEach(f => f(dl)); };
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
  abort = new AbortController();
  const from = partial && (dl.phase === 'paused' || (dl.phase === 'failed' && dl.resumable)) ? dl.got : 0;
  setDl({ phase: 'downloading', error: undefined, resumable: false, rate: null, eta: null, total: M.bytes, got: from, retries: 0 });
  // the bytes in hand, exactly (the state's count is updated a few times a second); whether a failure now leaves bytes
  // that a Range request can resume from
  let got = from, streaming = false, retries = 0;
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
          const r = await fetch(M.url, { signal: abort.signal, headers: { Range: `bytes=${start}-${end}` } });
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
    return verifyKept();
  } catch (e) {
    // paused or cancelled: pause() and cancel() set the state; a pause resumes from the exact byte
    if (abort?.signal.aborted) { if (dl.phase === 'paused') setDl({ got }); return null; }
    // the connection dropped mid-file (a phone, Wi-Fi that changes): keep the bytes so far, Retry resumes there
    const resumable = streaming && !!partial && got > 0 && got < M.bytes;
    if (!resumable) partial = null;
    setDl({ phase: 'failed', error: String((e as Error).message || e), resumable, got: resumable ? got : dl.got, rate: null, eta: null });
    return null;
  } finally {
    abort = null;
  }
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
  | { phase: 'restored' | 'warmed'; tokens: number; bytes: number; ms: number }
  | { phase: 'failed'; error: string };
let warmState: WarmState = { phase: 'cold' };
let warmedFor = '';
const warmFns = new Set<() => void>();
export const browseWarm = () => warmState;
export function onBrowseWarm(f: () => void) { warmFns.add(f); return () => { warmFns.delete(f); }; }
const setWarm = (w: WarmState) => { warmState = w; warmFns.forEach(f => f()); };

/** Read `composed` (the page's system prompt) into the engine now, or restore it from a slot kept on an earlier visit,
 *  so the next question reads only itself. Once per prompt and engine; a question asked meanwhile waits its turn. */
export async function warmBrowse(composed: string): Promise<WarmState> {
  const b = await mod();
  if (!b.isReady() || !browsed) return warmState;
  const system = systemFor(composed, browsed);
  const key = `${browsed.sha256}|${browsed.ctx}|${system}`;
  if (key === warmedFor && warmState.phase !== 'failed') return warmState;
  warmedFor = key;
  setWarm({ phase: 'warming', since: Date.now() });
  const r = await b.warm(system);
  setWarm(r.how === 'failed' ? { phase: 'failed', error: r.error ?? 'unknown' } : { phase: r.how, tokens: r.tokens, bytes: r.bytes, ms: r.ms });
  if (r.how !== 'failed') recordWarm({ how: r.how, tokens: r.tokens, bytes: r.bytes, ms: r.ms, threads: browsed?.threads ?? 1 });
  return warmState;
}

/** STOP the answer being written: it ends at its next piece (shared memory), or the engine is ended (no shared
 *  memory here; the next question loads the kept model again). */
export async function stopBrowse(): Promise<'stopped' | 'ended' | 'idle'> {
  const b = await mod();
  const how = b.stop();
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
  b.chat({ messages: [{ role: 'system', content: systemFor(composed, v) }, ...turns, { role: 'user', content: message }], max_tokens: maxTokens },
    (p: string) => { pieces.push(p); wake?.(); }, () => {})
    .then((r: any) => { result = r; end = true; wake?.(); }, (e: unknown) => { err = e; end = true; wake?.(); });
  let text = '';
  for (;;) {
    while (pieces.length) { const p = pieces.shift()!; text += p; yield p; }
    if (end) break;
    await new Promise<void>(r => { wake = r; });
    wake = null;
  }
  if (err) throw err;
  const receipt = result?.bankml_receipt ?? null, u = result?.usage ?? {}, tm = result?.timings ?? {};
  recordAnswer({
    threads: v.threads, ctx: v.ctx ?? 4096, cacheRam: v.cacheRam ?? 0, build: v.build ?? '',
    prompt: Number(u.prompt_tokens) || 0, completion: Number(u.completion_tokens) || 0, cached: Number(tm.cache_n) || 0,
    promptPerSec: Number(tm.prompt_per_second) || 0, genPerSec: Number(tm.predicted_per_second) || 0,
    promptMs: Number(tm.prompt_ms) || 0, genMs: Number(tm.predicted_ms) || 0, memory: Number(b.memoryBytes) || 0,
  });
  const ok = !!receipt && (await sha256hex(text)) === receipt.response_sha256;
  done({
    ok, receipt,
    usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, cache_n: tm.cache_n, finish: result?.choices?.[0]?.finish_reason },
    line: `${ok ? '✓ receipt' : receipt ? '✗ receipt: the answer does not match its sha256' : '✗ no receipt'} · bankML ${v.version} in this browser · ${v.model} · ` +
      `${u.prompt_tokens ?? '?'} + ${u.completion_tokens ?? '?'} tokens · ${Number(tm.predicted_per_second || 0).toFixed(2)} tok/s · free`,
  });
}
