// SPDX-License-Identifier: MIT
// browseML's state, in the response window (the 'browseml' widget): not here yet → "Import browseML" (the model is
// pulled in the background from its pinned source, checked against its sha256 pin, kept in this browser); on its
// way → the download's progress, pause and cancel, then the verification; ready → one diagnostic line (what was
// verified, threads, context, the memory the engine holds, the last answer's speed). When it becomes ready, the
// question waiting in the window is asked.
import { useEffect, useMemo, useRef, useState } from 'react';
import { askPersist, browseCached, browseDiag, browseState, browseWarm, download, onBrowseWarm, overwriteModel, useLocalModel } from '../bankml/free';
import { DownloadProgress, useBrowseSettings, useDownload } from '../bankml/ui/browse';
import { browseVerdicts, mb, readCaps } from '../bankml/caps';
import { summarize } from '../bankml/usage';
import { useTick, useUsage } from './ClientRack';
import { canPickFolders, classify, pickFolder, scan } from '../bankml/folders';
import { getLimits } from './limits';

export function BrowseCard({ onReady }: { onReady(): void }) {
  const s = useDownload();
  const settings = useBrowseSettings();
  const usage = useUsage();
  const caps = useMemo(() => readCaps(), []);
  const [kept, setKept] = useState<boolean | null>(null);
  useTick(1000);
  useEffect(() => { void browseCached().then(setKept); }, [s.phase]);
  const [, rewarm] = useState(0);
  useEffect(() => onBrowseWarm(() => rewarm(n => n + 1)), []);
  const w = browseWarm();

  const v = browseState();
  if (v) {
    const d = browseDiag(), a = summarize(usage).lastAnswer;
    return (
      <details className="cs-card is-ready" role="status">
        <summary><b>✓ browseML ready</b>{w.phase === 'warming' ? <span className="cs-card-warm is-working"> · reading its prompt once…</span> : ` · ${v.threads} thread${v.threads === 1 ? '' : 's'} · ${mb(d.memoryBytes)}`}</summary>
        <p>{v.model} verified (sha256 {v.sha256.slice(0, 12)}…) · bankML {v.version} · {v.threads} thread{v.threads === 1 ? '' : 's'} · context {v.ctx ?? settings.ctx} · holds {mb(d.memoryBytes)}
          {a ? ` · last answer ${a.genPerSec.toFixed(2)} tok/s` : ''}
          {w.phase === 'restored' && <span className="cs-card-warm"> · prompt ready: {w.tokens} tokens restored from this browser in {(w.ms / 1000).toFixed(1)} s</span>}
          {w.phase === 'warmed' && <span className="cs-card-warm"> · prompt read once ({w.tokens} tokens, {(w.ms / 1000).toFixed(0)} s) and kept for next time</span>}
        </p>
      </details>
    );
  }
  const go = async () => {
    void askPersist();
    if (await download()) onReady();
  };
  // a model file already on this computer: recognised by its sha256 against the pin, then used without a download
  const pick = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<{ text: string; tone?: 'ok' | 'bad' | 'working' } | null>(null);
  const useFile = async (f: File | undefined) => {
    if (!f) return;
    setLocal({ text: `checking ${f.name}…`, tone: 'working' });
    const r = await useLocalModel(f, line => setLocal({ text: line, tone: 'working' }));
    if (r.ok) { setLocal({ text: `✓ recognised: ${r.name} (sha256 ${r.sha256.slice(0, 12)}…), no download`, tone: 'ok' }); if (r.verified) onReady(); }
    else setLocal({ text: r.reason, tone: 'bad' });
  };
  // a folder on this computer: its models scanned, browseML's used if it is there (no download)
  const lookIn = async () => {
    try {
      const h = await pickFolder();
      setLocal({ text: `looking in ${h.name}…`, tone: 'working' });
      const found = await scan(h);
      const pin = { bytes: 248_302_272, sha256: '3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3' };
      const best = found.find(x => classify(x, pin) === 'named') ?? found.find(x => classify(x, pin) === 'size');
      if (!best) return setLocal({ text: `${h.name}: ${found.length} model file${found.length === 1 ? '' : 's'}, none of them browseML's (${mb(pin.bytes)})`, tone: 'bad' });
      const r = await useLocalModel(await best.handle!.getFile(), line => setLocal({ text: line, tone: 'working' }), { keep: getLimits().keepCopy, named: best.named });
      if (r.ok) { setLocal({ text: `✓ ${r.name} from ${h.name}/${best.path.join('/')}: no download`, tone: 'ok' }); if (r.verified) onReady(); }
      else setLocal({ text: r.reason, tone: 'bad' });
    } catch (e) { if ((e as Error).name !== 'AbortError') setLocal({ text: String((e as Error).message || e), tone: 'bad' }); }
  };
  const overwrite = async () => { setLocal(null); void askPersist(); if (await overwriteModel()) onReady(); };
  const extra = (
    <>
      <input ref={pick} type="file" accept=".gguf,application/octet-stream" hidden onChange={e => void useFile(e.target.files?.[0])} />
      <button type="button" className="cs-card-link" onClick={() => pick.current?.click()}>Use a model file you already have</button>
      {canPickFolders() && <button type="button" className="cs-card-link" onClick={() => void lookIn()}>Look in a folder</button>}
      {local && <span className={`cs-card-local ${local.tone ? `is-${local.tone}` : ''}`}>{local.text}</span>}
    </>
  );
  const busy = s.phase === 'downloading' || s.phase === 'paused' || s.phase === 'saving' || s.phase === 'verifying' || s.phase === 'failed';
  const blocked = browseVerdicts(caps, { ctx: settings.ctx }).filter(x => x.level === 'bad');
  return (
    <div className="cs-card">
      {busy ? (
        <>
          <span className="cs-card-what is-working">{s.phase === 'verifying' ? 'Checking the model against its sha256 pin…' : 'Loading the model in your browser…'}</span>
          <DownloadProgress s={s} onRetry={go} />
          {s.phase === 'failed' && (
            <>
              <button type="button" className="cs-import" onClick={() => void overwrite()}>Overwrite with a fresh copy</button>
              {extra}
            </>
          )}
        </>
      ) : (
        <>
          <button type="button" className="cs-import" onClick={go} disabled={blocked.length > 0}>
            {kept ? 'Start browseML' : 'Import browseML'}
          </button>
          <span className="cs-card-what">
            {kept
              ? 'The model is already in this browser: bankML checks it against its sha256 pin, then answers.'
              : `Bonsai-1.7B, ${mb(248_302_272)} once, pulled in the background from its pinned source, checked against its sha256 pin, kept in this browser.`}
          </span>
          {blocked.map((x, i) => <span key={i} className="cs-card-bad">{x.text}</span>)}
          {extra}
        </>
      )}
    </div>
  );
}
