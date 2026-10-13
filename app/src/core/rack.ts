// SPDX-License-Identifier: MIT
// The rack: the field's action bar, managed by command (rack, rack add, rack remove, rack move, rack reset) as well
// as by hand (hold a button to move it; + to add one). Pure operations on a bar's layout, so they are tested; the
// `rack` command (builtins.ts) applies them to a mode's face of the bar (the rolodex), which the field keeps saved.
import type { ActionsLayout } from './actions';

const without = <T>(r: Record<string, T>, k: string): Record<string, T> => {
  if (!(k in r)) return r;
  const { [k]: _drop, ...rest } = r;
  return rest;
};

/** The racked ids that are registered, in order, and the ones waiting for their action (kept after them). */
function split(l: ActionsLayout, known: (id: string) => boolean) {
  return { vis: l.order.filter(known), pending: l.order.filter(id => !known(id)) };
}

/** Rack a button at a 0-based position among the racked ones (default: the end). From hidden or floating alike. */
export function rackAdd(l: ActionsLayout, id: string, known: (id: string) => boolean, at?: number): ActionsLayout {
  const { vis, pending } = split({ ...l, order: l.order.filter(o => o !== id) }, known);
  const i = Math.max(0, Math.min(at ?? vis.length, vis.length));
  vis.splice(i, 0, id);
  return { ...l, order: [...vis, ...pending], hidden: l.hidden.filter(h => h !== id), floating: without(l.floating, id) };
}

/** Take a button off the rack (or off the screen, when it floats): it stays a command and is in + to add back. */
export function rackRemove(l: ActionsLayout, id: string): ActionsLayout | null {
  if (!l.order.includes(id) && !(id in l.floating)) return null;
  return { ...l, order: l.order.filter(o => o !== id), floating: without(l.floating, id), hidden: [...l.hidden.filter(h => h !== id), id] };
}

/** Move a racked button to a 0-based position; null when it is not on the rack. */
export function rackMove(l: ActionsLayout, id: string, known: (id: string) => boolean, to: number): ActionsLayout | null {
  if (!l.order.includes(id) || !known(id)) return null;
  return rackAdd(l, id, known, to);
}
