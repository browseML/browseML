// SPDX-License-Identifier: MIT
// The free tier: answering without the visitor's own bankML and without a sign-in.
//  · space — "bankML · free CPU", the default: answers at once, exactly as PYTHAI/savante renders from Bonsai, through
//    @gradio/client to the Space Gregory-L/mindXhfgradio, endpoint /mindx. HONEST: that is Bonsai in llama.cpp on
//    Hugging Face's free CPU, not bankML's engine, and there is no receipt; every answer says so. What is typed is
//    processed on a public Space. When the Space offers a /bankml endpoint that returns a bankml_receipt, it is used
//    instead and the receipt is checked here (askSpace, findReceipt).
//  · browse — browseML: bankML itself in this browser (bankML compiled to WebAssembly). The model (Bonsai-1.7B Q1_0,
//    248 MB) is downloaded only after the visitor presses "Download and verify" (the consent card), with progress,
//    pause and cancel (download()); bankML checks its sha256 before it answers and puts a receipt on every answer,
//    checked here. The visitor's settings (threads, context, answer length, the cache) are kept in localStorage.
import type { Turn, Verdict } from './engine';
import { sha256hex } from './engine';
import { ctxCapFor } from './caps';
import { recordAnswer, recordLoad } from './usage';

const esm = (url: string): Promise<any> => import(/* @vite-ignore */ url);
export const GRADIO_ESM = 'https://cdn.jsdelivr.net/npm/@gradio/client@2.7.0/+esm';
export const FREE_SPACE = 'Gregory-L/mindXhfgradio';
export const SPACE_MODELS = { ternary: 'ternary-bonsai-8b (CPU llama.cpp)', bonsai: 'bonsai-8b (1-bit, CPU llama.cpp)' } as const;
export type SpaceModel = keyof typeof SPACE_MODELS;
export const SPACE_MODEL_NAME: Record<SpaceModel, string> = { ternary: 'Ternary-Bonsai-8B', bonsai: 'Bonsai-8B (1-bit)' };
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
  // a download by the consent card (download()) put the model in the cache first: the record says it was downloaded
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
/** The consent card's last finished download, for the next load's usage record. */
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

export async function* askBrowse(composed: string, turns: Turn[], message: string, done: (v: Verdict) => void, maxTokens = settings.maxTokens): AsyncGenerator<string> {
  const b = await mod();
  if (!b.isReady()) {
    // the page shows the consent card first; asked anyway, nothing is downloaded unasked
    if (!(await browseCached())) throw new Error('browseML is not loaded yet: press "Download and verify" in the browseML tab (248 MB once)');
    await loadBrowse();
  }
  const v = browsed!;
  const where = `WHERE YOU ARE RUNNING (measured by bankML just now): ${v.model} (sha256 ${v.sha256.slice(0, 16)}…), verified by bankML ${v.version}, ` +
    `in the visitor's own web browser, compiled to WebAssembly (browseML), on ${v.threads} CPU thread${v.threads > 1 ? 's' : ''}; nothing is sent anywhere.`;
  const pieces: string[] = [];
  let wake: (() => void) | null = null, end = false, err: unknown = null, result: any = null;
  b.chat({ messages: [{ role: 'system', content: composed + '\n\n' + where }, ...turns, { role: 'user', content: message }], max_tokens: maxTokens },
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

// ── Bonsai on Hugging Face's free CPU (mindXhfgradio), as PYTHAI/savante renders it ──────────────────────────────
/** The honest label, on every answer and in the tab's note, until bankML itself runs on that Space. */
export const SPACE_HONEST = "Bonsai on Hugging Face's free CPU — llama.cpp, not bankML's engine, no receipt";
/** Said when the Space answers with bankML and a receipt (its /bankml endpoint). */
export const SPACE_BANKML = "bankML on Hugging Face's free CPU — a receipt on the answer, checked here";
/** The Space appends a footer after the model's words (Savante's "— sAGI (Savante) …"): split off, shown as the Space's. */
export const FOOTER_MARK = '\n\n— sAGI';

const plain = (html: unknown) => {
  const s = String(html ?? '');
  if (typeof DOMParser === 'undefined') return s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return new DOMParser().parseFromString(s.replace(/</g, ' <'), 'text/html').body.textContent!.replace(/\s+/g, ' ').trim();
};
export { plain as plainText };

/** The answer and the Space's footer, apart; while streaming, a tail that may be the start of the footer is held
 *  back, so the footer's first characters never show as the model's words. Pure, so it is tested. */
export function splitFooter(full: string, final: boolean): { answer: string; footer: string } {
  const i = full.indexOf(FOOTER_MARK);
  if (i >= 0) return { answer: full.slice(0, i), footer: full.slice(i + 2).trim() };
  if (!final) {
    for (let k = Math.min(full.length, FOOTER_MARK.length - 1); k > 0; k--) {
      if (FOOTER_MARK.startsWith(full.slice(-k))) return { answer: full.slice(0, -k), footer: '' };
    }
  }
  return { answer: full, footer: '' };
}

/** What the Space's stats say: prompt and completion tokens, tok/s, seconds, where, first token. Pure, so it is tested. */
export interface SpaceStats { prompt?: number; completion?: number; tps?: number; seconds?: number; on?: string; first?: number; stopped?: string }
export function parseStats(s: string): SpaceStats {
  const num = (re: RegExp) => { const m = s.match(re); return m ? Number(m[1]) : undefined; };
  return {
    prompt: num(/prompt\s+(\d+)/), completion: num(/completion\s+(\d+)/), tps: num(/([\d.]+)\s*tok\/s/), seconds: num(/tok\/s in ([\d.]+)\s*s/),
    on: (s.match(/tok\/s in [\d.]+\s*s on (.+?)(?:\s+context\b|\s+model\b|$)/) || [])[1]?.trim(),
    first: num(/first token\s+([\d.]+)\s*s/), stopped: (s.match(/stopped on\s+(\w+)/) || [])[1],
  };
}
/** The delivery line from the Space's own stats. Pure, so it is tested. */
export function spaceDelivery(st: SpaceStats, model: string, receipt: 'none' | 'ok' | 'bad' = 'none'): string {
  const counts = `${st.prompt ?? '?'} prompt → ${st.completion ?? 0} completion tokens`;
  const r = receipt === 'ok' ? '✓ receipt: the answer matches its sha256' : receipt === 'bad' ? '✗ receipt: the answer does NOT match its sha256' : 'no receipt (not bankML)';
  return `delivered by the model — ${counts}` +
    (st.tps !== undefined ? ` · ${st.tps} tok/s` : '') + (st.first !== undefined ? ` · first token ${st.first} s` : '') +
    ` · ${model} on ${st.on || 'cpu'} · free public CPU (${FREE_SPACE}) · ${r}`;
}

/** A bankml_receipt among a Space's outputs (an object, or JSON text), or null. Pure, so it is tested. */
export function findReceipt(data: unknown[]): Record<string, unknown> | null {
  for (const d of data) {
    let o: any = d;
    if (typeof d === 'string' && /^\s*\{/.test(d)) { try { o = JSON.parse(d); } catch { continue; } }
    if (!o || typeof o !== 'object') continue;
    if (o.bankml_receipt && typeof o.bankml_receipt === 'object') return o.bankml_receipt;
    if (typeof o.response_sha256 === 'string' && typeof o.model_sha256 === 'string') return o;
  }
  return null;
}

let gradio: any = null;
let hasBankml: boolean | null = null;
/** Does the Space offer bankML itself (a /bankml endpoint)? Read from its API description once. */
async function spaceOffersBankml(client: any): Promise<boolean> {
  if (hasBankml !== null) return hasBankml;
  try {
    const api = await client.view_api();
    hasBankml = !!api?.named_endpoints?.['/bankml'];
  } catch { hasBankml = false; }
  return hasBankml;
}
/** What the free CPU tab's answers are now: Bonsai in llama.cpp (no receipt), or bankML with a receipt. */
export const spaceIsBankml = () => hasBankml === true;

export async function* askSpace(composed: string, turns: Turn[], message: string, done: (v: Verdict) => void,
  which: SpaceModel = 'ternary', maxTokens = MAX_TOKENS, progress: (line: string) => void = () => {}): AsyncGenerator<string> {
  const t0 = Date.now();
  let coldSaid = false, shown = '';
  // a Space asleep or busy says nothing for a while: after 8 s the page says it may take minutes
  let lastEv = t0, quietSaid = 0;
  const cold = setInterval(() => {
    if (!coldSaid && !shown && Date.now() - t0 > 8000) { coldSaid = true; progress('the free CPU is waking up or busy: a cold Space may take minutes (it loads the model first)'); }
    // words had started and then nothing for 30 s: say so (the connection may have dropped); Stop ends it
    const quiet = Math.round((Date.now() - lastEv) / 1000);
    if (shown && quiet >= 30 && quiet - quietSaid >= 15) { quietSaid = quiet; progress(`no word from the free CPU for ${quiet} s: it may be busy or the connection dropped — Stop, then ask again, or use browseML`); }
  }, 1000);
  try {
    if (!gradio) {
      progress(`connecting to the free CPU (${FREE_SPACE})…`);
      const { Client } = await esm(GRADIO_ESM);
      // status events too: the queue position, errors, and "complete" (without them the job's iterator never ends)
      gradio = await Client.connect(FREE_SPACE, { events: ['data', 'status'] });
    }
    const bankml = await spaceOffersBankml(gradio);
    // the Space takes one system prompt and one message: the earlier turns ride in the system prompt, briefly
    const recent = turns.slice(-6).map(t => `${t.role === 'user' ? 'Visitor' : 'You'}: ${t.content.slice(0, 600)}`).join('\n');
    const system = composed.slice(0, 3500) +
      (bankml ? '' : `\n\nWHERE THIS REPLY COMES FROM: you speak for bankML, but this reply is generated by Bonsai on Hugging Face's free public CPU (the Space ${FREE_SPACE}, llama.cpp), not by bankML's engine: no bankML arithmetic and no receipt. If asked what is running, say so.`) +
      (recent ? `\n\nTHE CONVERSATION SO FAR:\n${recent}` : '');
    const job = bankml
      ? gradio.submit('/bankml', { system, text: message, npred: Math.min(maxTokens, 512) })
      : gradio.submit('/mindx', {
        system, text: message, where: SPACE_MODELS[which], bz_persona: 'the system box above',
        npred: Math.min(maxTokens, 512), temp: 0.6, top_p: 0.9, rg_use: false,
      });
    let full = '', stats = '', data: unknown[] = [];
    for await (const ev of job) {
      lastEv = Date.now(); quietSaid = 0;
      if (ev.type === 'status') {
        if (ev.stage === 'error') throw new Error(ev.message || 'the free CPU Space reported an error');
        if (ev.stage === 'complete') break;
        if (ev.stage === 'pending' && !shown) progress(`queued on the free CPU${ev.position != null ? ` (position ${ev.position + 1}${ev.queue_size ? ` of ${ev.queue_size}` : ''})` : ''}…`);
      }
      if (ev.type === 'data') {
        data = ev.data as unknown[];
        full = String(data[0] ?? '');
        stats = plain(data[1]);
        if (!shown && !full) progress(stats ? `the free CPU: ${stats}` : 'the free CPU is reading the prompt…');
        const { answer } = splitFooter(full, false);
        if (answer.startsWith(shown) && answer.length > shown.length) { yield answer.slice(shown.length); shown = answer; }
      }
    }
    const { answer, footer } = splitFooter(full, true);
    if (answer.startsWith(shown) && answer.length > shown.length) { yield answer.slice(shown.length); shown = answer; }
    const st = parseStats(stats);
    // no completion counted, or no stats at all: no delivery from the model (as Savante)
    const completion = st.completion ?? 0;
    const receipt = bankml ? findReceipt(data) : null;
    const ok = !!receipt && (await sha256hex(answer)) === receipt.response_sha256;
    const model = bankml ? 'bankML' : SPACE_MODEL_NAME[which];
    done({
      ok, receipt: receipt as Verdict['receipt'],
      usage: { prompt_tokens: st.prompt, completion_tokens: completion, finish: st.stopped },
      footer: footer || undefined,
      delivery: spaceDelivery(st, model, bankml ? (ok ? 'ok' : 'bad') : 'none'),
      line: bankml
        ? `${ok ? '✓' : '✗'} receipt · bankML on the free CPU (${FREE_SPACE}) · ${completion} tokens`
        : `not bankML · ${model} on the free public CPU (${FREE_SPACE}, llama.cpp) · ${completion} tokens${st.tps ? ` · ${st.tps} tok/s` : ''} · no receipt · free`,
    });
  } finally {
    clearInterval(cold);
  }
}
