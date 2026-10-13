// SPDX-License-Identifier: MIT
// Diagnostics from actual usage: what to change (usage.ts advise, from the records only), the speed measured at each
// thread count, the last load (where the model came from, the download's speed and its retried pieces, bankML's
// verification, the memory the engine took) and the last answer as bankML timed it. The records can be saved as a
// JSON file (made here, from this browser's own records) or cleared. Written as React text, never markup.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { advise, clearUsage, summarize, type Usage } from '../bankml/usage';
import { useBrowseSettings } from '../bankml/ui/browse';
import { browseMaxThreads } from '../bankml/free';
import { mb, readCaps } from '../bankml/caps';

const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Row({ k, children, tone }: { k: string; children: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return <div className="cs-row"><dt>{k}</dt><dd className={tone ? `is-${tone}` : undefined}>{children}</dd></div>;
}

export function UsagePanel({ usage }: { usage: Usage }) {
  const caps = useMemo(() => readCaps(), []);
  const s = useBrowseSettings();
  const [max, setMax] = useState(1);
  useEffect(() => { void browseMaxThreads().then(l => setMax(l.max)); }, []);
  const sum = summarize(usage);
  const threads = Math.min(max, s.threads ?? max);
  const advice = advise(usage, { memoryGB: caps.memoryGB, threads, ctx: s.ctx, cacheRam: s.cacheRam });
  const l = sum.lastLoad, a = sum.lastAnswer;
  const save = () => {
    const blob = new Blob([JSON.stringify({ kind: 'browseml-usage', saved: new Date().toISOString(), device: { cores: caps.cores, memoryGB: caps.memoryGB, isolated: caps.isolated, relaxedSimd: caps.relaxedSimd }, ...usage }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `browseml-usage-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="cs-usage" aria-label="Diagnostics from actual usage">
      <h2>diagnostics <small>from what ran here</small></h2>
      <ul className="cs-advice">
        {advice.map((v, i) => <li key={i} className={`is-${v.level}`}>{v.text}</li>)}
      </ul>
      {sum.byThreads.length > 0 && (
        <table className="cs-table">
          <caption>speed by threads (medians, as bankML timed them)</caption>
          <thead><tr><th>threads</th><th>answers</th><th>reading</th><th>writing</th></tr></thead>
          <tbody>
            {sum.byThreads.map(r => (
              <tr key={r.threads}><td>{r.threads}</td><td>{r.answers}</td><td>{r.prompt.toFixed(2)} tok/s</td><td>{r.gen.toFixed(2)} tok/s</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <dl>
        {l && (
          <>
            <Row k="last load">{new Date(l.at).toLocaleString()} · {l.build || 'browseml.wasm'} · {l.threads} thread{l.threads === 1 ? '' : 's'} · context {l.ctx}{l.cacheRam ? ` · cache ${l.cacheRam} MiB` : ''}</Row>
            <Row k="the model">{l.source === 'cache'
              ? `from this browser's cache in ${s1(l.modelMs)}`
              : `downloaded ${mb(l.fetched)} in ${s1(l.modelMs)} (${(l.fetched / 1e6 / Math.max(0.001, l.modelMs / 1000)).toFixed(1)} MB/s)${l.retries ? ` · ${l.retries} piece${l.retries === 1 ? '' : 's'} retried` : ''}`}</Row>
            <Row k="verified">the guard, the sha256 pin and the weights in {s1(l.openMs)}</Row>
            <Row k="engine memory" tone={caps.memoryGB && l.memory > caps.memoryGB * 1e9 * 0.5 ? 'bad' : undefined}>{mb(l.memory)} once open</Row>
          </>
        )}
        {a && (
          <>
            <Row k="last answer">{a.prompt} prompt{a.cached ? ` (${a.cached} from the cache)` : ''} → {a.completion} tokens</Row>
            <Row k="reading">{a.promptPerSec ? `${a.promptPerSec.toFixed(2)} tok/s` : '—'} · {s1(a.promptMs)}</Row>
            <Row k="writing">{a.genPerSec ? `${a.genPerSec.toFixed(2)} tok/s` : '—'} · {s1(a.genMs)}</Row>
            <Row k="engine memory">{mb(a.memory)} after the answer · peak {mb(sum.peakMemory)}</Row>
          </>
        )}
        {!l && !a && <Row k="—">no load or answer recorded in this browser yet</Row>}
      </dl>
      <div className="cs-row-buttons">
        <button type="button" className="cs-btn" onClick={save} disabled={!usage.loads.length && !usage.answers.length}>save the records (JSON)</button>
        <button type="button" className="cs-btn is-danger" onClick={clearUsage} disabled={!usage.loads.length && !usage.answers.length}>clear the records</button>
      </div>
      <p className="cs-fine">{usage.loads.length} load{usage.loads.length === 1 ? '' : 's'} and {usage.answers.length} answer{usage.answers.length === 1 ? '' : 's'} recorded (the last 50 of each), kept in this browser only.</p>
    </section>
  );
}
