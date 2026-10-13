// SPDX-License-Identifier: MIT
// browseML's diagnostics from actual usage: every load and every answer as it ran in this browser — the bytes fetched
// and the pieces retried, how long the download and bankML's verification took, the engine's WebAssembly memory, and
// each answer's prompt and writing speed as bankML timed it (llama-server's `timings`) — kept in localStorage (the
// last 50 of each), never sent. `advise` turns those records, and only those, into what to change: the threads that
// measured fastest here, the context the conversations used, the memory the engine took against what the device
// reports, whether the prompt cache earned its memory. An estimate is never shown as a measurement. Pure, so tested.
import { KV_BYTES_PER_TOKEN, mb, type Verdict } from './caps';

export interface LoadRecord {
  at: number;
  /** 'cache': the model came from this browser's Cache Storage; 'download': from huggingface.co. */
  source: 'download' | 'cache';
  /** Bytes downloaded (0 from the cache). */
  fetched: number;
  /** Pieces the connection cut and the download asked for again. */
  retries: number;
  /** Download (or cache read), then the engine's open: the guard, the sha256 of the whole model, the weights. */
  modelMs: number;
  openMs: number;
  totalMs: number;
  /** The engine's WebAssembly memory once open, bytes. */
  memory: number;
  threads: number;
  ctx: number;
  cacheRam: number;
  build: string;
}

export interface AnswerRecord {
  at: number;
  threads: number;
  ctx: number;
  cacheRam: number;
  build: string;
  prompt: number;
  completion: number;
  /** Prompt tokens reused from the engine's cache (timings.cache_n). */
  cached: number;
  promptPerSec: number;
  genPerSec: number;
  promptMs: number;
  genMs: number;
  /** The engine's WebAssembly memory after the answer, bytes. */
  memory: number;
}

export interface Usage { loads: LoadRecord[]; answers: AnswerRecord[] }

const KEY = 'browseml:usage';
const KEEP = 50;
const fns = new Set<() => void>();
let now: () => number = () => Date.now();

const store = {
  read(): Usage {
    try {
      const o = JSON.parse(globalThis.localStorage?.getItem(KEY) || 'null');
      if (o && Array.isArray(o.loads) && Array.isArray(o.answers)) return { loads: o.loads.slice(-KEEP), answers: o.answers.slice(-KEEP) };
    } catch { /* storage off, or not ours */ }
    return { loads: [], answers: [] };
  },
  write(u: Usage) {
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(u)); } catch { /* storage off */ }
    fns.forEach(f => f());
  },
};

export const usageLog = (): Usage => store.read();
export function onUsage(f: () => void) { fns.add(f); return () => { fns.delete(f); }; }
export function recordLoad(r: Omit<LoadRecord, 'at'>) {
  const u = store.read();
  store.write({ ...u, loads: [...u.loads, { ...r, at: now() }].slice(-KEEP) });
}
export function recordAnswer(r: Omit<AnswerRecord, 'at'>) {
  const u = store.read();
  store.write({ ...u, answers: [...u.answers, { ...r, at: now() }].slice(-KEEP) });
}
export function clearUsage() { store.write({ loads: [], answers: [] }); }
/** Tests only: a fixed clock. */
export function setClock(f: () => number) { now = f; }

export const median = (xs: number[]) => {
  const v = xs.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export interface ThreadsRow { threads: number; answers: number; gen: number; prompt: number }
export interface Summary {
  /** The most WebAssembly memory the engine took, over every load and answer (bytes; 0: nothing measured). */
  peakMemory: number;
  /** The most tokens one exchange held (prompt + answer), against the context it ran in. */
  longest: { tokens: number; ctx: number } | null;
  /** Median writing and prompt speed (tok/s) per thread count, fewest threads first. */
  byThreads: ThreadsRow[];
  /** Prompt tokens reused from the cache over all prompt tokens. */
  cacheShare: number;
  retries: number;
  lastLoad: LoadRecord | null;
  lastAnswer: AnswerRecord | null;
}

export function summarize(u: Usage): Summary {
  const peakMemory = Math.max(0, ...u.loads.map(l => l.memory || 0), ...u.answers.map(a => a.memory || 0));
  let longest: Summary['longest'] = null;
  for (const a of u.answers) {
    const t = a.prompt + a.completion;
    if (!longest || t > longest.tokens) longest = { tokens: t, ctx: a.ctx };
  }
  const groups = new Map<number, AnswerRecord[]>();
  for (const a of u.answers) groups.set(a.threads, [...(groups.get(a.threads) ?? []), a]);
  const byThreads = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([threads, as]) => ({
    threads, answers: as.length, gen: median(as.map(a => a.genPerSec)), prompt: median(as.map(a => a.promptPerSec)),
  }));
  const promptAll = u.answers.reduce((n, a) => n + a.prompt, 0), cachedAll = u.answers.reduce((n, a) => n + a.cached, 0);
  return {
    peakMemory, longest, byThreads, cacheShare: promptAll ? cachedAll / promptAll : 0,
    retries: u.loads.reduce((n, l) => n + (l.retries || 0), 0),
    lastLoad: u.loads[u.loads.length - 1] ?? null, lastAnswer: u.answers[u.answers.length - 1] ?? null,
  };
}

export interface Now {
  /** navigator.deviceMemory (GB, rounded by the browser, at most 8), or null. */
  memoryGB: number | null;
  /** The threads and context chosen now (they apply on the next load). */
  threads: number;
  ctx: number;
  cacheRam: number;
}

/** What to change, worked out from what was measured here: the worst first. */
export function advise(u: Usage, n: Now): Verdict[] {
  const s = summarize(u);
  if (!u.loads.length && !u.answers.length) {
    return [{ level: 'ok', text: 'nothing measured yet: load browseML and ask — every number here is what ran in this browser, never an estimate' }];
  }
  const out: Verdict[] = [];
  // memory: what the engine took, against what the device reports
  if (s.peakMemory) {
    if (n.memoryGB) {
      const share = s.peakMemory / (n.memoryGB * 1e9);
      const said = `the engine took ${mb(s.peakMemory)} at most, ${Math.round(share * 100)}% of the ${n.memoryGB >= 8 ? '≥ 8' : n.memoryGB} GB this device reports`;
      out.push(share > 0.5 ? { level: 'bad', text: `${said}: lower the context or the cache, or close other tabs — the browser may close this one` }
        : share > 0.25 ? { level: 'warn', text: `${said}: comfortable while little else runs` }
        : { level: 'ok', text: said });
    } else out.push({ level: 'ok', text: `the engine took ${mb(s.peakMemory)} at most (this browser does not report the device's memory)` });
  }
  // context: what the conversations used of it
  if (s.longest && u.answers.length >= 2) {
    const used = s.longest.tokens, ctx = n.ctx;
    if (used > ctx * 0.85) out.push({ level: 'warn', text: `the longest exchange held ${used} tokens, near the ${ctx}-token context: raise it, or start new windows sooner` });
    else if (ctx > 1024 && used * 2 < ctx) {
      let fit = ctx;
      while (fit > 1024 && used * 2 < fit / 2) fit /= 2;
      if (fit < ctx) out.push({ level: 'ok', text: `the longest exchange held ${used} of ${ctx} tokens: a ${fit}-token context would hold it with room, and cap the keys and values at ${mb(fit * KV_BYTES_PER_TOKEN)} instead of ${mb(ctx * KV_BYTES_PER_TOKEN)}` });
    }
  }
  // threads: the fastest measured here
  if (s.byThreads.length >= 2) {
    const best = s.byThreads.reduce((a, b) => (b.gen > a.gen ? b : a));
    const fewer = s.byThreads.filter(r => r.threads < best.threads && r.gen >= best.gen * 0.9).sort((a, b) => a.threads - b.threads)[0];
    if (fewer) out.push({ level: 'ok', text: `${fewer.threads} thread${fewer.threads === 1 ? '' : 's'} wrote ${fewer.gen.toFixed(2)} tok/s, within 10% of ${best.threads} (${best.gen.toFixed(2)}): fewer threads leave this computer free for little cost` });
    else if (best.threads !== n.threads) out.push({ level: 'warn', text: `${best.threads} threads measured fastest here (${best.gen.toFixed(2)} tok/s writing); ${n.threads} are chosen now` });
    else out.push({ level: 'ok', text: `${best.threads} threads, chosen now, measured fastest here (${best.gen.toFixed(2)} tok/s writing)` });
  } else if (s.byThreads.length === 1) {
    const r = s.byThreads[0];
    out.push({ level: 'ok', text: `measured at ${r.threads} thread${r.threads === 1 ? '' : 's'} only (${r.gen.toFixed(2)} tok/s writing, ${r.prompt.toFixed(2)} reading): load with another count to compare` });
  }
  // the prompt cache: did it earn its memory?
  const withCache = u.answers.filter(a => a.cacheRam > 0);
  if (n.cacheRam > 0 && withCache.length >= 3 && !withCache.some(a => a.cached > 0)) {
    out.push({ level: 'warn', text: `the ${n.cacheRam} MiB prompt cache reused nothing in ${withCache.length} answers: set it to 0 to give that memory back` });
  }
  if (s.retries) out.push({ level: 'ok', text: `the connection cut ${s.retries} piece${s.retries === 1 ? '' : 's'} of the download; each was asked for again from where it stopped` });
  const order = { bad: 0, warn: 1, ok: 2 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
