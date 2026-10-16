// SPDX-License-Identifier: MIT
// CLIENT DATA: answers about this computer come from this computer — what browseML measures here, given with the
// question when the question is about it — and the changes a visitor asks for are proposed, exactly, for one press.
// The page recognises the request (a 1-bit model is not asked to), the settings' own validators check every value, and
// nothing changes until the visitor presses. Pure functions over a snapshot, so they are tested without a browser.
import { CACHE_CHOICES, CTX_CHOICES, MAXTOK_CHOICES, parseSettings, type BrowseSettings } from './free';

export type Topic = 'cpu' | 'memory' | 'gpu' | 'storage' | 'battery' | 'network' | 'speed' | 'engine' | 'settings';
const TOPICS: [Topic, RegExp][] = [
  ['cpu', /\b(cpu|processors?|cores?|threads?)\b/i],
  ['memory', /\b(ram|how much memory|device memory|memory (?:of|on|in|does) (?:my|this|the) (?:computer|device|phone|laptop|machine))\b/i],
  ['gpu', /\b(gpus?|graphics(?: card)?|webgpu|video card)\b/i],
  ['storage', /\b(storage|cache|caches|disk|quota|space (?:left|available)|how much space)\b/i],
  ['battery', /\b(battery|charging|plugged in|on power)\b/i],
  ['network', /\b(network|internet|connection|bandwidth|latency|offline|online|wi-?fi)\b/i],
  ['speed', /\b(tok(?:ens)?\/s|tokens? (?:a|per) second|how fast|speed|so slow|faster)\b/i],
  ['engine', /\b(which model|what model|which engine|engine|webassembly|wasm|simd|verified)\b/i],
  ['settings', /\b(settings?|context (?:size|window)|max(?:imum)? tokens|answer length|preset)\b/i],
];
/** The topics a question asks about this computer; none for an ordinary question. */
export function intent(q: string): Topic[] {
  const own = /\b(my|this|the)\s+(computer|device|phone|laptop|machine|browser|tab|pc|mac)\b|\b(you|browseml|bankml)\b.*\b(using|running|on)\b/i.test(q);
  return TOPICS.filter(([t, r]) => r.test(q) && (own || t !== 'memory' || /\bram\b/i.test(q))).map(([t]) => t);
}

export interface Snapshot {
  cores?: number | null; memoryGB?: number | null; threadsFree?: number | null; threadsUsed?: number | null;
  simd?: boolean; relaxedSimd?: boolean; isolated?: boolean;
  gpu?: string | null; gpuBusy?: number | null;
  storage?: string[];
  battery?: { level: number; charging: boolean } | null;
  network?: { online: boolean; effectiveType?: string; downlink?: number; rtt?: number } | null;
  tokPerSec?: number | null; lastAnswerTokPerSec?: number | null;
  model?: string | null; engineVersion?: string | null; engineMemoryMB?: number | null;
  settings?: BrowseSettings;
  advice?: string[];
}
const pct = (x: number) => `${Math.round(x * 100)} %`;
/** The lines a question's topics call for, measured here, short and exact (about 600 characters at most). */
export function clientFacts(s: Snapshot, topics: Topic[], budget = 600): string[] {
  const out: string[] = [];
  const add = (l: string | null | undefined) => { if (l && !out.includes(l)) out.push(l); };
  for (const t of topics) {
    if (t === 'cpu') add(`CPU: ${s.cores ?? 'not reported'} logical cores${s.threadsFree != null ? ` · ${s.threadsFree} free, measured` : ''}${s.threadsUsed != null ? ` · the engine uses ${s.threadsUsed}` : ''}`);
    if (t === 'memory') add(`memory: ${s.memoryGB != null ? `the browser reports ${s.memoryGB} GB (a rounded floor)` : 'not reported by this browser'}${s.engineMemoryMB != null ? ` · the engine holds ${s.engineMemoryMB} MB` : ''}`);
    if (t === 'gpu') add(`GPU: ${s.gpu ?? 'none in use'}${s.gpuBusy != null ? ` · busy ${Math.round(s.gpuBusy)} %` : ''}`);
    if (t === 'storage') (s.storage ?? []).slice(0, 3).forEach(l => add(`storage: ${l}`));
    if (t === 'battery') add(s.battery ? `battery: ${pct(s.battery.level)}${s.battery.charging ? ', charging' : ', on battery'}` : 'battery: not reported (a desktop, or the browser does not say)');
    if (t === 'network') add(s.network ? `network: ${s.network.online ? 'online' : 'offline'}${s.network.effectiveType ? ` · ${s.network.effectiveType}` : ''}${s.network.downlink != null ? ` · about ${s.network.downlink} Mb/s` : ''}${s.network.rtt != null ? ` · ${s.network.rtt} ms round trip` : ''}` : null);
    if (t === 'speed') add(`speed: ${s.lastAnswerTokPerSec != null ? `the last answer was written at ${s.lastAnswerTokPerSec.toFixed(2)} tokens a second` : 'no answer measured yet'}${s.threadsUsed != null ? ` on ${s.threadsUsed} thread${s.threadsUsed === 1 ? '' : 's'}` : ''}`);
    if (t === 'engine') add(`engine: ${s.model ?? 'not loaded'}${s.engineVersion ? ` · bankML ${s.engineVersion}` : ''} · WebAssembly${s.simd ? ' SIMD' : ''}${s.relaxedSimd ? ' (relaxed where exact)' : ''}${s.isolated ? ' · threads allowed' : ' · one thread (not isolated)'}`);
    if (t === 'settings' && s.settings) add(`settings: threads ${s.settings.threads ?? 'auto'} · context ${s.settings.ctx} · answers up to ${s.settings.maxTokens} tokens · prompt cache ${s.settings.cacheRam} MiB`);
  }
  if (topics.length) (s.advice ?? []).slice(0, 2).forEach(l => add(`advice: ${l}`));
  const kept: string[] = [];
  let used = 0;
  for (const l of out) { if (used + l.length > budget) break; kept.push(l); used += l.length + 1; }
  return kept;
}
/** The question as the model reads it: this computer's lines first, then the question (the record keeps it as typed). */
export function withFacts(q: string, lines: string[]): string {
  return lines.length ? `THIS COMPUTER (measured here, now — answer from these, not from guesses):\n${lines.map(l => `- ${l}`).join('\n')}\n\nQuestion: ${q}` : q;
}

// ---- adjustments, proposed --------------------------------------------------------------------------------------
export interface Proposal {
  id: string; label: string; when: 'next load' | 'next question' | 'now';
  settings?: Partial<BrowseSettings>; limits?: { power?: 'low-power' | 'high-performance'; gpuProbe?: boolean };
}
const step = <T extends number>(list: readonly T[], v: number, dir: 1 | -1): T | null => {
  const i = list.findIndex(x => x >= v), at = i < 0 ? list.length - 1 : i;
  const n = dir > 0 ? (list[at] > v ? at : at + 1) : (list[at] < v ? at : at - 1);
  return n >= 0 && n < list.length ? list[n] : null;
};
/** The changes a question asks for, each exact and checked by the settings' own validator; [] for anything else. */
export function proposals(q: string, s: BrowseSettings, maxThreads: number | null, limits?: { power?: string; gpuProbe?: boolean }): Proposal[] {
  const out: Proposal[] = [];
  const t = q.toLowerCase();
  const checked = (patch: Partial<BrowseSettings>) => { const p = parseSettings({ ...s, ...patch }); return Object.keys(patch).every(k => JSON.stringify((p as unknown as Record<string, unknown>)[k]) === JSON.stringify((patch as Record<string, unknown>)[k])); };
  const m = t.match(/\b(?:use|set|run (?:on|with)|give (?:it|you))\s+(\d{1,2})\s+threads?\b/) || t.match(/\b(\d{1,2})\s+threads?\s+(?:please|instead)\b/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && (maxThreads == null || n <= maxThreads) && n !== s.threads && checked({ threads: n })) out.push({ id: 'threads', label: `threads ${s.threads ?? 'auto'} → ${n}`, when: 'next load', settings: { threads: n } });
  } else if (/\b(all|every) (?:the )?(cores|threads)\b|\buse everything\b/.test(t) && s.threads !== null) {
    out.push({ id: 'threads', label: `threads ${s.threads} → auto (all it may take)`, when: 'next load', settings: { threads: null } });
  }
  if (/\b(longer|more detailed|fuller|bigger) answers?\b|\banswer (?:in )?more\b/.test(t)) { const v = step(MAXTOK_CHOICES, s.maxTokens, 1); if (v) out.push({ id: 'maxTokens', label: `answers up to ${s.maxTokens} → ${v} tokens`, when: 'next question', settings: { maxTokens: v } }); }
  if (/\b(shorter|brief|briefer|concise|quicker) answers?\b/.test(t)) { const v = step(MAXTOK_CHOICES, s.maxTokens, -1); if (v) out.push({ id: 'maxTokens', label: `answers up to ${s.maxTokens} → ${v} tokens`, when: 'next question', settings: { maxTokens: v } }); }
  if (/\b(more|bigger|larger|longer) context\b/.test(t)) { const v = step(CTX_CHOICES, s.ctx, 1); if (v) out.push({ id: 'ctx', label: `context ${s.ctx} → ${v} tokens`, when: 'next load', settings: { ctx: v } }); }
  if (/\b(less|smaller|shorter) context\b/.test(t)) { const v = step(CTX_CHOICES, s.ctx, -1); if (v) out.push({ id: 'ctx', label: `context ${s.ctx} → ${v} tokens`, when: 'next load', settings: { ctx: v } }); }
  const c = t.match(/\bprompt cache (?:of |to )?(\d{1,3})\s*(?:mib|mb)?\b/);
  if (c && (CACHE_CHOICES as readonly number[]).includes(Number(c[1])) && Number(c[1]) !== s.cacheRam) out.push({ id: 'cacheRam', label: `prompt cache ${s.cacheRam} → ${c[1]} MiB`, when: 'next load', settings: { cacheRam: Number(c[1]) as BrowseSettings['cacheRam'] } });
  if (/\b(turn|switch) (?:the )?gpu off\b|\bno gpu\b|\bcpu only\b/.test(t) && limits?.gpuProbe !== false) out.push({ id: 'gpu', label: 'GPU off: the CPU computes everything', when: 'next load', limits: { gpuProbe: false } });
  if (/\b(turn|switch) (?:the )?gpu (?:back )?on\b|\buse (?:the|my) gpu\b/.test(t) && limits?.gpuProbe === false) out.push({ id: 'gpu', label: 'GPU on, where it is exact and faster', when: 'next load', limits: { gpuProbe: true } });
  if (/\b(save|saving) (?:my )?(battery|power)\b|\blow[- ]power\b/.test(t) && limits?.power !== 'low-power') out.push({ id: 'power', label: 'power: low (the integrated GPU, a lighter load)', when: 'next load', limits: { power: 'low-power' } });
  return out;
}
