// SPDX-License-Identifier: MIT
// The answering every bankML page shares (bankML UIF, mindx.pythai.net/bankml): the visitor's choice of who answers
// (tabs), each answerer's flow under Savante's delivery pattern (deliver.ts), browseML's consent card and pending
// question, "your own bankML"'s not-found card, and the Hugging Face tab (the GPL credential module's panel). The page
// keeps its own layout, actions and panels; this hook gives it onSend, the tab area and the state it shows.
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { UIFContextValue } from '../../components/UIFContext';
import type { ReplyMarks, SendMeta } from '../../types';
import { askLocal, askProvider, isRepoId, modelFile, probe, slackWindow, type Engine, type Turn, type Verdict, type VerifiedModel } from '../engine';
import {
  SPACE_MODEL_NAME, askBrowse, askSpace, browseCached, browseSettings, browseState, loadBrowse, sessionCleanup, spaceIsBankml,
  type SpaceModel,
} from '../free';
import { CARRIER, FOOTER, NAME, OFFER, RUNS_ON, loadPrefs, savePrefs, type Prefs } from '../answerers';
import { deliver, type DeliveryHooks, type Measured, type Outcome } from '../deliver';
import { AnswererTabs, CredsSection, useCreds } from './tabs';
import { BrowseConsent, BrowseControls, useDownload } from './browse';
import { NotFoundCard } from './local';
import { loadCreds } from '../credsBridge';
import './answerers.css';

export interface AnswerersOptions {
  /** localStorage key of the visitor's choice. */
  prefsKey: string;
  offered: readonly Engine[];
  uif: MutableRefObject<UIFContextValue | null>;
  /** Every settled answer (a receipts list, a log). */
  onSettled?(engine: string, model: string, v: Verdict): void;
  onMeasured?(m: Measured): void;
  /** The tab ids' prefix (two tab areas on one page need two). */
  idBase?: string;
  /** Load the credential module (bankml-creds.js); false on a page that offers no sign-in. Default true. */
  creds?: boolean;
}

type Waiting = { text: string; outputId: string };

export function useAnswerers(o: AnswerersOptions) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(o.prefsKey, o.offered));
  const [local, setLocal] = useState<{ ok: boolean; line: string }>({ ok: false, line: 'not connected yet' });
  const [tally, setTally] = useState({ in: 0, out: 0, turns: 0 });
  const [live, setLive] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ engine: Engine; how: Outcome; ok: boolean } | null>(null);
  const [last, setLast] = useState<Verdict | null>(null);
  const [notFound, setNotFound] = useState<{ reason: string; question: Waiting | null } | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [, tick] = useState(0);
  const verified = useRef<VerifiedModel | undefined>(undefined);
  const P = useRef(prefs); P.current = prefs;
  const W = useRef(waiting); W.current = waiting;
  const dl = useDownload();
  const cr = useCreds();
  const area = useRef<HTMLDivElement | null>(null);

  useEffect(() => { sessionCleanup(); if (o.creds !== false) void loadCreds(); }, []);

  const update = (patch: Partial<Prefs>) => {
    const n = { ...P.current, ...patch };
    P.current = n;
    savePrefs(o.prefsKey, n);
    setPrefs(n);
  };
  const showModel = (engine: Engine = P.current.engine) =>
    o.uif.current?.context.setModelText(modelFile(engine, { local: verified.current, provider: P.current.model }));
  const check = async (ep = P.current.endpoint, question: Waiting | null = null) => {
    const s = await probe(ep);
    setLocal({ ok: s.ok, line: s.line });
    verified.current = s.model;
    if (P.current.engine === 'local') showModel('local');
    setNotFound(s.ok ? null : { reason: `Not reachable at ${ep.replace(/\/+$/, '')}.`, question });
    return s;
  };
  const choose = (want: Engine) => {
    if (!o.offered.includes(want)) return;
    update({ engine: want });
    showModel(want);
    if (want === 'local') void check();
  };
  /** Ask `q` again in its window with whoever answers now. */
  const reask = (q: Waiting | null) => {
    const f = o.uif.current;
    if (q && f?.outputs.list().some(w => w.id === q.outputId)) f.sendTo(q.text, q.outputId);
  };
  /** browseML verified (the consent card's download, or a model already kept): the waiting question is asked. */
  const browseReady = () => {
    tick(n => n + 1);
    const q = W.current;
    setWaiting(null);
    W.current = null;
    if (P.current.engine === 'browse') reask(q);
  };
  /** Bring the tab area into view (the consent card, the not-found card). */
  const reveal = () => setTimeout(() => area.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 30);

  // "streaming · N pieces", at most five times a second
  const liveNow = useRef<number | null>(null);
  const liveTimer = useRef(0);
  const pushLive = (n: number | null) => {
    liveNow.current = n;
    if (n === null) { window.clearTimeout(liveTimer.current); liveTimer.current = 0; setLive(null); return; }
    if (!liveTimer.current) liveTimer.current = window.setTimeout(() => { liveTimer.current = 0; setLive(liveNow.current); }, 200);
  };

  const turnsOf = (outputId: string): Turn[] =>
    slackWindow((o.uif.current?.context.history ?? []).filter(h => h.output_id === outputId)).flatMap(h => [
      { role: 'user' as const, content: typeof h.sent === 'string' ? h.sent : h.user },
      { role: 'assistant' as const, content: h.assistant },
    ]);

  const hooksFor = (outputId: string, markReply: (p: ReplyMarks) => void, engine: Engine, question: Waiting): DeliveryHooks => {
    let lineId: string | null = null;
    return {
      line(text, tone, kind) {
        const out = o.uif.current?.outputs;
        if (!out) return;
        if (lineId) out.update(outputId, lineId, { text, tone, kind });
        else if (text) lineId = out.append(outputId, { role: 'system', text, tone, kind });
      },
      footer(text) { o.uif.current?.outputs.append(outputId, { role: 'system', kind: 'footer', text }); },
      live: pushLive,
      mark: markReply,
      counted(p, c) { setTally(t => ({ in: t.in + p, out: t.out + c, turns: t.turns + 1 })); },
      ended(how, v) {
        setOutcome({ engine, how, ok: how === 'delivered' && !!v?.ok });
        // your own bankML did not answer: the card with the ways forward, holding this question
        if (how === 'error' && engine === 'local') {
          setNotFound({ reason: `It did not answer this question (${P.current.endpoint}).`, question });
          setLocal({ ok: false, line: `not reachable at ${P.current.endpoint}` });
          reveal();
        }
      },
      measured: o.onMeasured,
    };
  };

  const onSend = (text: string, meta: SendMeta) => {
    const { outputId, context, annotate, markReply, signal } = meta;
    const p = P.current;
    const question = { text, outputId };
    const hooks = hooksFor(outputId, markReply, p.engine, question);
    // the receipt lives with the exchange in .history, as in Savante's savante.history
    const settle = (engine: string, model: string, done: (v: Verdict) => void) => (v: Verdict) => {
      setLast(v);
      o.onSettled?.(engine, model, v);
      // only an answer whose receipt matched is read aloud (no receipt: never spoken)
      if (!v.ok) markReply({ silent: true });
      annotate({ engine, model, receipt: v.receipt ?? null, verified: v.ok, ...(v.usage ? { usage: v.usage } : {}), ...(v.sent !== undefined && v.sent !== text ? { sent: v.sent } : {}) });
      done(v);
    };
    if (p.engine === 'space') {
      const which: SpaceModel = p.spaceModel === 'bonsai' ? 'bonsai' : 'ternary';
      const b = spaceIsBankml();
      return deliver(done => askSpace(context.system, turnsOf(outputId), text,
        settle(b ? 'bankml on the free CPU' : 'free CPU (not bankML)', b ? 'bankML' : SPACE_MODEL_NAME[which], done), which, browseSettings().maxTokens,
        line => hooks.line(line, 'working', 'status')), hooks, {
        where: b ? "bankML on Hugging Face's free CPU" : `${SPACE_MODEL_NAME[which]} on Hugging Face's free CPU (llama.cpp, not bankML)`,
        receipts: b, footer: FOOTER.space!(b), signal,
      });
    }
    if (p.engine === 'browse') {
      return deliver(done => askBrowse(context.system, turnsOf(outputId), text, settle('bankml in this browser', browseState()?.model ?? 'Bonsai-1.7B-Q1_0', done)), hooks, {
        where: 'browseML — bankML in this browser (Bonsai-1.7B Q1_0)', receipts: true, signal,
        // not downloaded: the consent card (nothing downloads until "Download and verify"); kept: loaded with a line
        prepare: async progress => {
          if (browseState()) return null;
          if (await browseCached()) { await loadBrowse(progress); tick(n => n + 1); return null; }
          setWaiting(question); W.current = question;
          reveal();
          return OFFER;
        },
      });
    }
    if (p.engine === 'hf') {
      const chosen = String(context.model.logical_model ?? '');
      const model = isRepoId(chosen) ? chosen : p.model;
      if (model !== p.model) update({ model });
      return deliver(done => askProvider(model, context.system, turnsOf(outputId), text, settle('hf provider (not bankML)', model, done), signal), hooks, {
        // "not bankML" in every line it writes and in the footer under the answer
        where: `${model} via a Hugging Face provider (not bankML)`, receipts: false, footer: FOOTER.hf!(), signal,
        prepare: async () => {
          const c = cr.api ?? (await loadCreds());
          if (!c) return 'Not asked: Hugging Face sign-in is not offered on this page (its credential module is not loaded). The free CPU tab answers at once.';
          if (!c.status().signedIn) { reveal(); return 'Not asked: sign in to Hugging Face (or paste a token, where sign-in cannot work) in the Hugging Face tab above — or use the free CPU tab, which answers at once.'; }
          return null;
        },
      });
    }
    return deliver(done => askLocal(p.endpoint, context.system, turnsOf(outputId), text, settle('bankml', verified.current?.name ?? 'unverified', done), p.self ?? 'system', p.selfStyle ?? 'aware'), hooks, {
      where: `your own bankML at ${p.endpoint.replace(/^https?:\/\//, '')}${verified.current ? ` (${verified.current.name})` : ''}`, receipts: true, signal,
    });
  };

  /** ⬇ / `load`: browseML. Kept here: verified and started (no download). Not kept: the consent card. */
  const loadHere = async (print: (line: string, kind?: 'out' | 'err') => void) => {
    choose('browse');
    if (browseState()) return print('browseML is loaded and verified: bankML answers in this browser');
    if (await browseCached()) {
      print('the model is kept in this browser: bankML checks its sha256…');
      try {
        const v = await loadBrowse();
        print(`✓ ${v.model} verified by bankML ${v.version} · ${v.threads} thread${v.threads > 1 ? 's' : ''}`);
        browseReady();
      } catch (e) { print('browseML could not start: ' + String((e as Error).message || e), 'err'); }
      return;
    }
    reveal();
    print('browseML needs a one-time download (248 MB): the card in the browseML tab says what will happen — press "Download and verify" there');
  };

  // the not-found card's ways forward
  const ways = {
    useBrowse: async () => {
      const q = notFound?.question ?? null;
      setNotFound(null);
      choose('browse');
      if (browseState()) return reask(q);
      setWaiting(q); W.current = q;
      if (await browseCached()) { try { await loadBrowse(); browseReady(); } catch { /* the card says so */ } }
      reveal();
    },
    useSpace: () => { const q = notFound?.question ?? null; setNotFound(null); choose('space'); reask(q); },
    useHf: () => { setNotFound(null); choose('hf'); reveal(); },
    retry: () => { void check(P.current.endpoint, notFound?.question ?? null).then(s => { if (s.ok && notFound?.question) reask(notFound.question); }); },
  };

  const ready = prefs.engine === 'browse' ? !!browseState() : prefs.engine === 'local' ? local.ok : prefs.engine === 'hf' ? !!cr.status?.signedIn : true;
  const idBase = o.idBase ?? 'bk-tab';
  const [ep, setEp] = useState(prefs.endpoint);

  const body = (): ReactNode => {
    switch (prefs.engine) {
      case 'space':
        return (
          <>
            <p className="bk-note">{CARRIER.space(prefs, spaceIsBankml())}</p>
            <label className="bk-inline">
              <span>model on the free CPU</span>
              <select value={prefs.spaceModel ?? 'ternary'} onChange={e => update({ spaceModel: e.target.value as SpaceModel })} aria-label="Model on the free CPU">
                <option value="ternary">Ternary-Bonsai-8B</option>
                <option value="bonsai">Bonsai-8B (1-bit)</option>
              </select>
            </label>
          </>
        );
      case 'browse':
        return (
          <>
            <p className="bk-note">{CARRIER.browse(prefs)}</p>
            {browseState() ? (
              <>
                <p className="bk-dl-line is-ok">verified ✓ — {browseState()!.model} · sha256 {browseState()!.sha256.slice(0, 16)}… · bankML {browseState()!.version} · {browseState()!.threads} thread{browseState()!.threads === 1 ? '' : 's'}. It stays available; the free CPU tab stays too.</p>
                <details className="bk-settings-details"><summary>browseML settings: CPU · memory · disk</summary><BrowseControls /></details>
              </>
            ) : (
              <BrowseConsent onVerified={browseReady} onUseSpace={o.offered.includes('space') ? () => { const q = W.current; setWaiting(null); choose('space'); reask(q); } : undefined} pendingQuestion={waiting?.text} />
            )}
          </>
        );
      case 'local':
        return (
          <>
            <p className="bk-note">{CARRIER.local(prefs)}</p>
            <form className="bk-row" onSubmit={e => { e.preventDefault(); update({ endpoint: ep }); void check(ep); }}>
              <input className="bk-input" value={ep} onChange={e => setEp(e.target.value)} aria-label="Your bankml serve's address" spellCheck={false} inputMode="url" />
              <button type="submit" className="bk-btn">Connect</button>
            </form>
            <p className={local.ok ? 'bk-dl-line is-ok' : 'bk-fine'} role="status">{local.line}</p>
            {notFound && !local.ok && (
              <NotFoundCard endpoint={prefs.endpoint} reason={notFound.reason} question={notFound.question?.text} {...ways} />
            )}
          </>
        );
      case 'hf':
        return (
          <>
            <p className="bk-note">{CARRIER.hf(prefs)}</p>
            <CredsSection />
            <label className="bk-inline">
              <span>model (owner/name)</span>
              <input className="bk-input" defaultValue={prefs.model} spellCheck={false}
                onBlur={e => { if (isRepoId(e.target.value)) { update({ model: e.target.value }); showModel('hf'); } }} aria-label="Hugging Face model (owner/name)" />
            </label>
          </>
        );
    }
  };

  const tabArea = (
    <div className="bk-answerers" ref={area}>
      <AnswererTabs offered={o.offered} active={prefs.engine} choose={choose} idBase={idBase} />
      <div className="bk-tabpanel" role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-${prefs.engine}`}>
        {body()}
        <p className="bk-runs"><i>model runs on</i> {RUNS_ON[prefs.engine](prefs, verified.current)}</p>
      </div>
    </div>
  );

  return {
    prefs, update, choose, check, showModel, local, verified, tally, live, outcome, last, ready, onSend, loadHere,
    tabArea, creds: cr, download: dl, name: NAME[prefs.engine], spaceBankml: spaceIsBankml(),
  };
}
