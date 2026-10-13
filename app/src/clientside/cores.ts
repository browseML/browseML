// SPDX-License-Identifier: MIT
// How much processor browseML claims: measured once a visit at the first interaction (before the engine starts, so
// the engine's own work is not in the measure), kept for the visit (a reload reuses it), and measured again on request.
// The engine waits for it, so the first start already takes what is free. A thread count the visitor chose wins.
import { engineLog, setMeasuredThreads, setPendingMeasure } from '../bankml/free';
import { availableThreads, type Available } from './tools';

const KEY = 'browseml:cores';
let current: Promise<Available | null> | null = null;
let last: Available | null = null;
const fns = new Set<() => void>();
export const lastMeasure = () => last;
export function onMeasure(f: () => void) { fns.add(f); return () => { fns.delete(f); }; }

export function measureCores(again = false): Promise<Available | null> {
  if (current && !again) return current;
  current = (async () => {
    if (!(globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined')) return null;  // one thread anyway
    if (!again) { try { const k = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (k?.claim) { last = k; setMeasuredThreads(k.claim); fns.forEach(f => f()); return k; } } catch { /* off */ } }
    const a = await availableThreads();
    last = a;
    setMeasuredThreads(a.claim);
    try { sessionStorage.setItem(KEY, JSON.stringify(a)); } catch { /* off */ }
    engineLog('step', `processor: ${a.available} thread${a.available === 1 ? '' : 's'} free (measured in ${a.ms} ms; ${a.reported ?? '?'} reported) — browseML claims ${a.claim}${a.claim < a.available ? ', one left for the unexpected' : ''}`);
    fns.forEach(f => f());
    return a;
  })().catch(() => null);
  setPendingMeasure(current);
  return current;
}
