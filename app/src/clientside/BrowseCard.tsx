// SPDX-License-Identifier: MIT
// browseML's state, in the response window (the 'browseml' widget): not here yet → "Import browseML" (the model is
// pulled in the background from its pinned source, checked against its sha256 pin, kept in this browser); on its
// way → the download's progress, pause and cancel, then the verification; ready → one diagnostic line (what was
// verified, threads, context, the memory the engine holds, the last answer's speed). When it becomes ready, the
// question waiting in the window is asked.
import { useEffect, useMemo, useState } from 'react';
import { askPersist, browseCached, browseDiag, browseState, browseWarm, download, onBrowseWarm } from '../bankml/free';
import { DownloadProgress, useBrowseSettings, useDownload } from '../bankml/ui/browse';
import { browseVerdicts, mb, readCaps } from '../bankml/caps';
import { summarize } from '../bankml/usage';
import { useTick, useUsage } from './ClientRack';

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
      <p className="cs-card is-ready" role="status">
        <b>✓ browseML ready</b> · {v.model} verified (sha256 {v.sha256.slice(0, 12)}…) · bankML {v.version} ·{' '}
        {v.threads} thread{v.threads === 1 ? '' : 's'} · context {v.ctx ?? settings.ctx} · holds {mb(d.memoryBytes)}
        {a ? ` · last answer ${a.genPerSec.toFixed(2)} tok/s` : ''}
        {w.phase === 'warming' && <span className="cs-card-warm is-working"> · reading its prompt once (kept for next time)…</span>}
        {w.phase === 'restored' && <span className="cs-card-warm"> · prompt ready: {w.tokens} tokens restored from this browser in {(w.ms / 1000).toFixed(1)} s</span>}
        {w.phase === 'warmed' && <span className="cs-card-warm"> · prompt read once ({w.tokens} tokens, {(w.ms / 1000).toFixed(0)} s) and kept for next time</span>}
      </p>
    );
  }
  const go = async () => {
    void askPersist();
    if (await download()) onReady();
  };
  const busy = s.phase === 'downloading' || s.phase === 'paused' || s.phase === 'saving' || s.phase === 'verifying' || s.phase === 'failed';
  const blocked = browseVerdicts(caps, { ctx: settings.ctx }).filter(x => x.level === 'bad');
  return (
    <div className="cs-card">
      {busy ? (
        <>
          <span className="cs-card-what is-working">{s.phase === 'verifying' ? 'Checking the model against its sha256 pin…' : 'Loading the model in your browser…'}</span>
          <DownloadProgress s={s} onRetry={go} />
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
        </>
      )}
    </div>
  );
}
