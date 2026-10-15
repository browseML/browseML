// SPDX-License-Identifier: MIT
// The monitor: battery, network, CPU, memory, GPU and the engine, kept current for as long as the page is open — not
// read once on demand. Cheap by design: the battery, the network and the CPU's pressure come by the browser's own
// events (no polling); one tick a second (none in a background tab) reads the rest — how late the page's main thread
// runs (its event-loop lag), long tasks, the JS heap, what bankML's GPU limiter says the card did, the engine's live
// writing speed and the fire's own cost. A short history (60 samples) feeds the charts. Nothing is sent anywhere.
import { activity, liveRate } from '../bankml/pulse';
import { browseDiag, type GpuLive } from '../bankml/free';
import { fireStats } from './Fire';

export type Pressure = 'nominal' | 'fair' | 'serious' | 'critical';
export interface MonitorState {
  battery: { level: number; charging: boolean; chargingTime: number; dischargingTime: number } | null;
  network: { online: boolean; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean; changes: number };
  /** The system's CPU pressure where the browser offers it (Compute Pressure API); null elsewhere. */
  pressure: Pressure | null;
  /** How late the page's one-second tick fires, in ms (the main thread's load), and long tasks (> 50 ms) in the last 10 s. */
  lagMs: number; longTasks: number;
  heapMB: number | null;
  gpu: GpuLive | null;
  engine: { activity: string; tokPerSec: number };
  fire: { on: boolean; asleep: boolean; fps: number; share: number };
  history: { lag: number[]; tok: number[]; gpuBusy: number[] };
  since: number;
}

const N = 60;
const st: MonitorState = {
  battery: null, network: { online: typeof navigator === 'undefined' ? true : navigator.onLine, changes: 0 }, pressure: null,
  lagMs: 0, longTasks: 0, heapMB: null, gpu: null, engine: { activity: 'idle', tokPerSec: 0 },
  fire: { on: true, asleep: true, fps: 0, share: 0 }, history: { lag: [], tok: [], gpuBusy: [] }, since: Date.now(),
};
const fns = new Set<() => void>();
const emit = () => fns.forEach(f => f());
export const monitor = (): MonitorState => st;
export function onMonitor(f: () => void) { fns.add(f); return () => { fns.delete(f); }; }
const push = (xs: number[], x: number) => { xs.push(x); if (xs.length > N) xs.shift(); };

let started = false, longs: number[] = [];
/** Start once (main.tsx); every reading after that is live. */
export function startMonitor() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget & { level: number; charging: boolean; chargingTime: number; dischargingTime: number }>; connection?: EventTarget & Record<string, unknown> };
  // the battery: by its events
  void nav.getBattery?.().then(b => {
    const read = () => { st.battery = { level: b.level, charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime }; emit(); };
    read();
    for (const ev of ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']) b.addEventListener(ev, read);
  }).catch(() => { /* not offered */ });
  // the network: by its events
  const net = () => {
    const c = nav.connection;
    st.network = { online: navigator.onLine, changes: st.network.changes + 1, ...(c ? { effectiveType: c.effectiveType as string, downlink: c.downlink as number, rtt: c.rtt as number, saveData: c.saveData as boolean } : {}) };
    emit();
  };
  net(); st.network.changes = 0;
  addEventListener('online', net); addEventListener('offline', net);
  nav.connection?.addEventListener?.('change', net);
  // the CPU's pressure, where the browser offers it
  try {
    const PO = (globalThis as { PressureObserver?: new (cb: (r: { state: Pressure }[]) => void) => { observe(s: string, o?: object): Promise<void> } }).PressureObserver;
    if (PO) void new PO(rs => { const r = rs[rs.length - 1]; if (r) { st.pressure = r.state; emit(); } }).observe('cpu', { sampleInterval: 2000 }).catch(() => { /* refused */ });
  } catch { /* not offered */ }
  // long tasks on the main thread
  try { new PerformanceObserver(l => { const t = performance.now(); for (let i = l.getEntries().length; i > 0; i--) longs.push(t); }).observe({ type: 'longtask', buffered: false }); } catch { /* not offered */ }
  // the one tick: lag, heap, GPU, engine, fire
  let due = performance.now() + 1000;
  const tick = () => {
    const now = performance.now();
    st.lagMs = Math.max(0, now - due);
    due = now + 1000;
    if (document.hidden) { setTimeout(tick, 1000); return; }
    longs = longs.filter(t => now - t < 10000);
    st.longTasks = longs.length;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    st.heapMB = mem ? mem.usedJSHeapSize / 1e6 : null;
    st.gpu = browseDiag().gpu;
    st.engine = { activity: activity(), tokPerSec: liveRate() };
    const f = fireStats();
    st.fire = { on: f.on, asleep: f.asleep, fps: f.fps, share: f.share };
    push(st.history.lag, st.lagMs); push(st.history.tok, st.engine.tokPerSec); push(st.history.gpuBusy, st.gpu?.busy ?? 0);
    emit();
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);
}

/** Running on battery and discharging (the limiter "rest the fire effect on battery" acts only then). */
export const onBattery = () => !!st.battery && !st.battery.charging;
