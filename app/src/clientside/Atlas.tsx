// SPDX-License-Identifier: MIT
// ATLAS: the rage atlas of rage.pythai.net (v1, the menu's top choice), as a panel — the rage module's window.
// Travel collects complexity: branch → path → document; every node opened is kept on the TRAIL and its branch and path
// are COLLECTED, and the complexity meter shows how much has been gathered (amber when it is a lot). From a document,
// new paths drop in beneath it: kindred, its thread and CONVERGE. "Travel by a word" gives an instant path from the atlas
// itself, then "… and in the full text" from the source's search (a host: words at once, then words and meaning fused;
// this browser: BM25 here). The ragebar's sparks rise in the head as you travel. A passage pinned with ＋ goes with the
// next questions to the model in this browser, until it is unpinned. Only a host source sends anything anywhere: what
// is typed into its search (and the labels collected, for converge), to the host's own same-origin paths.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { complexity, instantPath, type AtlasData, type Doc, type Found, type Hit, type Memory, type Source } from './atlasSource';
import { sparksAllowed } from './sparks';

export type { Hit } from './atlasSource';
interface Spawn { key: string; title: string; hits: Hit[] | null; error?: string; under: string }

/** A memory as a passage: named by its agent and kind, so the model can say where it came from. */
const hashId = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
const memHit = (m: Memory): Hit => ({ doc: `memory:${m.agent}/${m.type}`, t: `${m.agent} · ${m.type}${m.at ? ` · ${m.at.slice(0, 10)}` : ''}`, text: m.text, similarity: m.similarity, chunk: hashId(m.memory_id) });
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
  const b = passagesBlock(list);
  return b ? `${b}\n\nQuestion: ${text}` : text;
}
/** The pinned passages as a block (the rage module adds it to every question while any is pinned). */
export function passagesBlock(list: Hit[] = pinned): string {
  if (!list.length) return '';
  let room = PASSAGES_CHARS;
  const parts: string[] = [];
  for (const h of list) {
    if (room <= 80) break;
    const body = h.text.replace(/\s+/g, ' ').trim();
    const cut = body.length > room - 40 ? body.slice(0, Math.max(0, room - 41)) + '…' : body;
    parts.push(`[${h.doc}] ${cut}`);
    room -= cut.length + h.doc.length + 4;
  }
  return `Passages from the documentation (context, not evidence; name the document you use):\n${parts.join('\n')}`;
}

// ---- the head's sparks (v1's own: they rise as the travel heats) ---------------------------------------------------
function useHeadSparks(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const state = useRef({ sparks: [] as { x: number; y: number; vx: number; vy: number; l: number; a: boolean }[], raf: 0 });
  const draw = () => {
    const cv = canvas.current, s = state.current;
    s.raf = 0;
    if (!cv) return;
    const c = cv.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, cv.width, cv.height);
    s.sparks = s.sparks.filter(p => (p.l -= 0.03) > 0);
    for (const p of s.sparks) {
      p.x += p.vx; p.y += p.vy;
      c.fillStyle = p.a ? `rgba(247,147,26,${p.l})` : `rgba(14,203,129,${p.l})`;
      c.fillRect(p.x, p.y, 2, 2);
    }
    if (s.sparks.length && !document.hidden) s.raf = requestAnimationFrame(draw);
  };
  return (n: number, amber = false) => {
    const cv = canvas.current;
    if (!cv || !sparksAllowed()) return;
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    for (let i = 0; i < n; i++) state.current.sparks.push({ x: Math.random() * cv.width, y: cv.height * (0.5 + Math.random() * 0.5), vx: (Math.random() - 0.5) * 2.2, vy: -(0.4 + Math.random() * 1.8), l: 1, a: amber });
    if (!state.current.raf) state.current.raf = requestAnimationFrame(draw);
  };
}

export function AtlasPanel({ src, close }: { src: Source; close?: () => void }) {
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'signin' | 'down'>('loading');
  const [detail, setDetail] = useState('');
  const [openB, setOpenB] = useState<Record<string, boolean>>({});
  const [openD, setOpenD] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ k: string; l: string }[]>([]);
  const [collected, setCollected] = useState<Record<string, number>>({});
  const [spawns, setSpawns] = useState<Spawn[]>([]);
  const [q, setQ] = useState('');
  const [path, setPath] = useState<Hit[] | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [withMem, setWithMem] = useState(false);  // the host's memories: off on every visit until the visitor turns them on
  const [busy, setBusy] = useState(false);
  const pins = useSyncExternalStore(subscribePins, () => pinned);
  const seq = useRef(0), ctl = useRef<AbortController | null>(null), cv = useRef<HTMLCanvasElement>(null), find = useRef<HTMLInputElement>(null);
  const spark = useHeadSparks(cv);

  const load = () => {
    setState('loading');
    void src.load().then(g => {
      if (g.ok) { setAtlas(g.v); setState('ok'); spark(14); } else { setState(g.why); setDetail(g.detail); }
    });
  };
  useEffect(load, [src]);
  useEffect(() => { const t = setTimeout(() => find.current?.focus({ preventScroll: true }), 60); return () => clearTimeout(t); }, []);
  // a host's sign-in happens on its own page: come back to a fresh token when this tab is shown again
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible' && state === 'signin') load(); };
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, [state, src]);

  // travel by a word: the instant path from the atlas, then the full text from the source (stale requests aborted)
  useEffect(() => {
    const text = q.trim();
    ctl.current?.abort();
    setPath(text.length >= 2 && atlas ? instantPath(atlas, text) : null);
    if (text.length < 3) { setFound(null); setBusy(false); return; }
    const n = ++seq.current, c = new AbortController();
    ctl.current = c;
    setBusy(true);
    const t = window.setTimeout(() => {
      src.search(text, 8, withMem, (g, final) => {
        if (n !== seq.current) return;
        if (final) setBusy(false);
        if (g.ok) { setFound(g.v); if (final) spark(g.v.hits.length ? 8 : 3, !g.v.hits.length); }
        else { setFound({ hits: [], error: g.why === 'signin' ? 'sign in to search' : g.detail }); if (g.why === 'signin') setState('signin'); }
      }, c.signal).catch(() => { /* aborted: a newer search is on its way */ });
    }, 300);
    return () => { window.clearTimeout(t); c.abort(); };
  }, [q, src, withMem, atlas]);

  const visit = (k: string, l: string, labels: string[] = []) => {
    setTrail(t => (t.some(x => x.k === k) ? t : [...t, { k, l }]).slice(-24));
    if (labels.length) setCollected(c => { const n = { ...c }; labels.forEach(x => { n[x] = (n[x] ?? 0) + 1; }); return n; });
    spark(6);
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
    spark(10, true);
    if (Array.isArray(run)) { setSpawns(s => [{ key, title, hits: run, under }, ...s]); return; }
    setSpawns(s => [{ key, title, hits: null, under }, ...s]);
    void src.search(run.q, 6, false, g => setSpawns(s => s.map(x => (x.key === key
      ? { ...x, hits: g.ok ? g.v.hits.filter(h => h.doc !== run.drop) : [], error: g.ok ? undefined : g.detail } : x))));
  };
  const kindred = (d: Doc) => spawn(d.id, `kindred · ${d.t}`, { q: `${d.t}. ${d.x}`, drop: d.id });
  const thread = (d: Doc) => {
    const p = atlas?.tree.flatMap(b => b.paths).find(x => x.id === d.p);
    spawn(d.id, `its thread · ${labelOf(d.p)}`, (p?.docs ?? []).filter(x => x !== d.id).map(x => ({ doc: x, t: atlas!.docs[x]?.t ?? x, text: atlas!.docs[x]?.body ?? atlas!.docs[x]?.x ?? '' })));
  };
  const top = Object.entries(collected).sort((a, b) => b[1] - a[1]);
  const converge = (under: string) => {
    const words = [...top.slice(0, 6).map(([l]) => l), ...trail.filter(t => t.k.startsWith('doc:')).slice(-4).map(t => t.l)].join('; ');
    spawn(under, 'where your path converges', { q: words });
  };
  const pin = (h: Hit) => { if (!pinned.some(x => keyOf(x) === keyOf(h))) setPinned([...pinned, h]); };
  const unpin = (h: Hit) => setPinned(pinned.filter(x => keyOf(x) !== keyOf(h)));
  const isPinned = (h: Hit) => pins.some(x => keyOf(x) === keyOf(h));
  const cx = complexity(trail.length, Object.keys(collected).length);

  const hitRow = (h: Hit) => {
    const url = h.doc.startsWith('memory:') ? null : src.readUrl(h.doc);
    return (
      <li key={keyOf(h)} className="atl-hit">
        {atlas?.docs[h.doc] ? <button type="button" className="atl-link" onClick={() => openDoc(h.doc)}>{h.t || h.doc}</button>
          : url ? <a className="atl-link" href={url} target="_blank" rel="noopener">{h.t || h.doc}</a>
          : <span className="atl-link is-mem">{h.t || h.doc}</span>}
        {h.similarity !== undefined && <span className="atl-sim" title="cosine similarity (the source's embedding model)">{h.similarity.toFixed(2)}</span>}
        {h.text && <p className="atl-text">{h.text.length > 280 ? h.text.slice(0, 279) + '…' : h.text}</p>}
        {h.text && (isPinned(h)
          ? <button type="button" className="atl-act is-on" onClick={() => unpin(h)} title="stop sending this passage with questions">✓ with my questions</button>
          : <button type="button" className="atl-act" onClick={() => pin(h)} title="send this passage with the next questions">＋ with my question</button>)}
      </li>
    );
  };
  const list = (hits: Hit[], empty = 'nothing found') => (hits.length ? <ul className="atl-hits">{hits.map(hitRow)}</ul> : <p className="atl-note is-bad">{empty}</p>);
  const spawnsUnder = (id: string) => spawns.filter(s => s.under === id).map(s => (
    <div key={s.key} className="atl-spawn">
      <div className="atl-spawn-h"><span>{s.title}</span>
        <button type="button" className="atl-x" aria-label="drop this path out" onClick={() => setSpawns(l => l.filter(x => x.key !== s.key))}>×</button></div>
      {s.hits === null ? <p className="atl-note">searching…</p> : s.error ? <p className="atl-note is-bad">{s.error}</p> : list(s.hits)}
    </div>
  ));

  return (
    <section className="atl is-open" aria-label={`rage · atlas of ${src.label}`} onKeyDown={e => { if (e.key === 'Escape' && close) { e.stopPropagation(); close(); } }}>
      <div className="atl-head">
        <canvas ref={cv} className="atl-sparks" aria-hidden="true" />
        <div className="atl-row1">
          <span className="atl-title"><span className="atl-glyph" aria-hidden="true">✵</span> rage · atlas <small>· {src.label}{atlas ? ` · ${Object.keys(atlas.docs).length} documents` : ''}</small></span>
          {close && <button type="button" className="atl-x" aria-label="close the atlas" onClick={close}>×</button>}
        </div>
        {state === 'ok' && <div className="atl-bar">
          <input ref={find} className="atl-input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="travel by a word…"
            aria-label={`travel the atlas of ${src.label} by a word`} enterKeyHint="search" />
          <span className={'atl-meter' + (found && (found.error || !found.hits.length) ? ' is-bad' : busy ? ' is-busy' : '')}
            style={{ width: `${found ? (found.error || !found.hits.length ? 100 : Math.min(100, found.hits.length * 12.5)) : busy ? 35 : 0}%` }} />
        </div>}
        <div className="atl-cx" title="complexity: the nodes you opened and the tags you collected">
          <span>complexity</span><span className="atl-cx-bar"><i style={{ width: `${Math.round(cx * 100)}%` }} className={cx > 0.8 ? 'is-hot' : undefined} /></span>
          <span>{trail.length} nodes · {Object.keys(collected).length} tags collected</span>
          {src.memories && <label className="atl-toggle" title="also search the host's memories (off by default)">
            <input type="checkbox" checked={withMem} onChange={e => setWithMem(e.target.checked)} /> memories</label>}
        </div>
        {trail.length > 0 && <div className="atl-trail" aria-label="trail">{trail.slice(-7).map((t, i) => (
          <span key={t.k}>{i > 0 && <span className="atl-sep">›</span>}
            <button type="button" title={t.l} onClick={() => (t.k.startsWith('doc:') ? openDoc(t.k.slice(4)) : setOpenB(o => ({ ...o, [t.k]: true })))}>{t.l}</button></span>))}</div>}
        {top.length > 0 && <div className="atl-collected">
          {top.slice(0, 8).map(([l, n]) => <span key={l} className="atl-chip">{l} <b>×{n}</b></span>)}
          {top.length > 1 && <button type="button" className="atl-chip" onClick={() => converge('top')}>◎ converge</button>}
          <button type="button" className="atl-chip" title="forget the trail" onClick={() => { setTrail([]); setCollected({}); setSpawns([]); }}>↺</button>
        </div>}
      </div>
      {pins.length > 0 && <div className="atl-pins" aria-live="polite">with your next questions:{' '}
        {pins.map(h => <button key={keyOf(h)} type="button" className="atl-chip is-on" title="unpin" onClick={() => unpin(h)}>{h.t || h.doc} ×</button>)}
        <button type="button" className="atl-chip" onClick={() => setPinned([])}>unpin all</button></div>}
      <div className="atl-body" role="tree" aria-label="rage atlas">
        {state === 'loading' && <p className="atl-note">drawing the atlas…</p>}
        {state === 'signin' && <p className="atl-note">Sign in as a participant to travel and search {src.label}
          {src.signin && <> — <a href={src.signin}>sign in</a>, then come back to this tab</>}. Your questions stay on this computer either way.</p>}
        {state === 'down' && <p className="atl-note is-bad">The atlas could not be read ({detail}). <button type="button" className="atl-act" onClick={load}>retry</button></p>}
        {state === 'ok' && atlas && <>
          {(path || found) && <div className="atl-found">
            <div className="atl-spawn-h"><span>“{q.trim()}”{found?.engines ? ` · ${enginesLine(found.engines)}` : ''}</span>
              <button type="button" className="atl-x" aria-label="clear the search" onClick={() => setQ('')}>×</button></div>
            {path && list(path, 'no document of the atlas holds that word')}
            {found && (found.error ? <p className="atl-note is-bad">{found.error}</p> : <>
              <div className="atl-sub">… and in the full text:</div>
              {list(found.hits.filter(h => !path?.some(p => p.doc === h.doc)), 'nothing more')}
              {found.memories && <><div className="atl-sub">… and in the memories:</div>{list(found.memories.map(memHit), 'no memory found')}</>}
            </>)}
          </div>}
          {spawnsUnder('top')}
          <ul className="atl-tree">{atlas.tree.map(b => (
            <li key={b.id}>
              <button type="button" className="atl-sum" aria-expanded={!!openB[b.id]}
                onClick={() => { setOpenB(o => ({ ...o, [b.id]: !o[b.id] })); if (!openB[b.id]) visit(b.id, b.label); }}>
                <span className="atl-tw" aria-hidden="true">▸</span>{b.label}<span className="atl-n">{b.n}</span></button>
              {openB[b.id] && <ul className="atl-kids">{b.paths.map(p => {
                const flat = b.paths.length === 1 && p.label === b.label;
                return (
                  <li key={p.id}>
                    {!flat && <button type="button" className="atl-sum" aria-expanded={!!openB[p.id]}
                      onClick={() => { setOpenB(o => ({ ...o, [p.id]: !o[p.id] })); if (!openB[p.id]) visit(p.id, p.label); }}>
                      <span className="atl-tw" aria-hidden="true">▸</span>{p.label}<span className="atl-n">{p.n}</span></button>}
                    {(openB[p.id] || flat) && <ul className="atl-kids">{p.docs.map(id => {
                      const d = atlas.docs[id];
                      if (!d) return null;
                      const here = openD === id, url = src.readUrl(id);
                      return (
                        <li key={id} id={`atl-${id}`} className={'atl-doc' + (here ? ' is-here' : '')}>
                          <button type="button" className="atl-sum" aria-expanded={here} onClick={() => (here ? setOpenD(null) : openDoc(id))}>{d.t}</button>
                          {here && <div className="atl-end">
                            {(d.body ?? d.x) && <p className="atl-text">{(d.body ?? d.x).slice(0, 600)}</p>}
                            <div className="atl-acts">
                              {url && <a className="atl-act" href={url} target="_blank" rel="noopener">read ↗</a>}
                              {(d.body ?? d.x) && (isPinned({ doc: id, t: d.t, text: d.body ?? d.x })
                                ? <button type="button" className="atl-act is-on" onClick={() => unpin({ doc: id, t: d.t, text: d.body ?? d.x })}>✓ with my questions</button>
                                : <button type="button" className="atl-act" onClick={() => pin({ doc: id, t: d.t, text: d.body ?? d.x })}>＋ with my question</button>)}
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
                );
              })}</ul>}
            </li>
          ))}</ul>
        </>}
      </div>
      <div className="atl-foot">
        {src.links?.map(l => <a key={l.href} href={l.href} target="_blank" rel="noopener">{l.label}</a>)}
        <span>{src.kind === 'host' ? `only what you type into this search goes to ${location.host}; your questions are answered on this computer`
          : 'this browser\'s own atlas: nothing leaves this computer'}</span>
      </div>
    </section>
  );
}
