// SPDX-License-Identifier: MIT
// CPU · RAM · GPU · CACHE: what browseML may take of this computer, as sliders that go to 100% when the visitor wants
// it, each with what is measured now beside it.
//   CPU   — threads, 1 to 8 (100%). Past the cores the browser reports is allowed: Brave reports fewer than there are.
//   RAM   — the context (1k to 8k tokens): the keys and values the engine may hold, against what the device reports.
//   GPU   — off · low power · high performance: the probe, EXACT, and bankML's forward pass (rows the card computes
//           bit-exact and faster; it needs threads); and its time, 25% to 100% (bankML's limiter: the card rests
//           between dispatches for the rest; 80% leaves room for the visitor's own use). APPLY restarts the engine.
//   CACHE — the prompt cache in RAM (0 to 256 MiB), warming the prompt for the next visit, the kept slot and CLEAR.
// CPU, RAM, GPU and CACHE apply when the engine starts again: APPLY restarts it now (the model stays here).
import { useEffect, useState } from 'react';
import { Button, LEDFader, SegmentSwitch, ToggleSwitch } from 'dreamknob';
import {
  CACHE_CHOICES, CTX_CHOICES, GPU_TIME_CHOICES, browseDiag, browseMaxThreads, browseSettings, browseState, browseWarm, clearWarmSlot, loadBrowse,
  forgetPrompt, keptPrompts, measuredThreads, onBrowseSettings, onBrowseWarm, setBrowseSettings, unloadBrowse, warmBrowse, type KeptPrompt,
} from '../bankml/free';
import type { MutableRefObject } from 'react';
import type { UIFContextValue } from '../components/UIFContext';
import { personaName } from '../core/context';
import { lastMeasure, measureCores, onMeasure } from './cores';
import { mb, ramEstimate, readCaps } from '../bankml/caps';
import { summarize, type Usage } from '../bankml/usage';
import { getLimits, onLimits, setLimits } from './limits';

const GREEN = '#0ECB81', ORANGE = '#F7931A', RED = '#F6465D';
type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

export function Sliders({ usage, say, gpu, uif }: { usage: Usage; say: Say; gpu: string; uif: MutableRefObject<UIFContextValue | null> }) {
  const [kept, setKept] = useState<KeptPrompt[]>([]);
  const refreshKept = () => keptPrompts().then(setKept);
  const [, tick] = useState(0);
  const [cap, setCap] = useState(8);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void browseMaxThreads().then(l => setCap(l.isolated ? l.cap : 1));
    void refreshKept();
    const a = onBrowseSettings(() => tick(n => n + 1)), b = onLimits(() => tick(n => n + 1)), c = onBrowseWarm(() => { tick(n => n + 1); void refreshKept(); }), m = onMeasure(() => tick(n => n + 1));
    return () => { a(); b(); c(); m(); };
  }, []);
  const s = browseSettings(), lim = getLimits(), caps = readCaps(), v = browseState(), d = browseDiag(), w = browseWarm();
  const sum = summarize(usage), last = sum.lastAnswer;
  const reported = Math.max(1, Math.min(cap, caps.cores ?? 1));
  const meas = lastMeasure(), free = meas?.available ?? reported;
  const threads = Math.max(1, Math.min(cap, s.threads ?? measuredThreads() ?? reported));
  const [measuring, setMeasuring] = useState(false);
  const remeasure = async () => {
    setMeasuring(true);
    const r = await measureCores(true);
    setMeasuring(false);
    if (r) say(`${r.available} thread${r.available === 1 ? '' : 's'} free now (${r.reported ?? '?'} reported): auto claims ${r.claim}${v && s.threads === null && v.threads !== r.claim ? ' — APPLY restarts with it' : ''}`, 'ok');
  };
  const ctxI = Math.max(0, CTX_CHOICES.indexOf(s.ctx as never));
  const cacheI = Math.max(0, CACHE_CHOICES.indexOf(s.cacheRam as never));
  const ram = ramEstimate(s.ctx, s.cacheRam), device = caps.memoryGB ? caps.memoryGB * 1e9 : null;
  const gpuI = !lim.gpuProbe ? 0 : lim.power === 'low-power' ? 1 : 2;
  const gpuWant = (['off', 'low-power', 'high-performance'] as const)[gpuI];
  const timeI = Math.max(0, GPU_TIME_CHOICES.indexOf(s.gpuTime as never));
  const stale = !!v && (v.threads !== threads || (v.ctx ?? s.ctx) !== s.ctx || (v.cacheRam ?? 0) !== s.cacheRam || (v.gpu ?? 'off') !== gpuWant
    || (gpuWant !== 'off' && (v.gpuTime ?? 80) !== s.gpuTime));

  /** READ NOW: the prompt questions are asked with now, read once and kept (or restored, if it is kept). */
  const readNow = async () => {
    const f = uif.current;
    if (!f || !v) return;
    const r = await warmBrowse(f.context.forSend('', '').system, f.context.promptSource === 'prompt' ? '.prompt' : (personaName(f.context.persona) ?? 'browseML'));
    say(r.phase === 'restored' ? `restored ${r.tokens} tokens in ${(r.ms / 1000).toFixed(1)} s` : r.phase === 'warmed' ? `read ${r.tokens} tokens in ${(r.ms / 1000).toFixed(0)} s and kept` : r.phase === 'failed' ? `not kept: ${r.error}` : 'already kept', r.phase === 'failed' ? 'bad' : 'ok');
    void refreshKept();
  };
  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      say(`restarting bankML: ${threads} thread${threads === 1 ? '' : 's'}, context ${s.ctx}, cache ${s.cacheRam} MiB, GPU ${['off', 'low', 'high'][gpuI]}${gpuI ? ` at ${s.gpuTime}% of its time` : ''}…`, 'working');
      if (v) await unloadBrowse();
      const r = await loadBrowse(line => say(line, 'working'));
      say(`✓ ${r.model} · ${r.threads} thread${r.threads === 1 ? '' : 's'} · context ${r.ctx} · ${mb(browseDiag().memoryBytes)} held`, 'ok');
    } catch (e) { say(String((e as Error).message || e), 'bad'); }
    setBusy(false);
  };

  return (
    <div className="cp-sliders">
      <div className="cp-slider">
        <div className="cp-slider-head"><b>CPU</b><span>{threads} thread{threads === 1 ? '' : 's'} · {pct(threads / cap)} · {s.threads === null ? 'auto' : 'chosen'}</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={cap} min={1} max={cap} step={1} value={threads} disabled={cap <= 1}
          zones={[{ upTo: Math.min(1, free / cap), color: GREEN }, { upTo: 1, color: ORANGE }]} aria-label="Threads for bankML"
          onChange={x => setBrowseSettings({ threads: Math.round(x) })} />
        <p className="cp-fine">{cap <= 1 ? 'one thread: this page is not cross-origin isolated'
          : meas ? `${meas.available} free, measured (${meas.reported ?? '?'} reported) · auto claims ${meas.claim}${meas.claim < meas.available ? ', one left for the unexpected' : ''}${threads > meas.available ? ' · past what is free (orange): slower, not faster' : ''}`
          : `${caps.cores ?? '?'} cores reported · measured at the first interaction`}
          {' · '}{v ? `running ${v.threads}` : 'off'}{last ? ` · last answer: reading ${last.promptPerSec.toFixed(2)}, writing ${last.genPerSec.toFixed(2)} tok/s at ${last.threads}` : ''}</p>
        {cap > 1 && (
          <div className="cp-presets">
            <button type="button" className={s.threads === null ? 'is-on' : ''} onClick={() => setBrowseSettings({ threads: null })}>AUTO</button>
            <button type="button" onClick={() => void remeasure()} disabled={measuring}>{measuring ? 'MEASURING…' : 'RE-MEASURE'}</button>
          </div>
        )}
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
        <p className="cp-fine">{gpu || 'no GPU reported'} · {v ? (v.gpuNote || 'the CPU computes everything') : 'bankML checks the card\'s bits before it computes anything, and gives it only the rows it does faster'}{v && (v.gpu ?? 'off') !== gpuWant ? ' · APPLY restarts with it' : ''}</p>
        {gpuI > 0 && (<>
          <div className="cp-slider-head"><span>its time</span><span>{s.gpuTime}%{s.gpuTime === 100 ? ' · no rest' : s.gpuTime === 80 ? ' · the default' : ''}</span></div>
          <LEDFader orientation="horizontal" length={220} breadth={14} segments={GPU_TIME_CHOICES.length} min={0} max={GPU_TIME_CHOICES.length - 1} step={1} value={timeI}
            zones={[{ upTo: 0.67, color: GREEN }, { upTo: 1, color: ORANGE }]} aria-label="The share of the GPU's time bankML may take"
            onChange={x => setBrowseSettings({ gpuTime: GPU_TIME_CHOICES[Math.round(x)] })} />
          <p className="cp-fine">the card rests between dispatches for the rest of its time, leaving it to the screen and other tabs; at 100% it never rests. Answers are the same at any setting; on an integrated Radeon the speed was the same within the noise{v && v.gpu !== 'off' && (v.gpuTime ?? 80) !== s.gpuTime ? ' · APPLY restarts with it' : ''}</p>
        </>)}
      </div>

      <div className="cp-slider">
        <div className="cp-slider-head"><b>CACHE</b><span>{kept.length} prompt{kept.length === 1 ? '' : 's'} kept · {mb(kept.reduce((n, k) => n + k.bytes, 0))} · {s.cacheRam} MiB RAM</span></div>
        <p className="cp-fine">{w.phase === 'restored' ? `this prompt restored in ${(w.ms / 1000).toFixed(1)} s instead of read again` : w.phase === 'warmed' ? `this prompt read once in ${(w.ms / 1000).toFixed(0)} s; restored in a moment from now on` : w.phase === 'warming' ? 'reading this prompt once…' : 'each prompt (persona, .prompt, context) is read once, then kept here'}</p>
        {kept.length > 0 && (
          <ul className="cp-kept">
            {kept.map(k => (
              <li key={k.key} className={'key' in w && w.key === k.key ? 'is-on' : ''}>
                <b title={k.label || 'a prompt'}>{k.label || 'a prompt'}</b>
                <span>{k.tokens} tok · {mb(k.bytes)} · ctx {k.ctx} · {ago(k.used)}</span>
                <button type="button" aria-label={`forget ${k.label || 'this prompt'}`} title="forget: read again when next used" onClick={() => void forgetPrompt(k.key).then(refreshKept)}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="cp-slider-head"><span>keep up to</span><span>{s.keptPrompts} prompt{s.keptPrompts === 1 ? '' : 's'} (≈ {mb(s.keptPrompts * (kept[0]?.bytes ?? 45e6))})</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={8} min={1} max={8} step={1} value={s.keptPrompts}
          zones={[{ upTo: 0.5, color: GREEN }, { upTo: 1, color: ORANGE }]} aria-label="Prompts kept read"
          onChange={x => setBrowseSettings({ keptPrompts: Math.round(x) })} />
        <div className="cp-slider-head"><span>RAM cache</span><span>{s.cacheRam} MiB</span></div>
        <LEDFader orientation="horizontal" length={220} breadth={14} segments={CACHE_CHOICES.length} min={0} max={CACHE_CHOICES.length - 1} step={1} value={cacheI}
          zones={[{ upTo: 0.5, color: GREEN }, { upTo: 1, color: ORANGE }]} aria-label="Prompt cache in RAM"
          onChange={x => setBrowseSettings({ cacheRam: CACHE_CHOICES[Math.round(x)] })} />
        <p className="cp-fine">The RAM cache keeps other windows' conversations read, so going back to one does not read it again (0: off; applies on restart){last?.cached ? ` · the last answer reused ${last.cached} of ${last.prompt} prompt tokens` : ''}.</p>
        <div className="cp-limits">
          <ToggleSwitch on={lim.warm} color={ORANGE} label="read and keep the prompt as soon as browseML starts" onChange={on => setLimits({ warm: on })} />
        </div>
        <div className="cp-buttons">
          <Button onClick={() => void readNow()} disabled={!v || w.phase === 'warming'}>{w.phase === 'warming' ? 'READING…' : 'READ NOW'}</Button>
          <Button onClick={() => void clearWarmSlot().then(n => { void refreshKept(); say(`the kept prompts removed${n ? ` (${mb(n)})` : ''}: each is read again when next used`, 'ok'); })} disabled={!kept.length}>CLEAR CACHE</Button>
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
