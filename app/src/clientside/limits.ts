// SPDX-License-Identifier: MIT
// The control panel's limiters: what browseML may take of this computer and this connection, as toggles, kept in this
// browser. Each one acts through browseML's own settings or the page's flow — nothing here is a promise.
//   spareCore   — leave one core free: threads = cores − 1 (applied on the next load)
//   lowMemory   — the smallest context (1024) and no prompt cache (applied on the next load)
//   askFirst    — ask before downloading the model (a question does not start it); on when the browser asks to save data
//   warm        — read browseML's prompt in the background once the model is here, and keep it for the next visit
//   gpuProbe    — allow the GPU probe (compute shaders on the visitor's GPU, on request only)
export interface Limits { spareCore: boolean; lowMemory: boolean; askFirst: boolean; warm: boolean; gpuProbe: boolean; power: 'low-power' | 'high-performance' }

const KEY = 'browseml:limits';
const saveData = () => { try { return !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData; } catch { return false; } };
export const DEFAULT_LIMITS = (): Limits => ({ spareCore: false, lowMemory: false, askFirst: saveData(), warm: true, gpuProbe: true, power: 'high-performance' });

export function parseLimits(raw: unknown): Limits {
  const d = DEFAULT_LIMITS(), o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: keyof Limits) => (typeof o[k] === 'boolean' ? o[k] as boolean : d[k] as boolean);
  return { spareCore: b('spareCore'), lowMemory: b('lowMemory'), askFirst: b('askFirst'), warm: b('warm'), gpuProbe: b('gpuProbe'),
    power: o.power === 'low-power' ? 'low-power' : 'high-performance' };
}

let limits: Limits = (() => { try { return parseLimits(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return DEFAULT_LIMITS(); } })();
const fns = new Set<() => void>();
export const getLimits = () => limits;
export function setLimits(patch: Partial<Limits>) {
  limits = parseLimits({ ...limits, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(limits)); } catch { /* storage off */ }
  fns.forEach(f => f());
}
export function onLimits(f: () => void) { fns.add(f); return () => { fns.delete(f); }; }
