// SPDX-License-Identifier: MIT
// browseML in the page: the consent card (what will happen, the room it needs, nothing downloaded until "Download and
// verify"), the download's feedback (MB done of total, MB/s, time left, "checking sha256…", "verified ✓" or the
// failure with a retry; pause and cancel), and the controls — CPU, RAM, disk and cache — on the card and afterwards
// in the browseML section. Everything is read in this browser and written as text; settings are kept in localStorage.
import { useEffect, useMemo, useState } from 'react';
import {
  CTX_CHOICES, MAXTOK_CHOICES, askPersist, browseDiag, browseMaxThreads, browseSettings, browseState, cancelDownload,
  clearBrowseCache, download, downloadState, keptFiles, loadBrowse, onBrowseSettings, onDownload, pauseDownload,
  persisted, setBrowseSettings, storageEstimate, unloadBrowse, type DownloadState, type KeptFile,
} from '../free';
import { ENGINE_OVERHEAD, KV_BYTES_PER_TOKEN, MODEL_BYTES, browseVerdicts, ctxCapFor, mb, ramEstimate, readCaps } from '../caps';

export function useDownload(): DownloadState {
  const [s, set] = useState(downloadState);
  useEffect(() => onDownload(set), []);
  return s;
}
export function useBrowseSettings() {
  const [s, set] = useState(browseSettings);
  useEffect(() => onBrowseSettings(() => set(browseSettings())), []);
  return s;
}
function useStorage(every = 5000) {
  const [est, setEst] = useState<{ usage: number; quota: number } | null | undefined>(undefined);
  const [keep, setKeep] = useState<boolean | null | undefined>(undefined);
  const [files, setFiles] = useState<KeptFile[]>([]);
  const [n, again] = useState(0);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const [e, p, f] = await Promise.all([storageEstimate(), persisted(), keptFiles()]);
      if (live) { setEst(e); setKeep(p); setFiles(f); }
    };
    void read();
    const t = window.setInterval(read, every);
    return () => { live = false; window.clearInterval(t); };
  }, [every, n]);
  return { est, keep, files, refresh: () => again(x => x + 1) };
}

const secs = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);
const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;

/** The download's feedback line and its buttons. */
export function DownloadProgress({ s, onRetry }: { s: DownloadState; onRetry(): void }) {
  const pct = s.total ? Math.min(100, (s.got / s.total) * 100) : 0;
  if (s.phase === 'idle' || s.phase === 'cancelled') return s.phase === 'cancelled' ? <p className="bk-dl-line" role="status">Cancelled: nothing was kept. Press "Download and verify" to start again.</p> : null;
  return (
    <div className="bk-dl" aria-live="polite">
      {(s.phase === 'downloading' || s.phase === 'paused') && (
        <>
          <div className="bk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Download progress">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className={`bk-dl-line ${s.phase === 'downloading' ? 'is-working' : ''}`}>
            {mb(s.got)} of {mb(s.total)}
            {s.phase === 'downloading' && s.rate ? ` · ${(s.rate / 1e6).toFixed(1)} MB/s` : ''}
            {s.phase === 'downloading' && s.eta !== null ? ` · ${secs(s.eta)} left` : ''}
            {s.phase === 'paused' ? ' · paused (kept in this tab\'s memory only; resumes where it stopped)' : ''}
          </p>
          <div className="bk-row">
            {s.phase === 'downloading'
              ? <button type="button" className="bk-btn" onClick={pauseDownload}>Pause</button>
              : <button type="button" className="bk-btn is-primary" onClick={onRetry}>Resume</button>}
            <button type="button" className="bk-btn is-danger" onClick={cancelDownload}>Cancel</button>
          </div>
        </>
      )}
      {s.phase === 'saving' && <p className="bk-dl-line is-working">keeping the model in this browser…</p>}
      {s.phase === 'verifying' && <p className="bk-dl-line is-working">checking sha256… bankML checks the model against its pin before it answers</p>}
      {s.phase === 'verified' && s.verified && (
        <p className="bk-dl-line is-ok">verified ✓ — {s.verified.model} · sha256 {s.verified.sha256.slice(0, 16)}… · bankML {s.verified.version} · {s.verified.threads} thread{s.verified.threads === 1 ? '' : 's'}</p>
      )}
      {s.phase === 'failed' && (
        <>
          <p className="bk-dl-line is-bad" role="alert">Failed: {s.error}{s.resumable ? ` — the ${mb(s.got)} that arrived are kept in this tab's memory: Retry asks for the rest` : ' — Retry starts again'}</p>
          <div className="bk-row">
            <button type="button" className="bk-btn is-primary" onClick={onRetry}>{s.resumable ? `Retry from ${mb(s.got)}` : 'Retry'}</button>
            {s.resumable && <button type="button" className="bk-btn is-danger" onClick={cancelDownload}>Cancel</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** The consent card: shown when browseML is chosen and not loaded. Nothing is downloaded until the button. */
export function BrowseConsent({ onVerified, onUseSpace, pendingQuestion }: { onVerified(): void; onUseSpace?: () => void; pendingQuestion?: string | null }) {
  const caps = useMemo(() => readCaps(), []);
  const s = useDownload();
  const st = useStorage(4000);
  const settings = useBrowseSettings();
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => { void keptFiles().then(f => setKept(f.some(x => x.where === 'Cache Storage'))); }, [s.phase]);
  const available = st.est ? Math.max(0, st.est.quota - st.est.usage) : null;
  const verdicts = browseVerdicts(caps, { phone: isPhone(), available: kept ? null : available, ctx: settings.ctx });
  const blocked = verdicts.some(v => v.level === 'bad');
  const go = async () => {
    // ask the browser to keep the model under storage pressure (it may say no; the download goes ahead either way)
    void askPersist();
    const v = await download();
    if (v) onVerified();
  };
  const running = s.phase === 'downloading' || s.phase === 'saving' || s.phase === 'verifying';
  return (
    <section className="bk-card bk-consent" aria-label="browseML: download and verify">
      <h3>browseML — bankML in this browser</h3>
      {pendingQuestion && <p className="bk-fine">Your question waits: <q>{pendingQuestion.slice(0, 120)}</q> — it is asked as soon as the model is verified.</p>}
      <ul className="bk-what">
        {kept
          ? <li>The model is already kept in this browser: bankML only checks it (no download).</li>
          : <li><b>{mb(MODEL_BYTES)}</b> from <b>huggingface.co</b> (prism-ml/Bonsai-1.7B-gguf, a pinned revision), once.</li>}
        <li>bankML checks it against its <b>sha256</b> pin before it answers; every answer carries a receipt, checked here.</li>
        <li>Kept in this browser (Cache Storage) for your next visit — unless you choose otherwise below. Nothing you type leaves this device.</li>
        <li>Needs about <b>{mb(ramEstimate(settings.ctx))}</b> of memory with a {settings.ctx}-token context (an estimate).</li>
      </ul>
      <ul className="bk-verdicts">
        {verdicts.map((v, i) => <li key={i} className={`is-${v.level}`}>{v.text}</li>)}
        {st.est && <li className="is-ok">this site uses {mb(st.est.usage)} of the {mb(st.est.quota)} this browser allows it</li>}
      </ul>
      {s.phase !== 'verified' && !running && s.phase !== 'paused' && s.phase !== 'failed' && (
        <div className="bk-row">
          <button type="button" className="bk-btn is-primary is-big" onClick={go} disabled={blocked}>{kept ? 'Verify and start' : 'Download and verify'}</button>
          {onUseSpace && <button type="button" className="bk-btn" onClick={onUseSpace}>Use the free CPU tab instead</button>}
        </div>
      )}
      <DownloadProgress s={s} onRetry={go} />
      {!running && <p className="bk-fine">Pause (or a dropped connection) keeps what has arrived in this tab's memory only, and Resume or Retry continues where it stopped; Cancel stops and keeps nothing.</p>}
      <details className="bk-settings-details">
        <summary>CPU · memory · disk settings</summary>
        <BrowseControls />
      </details>
    </section>
  );
}

/** The browseML controls: CPU threads, context and answer length (with the memory each needs), disk and cache. */
export function BrowseControls() {
  const caps = useMemo(() => readCaps(), []);
  const settings = useBrowseSettings();
  const st = useStorage(5000);
  const [lim, setLim] = useState<{ max: number; cap: number; isolated: boolean } | null>(null);
  const [, tick] = useState(0);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  const [reloading, setReloading] = useState(false);
  useEffect(() => { void browseMaxThreads().then(setLim); }, []);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 2000); return () => window.clearInterval(t); }, []);
  const loaded = browseState();
  const d = browseDiag();
  const max = lim?.max ?? 1;
  const threads = Math.min(max, settings.threads ?? max);
  const stale = !!loaded && (loaded.threads !== threads || (loaded.ctx ?? 4096) !== settings.ctx);
  const cacheBytes = st.files.filter(f => f.where === 'Cache Storage').reduce((n, f) => n + f.bytes, 0);
  const cap = ctxCapFor(caps.memoryGB);
  const reload = async () => {
    setReloading(true);
    try { await unloadBrowse(); await loadBrowse(); setSaid('reloaded with the new settings'); }
    catch (e) { setSaid('could not reload: ' + String((e as Error).message || e)); }
    setReloading(false);
  };
  return (
    <div className="bk-controls">
      <fieldset>
        <legend>CPU</legend>
        <label className="bk-ctl">
          <span>threads <b>{threads}</b></span>
          <input type="range" min={1} max={max} step={1} value={threads} disabled={max <= 1}
            onChange={e => setBrowseSettings({ threads: Number(e.target.value) })} aria-label="Threads for bankML in this browser" />
        </label>
        <p className="bk-fine">
          {lim?.isolated
            ? `1 to ${max} of ${caps.cores ?? '?'} cores${(caps.cores ?? 0) > (lim?.cap ?? 8) ? ` (browseML takes at most ${lim?.cap})` : ''}: more answers faster, fewer leave the computer free. Applied on the next load.`
            : 'One thread: this page is not cross-origin isolated (no SharedArrayBuffer), so the engine cannot start threads here.'}
        </p>
      </fieldset>
      <fieldset>
        <legend>Memory</legend>
        <label className="bk-ctl">
          <span>context</span>
          <select value={settings.ctx} onChange={e => setBrowseSettings({ ctx: Number(e.target.value) })} aria-label="Context size in tokens">
            {CTX_CHOICES.map(c => <option key={c} value={c}>{c} tokens — about {mb(ramEstimate(c))}</option>)}
          </select>
        </label>
        <p className="bk-fine">Estimate: model {mb(MODEL_BYTES)} + keys and values {mb(settings.ctx * KV_BYTES_PER_TOKEN)} + scratch ~{mb(ENGINE_OVERHEAD)}. Applied on the next load.</p>
        <label className="bk-ctl">
          <span>answer length</span>
          <select value={settings.maxTokens} onChange={e => setBrowseSettings({ maxTokens: Number(e.target.value) })} aria-label="Longest answer in tokens">
            {MAXTOK_CHOICES.map(c => <option key={c} value={c}>{c} tokens at most</option>)}
          </select>
        </label>
        <p className="bk-fine">Applied to the next question (it must fit in the context with the prompt).</p>
        <p className="bk-fine">WebAssembly memory in use: <b>{d.memoryBytes ? mb(d.memoryBytes) : 'none (not loaded)'}</b>{caps.memoryGB ? ` · this device reports ${caps.memoryGB >= 8 ? '≥ 8' : caps.memoryGB} GB` : ''}</p>
        {/* the consent card's rule (caps.ctxCapFor): warned only while the chosen context is above it */}
        {cap !== null && settings.ctx > cap && <p className="bk-warn">This device reports {caps.memoryGB} GB: keep the context at {cap} or less (now {settings.ctx}), or the browser may close the tab.</p>}
      </fieldset>
      {stale && (
        <div className="bk-row">
          <p className="bk-warn">The engine runs {loaded!.threads} thread{loaded!.threads === 1 ? '' : 's'} and context {loaded!.ctx ?? 4096}: reload it to apply.</p>
          <button type="button" className="bk-btn" onClick={reload} disabled={reloading}>{reloading ? 'reloading…' : 'Reload the engine now'}</button>
        </div>
      )}
      <fieldset>
        <legend>Disk and cache</legend>
        {st.files.length
          ? <ul className="bk-files">{st.files.map(f => <li key={f.where + f.name}><code>{f.name}</code> {mb(f.bytes)} <i>({f.where}{f.where === 'HTTP cache' ? ', managed by the browser' : ''})</i></li>)}</ul>
          : <p className="bk-fine">Nothing of browseML is kept in this browser.</p>}
        <p className="bk-fine">
          Persistent storage: {st.keep === undefined ? '…' : st.keep === null ? 'not offered by this browser' : st.keep ? 'yes — the browser keeps it under storage pressure' : 'no — the browser may evict it when space is short'}
          {st.keep === false && <> <button type="button" className="bk-btn is-small" onClick={async () => { const r = await askPersist(); setSaid(r ? 'the browser will keep it' : 'the browser said no (it decides; Chrome grants it to sites you use often or have bookmarked)'); st.refresh(); }}>Keep it</button></>}
        </p>
        <label className="bk-check">
          <input type="checkbox" checked={settings.removeAfterSession} onChange={e => setBrowseSettings({ removeAfterSession: e.target.checked })} />
          remove the model after this session — it goes when this site next opens in a new tab or window (a reload or a link within this tab keeps it; a closing tab gives the browser no reliable time to delete it)
        </label>
        {confirm === null
          ? <button type="button" className="bk-btn is-danger" disabled={!cacheBytes} onClick={() => setConfirm(cacheBytes)}>Clear browseML's cache{cacheBytes ? ` (frees ${mb(cacheBytes)})` : ''}</button>
          : (
            <div className="bk-row bk-confirm" role="alertdialog" aria-label="Clear browseML's cache?">
              <span>Remove {mb(confirm)} from this browser? {loaded ? 'The engine keeps running until you leave; the next visit downloads again.' : 'The next use downloads again.'}</span>
              <button type="button" className="bk-btn is-danger" onClick={async () => { const n = await clearBrowseCache(); setConfirm(null); setSaid(`cleared: ${mb(n)} freed`); st.refresh(); }}>Clear</button>
              <button type="button" className="bk-btn" onClick={() => setConfirm(null)}>Keep</button>
            </div>
          )}
      </fieldset>
      {said && <p className="bk-fine" role="status">{said}</p>}
    </div>
  );
}
