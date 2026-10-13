// SPDX-License-Identifier: MIT
// CPU · RAM · GPU · CACHE: what browseML may take of this computer, as sliders that go to 100% when the visitor wants
// it, each with what is measured now beside it.
//   CPU   — threads, 1 to 8 (100%). Past the cores the browser reports is allowed: Brave reports fewer than there are.
//   RAM   — the context (1k to 8k tokens): the keys and values the engine may hold, against what the device reports.
//   GPU   — off · low power · high performance: the probe and EXACT (the forward pass runs on the CPU for now).
//   CACHE — the prompt cache in RAM (0 to 256 MiB), warming the prompt for the next visit, the kept slot and CLEAR.
// CPU, RAM and CACHE apply when the engine starts again: APPLY restarts it now (the model stays here).
import { useEffect, useState } from 'react';
import { Button, LEDFader, SegmentSwitch, ToggleSwitch } from 'dreamknob';
import {
  CACHE_CHOICES, CTX_CHOICES, browseDiag, browseMaxThreads, browseSettings, browseState, browseWarm, clearWarmSlot, loadBrowse,
  onBrowseSettings, onBrowseWarm, setBrowseSettings, unloadBrowse,
} from '../bankml/free';
import { mb, ramEstimate, readCaps } from '../bankml/caps';
import { summarize, type Usage } from '../bankml/usage';
import { getLimits, onLimits, setLimits } from './limits';

const GREEN = '#0ECB81', ORANGE = '#F7931A', RED = '#F6465D';
type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Sliders({ usage, say, gpu }: { usage: Usage; say: Say; gpu: string }) {
  const [, tick] = useState(0);
  const [cap, setCap] = useState(8);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void browseMaxThreads().then(l => setCap(l.isolated ? l.cap : 1));
    const a = onBrowseSettings(() => tick(n => n + 1)), b = onLimits(() => tick(n => n + 1)), c = onBrowseWarm(() => tick(n => n + 1));
    return () => { a(); b(); c(); };
  }, []);
  const s = browseSettings(), lim = getLimits(), caps = readCaps(), v = browseState(), d = browseDiag(), w = browseWarm();
  const sum = summarize(usage), last = sum.lastAnswer;
  const reported = Math.max(1, Math.min(cap, caps.cores ?? 1));
  const threads = Math.max(1, Math.min(cap, s.threads ?? reported));
  const ctxI = Math.max(0, CTX_CHOICES.indexOf(s.ctx as never));
  const cacheI = Math.max(0, CACHE_CHOICES.indexOf(s.cacheRam as never));
  const ram = ramEstimate(s.ctx, s.cacheRam), device = caps.memoryGB ? caps.memoryGB * 1e9 : null;
  const gpuI = !lim.gpuProbe ? 0 : lim.power === 'low-power' ? 1 : 2;
  const stale = !!v && (v.threads !== threads || (v.ctx ?? s.ctx) !== s.ctx || (v.cacheRam ?? 0) !== s.cacheRam);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      say(`restarting bankML: ${threads} thread${threads === 1 ? '' : 's'}, context ${s.ctx}, cache ${s.cacheRam} MiB…`, 'working');
      if (v) await unloadBrowse();
      const r = await loadBrowse(line => say(line, 'working'));
      say(`✓ ${r.model} · ${r.threads} thread${r.threads === 1 ? '' : 's'} · context ${r.ctx} · ${mb(browseDiag().memoryBytes)} held`, 'ok');
    } catch (e) { say(String((e as Error).message || e), 'bad'); }
    setBusy(false);
  };

  return (
    <div className="cp-sliders">
      <div className="cp-slider">
        <div className="cp-slider-head"><b>CPU</b><span>{threads} thread{threads === 1 ? '' : 's'} · {pct(threads / cap)}</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={cap} min={1} max={cap} step={1} value={threads} disabled={cap <= 1}
          zones={[{ upTo: reported / cap, color: GREEN }, { upTo: 1, color: ORANGE }]} aria-label="Threads for bankML"
          onChange={x => setBrowseSettings({ threads: Math.round(x) })} />
        <p className="cp-fine">{cap <= 1 ? 'one thread: this page is not cross-origin isolated' : `${caps.cores ?? '?'} cores reported${threads > reported ? ' — past them (orange): Brave reports fewer cores than a computer has; measure with the speed below' : ''}`}
          {' · '}{v ? `running ${v.threads}` : 'off'}{last ? ` · last answer: reading ${last.promptPerSec.toFixed(2)}, writing ${last.genPerSec.toFixed(2)} tok/s at ${last.threads}` : ''}</p>
      </div>

      <div className="cp-slider">
        <div className="cp-slider-head"><b>RAM</b><span>context {s.ctx} · up to {mb(ram)}{device ? ` · ${pct(ram / device)} of ${caps.memoryGB! >= 8 ? '≥ 8' : caps.memoryGB} GB` : ''}</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={CTX_CHOICES.length} min={0} max={CTX_CHOICES.length - 1} step={1} value={ctxI}
          zones={[{ upTo: 0.5, color: GREEN }, { upTo: 0.75, color: ORANGE }, { upTo: 1, color: RED }]} aria-label="Context, and the memory it may take"
          onChange={x => setBrowseSettings({ ctx: CTX_CHOICES[Math.round(x)] })} />
        <p className="cp-fine">held now {mb(d.memoryBytes)} · peak {mb(sum.peakMemory)}{sum.longest ? ` · the longest exchange used ${sum.longest.tokens} tokens` : ''} (an estimate until it runs: the engine's own number replaces it)</p>
      </div>

      <div className="cp-slider">
        <div className="cp-slider-head"><b>GPU</b><span>{['off', 'low power', 'high performance'][gpuI]}</span></div>
        <SegmentSwitch options={['OFF', 'LOW', 'HIGH']} value={gpuI} color={ORANGE} size={26}
          onChange={i => setLimits(i === 0 ? { gpuProbe: false } : { gpuProbe: true, power: i === 1 ? 'low-power' : 'high-performance' })} />
        <p className="cp-fine">{gpu || 'no GPU reported'} · the probe and EXACT use it; the answers are written on the CPU (the GPU joins the forward pass only bit-exact)</p>
      </div>

      <div className="cp-slider">
        <div className="cp-slider-head"><b>CACHE</b><span>{s.cacheRam} MiB in RAM · {w.phase === 'restored' || w.phase === 'warmed' ? `prompt ${w.tokens} tokens, ${mb(w.bytes ?? 0)} kept` : w.phase === 'warming' ? 'reading the prompt…' : 'prompt not kept yet'}</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={CACHE_CHOICES.length} min={0} max={CACHE_CHOICES.length - 1} step={1} value={cacheI}
          zones={[{ upTo: 0.5, color: GREEN }, { upTo: 1, color: ORANGE }]} aria-label="Prompt cache in RAM"
          onChange={x => setBrowseSettings({ cacheRam: CACHE_CHOICES[Math.round(x)] })} />
        <div className="cp-limits">
          <ToggleSwitch on={lim.warm} color={ORANGE} label="keep browseML's prompt for the next visit (warm)" onChange={on => setLimits({ warm: on })} />
        </div>
        <p className="cp-fine">{w.phase === 'restored' ? `restored in ${((w.ms ?? 0) / 1000).toFixed(1)} s instead of reading it again` : w.phase === 'warmed' ? `read once in ${((w.ms ?? 0) / 1000).toFixed(0)} s; the next visit restores it in a moment` : 'the prompt is read once after browseML starts, then kept in this browser'}
          {' · '}the RAM cache reuses what earlier answers read (0: none)</p>
        <div className="cp-buttons">
          <Button onClick={() => void clearWarmSlot().then(n => say(`the kept prompt removed${n ? ` (${mb(n)})` : ''}: the next start reads it again`, 'ok'))}>CLEAR CACHE</Button>
        </div>
      </div>

      {(stale || !v) && (
        <div className="cp-buttons">
          <Button color={stale ? RED : GREEN} onClick={() => void apply()} disabled={busy}>{busy ? 'STARTING…' : stale ? 'APPLY (restart bankML)' : 'START WITH THESE'}</Button>
        </div>
      )}
    </div>
  );
}
