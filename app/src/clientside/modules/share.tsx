// SPDX-License-Identifier: MIT
// SHARE — the host edition's module (only where browseml-host.json names a `share` host, as mindX does): this
// browser lends its engine to the host, by the visitor's choice and on the visitor's terms. Nothing is shared until
// SHARE is pressed, and STOP ends it at once (the job in hand stops at its next piece and goes back to the host's
// queue). Each visit starts unshared.
//
//   SHARE → join (the realm token names the wallet credited) → pull a job (long-poll) → run it here on bankML,
//   exactly as sent → send the answer and its receipt (the host checks sha256(answer) against it) → rest → pull …
//
// What leaves this browser: the job's answer, its receipt, the engine's counts and speeds, and the model's sha256.
// Never .memory, .history, the visitor's own questions, or anything else. The visitor's choices (shareCore.ts): how much
// of the engine's time to give (the slider), only while charging, pause at a CPU pressure, pause while the tab is
// hidden, the largest job, and minutes per day. The token goes only to the host's own same-origin paths.
//
// distributed.mind: each job arrives with its kind and purpose, shown while it runs (and the exact messages, under
// "what was sent"); the visitor chooses the kinds this browser takes. A paused browser tells the host so (it is not
// counted as capacity), a job in hand keeps the session alive with a heartbeat, and a refusal retrying cannot fix
// (barred after a failed audit) stops sharing and says why. Trust is the host's: until a wallet's answers have
// matched the host's own re-run TRUST_AFTER times they are held for audit, and the panel says which.
import { useEffect, useState } from 'react';
import { Button, IndicatorLamp, LEDFader, SegmentSwitch, ToggleSwitch } from 'dreamknob';
import type { ModuleInfo } from './index';
import type { ModuleWindowProps } from '../../core/modules';
import { host, type ShareHost } from '../host';
import { monitor } from '../monitor';
import { browseCached, browseState, loadBrowse, shareBrowse } from '../../bankml/free';
import { activity } from '../../bankml/pulse';
import { summarize, usageLog } from '../../bankml/usage';
import { addThought, addToDay, DAILY_CHOICES, engineCaps, isFinal, JOB_TOKEN_CHOICES, kindsTaken, measuredSpeeds, parseKinds, parsePool, parseShare, PAUSE_CHOICES,
  pauseReason, PCT_MIN, restAfter, toggleKind, usedToday, type DayBudget, type KindInfo, type PoolView, type ShareSettings,
  type Thought } from './shareCore';

const GREEN = '#0ECB81', ORANGE = '#F7931A', RED = '#F6465D';
const KEY = 'browseml:share', DAY = 'browseml:share-day';
const HEARTBEAT_MS = 30_000, PAUSE_POLL_MS = 5_000, ERROR_BACKOFF_MS = 15_000;

const load = <T,>(k: string, f: (x: unknown) => T): T => { try { return f(JSON.parse(localStorage.getItem(k) || 'null')); } catch { return f(null); } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };
const token = (h: ShareHost) => { try { return localStorage.getItem(h.token) || ''; } catch { return ''; } };
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(r => {
  const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
});

type Phase = 'off' | 'starting' | 'waiting' | 'working' | 'resting' | 'paused' | 'error';
interface Visit { jobs: number; refused: number; tokens: number; engineMs: number; lastGen: number | null; lastPrompt: number | null; lastOk: boolean | null }
interface Trust { passed: number; after: number; trusted: boolean; note: string }
interface Current { kind: string; label: string; purpose: string; messages: { role: string; content: string }[]; maxTokens: number }
interface State { phase: Phase; why: string; restUntil: number; visit: Visit; catalogue: Record<string, KindInfo>; current: Current | null;
  thoughts: Thought[]; trust: Trust | null; /** can the host re-run this browser's model to check its answers? */ sharedModel: boolean | null }
/** A refusal retrying cannot fix: sharing stops and the panel says why. */
class Final extends Error {}

// ── the loop: one per page, kept while the window is closed ──────────────────────────────────────────────────────
let settings: ShareSettings = load(KEY, parseShare);
let state: State = { phase: 'off', why: '', restUntil: 0, visit: { jobs: 0, refused: 0, tokens: 0, engineMs: 0, lastGen: null, lastPrompt: null, lastOk: null },
  catalogue: {}, current: null, thoughts: [], trust: null, sharedModel: null };
let ctl: AbortController | null = null, session = '', ownJob = false;
const fns = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; fns.forEach(f => f()); };
export const shareState = () => state;
export const shareSettings = () => settings;
export function setShareSettings(patch: Partial<ShareSettings>) {
  settings = parseShare({ ...settings, ...patch }); save(KEY, settings); fns.forEach(f => f());
  if (session) void call('update', { session, share_pct: settings.pct, max_job_tokens: settings.maxJobTokens,
    ...(Object.keys(state.catalogue).length ? { kinds: kindsTaken(settings, state.catalogue) } : {}) }).catch(() => { /* next beat */ });
}
const asTrust = (t: unknown): Trust | null => {
  const o = t as Record<string, unknown> | null;
  return o && typeof o.passed === 'number' && typeof o.after === 'number'
    ? { passed: o.passed, after: o.after, trusted: o.trusted === true, note: typeof o.note === 'string' ? o.note : '' } : null;
};

async function call(path: keyof Pick<ShareHost, 'join' | 'update' | 'pull' | 'result' | 'leave'>, body: unknown, keepalive = false): Promise<any> {
  const h = host().share!;
  const r = await fetch(h[path], { method: 'POST', credentials: 'omit', keepalive, signal: path === 'pull' ? ctl?.signal : undefined,
    headers: { Authorization: `Bearer ${token(h)}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) throw new Final('sign in to share');
  if (!r.ok) throw new Error(`the host says ${r.status}`);
  const j = await r.json();
  if (isFinal(j)) throw new Final(j.reason || 'the host refuses this wallet');
  return j;
}

function conditions() {
  const m = monitor();
  return { charging: m.battery ? m.battery.charging : null, pressure: m.pressure, hidden: document.hidden,
    visitorBusy: !ownJob && activity() !== 'idle', usedTodayMs: usedToday(load(DAY, x => x as DayBudget | null)) };
}

async function join(): Promise<void> {
  const v = browseState()!;
  const best = state.visit.lastGen;
  let measured: { gen_tps?: number; prompt_tps?: number } = {};
  try { measured = measuredSpeeds(summarize(usageLog()).byThreads, v.threads); } catch { /* no records */ }
  const known = Object.keys(state.catalogue).length ? { kinds: kindsTaken(settings, state.catalogue) } : {};
  const j = await call('join', { model: v.model, model_sha256: v.sha256, threads: v.threads, share_pct: settings.pct,
    max_job_tokens: settings.maxJobTokens, ...known, ...measured, ...engineCaps(v), ...(best ? { gen_tps: best } : {}) });
  if (!j.ok) throw new Final(j.reason || 'the host refused');   // retrying a refused join only knocks again
  session = j.session;
  const catalogue = parseKinds(j.kinds);
  set({ catalogue, trust: asTrust(j.trust) ?? state.trust, sharedModel: typeof j.shared_model === 'boolean' ? j.shared_model : null });
  if (!known.kinds && Object.keys(catalogue).length && settings.kinds)   // the visitor's earlier choice, now that it can be named
    await call('update', { session, kinds: kindsTaken(settings, catalogue) });
}

/** SHARE: load the engine if it is only cached, join, and run until STOP. */
export async function startShare(): Promise<void> {
  if (ctl) return;
  if (!host().share) return;
  ctl = new AbortController();
  const signal = ctl.signal;
  set({ phase: 'starting', why: '' });
  try {
    if (!browseState()) {
      if (!(await browseCached())) throw new Error('import browseML first (the model is not in this browser yet)');
      await loadBrowse();
    }
    await join();
  } catch (e) { set({ phase: 'error', why: String((e as Error).message || e) }); ctl = null; session = ''; return; }
  let beat = Date.now();
  while (!signal.aborted) {
    try {
      const why = pauseReason(conditions(), settings);
      if (why) {
        if (state.phase !== 'paused') { beat = Date.now(); await call('update', { session, paused: true }); }   // not capacity now
        set({ phase: 'paused', why });
        if (Date.now() - beat > HEARTBEAT_MS) { beat = Date.now(); await call('update', { session }); }
        await sleep(PAUSE_POLL_MS, signal); continue;
      }
      if (Date.now() < state.restUntil) {
        set({ phase: 'resting', why: '' });
        if (Date.now() - beat > HEARTBEAT_MS) { beat = Date.now(); await call('update', { session }); }
        await sleep(Math.min(PAUSE_POLL_MS, state.restUntil - Date.now()), signal); continue;
      }
      set({ phase: 'waiting', why: '' });
      const got = await call('pull', { session }); beat = Date.now();
      if (!got.ok) {
        if (/no such session|session closed/.test(String(got.reason))) { await join(); continue; }   // expired while paused: join again
        throw new Error(got.reason || 'pull refused');
      }
      if (got.closed) { set({ phase: 'paused', why: 'the host closed sharing' }); await sleep(60_000, signal); continue; }
      if (!got.job) continue;
      const job = got.job;
      const kind = String(job.kind || 'answer');
      set({ phase: 'working', why: '', current: { kind, label: String(job.kind_label || state.catalogue[kind]?.label || kind),
        purpose: String(job.purpose || ''), messages: job.messages, maxTokens: job.max_tokens } });
      ownJob = true;
      const t0 = performance.now();
      let a;
      // the job's own stop: STOP ends it, and so does the host withdrawing it (its caller gave up)
      const jobCtl = new AbortController(), onStop = () => jobCtl.abort();
      signal.addEventListener('abort', onStop, { once: true });
      let withdrawn = false;
      // a long job keeps the session alive (the host would otherwise take a silent browser for gone), and the
      // heartbeat's reply says when the host no longer wants this answer, so the engine stops early
      const alive = setInterval(() => {
        void call('update', { session }).then(b => { if (b?.cancelled === job.job) { withdrawn = true; jobCtl.abort(); } })
          .catch(() => { /* the next beat */ });
      }, HEARTBEAT_MS);
      // exactly the job's own max_tokens: the host may re-run it to audit, and a smaller cap would change the bytes
      // (the host already sends only jobs within this browser's largest-job choice)
      try { a = await shareBrowse(job.messages, job.max_tokens, job.temperature, jobCtl.signal); }
      catch (e) { if (!withdrawn || signal.aborted) throw e; }
      finally { ownJob = false; clearInterval(alive); signal.removeEventListener('abort', onStop); beat = Date.now(); }
      const engineMs = performance.now() - t0;
      save(DAY, addToDay(load(DAY, x => x as DayBudget | null), engineMs));
      if (signal.aborted) break;            // STOP mid-job: nothing sent; leave() returns the job to the queue
      if (withdrawn || !a) {                 // the host withdrew it: nothing to send, and no rest owed
        set({ current: null, thoughts: addThought(state.thoughts, { at: Date.now(), kind: state.current?.label ?? kind,
          purpose: state.current?.purpose ?? '', tokens: 0, ms: engineMs, verdict: 'cancelled' }) });
        continue;
      }
      const r = await call('result', { session, job: job.job, text: a.text, receipt: a.receipt, usage: a.usage, timings: a.timings });
      const v = state.visit;
      const tokens = (Number(a.usage.prompt_tokens) || 0) + (Number(a.usage.completion_tokens) || 0);
      const thought: Thought = { at: Date.now(), kind: state.current?.label ?? kind, purpose: state.current?.purpose ?? '', tokens, ms: engineMs,
        verdict: !r.ok ? 'refused' : r.audit === 'held' ? 'held' : 'accepted' };
      set({ current: null, thoughts: addThought(state.thoughts, thought), trust: asTrust(r.trust) ?? state.trust });
      set({ restUntil: Date.now() + restAfter(engineMs, settings.pct), visit: { ...v, jobs: v.jobs + (r.ok ? 1 : 0), refused: v.refused + (r.ok ? 0 : 1),
        tokens: v.tokens + (Number(a.usage.prompt_tokens) || 0) + (Number(a.usage.completion_tokens) || 0), engineMs: v.engineMs + engineMs,
        lastGen: Number(a.timings.predicted_per_second) || v.lastGen, lastPrompt: Number(a.timings.prompt_per_second) || v.lastPrompt, lastOk: !!r.ok } });
    } catch (e) {
      if (signal.aborted) break;
      set({ phase: 'error', why: String((e as Error).message || e), current: null });
      if (e instanceof Final) { ctl = null; session = ''; break; }      // nothing a retry would change
      await sleep(ERROR_BACKOFF_MS, signal);
    }
  }
}

/** STOP: the job in hand ends at its next piece, the host takes it back, the session closes. */
export async function stopShare(): Promise<void> {
  const c = ctl; ctl = null;
  c?.abort();
  const s = session; session = '';
  set({ phase: 'off', why: '', restUntil: 0, current: null });
  if (s && host().share) { try { await call('leave', { session: s }, true); } catch { /* the host expires it */ } }
}

// leaving the page is a STOP
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (ctl) void stopShare(); });

// ── the panel ─────────────────────────────────────────────────────────────────────────────────────────────────────
const LAMP: Record<Phase, string> = { off: '#555', starting: ORANGE, waiting: GREEN, working: GREEN, resting: GREEN, paused: ORANGE, error: RED };
const secs = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(0)} s` : `${(ms / 60_000).toFixed(1)} min`);

function ShareBody(_: ModuleWindowProps) {
  const h = host().share!;
  const [, tick] = useState(0);
  const [mine, setMine] = useState<{ ledger?: { credits_earned?: number; cpu_seconds?: number; balance?: number } | null; live?: { audits_passed?: number }[];
    trust?: unknown; barred_until?: number | null; rank?: { rank: number; of: number } | null } | null>(null);
  const [pool, setPool] = useState<PoolView | null>(null);
  useEffect(() => {                         // the distributed mind now: public, read without the token
    if (!h.insight) return;
    let live = true;
    const read = () => void fetch(h.insight!, { credentials: 'omit', headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (live) setPool(parsePool(j)); }).catch(() => { if (live) setPool(null); });
    read();
    const t = setInterval(read, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [h.insight]);
  useEffect(() => { const f = () => tick(n => n + 1); fns.add(f); const t = setInterval(f, 1000); return () => { fns.delete(f); clearInterval(t); }; }, []);
  const refresh = () => {
    const t = token(h);
    if (t) void fetch(h.me, { credentials: 'omit', headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null)).then(setMine).catch(() => setMine(null));
  };
  useEffect(refresh, [state.visit.jobs]);  // eslint-disable-line react-hooks/exhaustive-deps
  const s = settings, st = state, on = st.phase !== 'off' && st.phase !== 'error' || !!ctl;
  const today = usedToday(load(DAY, x => x as DayBudget | null));
  const kinds = Object.entries(st.catalogue), taken = kindsTaken(s, st.catalogue);
  const trust = st.trust ?? asTrust(mine?.trust);
  const label = { off: 'OFF', starting: 'STARTING', waiting: 'SHARING · waiting for a job', working: 'SHARING · running a job',
    resting: `SHARING · resting ${secs(Math.max(0, st.restUntil - Date.now()))}`, paused: `PAUSED · ${st.why}`, error: `STOPPED · ${st.why}` }[st.phase];
  return (
    <div className="mp share">
      <div className="cp-row"><dt><IndicatorLamp on={st.phase !== 'off'} color={LAMP[st.phase]} size={12} /> state</dt><dd>{label}</dd></div>
      {pool && <div className="cp-row"><dt>the distributed mind</dt><dd>{pool.contributors} sharing
        ({pool.available} ready{pool.machines ? ` · ${pool.machines} machine${pool.machines === 1 ? '' : 's'}` : ''}{pool.gpus ? ` · ${pool.gpus} GPU${pool.gpus === 1 ? '' : 's'}` : ''}) · {pool.queued} thought{pool.queued === 1 ? '' : 's'} waiting · {Math.round(pool.coreSeconds)} core-seconds given
        {mine?.rank ? ` · you are #${mine.rank.rank} of ${mine.rank.of}` : ''}
        {!!pool.top.length && <details><summary>who gives the most</summary>{pool.top.map(r =>
          <div key={r.rank} className="cp-fine">#{r.rank} {r.wallet} · {Math.round(r.core_seconds)} core-s · {r.jobs} job{r.jobs === 1 ? '' : 's'}{r.trusted ? ' · trusted' : ''}</div>)}</details>}</dd></div>}
      {st.sharedModel === false && <div className="cp-row"><dt>note</dt><dd>{h.label} cannot re-run this browser's model, so it cannot check these
        answers: only kinds that accept unchecked answers come here, and trust is not earned with this model.</dd></div>}
      {st.current && <div className="cp-row"><dt>{h.label} is thinking</dt><dd><b>{st.current.label}</b>{st.current.purpose ? ` — ${st.current.purpose}` : ''}
        <details><summary>what was sent ({st.current.messages.length} message{st.current.messages.length === 1 ? '' : 's'}, up to {st.current.maxTokens} tokens back)</summary>
          {st.current.messages.map((m, i) => <pre key={i} className="cp-fine">{m.role}: {m.content}</pre>)}</details></dd></div>}

      <div className="cp-slider">
        <div className="cp-slider-head"><b>SHARE</b><span>{s.pct} % of this engine's time to {h.label} · {100 - s.pct} % yours</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={20} min={PCT_MIN} max={100} step={5} value={s.pct}
          zones={[{ upTo: 0.5, color: GREEN }, { upTo: 0.8, color: ORANGE }, { upTo: 1, color: RED }]} aria-label="Share of the engine's time"
          onChange={x => setShareSettings({ pct: x })} />
        <p className="cp-fine">After a job that held the engine t seconds it rests t·{100 - s.pct}/{s.pct} seconds before the next. Your own questions always go first.</p>
      </div>

      <div className="cp-limits">
        <ToggleSwitch on={s.onlyCharging} color={GREEN} label="only while charging" onChange={v => setShareSettings({ onlyCharging: v })} />
        <ToggleSwitch on={s.pauseHidden} color={ORANGE} label="pause when this tab is hidden" onChange={v => setShareSettings({ pauseHidden: v })} />
      </div>
      <div className="cp-row"><dt>pause at CPU pressure</dt><dd><SegmentSwitch options={PAUSE_CHOICES.map(p => p.toUpperCase())} value={PAUSE_CHOICES.indexOf(s.pauseAt)}
        color={ORANGE} size={22} onChange={i => setShareSettings({ pauseAt: PAUSE_CHOICES[i] })} /></dd></div>
      <div className="cp-row"><dt>largest job</dt><dd><SegmentSwitch options={JOB_TOKEN_CHOICES.map(String)} value={JOB_TOKEN_CHOICES.indexOf(s.maxJobTokens as never)}
        color={GREEN} size={22} onChange={i => setShareSettings({ maxJobTokens: JOB_TOKEN_CHOICES[i] })} /> tokens</dd></div>
      <div className="cp-row"><dt>per day</dt><dd><SegmentSwitch options={DAILY_CHOICES.map(m => (m ? `${m}m` : '∞'))} value={DAILY_CHOICES.indexOf(s.dailyMinutes as never)}
        color={GREEN} size={22} onChange={i => setShareSettings({ dailyMinutes: DAILY_CHOICES[i] })} /> · {secs(today)} given today</dd></div>

      {!!kinds.length && <div className="cp-limits">
        {kinds.map(([id, k]) => <ToggleSwitch key={id} on={taken.includes(id)} color={GREEN} label={`take ${k.label}`}
          onChange={() => setShareSettings({ kinds: toggleKind(s, st.catalogue, id) })} />)}
        <p className="cp-fine">{kinds.map(([, k]) => `${k.label}: ${k.about}${k.unverified_ok ? '' : ' (used only when checked)'}`).join(' · ')}</p>
      </div>}

      <div className="cp-buttons">
        <Button color={GREEN} disabled={on || !token(h)} onClick={() => void startShare()}>SHARE</Button>
        <Button color={RED} disabled={!on} onClick={() => void stopShare()}>STOP</Button>
        {!token(h) && h.signin && <a className="atl-act" href={h.signin}>sign in</a>}
      </div>

      <dl>
        <div className="cp-row"><dt>this visit</dt><dd>{st.visit.jobs} job{st.visit.jobs === 1 ? '' : 's'}{st.visit.refused ? ` (${st.visit.refused} refused)` : ''} · {st.visit.tokens} tokens · {secs(st.visit.engineMs)} of engine time</dd></div>
        {st.visit.lastGen !== null && <div className="cp-row"><dt>measured</dt><dd>reading {st.visit.lastPrompt?.toFixed(2) ?? '?'}, writing {st.visit.lastGen.toFixed(2)} tok/s · last receipt {st.visit.lastOk ? '✓ accepted' : '✗ refused'}</dd></div>}
        {!!mine?.live?.length && <div className="cp-row"><dt>audited</dt><dd>{mine.live.reduce((n, l) => n + (l.audits_passed ?? 0), 0)} answer(s) re-run by {h.label} and matched</dd></div>}
        {trust && <div className="cp-row"><dt>trust</dt><dd>{trust.passed} of your answers matched {h.label}'s own re-run · {trust.trusted
          ? 'trusted: a sampled share is audited' : `${trust.note}`}</dd></div>}
        {mine?.barred_until ? <div className="cp-row"><dt>refused</dt><dd>an answer did not match; {h.label} refuses this wallet until {new Date(mine.barred_until * 1000).toLocaleString()}</dd></div> : null}
        {!!st.thoughts.length && <div className="cp-row"><dt>thoughts given</dt><dd>{st.thoughts.map(t =>
          <div key={t.at} className="cp-fine">{new Date(t.at).toLocaleTimeString()} · {t.kind}{t.purpose ? ` — ${t.purpose}` : ''} · {t.tokens} tokens · {secs(t.ms)} · {
            t.verdict === 'accepted' ? '✓ used' : t.verdict === 'held' ? '◷ held for audit' : t.verdict === 'cancelled'
              ? '⊘ withdrawn by the host (stopped early)' : '✗ refused'}</div>)}</dd></div>}
        <div className="cp-row"><dt>credited by {h.label}</dt><dd>{mine?.ledger ? `${mine.ledger.credits_earned ?? 0} credits · ${mine.ledger.cpu_seconds ?? 0} core-seconds` : token(h) ? 'nothing yet' : 'sign in to see'}</dd></div>
      </dl>
      <p className="cp-fine">SHARE lends this browser's bankML to {h.label}: it runs {h.label}'s jobs here and sends back each answer with its receipt
        ({h.label} checks the answer against the receipt's sha256, and re-runs some answers on its own engine: the same
        pinned model gives the same bytes, and an answer that does not match is not credited), the token counts and speeds, and the model's sha256 — never your .memory, .history or
        questions. Each job says what it is for, and you choose which kinds this browser takes. Until {h.label} has matched {trust?.after ?? 'a few'} of your answers
        against its own engine, it holds them for that check. Credits are the engine's core-seconds, credited to the wallet you signed in with. STOP ends it at once; each visit starts unshared.</p>
    </div>
  );
}

export const shareModule: ModuleInfo = {
  id: 'share', label: 'share', when: () => !!host().share,
  note: "the host edition's: lend this browser's engine to the host, by your choice — a share slider, SHARE and STOP (only on such a host)",
  make() {
    return { id: 'share', label: 'share',
      windows: [{ id: 'share', file: `⇄ share with ${host().share?.label ?? 'host'}`, icon: '⇄', summary: "Lend this browser's engine to the host: how much, when, SHARE and STOP",
        Body: ShareBody, detail: () => (state.phase === 'off' ? 'off' : state.phase) }] };
  },
};
