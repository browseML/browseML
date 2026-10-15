// SPDX-License-Identifier: MIT
// QUALITY: accuracy (answers whose receipt checked, of those delivered) and the clarity and genius of the answers that
// succeeded, by mindX editor.agent's formulas (bankml/quality.ts), read from this browser's .history.
import { useEffect, useState, type MutableRefObject } from 'react';
import type { UIFContextValue } from '../components/UIFContext';
import { CLARITY_BAR, GENIUS_BAR, measure, type Quality as Q } from '../bankml/quality';

const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
function Meter({ label, s, bar, n }: { label: string; s: Q['clarity']; bar: number; n: number }) {
  if (!s) return <div className="cp-row"><dt>{label}</dt><dd>nothing to score yet</dd></div>;
  return (
    <div className="qa-row">
      <div className="cp-row"><dt>{label}</dt><dd className={s.median >= bar ? 'is-ok' : undefined}>
        median {s.median.toFixed(3)} · mean {s.mean.toFixed(3)} · {s.pass}/{n} at or over {bar.toFixed(2)}</dd></div>
      <div className="qa-meter" role="img" aria-label={`${label} median ${s.median.toFixed(3)} against the bar ${bar}`}>
        <span className="qa-fill" style={{ width: `${100 * s.median}%` }} /><span className="qa-bar" style={{ left: `${100 * bar}%` }} />
      </div>
    </div>
  );
}

export function QualitySection({ uif }: { uif: MutableRefObject<UIFContextValue | null> }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 5000); return () => window.clearInterval(t); }, []);
  const q = measure((uif.current?.context.history ?? []) as unknown as Parameters<typeof measure>[0]);
  return (
    <div className="qa">
      <dl>
        <div className="cp-row"><dt>accuracy</dt><dd className={q.accuracy === 1 ? 'is-ok' : q.accuracy !== null && q.accuracy < 1 ? 'is-working' : undefined}>
          {q.accuracy === null ? 'no answer delivered yet' : `${q.verified} of ${q.delivered} answers verified by their receipt (${pct(q.accuracy)})`}</dd></div>
        <Meter label="clarity" s={q.clarity} bar={CLARITY_BAR} n={q.verified} />
        <Meter label="genius" s={q.genius} bar={GENIUS_BAR} n={q.scored} />
      </dl>
      {q.short > 0 && <p className="cp-fine">{q.short} verified answer{q.short === 1 ? '' : 's'} under 40 words: clarity only (genius reads 0 below 40 words).</p>}
      <p className="cp-fine">Measured from what succeeded: only answers whose receipt checked are scored. Clarity and genius are mindX editor.agent's
        formulas, to the letter (sentence length near 16 words; lexical diversity, insight markers, citations): transparent and crude on purpose — not taste.</p>
    </div>
  );
}
