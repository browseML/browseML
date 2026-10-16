// SPDX-License-Identifier: MIT
// What the rage atlas travels: a SOURCE gives a tree (branch → path → document) and a search. Two sources:
//   host   a host's docs (mindx.pythai.net: /atlas/docs and /atlas/docs/search — words at once, then words and meaning
//          fused), with the host's token, only to the host's own same-origin paths (host.ts)
//   local  this browser's own: .memory's notes, .history's exchanges and the control panel's sections, searched by
//          BM25 here (k1 1.2, b 0.75, the formula of browseML/embeddings and Savante) — nothing leaves the computer
// and v1's travel helpers: complexity (nodes seen, tags collected) and the instant path a word finds in the atlas.
import type { AtlasHost } from './host';

export interface Doc { id: string; t: string; x: string; b: string; p: string; body?: string }
export interface Path { id: string; label: string; n: number; docs: string[] }
export interface Branch { id: string; label: string; n: number; paths: Path[] }
export interface AtlasData { tree: Branch[]; docs: Record<string, Doc> }
export interface Hit { doc: string; t: string; text: string; similarity?: number; chunk?: number }
export interface Memory { memory_id: string; agent: string; type: string; at: string | null; text: string; similarity?: number }
export interface Found { hits: Hit[]; memories?: Memory[]; engines?: Record<string, unknown>; error?: string }
export type Got<T> = { ok: true; v: T } | { ok: false; why: 'signin' | 'down'; detail: string };

export interface Source {
  kind: 'host' | 'local';
  label: string;
  load(): Promise<Got<AtlasData>>;
  /** Paint words first, then the final answer (a local source paints once, final). */
  search(q: string, k: number, memories: boolean, paint: (g: Got<Found>, final: boolean) => void, signal?: AbortSignal): Promise<void>;
  /** Where a document is read in full (null: its text is shown here). */
  readUrl(id: string): string | null;
  /** The host's own memories can be searched beside its docs. */
  memories: boolean;
  signin?: string;
  links?: { label: string; href: string }[];
}

// ---- host -------------------------------------------------------------------------------------------------------
const token = (h: AtlasHost) => { try { return localStorage.getItem(h.token) || ''; } catch { return ''; } };
export const hasToken = (h: AtlasHost) => !!token(h);
async function get<T>(h: AtlasHost, url: string, signal?: AbortSignal): Promise<Got<T>> {
  const t = token(h);
  if (!t) return { ok: false, why: 'signin', detail: 'not signed in' };
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal, credentials: 'omit' });
    if (r.status === 401 || r.status === 403) return { ok: false, why: 'signin', detail: `the host says ${r.status}` };
    if (!r.ok) return { ok: false, why: 'down', detail: `the host says ${r.status}` };
    return { ok: true, v: (await r.json()) as T };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { ok: false, why: 'down', detail: String((e as Error).message || e) };
  }
}
export function hostSource(h: AtlasHost): Source {
  const q1 = (q: string, k: number, memories: boolean, meaning: boolean, signal?: AbortSignal) =>
    get<Found>(h, `${h.search}?q=${encodeURIComponent(q.slice(0, 500))}&k=${k}${memories ? '&memories=1' : ''}${meaning ? '' : '&meaning=0'}`, signal);
  return {
    kind: 'host', label: h.label, memories: true, signin: h.signin,
    load: () => get<AtlasData>(h, h.api),
    async search(q, k, memories, paint, signal) {
      let final = false;
      void q1(q, k, memories, false, signal).then(g => { if (!final && g.ok) paint(g, false); }).catch(() => {});
      const g = await q1(q, k, memories, true, signal);
      final = true;
      paint(g, true);
    },
    readUrl: id => `${h.doc}${id}${token(h) ? `?t=${encodeURIComponent(token(h))}` : ''}`,
    links: [{ label: 'the docs', href: '/docs.html' }],
  };
}

// ---- local ------------------------------------------------------------------------------------------------------
export interface LocalInput {
  memory: { text: string; at?: string; source?: { kind?: string } }[];
  history: { user?: string; assistant?: string; at?: string; sent_at?: string }[];
  sections: string[];
}
const day = (s?: string) => (s && /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : 'undated');
const cut = (s: string, n = 140) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** This browser's own atlas: .memory by kind, .history by day (newest first), the control panel's sections. */
export function localAtlas(i: LocalInput): AtlasData {
  const docs: Record<string, Doc> = {}, tree: Branch[] = [];
  const add = (b: Branch, pathId: string, label: string, d: Doc) => {
    let p = b.paths.find(x => x.id === pathId);
    if (!p) { p = { id: pathId, label, n: 0, docs: [] as string[] } as Path; b.paths.push(p); }
    p.docs.push(d.id); p.n++; b.n++; docs[d.id] = d;
  };
  const mem: Branch = { id: 'memory', label: '.memory', n: 0, paths: [] };
  i.memory.forEach((m, n) => { const k = m.source?.kind || 'note'; add(mem, `memory/${k}`, k, { id: `mem:${n}`, t: cut(m.text, 60), x: day(m.at), b: 'memory', p: `memory/${k}`, body: m.text }); });
  const hist: Branch = { id: 'history', label: '.history', n: 0, paths: [] };
  [...i.history].map((h, n) => ({ h, n })).reverse().forEach(({ h, n }) => {
    const d = day(h.sent_at || h.at);
    add(hist, `history/${d}`, d, { id: `his:${n}`, t: cut(h.user || '', 60) || '(no question)', x: cut(h.assistant || ''), b: 'history', p: `history/${d}`, body: `${h.user || ''}\n${h.assistant || ''}` });
  });
  const panel: Branch = { id: 'panel', label: 'control panel', n: 0, paths: [] };
  i.sections.forEach(s => add(panel, 'panel/sections', 'sections', { id: `cp:${s}`, t: s, x: 'a section of the control panel (T)', b: 'panel', p: 'panel/sections' }));
  for (const b of [mem, hist, panel]) if (b.n) tree.push(b);
  return { tree, docs };
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** BM25 (k1 1.2, b 0.75; idf ln(1 + (N − df + ½)/(df + ½))) over the atlas's documents: the best `k`. */
export function bm25(atlas: AtlasData, q: string, k: number): Hit[] {
  const ids = Object.keys(atlas.docs), qs = [...new Set(words(q))];
  if (!ids.length || !qs.length) return [];
  const toks = ids.map(id => { const d = atlas.docs[id]; return words(`${d.t} ${d.x} ${d.body ?? ''}`); });
  const avg = toks.reduce((n, t) => n + t.length, 0) / toks.length || 1;
  const df = new Map(qs.map(w => [w, toks.filter(t => t.includes(w)).length]));
  const scored = ids.map((id, i) => {
    const t = toks[i];
    let s = 0;
    for (const w of qs) {
      const f = t.filter(x => x === w).length;
      if (!f) continue;
      const idf = Math.log(1 + (ids.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * t.length / avg));
    }
    return { id, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
  return scored.map(({ id }) => { const d = atlas.docs[id]; return { doc: id, t: d.t, text: d.body ?? d.x }; });
}
export function localSource(read: () => LocalInput): Source {
  return {
    kind: 'local', label: 'this browser', memories: false,
    load: async () => ({ ok: true, v: localAtlas(read()) }),
    async search(q, k, _m, paint) {
      const t0 = performance.now();
      const hits = bm25(localAtlas(read()), q, k);
      paint({ ok: true, v: { hits, engines: { words_ms: Math.round(performance.now() - t0) } } }, true);
    },
    readUrl: () => null,
  };
}

// ---- travel (v1) ------------------------------------------------------------------------------------------------
/** v1's complexity: how much the travel has gathered, 0..1 (amber past 0.8). */
export const complexity = (nodes: number, tags: number) => Math.min(1, (nodes * 0.6 + tags * 0.4) / 40);
/** v1's instant path: the atlas's own documents whose title or note holds the word, at once (at most 10). */
export function instantPath(atlas: AtlasData, q: string): Hit[] {
  const w = q.trim().toLowerCase();
  if (w.length < 2) return [];
  return Object.values(atlas.docs).filter(d => `${d.t} ${d.x}`.toLowerCase().includes(w)).slice(0, 10).map(d => ({ doc: d.id, t: d.t, text: d.body ?? d.x }));
}
