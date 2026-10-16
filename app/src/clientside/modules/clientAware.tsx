// SPDX-License-Identifier: MIT
// The client-aware module: a question about this computer is answered from this computer. When a question names its
// CPU, memory, GPU, storage, battery, network, speed, engine or settings, the lines measured here go with it (THIS
// COMPUTER …), so the model answers from them, not from guesses; any other question goes as it is. And a change the
// visitor asks for ("use 4 threads", "longer answers", "save my battery") is shown under the answer as an exact
// proposal — "threads 2 → 4 · next load" — applied with one press, never without it.
import { useState } from 'react';
import type { ModuleInfo } from './index';
import { addAugmenter } from '../augment';
import { registerWidget, type ModuleWidgetProps } from '../widgets';
import { clientFacts, intent, proposals, withFacts, type Proposal, type Snapshot } from '../../bankml/clientdata';
import { readCaps } from '../../bankml/caps';
import { browseDiag, browseSettings, setBrowseSettings } from '../../bankml/free';
import { advise, usageLog } from '../../bankml/usage';
import { storageReport, reportLines } from '../../bankml/storage';
import { getLimits, setLimits } from '../limits';
import { monitor } from '../monitor';
import { lastMeasure } from '../cores';

let storageLines: string[] = [];
const refreshStorage = () => { void storageReport().then(r => { storageLines = reportLines(r, 'visual'); }).catch(() => {}); };

/** This computer now, from what browseML already measures. */
export function snapshot(): Snapshot {
  const c = readCaps(), d = browseDiag(), m = monitor(), s = browseSettings(), u = usageLog();
  const last = u.answers[u.answers.length - 1];
  return {
    cores: c.cores, memoryGB: c.memoryGB, threadsFree: lastMeasure()?.available ?? null, threadsUsed: d.verified?.threads ?? null,
    simd: c.simd, relaxedSimd: c.relaxedSimd, isolated: c.isolated,
    gpu: d.gpu ? `${d.gpu.card}${d.gpu.integrated ? ' (integrated)' : ''}` : null, gpuBusy: d.gpu?.busy ?? null,
    storage: storageLines, battery: m.battery ? { level: m.battery.level, charging: m.battery.charging } : null,
    network: m.network, lastAnswerTokPerSec: last?.genPerSec ?? null,
    model: d.verified?.model ?? null, engineVersion: d.verified?.version ?? null, engineMemoryMB: d.memoryBytes ? Math.round(d.memoryBytes / 1e6) : null,
    settings: s,
    advice: advise(u, { memoryGB: c.memoryGB, threads: d.verified?.threads ?? 1, ctx: s.ctx, cacheRam: s.cacheRam }).filter(v => v.level !== 'ok').map(v => v.text),
  };
}

function Chips({ data }: ModuleWidgetProps) {
  const items = (data.items ?? []) as Proposal[];
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <div className="ca-props" role="group" aria-label="proposed changes">
      {items.map(p => (
        <span key={p.id} className="ca-prop">
          <span>{p.label} · {p.when}</span>
          {done[p.id] ? <span className="ca-done">✓ applied{p.when === 'next load' ? ' — CLIENT → apply, or the next load' : ''}</span>
            : <button type="button" className="atl-act" onClick={() => {
                if (p.settings) setBrowseSettings(p.settings);
                if (p.limits) setLimits(p.limits);
                setDone(d => ({ ...d, [p.id]: true }));
              }}>apply</button>}
        </span>
      ))}
    </div>
  );
}

let wired = false;
export const clientAwareModule: ModuleInfo = {
  id: 'client-aware', label: 'client-aware',
  note: 'questions about this computer answered from what is measured here; changes you ask for proposed exactly, applied with one press',
  make() {
    if (!wired) {
      wired = true;
      refreshStorage();
      setInterval(refreshStorage, 30_000);
      addAugmenter(q => { const t = intent(q); return t.length ? withFacts('', clientFacts(snapshot(), t)).replace(/\n\nQuestion: $/, '') : ''; });
      registerWidget('proposals', Chips);
      addEventListener('browseml:asked', e => {
        const d = (e as CustomEvent<{ text: string; append(m: unknown): void }>).detail;
        const ps = proposals(d.text, browseSettings(), browseDiag().maxThreads || null, getLimits());
        if (ps.length) d.append({ role: 'system', text: ps.map(p => p.label).join(' · '), widget: 'module', data: { kind: 'proposals', items: ps } });
      });
    }
    return { id: 'client-aware', label: 'client-aware' };
  },
};
