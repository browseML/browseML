// SPDX-License-Identifier: MIT
// The client rack: this computer's controls for browseML, on DreamKnob (MIT, vendor/dreamknob). Four knobs — CPU
// (threads), RAM (the context, read out as the most memory it can take), CACHE (the engine's prompt cache, MiB) and
// ANSWER (the longest answer) — a gauge of the memory the engine actually holds now against that ceiling, lamps for
// what this browser allows, and the buttons: APPLY (reload the engine with the knobs' settings), UNLOAD (end the
// engine: its memory goes back to the browser; the model stays kept), CLEAR (remove the kept model, confirmed), and
// MEASURE (the whole tab's memory, where the browser can measure it). Settings are browseML's own (free.ts), kept in
// this browser; threads, RAM and CACHE apply on the next load, ANSWER on the next question.
import { useEffect, useMemo, useState } from 'react';
import { Button, Gauge, IndicatorLamp, LEDKnob, SegmentDisplay, SteppedKnob } from 'dreamknob';
import {
  CACHE_CHOICES, CTX_CHOICES, MAXTOK_CHOICES, browseDiag, browseMaxThreads, browseState, clearBrowseCache, keptFiles,
  loadBrowse, setBrowseSettings, unloadBrowse,
} from '../bankml/free';
import { useBrowseSettings, useDownload } from '../bankml/ui/browse';
import { ctxCapFor, mb, ramEstimate, readCaps } from '../bankml/caps';
import { summarize, usageLog, onUsage } from '../bankml/usage';
import { measureTab, type TabMemory } from './memory';

const GREEN = '#0ECB81', ORANGE = '#F7931A', RED = '#F6465D';
const short = (n: number) => (n >= 1024 ? `${n / 1024}k` : String(n));

export function useTick(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), ms); return () => window.clearInterval(t); }, [ms]);
}
export function useUsage() {
  const [u, set] = useState(usageLog);
  useEffect(() => onUsage(() => set(usageLog())), []);
  return u;
}

export function ClientRack({ onSaid }: { onSaid(line: string, tone?: 'ok' | 'bad' | 'working'): void }) {
  const caps = useMemo(() => readCaps(), []);
  const s = useBrowseSettings();
  const dl = useDownload();
  const usage = useUsage();
  const [lim, setLim] = useState<{ max: number; cap: number; isolated: boolean } | null>(null);
  const [busy, setBusy] = useState<'' | 'apply' | 'unload' | 'clear' | 'measure'>('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [tab, setTab] = useState<TabMemory | null>(null);
  useEffect(() => { void browseMaxThreads().then(setLim); }, []);
  useTick(1000);

  const d = browseDiag(), loaded = browseState();
  const max = lim?.max ?? 1;
  const threads = Math.min(max, s.threads ?? max);
  const cap = ctxCapFor(caps.memoryGB);
  const ceiling = ramEstimate(s.ctx, s.cacheRam);
  const stale = !!loaded && (loaded.threads !== threads || (loaded.ctx ?? 4096) !== s.ctx || (loaded.cacheRam ?? 0) !== s.cacheRam);
  const last = summarize(usage).lastAnswer;
  const working = !!busy || dl.phase === 'downloading' || dl.phase === 'verifying' || dl.phase === 'saving';

  const run = async (what: typeof busy, f: () => Promise<void>) => {
    setBusy(what);
    try { await f(); } catch (e) { onSaid(String((e as Error).message || e), 'bad'); }
    setBusy('');
  };
  const apply = () => run('apply', async () => {
    onSaid(`reloading bankML: ${threads} thread${threads === 1 ? '' : 's'}, context ${s.ctx}, cache ${s.cacheRam} MiB…`, 'working');
    if (loaded) await unloadBrowse();
    const v = await loadBrowse(line => onSaid(line, 'working'));
    onSaid(`✓ ${v.model} verified · ${v.threads} thread${v.threads === 1 ? '' : 's'} · context ${v.ctx} · ${mb(browseDiag().memoryBytes)} of WebAssembly memory`, 'ok');
  });
  const unload = () => run('unload', async () => {
    const was = d.memoryBytes;
    await unloadBrowse();
    onSaid(`unloaded: the engine's ${mb(was)} went back to the browser; the model stays kept here (no download next time)`, 'ok');
  });
  const askClear = async () => {
    const n = (await keptFiles()).filter(f => f.where === 'Cache Storage').reduce((a, f) => a + f.bytes, 0);
    if (!n) return onSaid('nothing of browseML is kept in this browser');
    setConfirm(n);
  };
  const clear = () => run('clear', async () => {
    const n = await clearBrowseCache();
    setConfirm(null);
    onSaid(`cleared: ${mb(n)} removed from this browser${loaded ? ' (the engine keeps running until it is unloaded)' : ''}`, 'ok');
  });
  const measure = () => run('measure', async () => {
    onSaid('measuring this tab\'s memory (the browser may take a few seconds)…', 'working');
    const m = await measureTab();
    setTab(m);
    onSaid(m.bytes !== null ? `this tab holds ${mb(m.bytes)} (${m.how})` : `the browser does not measure a tab's memory here: ${m.how}`, m.bytes !== null ? 'ok' : undefined);
  });

  return (
    <section className="cs-rack" aria-label="Client controls">
      <header className="cs-rack-head">
        <h2>client</h2>
        <div className="cs-lamps">
          <Lamp on={!!loaded} color={GREEN} label="LOADED" title={loaded ? `${loaded.model} verified` : 'not loaded'} />
          <Lamp on={!!lim?.isolated} color={GREEN} label="THREADS" title={lim?.isolated ? 'cross-origin isolated: threads allowed' : 'not cross-origin isolated: one thread'} />
          <Lamp on={caps.relaxedSimd} color={GREEN} label="RELAXED" title={caps.relaxedSimd ? 'relaxed SIMD compiles here (used only where exact)' : 'plain SIMD'} />
          <Lamp on={working} color={ORANGE} label="BUSY" blink={working} title="downloading, verifying or reloading" />
          <Lamp on={stale} color={RED} label="APPLY" blink={stale} title={stale ? 'the knobs differ from the running engine: APPLY reloads it' : 'the engine runs the knobs\' settings'} />
        </div>
      </header>
      <div className="cs-knobs">
        <div className="cs-knob">
          <LEDKnob size={92} min={1} max={Math.max(2, max)} step={1} value={threads} disabled={max <= 1} digits={2} displayDecimals={0}
            color={ORANGE} label="CPU" sublabel={max <= 1 ? 'one thread here' : `of ${caps.cores ?? '?'} cores`}
            onChange={v => setBrowseSettings({ threads: Math.round(v) })} aria-label="Threads for bankML in this browser" />
        </div>
        <div className="cs-knob">
          <SteppedKnob size={92} positions={CTX_CHOICES.map(short)} value={Math.max(0, CTX_CHOICES.indexOf(s.ctx as never))} color={ORANGE}
            label="RAM" sublabel={`${mb(ramEstimate(s.ctx, s.cacheRam))} max · ${s.ctx} ctx`}
            onChange={i => setBrowseSettings({ ctx: CTX_CHOICES[Math.round(i)] })} aria-label="Memory: the context size in tokens" />
        </div>
        <div className="cs-knob">
          <SteppedKnob size={92} positions={CACHE_CHOICES.map(String)} value={Math.max(0, CACHE_CHOICES.indexOf(s.cacheRam as never))} color={ORANGE}
            label="CACHE" sublabel={s.cacheRam ? `${s.cacheRam} MiB prompt cache` : 'prompt cache off'}
            onChange={i => setBrowseSettings({ cacheRam: CACHE_CHOICES[Math.round(i)] })} aria-label="The engine's prompt cache in MiB" />
        </div>
        <div className="cs-knob">
          <SteppedKnob size={92} positions={MAXTOK_CHOICES.map(short)} value={Math.max(0, MAXTOK_CHOICES.indexOf(s.maxTokens as never))} color={ORANGE}
            label="ANSWER" sublabel={`${s.maxTokens} tokens at most`}
            onChange={i => setBrowseSettings({ maxTokens: MAXTOK_CHOICES[Math.round(i)] })} aria-label="The longest answer in tokens" />
        </div>
        <div className="cs-knob cs-gauge" title="The engine's WebAssembly memory now, against the most these settings can take">
          <Gauge size={104} value={d.memoryBytes / 1e6} min={0} max={Math.max(1, ceiling / 1e6)} unit="MB" label="HELD" displayDecimals={0}
            valueColor={v => (v * 1e6 > ceiling * 0.9 ? RED : v * 1e6 > ceiling * 0.7 ? ORANGE : GREEN)} />
        </div>
        <div className="cs-knob cs-readout" title="The last answer's writing speed, as bankML timed it">
          <SegmentDisplay value={last ? last.genPerSec.toFixed(2) : '----'} digits={5} height={26} color={GREEN} />
          <span>tok/s writing</span>
        </div>
      </div>
      {cap !== null && s.ctx > cap && <p className="cs-warn">This device reports {caps.memoryGB} GB: keep RAM at {cap} or less (now {s.ctx}), or the browser may close the tab.</p>}
      <div className="cs-buttons">
        <Button onClick={apply} disabled={working} color={stale ? ORANGE : undefined} led={stale ? 'dot' : undefined}>{busy === 'apply' ? 'LOADING…' : loaded ? 'APPLY' : 'LOAD'}</Button>
        <Button onClick={unload} disabled={working || !loaded}>UNLOAD</Button>
        <Button onClick={askClear} disabled={working}>CLEAR CACHE</Button>
        <Button onClick={measure} disabled={working}>{busy === 'measure' ? 'MEASURING…' : 'MEASURE'}</Button>
      </div>
      {confirm !== null && (
        <div className="cs-confirm" role="alertdialog" aria-label="Clear browseML's cache?">
          <span>Remove the kept model ({mb(confirm)}) from this browser? The next load downloads it again.</span>
          <Button onClick={clear} color={RED}>CLEAR</Button>
          <Button onClick={() => setConfirm(null)}>KEEP</Button>
        </div>
      )}
      {tab && <p className="cs-fine">this tab: {tab.bytes !== null ? mb(tab.bytes) : 'not measured'} · {tab.how}{tab.wasm ? ` · of which WebAssembly ${mb(tab.wasm)}` : ''}</p>}
      <p className="cs-fine">CPU, RAM and CACHE apply when the engine (re)loads; ANSWER applies to the next question. Read in this browser, never sent.</p>
    </section>
  );
}

function Lamp({ on, color, label, title, blink }: { on: boolean; color: string; label: string; title: string; blink?: boolean }) {
  return (
    <span className="cs-lamp" title={title}>
      <IndicatorLamp on={on} color={color} size={10} blink={blink} readOnly label={label} labelSize={10} aria-label={`${label}: ${on ? 'on' : 'off'}`} />
    </span>
  );
}
