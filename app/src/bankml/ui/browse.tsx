// SPDX-License-Identifier: MIT
// browseML's download in the page: its state as a hook, the visitor's settings as a hook, and the download's feedback
// (MB done of total, MB/s, time left, "checking sha256…", "verified ✓" or the failure with a retry; pause and cancel).
import { useEffect, useState } from 'react';
import { browseSettings, cancelDownload, downloadState, onBrowseSettings, onDownload, pauseDownload, type DownloadState } from '../free';
import { mb } from '../caps';
import './browse.css';

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
const secs = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

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
