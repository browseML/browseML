// SPDX-License-Identifier: MIT
// browseML's control panel: everything browseML may take of this computer and everything it can measure, in one
// place on the left of the window (the sidebar; T in the field opens it). In-house, after the patterns of the
// developer-tooling libraries (Blueprint's drawer, collapses and callouts; Tweakpane's monitors; stats.js's strip;
// uPlot's sparklines), all re-made here:
//   · the strip    — the engine's state, writing speed and memory held, live, with sparklines
//   · TOOLS        — ON (start browseML) · OFF (stop the answer, free the engine) · CLEAR the active window; the load as it
//                    happens (download bar, rate, time left, source, verify clock) and this device's environment line
//   · CPU · RAM · GPU · CACHE — sliders to 100%, each with what is measured now; APPLY restarts the engine
//   · PERSONA      — who answers: browseML's own, or one made here (name, opening message, prompt); import, export
//   · BUILDER      — browseML fills a .persona from a description, writes a .prompt, keeps a .memory note
//   · SAMPLING     — Savante's dials: answer length, temperature, top-p, top-k, min-p, repeat penalty, seed
//   · ENGINE LOG   — bankML's own lines and the page's steps
//   · HARD DRIVE   — browser storage, the files kept, a copy of the model on the disk, removing them
//   · DIALS        — the DreamKnob rack: threads, memory, prompt cache, answer length; the warm stage
//   · DIAGNOSTICS  — network, CPU, RAM, GPU, as this browser reports and as measured here
//   · TOOL SUITE   — PING, SPEED, CPU, MEMORY, STORAGE, GPU, SENSORS: each with its DreamKnob dial and RUN
//   · LIMITERS     — toggles: spare a core, low memory, ask before downloading, warm in background, GPU probe
//   · ADVICE       — what to change, from what actually ran
// Sections fold and remember it (lil-gui's folders); results are written as text.
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Button, Gauge, IndicatorLamp, SegmentSwitch, SteppedKnob, ToggleSwitch } from 'dreamknob';
import type { UIFContextValue } from '../components/UIFContext';
import { browseDiag, browseMaxThreads, browseSettings, browseState, browseWarm, downloadState, onBrowseWarm, setBrowseSettings, stopBrowse, unloadBrowse } from '../bankml/free';
import { mb, readCaps } from '../bankml/caps';
import { summarize } from '../bankml/usage';
import { UsagePanel } from './UsagePanel';
import { Folders } from './Folders';
import { Disk } from './Disk';
import { Status } from './Status';
import { Sliders } from './Sliders';
import { EngineLog } from './EngineLog';
import { PersonaSection } from './Persona';
import { SamplingDials } from './Sampling';
import { Builder } from './Builder';
import { ReceiptsSection } from './Receipt';
import { gpuVerdict, probeGpu, readGpu, KEY_FEATURES, type GpuExact, type GpuProbe, type GpuReport } from '../bankml/gpu';
import { ClientRack, useTick, useUsage } from './ClientRack';
import { cpu, memory, ping, sensors, speed, storage, type Sensors } from './tools';
import { getLimits, onLimits, setLimits, type Limits } from './limits';

const GREEN = '#0ECB81', ORANGE = '#F7931A', RED = '#F6465D';

/** A folding section that remembers whether it was open. */
function Fold({ id, title, children, open = true, right }: { id: string; title: string; children: ReactNode; open?: boolean; right?: ReactNode }) {
  const key = `browseml:cp:${id}`;
  const [o, setO] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? open : v === '1'; } catch { return open; } });
  return (
    <section className={`cp-fold ${o ? 'is-open' : ''}`}>
      <header>
        <button type="button" className="cp-fold-head" aria-expanded={o} onClick={() => { setO(!o); try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* off */ } }}>
          <span className="cp-caret" aria-hidden="true">{o ? '▾' : '▸'}</span>{title}
        </button>
        {right}
      </header>
      {o && <div className="cp-fold-body">{children}</div>}
    </section>
  );
}

/** A tiny line of the last values (uPlot's idea, in SVG). */
function Spark({ values, color = ORANGE, w = 96, h = 22 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (values.length < 2) return <svg width={w} height={h} className="cp-spark" aria-hidden="true" />;
  const max = Math.max(...values, 1e-9), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ');
  return <svg width={w} height={h} className="cp-spark" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" /></svg>;
}

/** The last `n` samples of `read()`, once a second. */
function useHistory(read: () => number, n = 60) {
  const [h, setH] = useState<number[]>([]);
  const r = useRef(read); r.current = read;
  useEffect(() => { const t = window.setInterval(() => setH(x => [...x.slice(-(n - 1)), r.current()]), 1000); return () => window.clearInterval(t); }, [n]);
  return h;
}

function Row({ k, children, tone }: { k: string; children: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return <div className="cp-row"><dt>{k}</dt><dd className={tone ? `is-${tone}` : undefined}>{children}</dd></div>;
}

function useLimits() {
  const [l, set] = useState<Limits>(getLimits);
  useEffect(() => onLimits(() => set(getLimits())), []);
  return l;
}

type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;
export function ControlPanel({ uif, onModelReady = () => {}, onStart }: { uif: MutableRefObject<UIFContextValue | null>; onModelReady?(): void; onStart?(say: Say): Promise<void> }) {
  useTick(1000);
  const usage = useUsage();
  const limits = useLimits();
  const caps = useMemo(() => readCaps(), []);
  const [said, setSaid] = useState<{ text: string; tone?: 'ok' | 'bad' | 'working' } | null>(null);
  const say = (text: string, tone?: 'ok' | 'bad' | 'working') => setSaid({ text, tone });
  const [, rewarm] = useState(0);
  useEffect(() => onBrowseWarm(() => rewarm(n => n + 1)), []);
  const v = browseState(), d = browseDiag(), w = browseWarm(), sum = summarize(usage), dl = downloadState();
  const memHist = useHistory(() => browseDiag().memoryBytes / 1e6);
  const speedHist = useMemo(() => usage.answers.slice(-30).map(a => a.genPerSec), [usage]);
  const busy = w.phase === 'warming';
  const starting = d.loading || ['downloading', 'saving', 'verifying'].includes(dl.phase);

  // ── tools ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** OFF: an answer being written stops (with its receipt), and the engine is turned off — its memory goes back to
   *  the browser; the model stays here, so ON starts it again in seconds. */
  const off = async () => {
    const how = await stopBrowse();
    if (browseState()) { try { await unloadBrowse(); } catch { /* still writing: stopped above */ } }
    say(`OFF${how === 'stopped' ? ': the answer stopped there, with its receipt;' : ':'} the engine's memory went back to the browser — the model stays here (ON starts it again)`, 'ok');
  };
  const clear = () => {
    const f = uif.current, id = f?.outputs.activeId ?? null;
    if (!f || !id) return say('no response window is active');
    f.outputs.clear(id); say('cleared the active window', 'ok');
  };

  // ── the suite ────────────────────────────────────────────────────────────────────────────────────────────────
  const [running, setRunning] = useState<string>('');
  const [res, setRes] = useState<Record<string, string>>({});
  const [p, setP] = useState({ ping: 5, speed: 16, workers: Math.max(1, navigator.hardwareConcurrency || 2), mem: 64, store: 32, rows: 256 });
  const [gpu, setGpu] = useState<GpuReport | null>(null);
  const [probe, setProbe] = useState<GpuProbe | null>(null);
  const [gx, setGx] = useState<GpuExact | null>(null);
  const [sens, setSens] = useState<Sensors | null>(null);
  useEffect(() => { void readGpu(limits.power).then(setGpu); void sensors().then(setSens); }, [limits.power]);
  const tool = async (id: string, f: () => Promise<string>) => {
    if (running) return;
    setRunning(id); say(`${id.toUpperCase()} running…`, 'working');
    try { const r = await f(); setRes(x => ({ ...x, [id]: r })); say(`${id.toUpperCase()}: ${r}`, 'ok'); }
    catch (e) { const r = `failed: ${String((e as Error).message || e)}`; setRes(x => ({ ...x, [id]: r })); say(`${id.toUpperCase()} ${r}`, 'bad'); }
    setRunning('');
  };
  const suite: { id: string; name: string; knob?: ReactNode; run: () => Promise<string> }[] = [
    { id: 'ping', name: 'PING', knob: <SteppedKnob size={56} positions={['3', '5', '10', '20']} value={[3, 5, 10, 20].indexOf(p.ping)} color={ORANGE} label="COUNT" onChange={i => setP({ ...p, ping: [3, 5, 10, 20][Math.round(i)] })} />,
      run: async () => { const r = await ping(p.ping); return `${r.ok}/${r.sent} · min ${r.min.toFixed(0)} · median ${r.median.toFixed(0)} · max ${r.max.toFixed(0)} ms · jitter ${r.jitter.toFixed(0)} ms`; } },
    { id: 'speed', name: 'SPEED', knob: <SteppedKnob size={56} positions={['4', '16', '32', '64']} value={[4, 16, 32, 64].indexOf(p.speed)} color={ORANGE} label="MB" onChange={i => setP({ ...p, speed: [4, 16, 32, 64][Math.round(i)] })} />,
      run: async () => { const r = await speed(p.speed); return `${r.mbps.toFixed(1)} MB/s (${mb(r.bytes)} in ${(r.ms / 1000).toFixed(1)} s)`; } },
    { id: 'cpu', name: 'CPU', knob: <SteppedKnob size={56} positions={['1', '2', '4', '8']} value={Math.max(0, [1, 2, 4, 8].indexOf(p.workers))} color={ORANGE} label="WORKERS" onChange={i => setP({ ...p, workers: [1, 2, 4, 8][Math.round(i)] })} />,
      run: async () => { const r = await cpu(p.workers); return `${r.single.toFixed(0)} Mops/s on one · ${r.total.toFixed(0)} on ${r.workers} (×${r.scaling.toFixed(2)})`; } },
    { id: 'memory', name: 'MEMORY', knob: <SteppedKnob size={56} positions={['16', '64', '128', '256']} value={[16, 64, 128, 256].indexOf(p.mem)} color={ORANGE} label="MB" onChange={i => setP({ ...p, mem: [16, 64, 128, 256][Math.round(i)] })} />,
      run: async () => { const r = memory(p.mem); return `copy ${r.copy.toFixed(1)} GB/s · triad ${r.triad.toFixed(1)} GB/s`; } },
    { id: 'storage', name: 'STORAGE', knob: <SteppedKnob size={56} positions={['8', '32', '64']} value={[8, 32, 64].indexOf(p.store)} color={ORANGE} label="MB" onChange={i => setP({ ...p, store: [8, 32, 64][Math.round(i)] })} />,
      run: async () => { const r = await storage(p.store); return `write ${r.write.toFixed(0)} MB/s · read ${r.read.toFixed(0)} MB/s`; } },
    { id: 'gpu', name: 'GPU', knob: <SegmentSwitch options={['LOW', 'HIGH']} value={limits.power === 'low-power' ? 0 : 1} color={ORANGE} size={26} onChange={i => setLimits({ power: i ? 'high-performance' : 'low-power' })} />,
      run: async () => {
        if (!limits.gpuProbe) throw new Error('the GPU probe is off (limiters)');
        const r = await probeGpu(limits.power); setProbe(r);
        return `fma ${r.fma.fused ? 'fused (exact)' : 'not fused'}${r.contracted ? ', a·b+c contracted' : ''} · ${r.gflops.toFixed(0)} GFLOP/s · ${r.bandwidth.toFixed(1)} GB/s`;
      } },
    { id: 'exact', name: 'EXACT', knob: <SteppedKnob size={56} positions={['64', '256', '1024']} value={[64, 256, 1024].indexOf(p.rows)} color={ORANGE} label="ROWS" onChange={i => setP({ ...p, rows: [64, 256, 1024][Math.round(i)] })} />,
      run: async () => {
        if (!limits.gpuProbe) throw new Error('the GPU probe is off (limiters)');
        // bankML's Q1_0 kernel on this GPU, every row's bits against the engine's own reference (web/browseml-gpu.js)
        const g = await import(/* @vite-ignore */ new URL('browseml-gpu.js', location.href).href);
        const x = await g.exact({ rows: p.rows, n: 2048, seed: Date.now() & 0xffff, power: limits.power });
        setGx(x);
        return `${x.same}/${x.rows} rows bit-exact (n ${x.n}) · GPU ${x.gpuMs.toFixed(0)} ms`;
      } },
    { id: 'sensors', name: 'SENSORS', run: async () => { const s = await sensors(); setSens(s); return `${s.online ? 'online' : 'offline'}${s.connection?.effectiveType ? ` · ${s.connection.effectiveType}` : ''}${s.battery ? ` · battery ${Math.round(s.battery.level * 100)}%${s.battery.charging ? ' charging' : ''}` : ''}`; } },
  ];
  const gv = gpuVerdict(gpu ?? { webgpu: false, reason: '…' }, probe, gx);
  const gpuName = gpu?.adapter ? [gpu.adapter.vendor, gpu.adapter.architecture, gpu.adapter.device].filter(Boolean).join(' · ') || (gpu.webgl?.renderer ?? '') : (gpu?.webgl?.renderer ?? '');
  const lastLoad = sum.lastLoad, last = sum.lastAnswer;

  return (
    <div className="cp">
      <div className="cp-strip" aria-label="browseML now">
        <span className="cp-strip-lamp"><IndicatorLamp on readOnly size={9} color={!v && !starting ? '#64748b' : busy || starting ? ORANGE : GREEN} blink={busy || starting} aria-label="engine" /></span>
        <span className="cp-strip-state"><b>{v ? (w.phase === 'warming' ? 'ON · warming' : 'ON') : starting ? 'STARTING' : 'OFF'}</b>{v && <small>{v.threads} thr · ctx {v.ctx ?? browseSettings().ctx}</small>}</span>
        <span className="cp-strip-num" title="writing speed, last answers"><Spark values={speedHist} color={GREEN} /><b>{last ? last.genPerSec.toFixed(2) : '—'}</b><small>tok/s{last ? ` · read ${last.promptPerSec.toFixed(1)}` : ''}</small></span>
        <span className="cp-strip-num" title="engine memory, last minute"><Spark values={memHist} /><b>{mb(d.memoryBytes)}</b><small>held</small></span>
        <span className="cp-strip-num" title="the prompt cache: the kept prompt, and the RAM cache"><b>{w.phase === 'restored' || w.phase === 'warmed' ? mb(w.bytes) : '—'}</b><small>cache{w.phase === 'restored' || w.phase === 'warmed' ? ` · ${w.tokens} tok` : ''} · {browseSettings().cacheRam} MiB RAM</small></span>
      </div>

      <Fold id="tools" title="TOOLS">
        <div className="cp-buttons">
          <Button onClick={() => void onStart?.(say)} color={GREEN} disabled={!!v || starting}>{starting ? 'ON…' : 'ON'}</Button>
          <Button onClick={() => void off()} color={RED} disabled={!v && !starting}>OFF</Button>
          <Button onClick={clear}>CLEAR</Button>
        </div>
        {said && <p className={`cp-said ${said.tone ? `is-${said.tone}` : ''}`} role="status">{said.text}</p>}
        <Status usage={usage} gpu={gpuName} />
      </Fold>

      <Fold id="sliders" title="CPU · RAM · GPU · CACHE"><Sliders usage={usage} say={say} gpu={gpuName} /></Fold>

      <Fold id="persona" title="PERSONA" open={false}><PersonaSection uif={uif} say={say} /></Fold>

      <Fold id="builder" title="BUILDER" open={false}><Builder uif={uif} say={say} /></Fold>

      <Fold id="sampling" title="SAMPLING" open={false}><SamplingDials /></Fold>

      <Fold id="log" title="ENGINE LOG" open={false}><EngineLog /></Fold>

      <Fold id="receipts" title="RECEIPTS" open={false}><ReceiptsSection uif={uif} /></Fold>

      <Fold id="folders" title="MODELS ON THIS COMPUTER" open={false}><Folders onReady={onModelReady} say={say} /></Fold>

      <Fold id="disk" title="HARD DRIVE"><Disk say={say} /></Fold>

      <Fold id="dials" title="DIALS"><ClientRack onSaid={say} /></Fold>

      <Fold id="diag" title="DIAGNOSTICS">
        <h4>Network</h4>
        <dl>
          <Row k="connection">{sens ? `${sens.online ? 'online' : 'offline'}${sens.connection?.effectiveType ? ` · ${sens.connection.effectiveType}` : ''}${sens.connection?.downlink ? ` · ~${sens.connection.downlink} Mb/s` : ''}${sens.connection?.rtt ? ` · rtt ~${sens.connection.rtt} ms` : ''}${sens.connection?.saveData ? ' · data saver' : ''}` : '…'}</Row>
          <Row k="model download" tone={dl.phase === 'failed' ? 'bad' : undefined}>{dl.phase === 'downloading' ? `${mb(dl.got)} of ${mb(dl.total)}${dl.rate ? ` · ${(dl.rate / 1e6).toFixed(1)} MB/s` : ''}${dl.retries ? ` · ${dl.retries} pieces retried` : ''}` : lastLoad ? (lastLoad.source === 'cache' ? 'from this browser (no download)' : `${mb(lastLoad.fetched)} at ${(lastLoad.fetched / 1e6 / Math.max(.001, lastLoad.modelMs / 1000)).toFixed(1)} MB/s${lastLoad.retries ? `, ${lastLoad.retries} retried` : ''}`) : 'none yet'}</Row>
          {res.ping && <Row k="ping">{res.ping}</Row>}
          {res.speed && <Row k="speed">{res.speed}</Row>}
        </dl>
        <h4>CPU</h4>
        <dl>
          <Row k="cores">{caps.cores ?? 'not reported'} reported{caps.isolated ? ` · bankML may take ${Math.min(8, caps.cores ?? 1)}` : ' · one thread (not isolated)'}</Row>
          <Row k="engine">{v ? `${v.threads} thread${v.threads === 1 ? '' : 's'} · ${v.build ?? 'browseml.wasm'}` : 'not loaded'}</Row>
          <Row k="speed">{last ? `reading ${last.promptPerSec.toFixed(2)} · writing ${last.genPerSec.toFixed(2)} tok/s` : 'no answer yet'}</Row>
          {res.cpu && <Row k="CPU tool">{res.cpu}</Row>}
        </dl>
        <h4>RAM</h4>
        <dl>
          <Row k="engine">{mb(d.memoryBytes)} held · peak {mb(sum.peakMemory)}</Row>
          <Row k="device">{caps.memoryGB ? `${caps.memoryGB >= 8 ? '≥ 8' : caps.memoryGB} GB reported` : 'not reported'}{sens?.heapMB ? ` · page heap ${sens.heapMB.toFixed(0)} MB` : ''}</Row>
          <Row k="prompt cache">{w.phase === 'restored' ? `restored ${w.tokens} tokens in ${(w.ms / 1000).toFixed(1)} s` : w.phase === 'warmed' ? `read ${w.tokens} tokens once, ${mb(w.bytes)} kept` : w.phase === 'warming' ? 'reading…' : w.phase === 'failed' ? `not warm: ${w.error}` : 'not warm'}</Row>
          {res.memory && <Row k="MEMORY tool">{res.memory}</Row>}
          {res.storage && <Row k="STORAGE tool">{res.storage}</Row>}
        </dl>
        <h4>GPU</h4>
        <dl>
          <Row k="adapter">{gpu?.adapter ? [gpu.adapter.vendor, gpu.adapter.architecture, gpu.adapter.device, gpu.adapter.description].filter(Boolean).join(' · ') || 'unnamed (the browser keeps it private)' : gpu ? (gpu.reason ?? 'none') : '…'}{gpu?.adapter?.fallback ? ' · software fallback' : ''}</Row>
          {gpu?.webgl && <Row k="WebGL">{gpu.webgl.renderer}</Row>}
          {gpu?.adapter && <Row k="features">{KEY_FEATURES.filter(f => gpu.adapter!.features.includes(f)).join(' · ') || 'none of the key ones'} ({gpu.adapter.features.length} in all)</Row>}
          {gpu?.adapter && <Row k="limits">buffer {mb(gpu.adapter.limits.maxBufferSize ?? 0)} · storage binding {mb(gpu.adapter.limits.maxStorageBufferBindingSize ?? 0)} · {gpu.adapter.limits.maxComputeInvocationsPerWorkgroup ?? '?'} invocations/workgroup</Row>}
          <Row k="verdict" tone={gv.level}>{gv.text}</Row>
          {probe && (
            <div className="cp-gauges">
              <Gauge size={78} value={Math.min(probe.gflops, 20000)} min={0} max={Math.max(100, Math.ceil(probe.gflops / 500) * 500)} unit="GFLOP/s" label="COMPUTE" displayDecimals={0} />
              <Gauge size={78} value={probe.bandwidth} min={0} max={Math.max(10, Math.ceil(probe.bandwidth / 50) * 50)} unit="GB/s" label="MEMORY" displayDecimals={0} />
            </div>
          )}
        </dl>
      </Fold>

      <Fold id="suite" title="TOOL SUITE">
        <div className="cp-suite">
          {suite.map(t => (
            <div key={t.id} className={`cp-tool ${running === t.id ? 'is-running' : ''}`}>
              <div className="cp-tool-head"><b>{t.name}</b>{t.knob}</div>
              <Button onClick={() => void tool(t.id, t.run)} disabled={!!running}>{running === t.id ? 'RUNNING…' : 'RUN'}</Button>
              {res[t.id] && <p className={`cp-tool-out ${res[t.id].startsWith('failed') ? 'is-bad' : ''}`}>{res[t.id]}</p>}
            </div>
          ))}
        </div>
        <p className="cp-fine">The classics, as a page can do them: <a href="https://github.com/browseML/browseML/blob/main/docs/cpu-software.md">CPU and network</a> · <a href="https://github.com/browseML/browseML/blob/main/docs/gpu-software.md">graphics cards</a>.</p>
      </Fold>

      <Fold id="limits" title="LIMITERS">
        <div className="cp-limits">
          <ToggleSwitch on={limits.spareCore} color={ORANGE} label="leave a core free" onChange={on => { setLimits({ spareCore: on }); void browseMaxThreads().then(l => setBrowseSettings({ threads: on ? Math.max(1, l.max - 1) : null })); }} />
          <ToggleSwitch on={limits.lowMemory} color={ORANGE} label="low memory (1k context, no cache)" onChange={on => { setLimits({ lowMemory: on }); if (on) setBrowseSettings({ ctx: 1024, cacheRam: 0 }); else setBrowseSettings({ ctx: browseSettings().ctx === 1024 ? 2048 : browseSettings().ctx }); }} />
          <ToggleSwitch on={limits.askFirst} color={ORANGE} label="ask before downloading the model" onChange={on => setLimits({ askFirst: on })} />
          <ToggleSwitch on={limits.warm} color={ORANGE} label="warm the prompt in the background" onChange={on => setLimits({ warm: on })} />
          <ToggleSwitch on={limits.gpuProbe} color={ORANGE} label="allow the GPU probe" onChange={on => setLimits({ gpuProbe: on })} />
        </div>
        <p className="cp-fine">Threads and memory apply when the engine loads again (APPLY in the dials).</p>
      </Fold>

      <Fold id="advice" title="ADVICE AND RECORDS" open={false}><UsagePanel usage={usage} /></Fold>
    </div>
  );
}
