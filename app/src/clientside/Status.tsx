// SPDX-License-Identifier: MIT
// The load, said as it happens — after PYTHAI/browseML's Space (its status line, bar and environment line), with more:
//   downloading — the bar, MB of MB, the speed (b/s … Tb/s), time left, elapsed, the source it comes from, pieces asked for again
//   in this browser — no download
//   verifying   — bankML's guard and the sha256 of the whole model against its pin, with a clock
//   ready       — what bankML verified, its threads and build, and how long the start took (from the usage records)
//   failed      — the error, and what to do about it
// and the environment line: what this device offers, read here and never sent.
import { useEffect, useRef, useState } from 'react';
import { browseDiag, browseState, cancelDownload, download, pauseDownload } from '../bankml/free';
import { useDownload } from '../bankml/ui/browse';
import { mb, readCaps } from '../bankml/caps';
import { fmtRate } from '../bankml/netrate';
import { summarize, type Usage } from '../bankml/usage';

const secs = (s: number | null | undefined) => (s === null || s === undefined || !isFinite(s) ? '?' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

/** An error, with what to do about it (the Space's hints, for this page). */
export function hint(m: string): string {
  if (/not enough room/i.test(m)) return '';
  if (/download|HTTP \d|stopped at|failed to fetch|network ?error|load failed|piece/i.test(m)) return ' — the connection: Retry asks for the rest from where it stopped.';
  if (/FORK\.json/.test(m)) return " — the model's pin did not load with the page: reload the page.";
  if (/sha256|guard|pin/i.test(m)) return ' — the model failed bankML\'s check, so it will not answer from it: Overwrite (HARD DRIVE → CLEAR, then ON) fetches a fresh copy.';
  if (/memory|unreachable|RuntimeError|trap|-99/i.test(m)) return ' — the engine stopped (most often out of memory): lower RAM below, close other tabs, then ON.';
  if (/compile|WebAssembly|\.wasm/i.test(m)) return " — this browser could not start the engine's WebAssembly: a current Chrome, Edge, Brave or Firefox runs it.";
  return '';
}

/** A clock that runs while `on`, from when it turned on. */
function useClock(on: boolean) {
  const t0 = useRef<number | null>(null);
  const [, tick] = useState(0);
  if (on && t0.current === null) t0.current = performance.now();
  if (!on) t0.current = null;
  useEffect(() => { if (!on) return; const t = window.setInterval(() => tick(n => n + 1), 500); return () => window.clearInterval(t); }, [on]);
  return t0.current === null ? 0 : (performance.now() - t0.current) / 1000;
}

export function Status({ usage, gpu }: { usage: Usage; gpu: string }) {
  const s = useDownload();
  const d = browseDiag(), v = browseState(), caps = readCaps();
  const starting = d.loading && s.phase !== 'downloading';
  const clock = useClock(s.phase === 'verifying' || starting);
  const last = summarize(usage).lastLoad;
  const pct = s.total ? Math.min(100, (s.got / s.total) * 100) : 0;

  let line: string, tone: 'working' | 'ok' | 'bad' | '' = '';
  let bar: number | null = null;
  if (s.phase === 'downloading' || s.phase === 'paused') {
    bar = pct; tone = 'working';
    const elapsed = s.started ? (performance.now() - s.started) / 1000 : null;
    line = `downloading the model: ${mb(s.got)} of ${mb(s.total)} (${pct.toFixed(0)}%)`
      + (s.rate ? ` · ${fmtRate(s.rate)}` : '') + (s.eta !== null ? ` · about ${secs(s.eta)} left` : '')
      + (elapsed !== null ? ` · ${secs(elapsed)} so far` : '') + (s.source ? ` · from ${s.source}` : '')
      + (s.retries ? ` · ${s.retries} piece${s.retries === 1 ? '' : 's'} asked for again` : '')
      + (s.phase === 'paused' ? ' · paused: resumes from the exact byte' : ' · once; it stays in this browser');
  } else if (s.phase === 'saving') { bar = 100; tone = 'working'; line = `keeping the model in this browser (${mb(s.total)})…`; }
  else if (s.phase === 'verifying' || starting) {
    tone = 'working';
    line = d.progress?.phase === 'cache' || d.progress?.phase === 'folder' || s.phase === 'verifying'
      ? `bankML is verifying the model in this browser: the guard, then the sha256 of all ${mb(d.model?.bytes ?? s.total)} against its pin · ${secs(clock)}`
      : `starting bankML · ${secs(clock)}`;
  } else if (s.phase === 'failed') { tone = 'bad'; line = `bankML could not load: ${s.error ?? 'unknown'}${hint(s.error ?? '')}`; }
  else if (v) {
    tone = 'ok';
    line = `✓ ${v.model} verified by bankML ${v.version} · sha256 ${v.sha256.slice(0, 12)}… · ${v.threads} thread${v.threads === 1 ? '' : 's'} · ${v.build ?? 'browseml.wasm'}`
      + (last ? ` · ready in ${secs(last.totalMs / 1000)} (${last.source === 'download' ? `download ${secs(last.modelMs / 1000)}, ` : last.source === 'folder' ? 'from a folder, ' : 'no download, '}open ${secs(last.openMs / 1000)})` : '');
  } else line = 'off: ON (or a question) starts browseML — from this browser or a folder if the model is here, else pulled once and checked';

  const env = [
    `${caps.cores ?? '?'} CPU threads reported`,
    caps.memoryGB ? `${caps.memoryGB >= 8 ? '≥ 8' : caps.memoryGB} GB RAM reported` : 'RAM not reported',
    gpu ? `GPU ${gpu} (bankML gives it the rows it checked and measured faster)` : 'GPU not reported',
    caps.isolated ? `cross-origin isolated: bankML may take up to 8 threads` : 'not cross-origin isolated: one thread',
  ].join(' · ');

  return (
    <div className="cp-status" aria-live="polite">
      {bar !== null && (
        <div className={`bk-bar ${bar >= 100 || s.phase === 'verified' ? 'is-done' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar)} aria-label="Download progress"><span style={{ width: `${bar}%` }} /></div>
      )}
      <p className={`cp-status-line ${tone ? `is-${tone}` : ''}`}>{line}</p>
      {(s.phase === 'downloading' || s.phase === 'paused' || s.phase === 'failed') && (
        <div className="cp-buttons">
          {s.phase === 'downloading' && <button type="button" className="bk-btn" onClick={pauseDownload}>PAUSE</button>}
          {(s.phase === 'paused' || s.phase === 'failed') && <button type="button" className="bk-btn is-primary" onClick={() => void download()}>{s.resumable ? `RETRY FROM ${mb(s.got)}` : s.phase === 'paused' ? 'RESUME' : 'RETRY'}</button>}
          {s.phase !== 'failed' && <button type="button" className="bk-btn is-danger" onClick={cancelDownload}>CANCEL</button>}
        </div>
      )}
      <p className="cp-fine cp-env">{env}</p>
    </div>
  );
}
