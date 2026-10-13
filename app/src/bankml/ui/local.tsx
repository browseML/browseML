// SPDX-License-Identifier: MIT
// "Your own bankML" did not answer: one card with the ways forward instead of a bare error — use browseML now, install
// bankML on this machine (steps chosen from what this browser says about the device, read here and never sent; no IP
// address is read — a page cannot know it and does not need it), sign in to Hugging Face, or the free CPU tab now.
import { useEffect, useState } from 'react';
import { PLATFORM_NAME, installPlan, readHints, recognise, unreachableReasons, type Platform } from '../caps';

export interface NotFoundProps {
  endpoint: string;
  /** Why it did not answer, in the browser's words. */
  reason?: string;
  /** The question that failed, re-asked by the way chosen. */
  question?: string | null;
  useBrowse(): void;
  useSpace(): void;
  useHf(): void;
  retry(): void;
}

export function NotFoundCard({ endpoint, reason, question, useBrowse, useSpace, useHf, retry }: NotFoundProps) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { void readHints().then(h => setPlatform(recognise(h))).catch(() => setPlatform('unknown')); }, []);
  const plan = platform ? installPlan(platform, location.origin) : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(plan!.commands.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  return (
    <section className="bk-card bk-notfound" aria-label="Your own bankML did not answer" role="region">
      <h3>Your own bankML did not answer at {endpoint.replace(/^https?:\/\//, '')}</h3>
      {reason && <p className="bk-fine">{reason}</p>}
      {question && <p className="bk-fine">Your question waits: <q>{question.slice(0, 120)}</q> — the way you choose asks it again.</p>}
      <ol className="bk-ways">
        <li>
          <b>Use browseML now</b> — bankML in this browser: 248 MB once, sha256-verified, receipts checked; then your question is asked.
          <div className="bk-row"><button type="button" className="bk-btn is-primary" onClick={useBrowse}>Use browseML now</button></div>
        </li>
        <li>
          <b>Install bankML on this machine</b>{platform ? <> — this looks like <i>{PLATFORM_NAME[platform]}</i> (from what this browser reports; nothing was sent)</> : ''}.
          {plan && (
            <>
              <p>{plan.lede}</p>
              {plan.commands.length > 0 && (
                <>
                  <pre className="bk-cmd">{plan.commands.join('\n')}</pre>
                  <div className="bk-row"><button type="button" className="bk-btn is-small" onClick={copy}>{copied ? 'copied ✓' : 'Copy the commands'}</button>
                    <button type="button" className="bk-btn is-small" onClick={retry}>It is running: try again</button></div>
                </>
              )}
              {plan.notes.map((n, i) => <p key={i} className="bk-fine">{n}</p>)}
            </>
          )}
          <details>
            <summary>Installed, but this page cannot reach it?</summary>
            <ul>{unreachableReasons(location.origin, endpoint).map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        </li>
        <li>
          <b>Sign in to Hugging Face, or create an account</b> — a provider answers under your account: not bankML, no receipt, your quota.
          <div className="bk-row">
            <button type="button" className="bk-btn" onClick={useHf}>Hugging Face tab</button>
            <a className="bk-btn" href="https://huggingface.co/join" target="_blank" rel="noreferrer">Create an account ↗</a>
          </div>
        </li>
      </ol>
      <div className="bk-row">
        <button type="button" className="bk-btn" onClick={useSpace}>Use the free CPU tab now</button>
        <span className="bk-fine">Bonsai on Hugging Face's free CPU — llama.cpp, not bankML's engine, no receipt; answers at once.</span>
      </div>
    </section>
  );
}
