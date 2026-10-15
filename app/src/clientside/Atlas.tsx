// SPDX-License-Identifier: MIT
// ATLAS: a host's documentation as the rage atlas of rage.pythai.net travels it, docked in the page — no chooser.
// Travel collects complexity: branch → path → document; every node opened is kept on the TRAIL and its branch and path
// are COLLECTED. From a document, new paths drop in beneath it: kindred (its meaning, searched), its thread (its
// neighbours on its path) and CONVERGE (what best answers everything collected so far). The ragebar on top searches by
// meaning: the host's pgvectorscale store (mindX: its embedding model over doc_embeddings), fused with a word search so
// an answer never waits on a busy embedder; mindX's memories too when the visitor turns them on (off by default). A
// passage pinned with ＋ goes with the next questions to the model in this browser, until it is unpinned.
// Only what is typed into the ragebar (and the labels of what was collected, for converge) leaves this computer, to
// the host's own same-origin paths, with the host's token; the questions themselves stay here.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { host, onHost, type AtlasHost } from './host';

interface Doc { id: string; t: string; x: string; b: string; p: string }
interface Path { id: string; label: string; n: number; docs: string[] }
interface Branch { id: string; label: string; n: number; paths: Path[] }
interface AtlasData { tree: Branch[]; docs: Record<string, Doc> }
export interface Hit { doc: string; t: string; text: string; similarity?: number; chunk?: number }
interface Memory { memory_id: string; agent: string; type: string; at: string | null; text: string; similarity?: number }
interface Found { hits: Hit[]; memories?: Memory[]; engines?: Record<string, unknown>; error?: string }
/** A memory as a passage: named by its agent and kind, so the model can say where it came from. */
const memHit = (m: Memory): Hit => ({ doc: `memory:${m.agent}/${m.type}`, t: `${m.agent} · ${m.type}${m.at ? ` · ${m.at.slice(0, 10)}` : ''}`, text: m.text, similarity: m.similarity, chunk: hashId(m.memory_id) });
const hashId = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
/** What answered, in one line: words and meaning, or words only and why. */
export function enginesLine(e?: Record<string, unknown>): string {
  if (!e) return '';
  const parts: string[] = [];
  if (typeof e.words_ms === 'number') parts.push(`words ${e.words_ms} ms`);
  if (typeof e.meaning_ms === 'number') parts.push(`meaning ${(e.meaning_ms / 1000).toFixed(1)} s${e.model ? ` (${e.model})` : ''}`);
  else if (typeof e.meaning === 'string') parts.push(`meaning: ${e.meaning}`);
  if (typeof e.memories_ms === 'number') parts.push(`memories ${e.memories_ms} ms`);
  return parts.join(' · ');
}
interface Spawn { key: string; title: string; hits: Hit[] | null; error?: string; under: string }

const OPEN = 'browseml:atlas-open';
const PASSAGES_CHARS = 1500;  // what pinned passages may add to a question (about 375 tokens of the context)

// ---- pinned passages: a tiny store the field reads when a question is asked ----------------------------------------
let pinned: Hit[] = [];
const pinFns = new Set<() => void>();
const setPinned = (l: Hit[]) => { pinned = l; pinFns.forEach(f => f()); };
const subscribePins = (f: () => void) => { pinFns.add(f); return () => { pinFns.delete(f); }; };
const keyOf = (h: Hit) => `${h.doc}#${h.chunk ?? 0}`;

/** The question as the model reads it: the pinned passages first (cut to fit), then the question. The record of the
 *  exchange keeps the question as it was typed. */
export function withPassages(text: string, list: Hit[] = pinned): string {
  if (!list.length) return text;
  let room = PASSAGES_CHARS;
  const parts: string[] = [];
  for (const h of list) {
    if (room <= 80) break;
    const body = h.text.replace(/\s+/g, ' ').trim();
    const cut = body.length > room - 40 ? body.slice(0, Math.max(0, room - 41)) + '…' : body;
    parts.push(`[${h.doc}] ${cut}`);
    room -= cut.length + h.doc.length + 4;
  }
  return `Passages from the documentation (context, not evidence; name the document you use):\n${parts.join('\n')}\n\nQuestion: ${text}`;
}

// ---- the host's endpoints -------------------------------------------------------------------------------------------
type Got<T> = { ok: true; v: T } | { ok: false; why: 'signin' | 'down'; detail: string };
const token = (h: AtlasHost) => { try { return localStorage.getItem(h.token) || ''; } catch { return ''; } };
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
const search = (h: AtlasHost, q: string, k: number, signal?: AbortSignal, memories = false, meaning = true) =>
  get<Found>(h, `${h.search}?q=${encodeURIComponent(q.slice(0, 500))}&k=${k}${memories ? '&memories=1' : ''}${meaning ? '' : '&meaning=0'}`, signal);
/** Words first, then words and meaning fused: both asked at once; `paint` gets the words-only answer only if the
 *  fused one has not come yet, and the fused one always (it replaces). `done` follows the fused answer. */
function searchBoth(h: AtlasHost, q: string, k: number, memories: boolean, paint: (g: Got<Found>, final: boolean) => void, signal?: AbortSignal) {
  let final = false;
  void search(h, q, k, signal, memories, false).then(g => { if (!final && g.ok) paint(g, false); }).catch(() => {});
  return search(h, q, k, signal, memories, true).then(g => { final = true; paint(g, true); });
}

export function Atlas() {
  const cfg = useSyncExternalStore(onHost, () => host().atlas);
  return cfg ? <AtlasDock cfg={cfg} /> : null;
}

function AtlasDock({ cfg }: { cfg: AtlasHost }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN) !== '0'; } catch { return true; } });
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'signin' | 'down'>('loading');
  const [detail, setDetail] = useState('');
  const [openB, setOpenB] = useState<Record<string, boolean>>({});
  const [openD, setOpenD] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ k: string; l: string }[]>([]);
  const [collected, setCollected] = useState<Record<string, number>>({});
  const [spawns, setSpawns] = useState<Spawn[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [withMem, setWithMem] = useState(false);  // mindX's memories: off on every visit until the visitor turns them on
  const [busy, setBusy] = useState(false);
  const pins = useSyncExternalStore(subscribePins, () => pinned);
  const seq = useRef(0), ctl = useRef<AbortController | null>(null);

  const load = () => {
    setState('loading');
    void get<AtlasData>(cfg, cfg.api).then(g => {
      if (g.ok) { setAtlas(g.v); setState('ok'); } else { setState(g.why); setDetail(g.detail); }
    });
  };
  useEffect(load, [cfg]);
  useEffect(() => { try { localStorage.setItem(OPEN, open ? '1' : '0'); } catch { /* storage off */ } }, [open]);
  // the sign-in happens on the host's own page: come back to a fresh token when this tab is shown again
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible' && state === 'signin' && token(cfg)) load(); };
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, [state, cfg]);

  // the ragebar: debounced, every older request aborted, so a slow answer never paints over a newer one
  useEffect(() => {
    const text = q.trim();
    ctl.current?.abort();
    if (text.length < 3) { setFound(null); setBusy(false); return; }
    const n = ++seq.current, c = new AbortController();
    ctl.current = c;
    setBusy(true);
    const t = window.setTimeout(() => {
      searchBoth(cfg, text, 8, withMem, (g, final) => {
        if (n !== seq.current) return;
        if (final) setBusy(false);
        if (g.ok) setFound(g.v);
        else { setFound({ hits: [], error: g.why === 'signin' ? 'sign in to search' : g.detail }); if (g.why === 'signin') setState('signin'); }
      }, c.signal).catch(() => { /* aborted: a newer search is on its way */ });
    }, 350);
    return () => { window.clearTimeout(t); c.abort(); };
  }, [q, cfg, withMem]);

  const visit = (k: string, l: string, labels: string[] = []) => {
    setTrail(t => (t.some(x => x.k === k) ? t : [...t, { k, l }]).slice(-24));
    if (labels.length) setCollected(c => { const n = { ...c }; labels.forEach(x => { n[x] = (n[x] ?? 0) + 1; }); return n; });
  };
  const labelOf = (id: string) => {
    for (const b of atlas?.tree ?? []) { if (b.id === id) return b.label; for (const p of b.paths) if (p.id === id) return p.label; }
    return id;
  };
  const openDoc = (id: string) => {
    const d = atlas?.docs[id];
    if (!d) return;
    setOpenB(o => ({ ...o, [d.b]: true, [d.p]: true }));
    setOpenD(id);
    visit(`doc:${id}`, d.t, [labelOf(d.b), labelOf(d.p)]);
    requestAnimationFrame(() => document.getElementById(`atl-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  /** A path spawned beneath a node: a list at once, or a search painted words first, then words and meaning. */
  const spawn = (under: string, title: string, run: Hit[] | { q: string; drop?: string }) => {
    const key = `${under}:${title}:${Date.now()}`;
    if (Array.isArray(run)) { setSpawns(s => [{ key, title, hits: run, under }, ...s]); return; }
    setSpawns(s => [{ key, title, hits: null, under }, ...s]);
    void searchBoth(cfg, run.q, 6, false, g => setSpawns(s => s.map(x => (x.key === key
      ? { ...x, hits: g.ok ? g.v.hits.filter(h => h.doc !== run.drop) : [], error: g.ok ? undefined : g.detail } : x))));
  };
  const kindred = (d: Doc) => spawn(d.id, `kindred · ${d.t}`, { q: `${d.t}. ${d.x}`, drop: d.id });
  const thread = (d: Doc) => {
    const path = atlas?.tree.flatMap(b => b.paths).find(p => p.id === d.p);
    spawn(d.id, `its thread · ${labelOf(d.p)}`, (path?.docs ?? []).filter(x => x !== d.id).map(x => ({ doc: x, t: atlas!.docs[x]?.t ?? x, text: atlas!.docs[x]?.x ?? '' })));
  };
  const top = Object.entries(collected).sort((a, b) => b[1] - a[1]);
  const converge = (under: string) => {
    const words = [...top.slice(0, 6).map(([l]) => l), ...trail.filter(t => t.k.startsWith('doc:')).slice(-4).map(t => t.l)].join('; ');
    spawn(under, 'where your path converges', { q: words });
  };
  const pin = (h: Hit) => { if (!pinned.some(x => keyOf(x) === keyOf(h))) setPinned([...pinned, h]); };
  const unpin = (h: Hit) => setPinned(pinned.filter(x => keyOf(x) !== keyOf(h)));
  const isPinned = (h: Hit) => pins.some(x => keyOf(x) === keyOf(h));
  const readUrl = (id: string) => `${cfg.doc}${id}${token(cfg) ? `?t=${encodeURIComponent(token(cfg))}` : ''}`;

  const hitRow = (h: Hit) => (
    <li key={keyOf(h)} className="atl-hit">
      {h.doc.startsWith('memory:') ? <span className="atl-link is-mem">{h.t}</span>
        : <button type="button" className="atl-link" onClick={() => (atlas?.docs[h.doc] ? openDoc(h.doc) : window.open(readUrl(h.doc), '_blank', 'noopener'))}>{h.t || h.doc}</button>}
      {h.similarity !== undefined && <span className="atl-sim" title="cosine similarity (the host's embedding model)">{h.similarity.toFixed(2)}</span>}
      {h.text && <p className="atl-text">{h.text.length > 280 ? h.text.slice(0, 279) + '…' : h.text}</p>}
      {h.text && (isPinned(h)
        ? <button type="button" className="atl-act is-on" onClick={() => unpin(h)} title="stop sending this passage with questions">✓ with my questions</button>
        : <button type="button" className="atl-act" onClick={() => pin(h)} title="send this passage with the next questions">＋ with my question</button>)}
    </li>
  );
  const spawnsUnder = (id: string) => spawns.filter(s => s.under === id).map(s => (
    <div key={s.key} className="atl-spawn">
      <div className="atl-spawn-h"><span>{s.title}</span>
        <button type="button" className="atl-x" aria-label="drop this path out" onClick={() => setSpawns(l => l.filter(x => x.key !== s.key))}>×</button></div>
      {s.hits === null ? <p className="atl-note">searching…</p>
        : s.error ? <p className="atl-note is-bad">{s.error}</p>
        : s.hits.length ? <ul className="atl-hits">{s.hits.map(hitRow)}</ul> : <p className="atl-note is-bad">nothing found</p>}
    </div>
  ));

  const meter = found ? (found.error || !found.hits.length ? 100 : Math.min(100, found.hits.length * 12.5)) : busy ? 35 : 0;
  return (
    <section className={'atl' + (open ? ' is-open' : '')} aria-label={`${cfg.label} atlas`}>
      <div className="atl-head">
        <button type="button" className="atl-fold" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="atl-glyph" aria-hidden="true">✵</span> {cfg.label}
          {atlas && <small> · {Object.keys(atlas.docs).length} documents</small>}
        </button>
        {state === 'ok' && (<>
          <div className="atl-bar">
            <input className="atl-input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={`search ${cfg.label}: words and meaning`}
              aria-label={`search ${cfg.label}`} enterKeyHint="search" />
            <span className={'atl-meter' + (found && (found.error || !found.hits.length) ? ' is-bad' : busy ? ' is-busy' : '')} style={{ width: `${meter}%` }} />
          </div>
          <label className="atl-toggle" title="also search mindX's memories (off by default)">
            <input type="checkbox" checked={withMem} onChange={e => setWithMem(e.target.checked)} /> memories
          </label>
        </>)}
      </div>
      {pins.length > 0 && (
        <div className="atl-pins" aria-live="polite">with your next questions:{' '}
          {pins.map(h => <button key={keyOf(h)} type="button" className="atl-chip is-on" title="unpin" onClick={() => unpin(h)}>{h.t || h.doc} ×</button>)}
          <button type="button" className="atl-chip" onClick={() => setPinned([])}>unpin all</button>
        </div>
      )}
      {open && (
        <div className="atl-body">
          {state === 'loading' && <p className="atl-note">reading the atlas…</p>}
          {state === 'signin' && <p className="atl-note">Sign in as a participant to travel and search {cfg.label}
            {cfg.signin && <> — <a href={cfg.signin}>sign in</a>, then come back to this tab</>}. Your questions stay on this computer either way.</p>}
          {state === 'down' && <p className="atl-note is-bad">The atlas did not load ({detail}). <button type="button" className="atl-act" onClick={load}>retry</button></p>}
          {state === 'ok' && atlas && <>
            {found && (
              <div className="atl-found">
                <div className="atl-spawn-h"><span>“{q.trim()}” · {enginesLine(found.engines)}</span>
                  <button type="button" className="atl-x" aria-label="clear the search" onClick={() => setQ('')}>×</button></div>
                {found.error ? <p className="atl-note is-bad">{found.error}</p>
                  : found.hits.length ? <ul className="atl-hits">{found.hits.map(hitRow)}</ul> : <p className="atl-note is-bad">nothing found in the docs</p>}
                {found.memories && <>
                  <div className="atl-spawn-h atl-sub"><span>mindX's memories</span></div>
                  {found.memories.length ? <ul className="atl-hits">{found.memories.map(m => hitRow(memHit(m)))}</ul> : <p className="atl-note is-bad">no memory found</p>}
                </>}
              </div>
            )}
            {(trail.length > 0 || top.length > 0) && (
              <div className="atl-travel">
                {trail.length > 0 && <div className="atl-trail" aria-label="trail">{trail.map(t => (
                  <button key={t.k} type="button" title={t.l} onClick={() => (t.k.startsWith('doc:') ? openDoc(t.k.slice(4)) : setOpenB(o => ({ ...o, [t.k]: true })))}>{t.l}</button>))}</div>}
                <div className="atl-collected">
                  {top.slice(0, 8).map(([l, n]) => <span key={l} className="atl-chip">{l} <b>×{n}</b></span>)}
                  {top.length > 1 && <button type="button" className="atl-chip" onClick={() => converge('top')}>◎ converge</button>}
                  <button type="button" className="atl-chip" title="forget the trail" onClick={() => { setTrail([]); setCollected({}); setSpawns([]); }}>↺</button>
                </div>
                {spawnsUnder('top')}
              </div>
            )}
            <ul className="atl-tree">{atlas.tree.map(b => (
              <li key={b.id}>
                <button type="button" className="atl-sum" aria-expanded={!!openB[b.id]}
                  onClick={() => { setOpenB(o => ({ ...o, [b.id]: !o[b.id] })); if (!openB[b.id]) visit(b.id, b.label); }}>
                  <span className="atl-tw" aria-hidden="true">▸</span>{b.label}<span className="atl-n">{b.n}</span></button>
                {openB[b.id] && <ul className="atl-kids">{b.paths.map(p => (
                  <li key={p.id}>
                    {b.paths.length > 1 || p.label !== b.label
                      ? <button type="button" className="atl-sum" aria-expanded={!!openB[p.id]}
                          onClick={() => { setOpenB(o => ({ ...o, [p.id]: !o[p.id] })); if (!openB[p.id]) visit(p.id, p.label); }}>
                          <span className="atl-tw" aria-hidden="true">▸</span>{p.label}<span className="atl-n">{p.n}</span></button>
                      : null}
                    {(openB[p.id] || (b.paths.length === 1 && p.label === b.label)) && <ul className="atl-kids">{p.docs.map(id => {
                      const d = atlas.docs[id];
                      if (!d) return null;
                      const here = openD === id;
                      return (
                        <li key={id} id={`atl-${id}`} className={'atl-doc' + (here ? ' is-here' : '')}>
                          <button type="button" className="atl-sum" aria-expanded={here} onClick={() => (here ? setOpenD(null) : openDoc(id))}>{d.t}</button>
                          {here && <div className="atl-end">
                            {d.x && <p className="atl-text">{d.x}</p>}
                            <div className="atl-acts">
                              <a className="atl-act" href={readUrl(id)} target="_blank" rel="noopener">read ↗</a>
                              <button type="button" className="atl-act" onClick={() => kindred(d)}>✵ kindred</button>
                              <button type="button" className="atl-act" onClick={() => thread(d)}>↔ its thread</button>
                              {top.length > 1 && <button type="button" className="atl-act" onClick={() => converge(id)}>◎ converge</button>}
                            </div>
                            {spawnsUnder(id)}
                          </div>}
                        </li>
                      );
                    })}</ul>}
                  </li>
                ))}</ul>}
              </li>
            ))}</ul>
            <p className="atl-foot">Only what you type into this search (and, for converge, the labels you collected) goes to {location.host}, with your sign-in; your questions are answered on this computer.</p>
          </>}
        </div>
      )}
    </section>
  );
}
