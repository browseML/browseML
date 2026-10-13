// SPDX-License-Identifier: MIT
// The control panel's limiters: what browseML may take of this computer and this connection, as toggles, kept in this
// browser. Each one acts through browseML's own settings or the page's flow — nothing here is a promise.
//   spareCore   — leave one core free: threads = cores − 1 (applied on the next load)
//   lowMemory   — the smallest context (1024) and no prompt cache (applied on the next load)
//   askFirst    — ask before downloading the model (a question does not start it); off unless the visitor turns it on
//   warm        — read browseML's prompt in the background once the model is here, and keep it for the next visit
//   gpuProbe    — allow the GPU probe (compute shaders on the visitor's GPU, on request only)
//   rememberFolders — persistent access: folders granted for models are kept (their handles, in IndexedDB) for the next
//                 visit; off by default, and turning it off forgets them
//   showReceipts — each answer's receipt shown under it (a closed accordion); off: kept, not shown
//   keepCopy    — a model found in a folder is also kept in this browser (off: read from the folder each visit)
//   diskCopy    — keep a copy of the model on this computer's disk too (HARD DRIVE: saved into a folder the visitor
//                 chooses, or to Downloads where the browser cannot write folders); off by default
export interface Limits { showReceipts: boolean; spareCore: boolean; lowMemory: boolean; askFirst: boolean; warm: boolean; gpuProbe: boolean; power: 'low-power' | 'high-performance'; rememberFolders: boolean; keepCopy: boolean; diskCopy: boolean }

const KEY = 'browseml:limits';
export const DEFAULT_LIMITS = (): Limits => ({ showReceipts: true, spareCore: false, lowMemory: false, askFirst: false, warm: true, gpuProbe: true, power: 'high-performance', rememberFolders: false, keepCopy: true, diskCopy: false });

export function parseLimits(raw: unknown): Limits {
  const d = DEFAULT_LIMITS(), o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: keyof Limits) => (typeof o[k] === 'boolean' ? o[k] as boolean : d[k] as boolean);
  return { showReceipts: b('showReceipts'), spareCore: b('spareCore'), lowMemory: b('lowMemory'), askFirst: b('askFirst'), warm: b('warm'), gpuProbe: b('gpuProbe'),
    rememberFolders: b('rememberFolders'), keepCopy: b('keepCopy'), diskCopy: b('diskCopy'),
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
