// SPDX-License-Identifier: MIT
// STORAGE REPORT: what browseML keeps in this browser, what this site holds in all, and what is still available —
// counted, not guessed, and saying where each number comes from.
//   browseML    its Cache Storage caches (browseml-*: the model, kept prompts, …) counted entry by entry, plus its
//               records and settings in localStorage (keys browseml*, ultimate-clientside*, uif:*, UTF-16: 2 bytes a
//               character, as browsers store them)
//   site        the browser's own estimate (navigator.storage.estimate().usage) for this origin — which can include
//               other pages of the same site (mindx.pythai.net is also mindX) and lags the browser's own writes, so it
//               is never shown below what browseML alone was counted to hold
//   available   quota − site: what may still be written here before the browser refuses (or evicts)
import { MODEL_BYTES } from './caps';

export interface Entry { cache: string; name: string; bytes: number }
export interface Part { id: 'model' | 'prompts' | 'caches' | 'records'; label: string; bytes: number }
export interface StorageReport {
  at: number;                 // when it was read (ms since the epoch)
  readMs: number;             // how long the reading took
  entries: Entry[];           // every Cache Storage entry browseML holds, largest first
  local: { keys: number; bytes: number };
  parts: Part[];              // browseML's bytes by kind (only the kinds that hold something)
  browseml: number;           // browseML's own bytes, counted
  estimate: { usage: number; quota: number; details?: Record<string, number> } | null;
  site: number | null;        // this origin's bytes: max(estimate, browseML counted)
  quota: number | null;
  available: number | null;   // quota − site
  lagging: boolean;           // the browser's estimate reads below what browseML alone was counted to hold
  persisted: boolean | null;
}
export type Level = 'ok' | 'low' | 'bad';

const MINE = /^(browseml|ultimate-clientside|uif:)/;
const KINDS: Record<string, Part['id']> = { 'browseml-models': 'model', 'browseml-slots': 'prompts' };
const LABEL: Record<Part['id'], string> = { model: 'the model', prompts: 'kept prompts', caches: 'other caches', records: 'records and settings' };

/** The report from what was read: pure, so it is tested without a browser. */
export function summarize(entries: Entry[], local: { keys: number; bytes: number },
  estimate: StorageReport['estimate'], persisted: boolean | null, at = Date.now(), readMs = 0): StorageReport {
  const by: Record<Part['id'], number> = { model: 0, prompts: 0, caches: 0, records: local.bytes };
  for (const e of entries) by[KINDS[e.cache] ?? 'caches'] += e.bytes;
  const parts = (Object.keys(by) as Part['id'][]).filter(k => by[k] > 0).map(id => ({ id, label: LABEL[id], bytes: by[id] }));
  const browseml = parts.reduce((n, p) => n + p.bytes, 0);
  const site = estimate ? Math.max(estimate.usage, browseml) : null;
  const quota = estimate ? estimate.quota : null;
  return {
    at, readMs, entries: [...entries].sort((a, b) => b.bytes - a.bytes), local, parts, browseml, estimate, site, quota,
    available: site !== null && quota !== null ? Math.max(0, quota - site) : null,
    lagging: !!estimate && estimate.usage < browseml, persisted,
  };
}

/** How much room is left, as feedback: bad when the model could not be kept again, low when under twice its size. */
export function roomLevel(available: number | null, need = MODEL_BYTES): Level {
  if (available === null) return 'ok';
  return available < need ? 'bad' : available < 2 * need ? 'low' : 'ok';
}

/** Bytes, as people read them (decimal: kB, MB, GB). */
export function bytesSI(n: number): string {
  if (n < 1000) return `${n} B`;
  const u = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1000, i = 0;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u[i]}`;
}
/** Bytes, as memory counts them (binary: KiB, MiB, GiB). */
export function bytesIEC(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 3 : v < 100 ? 2 : 1)} ${u[i]}`;
}
/** A share of the quota, to four significant figures. */
export const share = (n: number, of: number | null) => (of ? `${(100 * n / of).toPrecision(4)} %` : '—');

/** Read it all now: browseML's caches entry by entry, its localStorage keys, the browser's estimate and persistence. */
export async function storageReport(): Promise<StorageReport> {
  const t0 = performance.now();
  const entries: Entry[] = [];
  const ok = { caches: false, local: false, estimate: false, persisted: false };
  try {
    for (const cache of await caches.keys()) {
      if (!cache.startsWith('browseml')) continue;
      const c = await caches.open(cache);
      for (const req of await c.keys()) {
        const r = await c.match(req);
        const bytes = Number(r?.headers.get('Content-Length')) || (r ? (await r.clone().blob()).size : 0);
        entries.push({ cache, name: decodeURIComponent(req.url.split('?')[0].split('/').pop() || req.url), bytes });
      }
    }
    ok.caches = true;
  } catch { /* Cache Storage off (a private window) */ }
  const local = { keys: 0, bytes: 0 };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !MINE.test(k)) continue;
      local.keys++;
      local.bytes += 2 * (k.length + (localStorage.getItem(k)?.length ?? 0));
    }
    ok.local = true;
  } catch { /* storage off */ }
  let estimate: StorageReport['estimate'] = null;
  try {
    const e = await navigator.storage?.estimate?.() as (StorageEstimate & { usageDetails?: Record<string, number> }) | undefined;
    if (e?.quota) { estimate = { usage: e.usage ?? 0, quota: e.quota, ...(e.usageDetails ? { details: e.usageDetails } : {}) }; ok.estimate = true; }
  } catch { /* not reported */ }
  let persisted: boolean | null = null;
  try { persisted = (await navigator.storage?.persisted?.()) ?? null; ok.persisted = persisted !== null; } catch { /* not reported */ }
  const r = summarize(entries, local, estimate, persisted, Date.now(), Math.round(performance.now() - t0));
  track(ok, r);
  return r;
}

// ---- accuracy: how far each number can be trusted, measured over this visit's reads ---------------------------------
type Source = 'caches' | 'local' | 'estimate' | 'persisted';
const reads: Record<Source, { ok: number; n: number }> = { caches: { ok: 0, n: 0 }, local: { ok: 0, n: 0 }, estimate: { ok: 0, n: 0 }, persisted: { ok: 0, n: 0 } };
let counted: number[] = [];
function track(ok: Record<Source, boolean>, r: StorageReport) {
  (Object.keys(reads) as Source[]).forEach(k => { reads[k].n++; if (ok[k]) reads[k].ok++; });
  counted = [...counted, r.browseml].slice(-8);
}
export interface Accuracy {
  /** The browser's estimate against the count, when this site is browseML alone it is the estimate's error. */
  estimateDelta: number | null; estimatePct: number | null;
  /** Each source: reads that succeeded of reads attempted, this visit. */
  reads: Record<Source, { ok: number; n: number }>;
  /** How much browseML's counted bytes moved over the last reads (max − min), and over how many. */
  spread: number; over: number;
}
/** The accuracy figures: pure over what is passed, so tested without a browser. */
export function accuracy(r: StorageReport, rs = reads, history = counted): Accuracy {
  const d = r.estimate ? r.estimate.usage - r.browseml : null;
  return { estimateDelta: d, estimatePct: d !== null && r.browseml ? 100 * d / r.browseml : null, reads: rs,
    spread: history.length ? Math.max(...history) - Math.min(...history) : 0, over: history.length };
}
export function accuracyLines(a: Accuracy, level: 'enhanced' | 'scientific'): string[] {
  const rate = (k: Source) => `${a.reads[k].ok}/${a.reads[k].n}`;
  const out = [`accuracy: browseML's bytes are counted exactly; the browser's estimate ${a.estimateDelta === null ? 'is not reported'
    : a.estimateDelta === 0 ? 'agrees to the byte'
    : `${a.estimateDelta > 0 ? 'reads' : 'lags'} ${bytesSI(Math.abs(a.estimateDelta))} ${a.estimateDelta > 0 ? 'above' : 'below'} the count${a.estimatePct !== null ? ` (${a.estimatePct > 0 ? '+' : ''}${a.estimatePct.toPrecision(3)} %)` : ''}${a.estimateDelta > 0 ? ': other data of this site, or its own rounding' : ''}`}`];
  if (level === 'scientific') {
    out.push(`  reads that succeeded, this visit: Cache Storage ${rate('caches')} · localStorage ${rate('local')} · estimate ${rate('estimate')} · persistence ${rate('persisted')}`);
    out.push(`  stability: browseML's count moved ${a.spread} B over the last ${a.over} read${a.over === 1 ? '' : 's'}${a.spread === 0 && a.over > 1 ? ' (repeatable)' : ''}`);
  }
  return out;
}

export const LEVELS = ['visual', 'enhanced', 'scientific'] as const;
export type Detail = typeof LEVELS[number];

/** The report as lines of text at a level of detail (the terminal's `client cache`; the panel shows the same). */
export function reportLines(r: StorageReport, level: Detail, ramCacheMiB = 0): string[] {
  const avail = r.available, lv = roomLevel(avail);
  const out = [
    `browseML uses ${bytesSI(r.browseml)}${r.quota ? ` (${share(r.browseml, r.quota)} of the quota)` : ''}`,
    r.site !== null && r.quota !== null ? `this site holds ${bytesSI(r.site)} of ${bytesSI(r.quota)} the browser allows` : 'this browser does not report its storage',
    avail !== null ? `available ${bytesSI(avail)}${lv === 'bad' ? ` — under the model's ${bytesSI(MODEL_BYTES)}: it could not be kept again` : lv === 'low' ? ' — under twice the model: little room' : ''}` : 'available: not reported',
  ];
  if (level === 'visual') return out;
  out.push(...r.parts.map(p => `  ${p.label}: ${bytesSI(p.bytes)}`));
  if (r.site !== null) out.push(`  the rest of this site: ${bytesSI(Math.max(0, r.site - r.browseml))}`);
  out.push(`kept: ${r.persisted === null ? 'not reported' : r.persisted ? 'persistent (not evicted under pressure)' : 'may be evicted under storage pressure'}`);
  out.push(`prompt cache in memory: ${ramCacheMiB ? `up to ${ramCacheMiB} MiB (not on disk)` : 'off'}`);
  out.push(...accuracyLines(accuracy(r), level));
  if (level === 'enhanced') return out;
  out.push(`exact: browseML ${r.browseml} B (${bytesIEC(r.browseml)}) · site ${r.site ?? '—'} B · quota ${r.quota ?? '—'} B · available ${avail ?? '—'} B`);
  out.push(`records: ${r.local.keys} localStorage keys, ${r.local.bytes} B (UTF-16, 2 B a character)`);
  for (const e of r.entries) out.push(`  ${e.cache}/${e.name}: ${e.bytes} B (${bytesIEC(e.bytes)})`);
  if (r.estimate?.details) out.push(`the browser's breakdown: ${Object.entries(r.estimate.details).map(([k, v]) => `${k} ${v} B`).join(' · ')}`);
  if (r.estimate) out.push(`the browser's estimate ${r.estimate.usage} B${r.lagging ? ` — ${r.browseml - r.estimate.usage} B below what browseML alone was counted to hold: it lags its own writes; the count is used` : ''}`);
  out.push(`read ${new Date(r.at).toISOString()} in ${r.readMs} ms: Cache Storage entry by entry (Content-Length, else the body's size), localStorage, navigator.storage.estimate()`);
  return out;
}
