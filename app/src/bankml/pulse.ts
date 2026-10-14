// SPDX-License-Identifier: MIT
// The processor's pulse: what the engine is doing right now, from its own events (each token as it arrives, a question
// starting, the prompt warming, the download, the GPU's verdict, receipts, errors, STOP), as a heat between 0 and 1
// and a stream of surges. The page's fire (clientside/Fire.tsx) draws from it; nothing here is an estimate: the live
// writing speed is tokens counted over the last three seconds, the reference the best speed this visit has measured.
export type SurgeKind = 'ask' | 'gpu' | 'receipt' | 'error' | 'stop' | 'record' | 'load' | 'tool';
export interface Surge { kind: SurgeKind; at: number; strength: number }
export type Activity = 'idle' | 'loading' | 'verifying' | 'warming' | 'reading' | 'writing' | 'tool';

let now = () => performance.now();
/** Tests: a clock of their own. */
export function setPulseClock(f: () => number) { now = f; }

const st = {
  activity: 'idle' as Activity, ready: false,
  tokens: [] as number[], best: 0, lastRate: 0,
  surges: [] as Surge[], tool: 0,
};
const fns = new Set<(s?: Surge) => void>();
export function onPulse(f: (s?: Surge) => void) { fns.add(f); return () => { fns.delete(f); }; }
const emit = (s?: Surge) => fns.forEach(f => f(s));

export function setActivity(a: Activity) { if (st.activity !== a) { st.activity = a; emit(); } }
export function setReady(r: boolean) { if (st.ready !== r) { st.ready = r; emit(); } }
export const activity = () => st.activity;

/** A token arrived: counted for the live writing speed (the first one moves the activity from reading to writing). */
export function token() {
  const t = now();
  st.tokens.push(t);
  while (st.tokens.length && t - st.tokens[0] > 3000) st.tokens.shift();
  if (st.activity === 'reading') setActivity('writing');
  const r = liveRate();
  if (r > st.best && st.tokens.length >= 6) {
    // a speed this visit has not seen: a surge (only once the rate is measured over a few tokens)
    const was = st.best;
    st.best = r;
    if (was > 0 && r > was * 1.05) surge('record', Math.min(1, (r - was) / was + 0.4));
  }
}
/** Tokens per second over the last three seconds (0 when fewer than two). */
export function liveRate(): number {
  const t = now(), xs = st.tokens.filter(x => t - x <= 3000);
  if (xs.length < 2) return 0;
  return (xs.length - 1) / Math.max(0.05, (xs[xs.length - 1] - xs[0]) / 1000);
}
/** The best measured writing speed (the reference the heat is measured against); a recorded answer can raise it. */
export function noteRate(r: number) { if (r > st.best) st.best = r; st.lastRate = r; }
export const bestRate = () => st.best;

export function surge(kind: SurgeKind, strength = 1) {
  const s: Surge = { kind, at: now(), strength: Math.max(0.1, Math.min(1, strength)) };
  st.surges.push(s);
  if (st.surges.length > 32) st.surges.shift();
  emit(s);
}
/** Surges younger than `ms`. */
export const recentSurges = (ms = 1200) => { const t = now(); return st.surges.filter(s => t - s.at <= ms); };

/** A diagnostic tool running (CPU, MEMORY, GPU …): the processor is being measured, so it burns. */
export function toolRunning(on: boolean) { st.tool = Math.max(0, st.tool + (on ? 1 : -1)); if (on) surge('tool', 0.6); emit(); }

/** The heat the engine's activity calls for, 0–1: idle 0 (embers 0.06 when the model is ready), the download 0.3,
 *  verifying 0.4, a diagnostic 0.55, reading a prompt 0.7, warming the prompt cache 0.85, writing 0.35 + 0.6 × the live
 *  speed against the best this visit. */
export function targetHeat(): number {
  const a = st.activity;
  let h = st.ready ? 0.06 : 0;
  if (a === 'loading') h = 0.3;
  else if (a === 'verifying') h = 0.4;
  else if (a === 'reading') h = 0.7;
  else if (a === 'warming') h = 0.85;
  else if (a === 'writing') { const r = liveRate(), b = Math.max(st.best, r, 0.1); h = 0.35 + 0.6 * Math.min(1, r / b); }
  if (st.tool > 0) h = Math.max(h, 0.55);
  return h;
}

/** Heat that follows the target smoothly: rises in about a third of a second, cools in about two (fire does). */
export function follow(heat: number, target: number, dtMs: number): number {
  const tau = target > heat ? 350 : 2000;
  return target + (heat - target) * Math.exp(-dtMs / tau);
}

/** The colour of a surge: GPU blue-white, a record or receipt candle green, an error or STOP red, the rest orange. */
export function surgeColor(k: SurgeKind): string {
  return k === 'gpu' ? '#cfe8ff' : k === 'receipt' || k === 'record' ? '#0ECB81' : k === 'error' || k === 'stop' ? '#F6465D' : '#F7931A';
}

/** The browser checks drive the fire without an engine (`__browsemlPulse`): activity, tokens, surges. */
(globalThis as { __browsemlPulse?: unknown }).__browsemlPulse = { setActivity: (a: Activity) => setActivity(a), token: () => token(), surge: (k: SurgeKind, s?: number) => surge(k, s), setReady: (r: boolean) => setReady(r) };

/** Tests: back to the start. */
export function resetPulse() { Object.assign(st, { activity: 'idle', ready: false, tokens: [], best: 0, lastRate: 0, surges: [], tool: 0 }); }
