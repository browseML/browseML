// SPDX-License-Identifier: MIT
// Shelves: places for the field's buttons besides its bar — the sidebar menu, and any button panels the visitor adds.
// A button dropped on a shelf (from the bar, or floating) leaves the bar and sits there; from a shelf it can be
// dragged back to the bar, to another shelf, or anywhere on the screen. A shelf is any element marked
// `data-uif-shelf="<id>"` holding `data-uif-shelf-item` children, so a page can put shelves wherever it likes and a
// module can add its own. The operations are pure (so tested); `createShelves` keeps them in localStorage and tells
// whoever listens. One button is on at most one shelf.

export interface Shelf { id: string; title: string; ids: string[] }
/** `shown`: the sidebar is on screen. It appears when a button is first dragged off the field (somewhere to drop it)
 *  and stays until it is closed; the shelves keep their buttons either way. */
export interface ShelvesState { shelves: Shelf[]; shown?: boolean }

/** The sidebar menu: always there, first, cannot be removed. */
export const SIDEBAR = 'sidebar';
export const defaultShelves = (): ShelvesState => ({ shelves: [{ id: SIDEBAR, title: 'menu', ids: [] }], shown: false });

/** Take a button off every shelf. */
export function shelfTake(s: ShelvesState, id: string): ShelvesState {
  return { ...s, shelves: s.shelves.map(sh => (sh.ids.includes(id) ? { ...sh, ids: sh.ids.filter(x => x !== id) } : sh)) };
}

/** Put a button on a shelf at a 0-based place (default: the end), taking it off any other; null for no such shelf. */
export function shelfPut(s: ShelvesState, id: string, shelf: string, at?: number): ShelvesState | null {
  if (!s.shelves.some(sh => sh.id === shelf)) return null;
  const t = shelfTake(s, id);
  return {
    ...t,
    shelves: t.shelves.map(sh => {
      if (sh.id !== shelf) return sh;
      const ids = sh.ids.slice();
      ids.splice(Math.max(0, Math.min(at ?? ids.length, ids.length)), 0, id);
      return { ...sh, ids };
    }),
  };
}

/** The shelf a button is on, or null. */
export const shelfOf = (s: ShelvesState, id: string): string | null => s.shelves.find(sh => sh.ids.includes(id))?.id ?? null;

/** Add a button panel; its id is new (panel-1, panel-2, …). */
export function addPanel(s: ShelvesState, title = ''): { state: ShelvesState; id: string } {
  let n = 1;
  while (s.shelves.some(sh => sh.id === `panel-${n}`)) n++;
  const id = `panel-${n}`;
  return { state: { ...s, shelves: [...s.shelves, { id, title: title.trim() || `panel ${n}`, ids: [] }] }, id };
}

/** Remove a panel (never the sidebar); its buttons are returned, to go back to the bar. */
export function removePanel(s: ShelvesState, id: string): { state: ShelvesState; freed: string[] } | null {
  const sh = s.shelves.find(x => x.id === id);
  if (!sh || id === SIDEBAR) return null;
  return { state: { ...s, shelves: s.shelves.filter(x => x.id !== id) }, freed: sh.ids };
}

export function renameShelf(s: ShelvesState, id: string, title: string): ShelvesState {
  const t = title.trim().slice(0, 40);
  return t ? { ...s, shelves: s.shelves.map(sh => (sh.id === id ? { ...sh, title: t } : sh)) } : s;
}

/** A stored value, checked: unknown shapes give the default; the sidebar is always first; a button on one shelf. */
export function parseShelves(raw: unknown): ShelvesState {
  const o = raw as { shelves?: unknown; shown?: unknown } | null;
  if (!o || !Array.isArray(o.shelves)) return defaultShelves();
  const seen = new Set<string>(), ids = new Set<string>();
  const shelves: Shelf[] = [];
  for (const x of o.shelves as Record<string, unknown>[]) {
    if (!x || typeof x.id !== 'string' || !/^(sidebar|panel-\d+)$/.test(x.id) || ids.has(x.id)) continue;
    ids.add(x.id);
    const list = Array.isArray(x.ids) ? (x.ids as unknown[]).filter((i): i is string => typeof i === 'string' && !seen.has(i)) : [];
    list.forEach(i => seen.add(i));
    shelves.push({ id: x.id, title: typeof x.title === 'string' && x.title.trim() ? x.title.trim().slice(0, 40) : x.id, ids: list });
  }
  const side = shelves.find(sh => sh.id === SIDEBAR) ?? defaultShelves().shelves[0];
  return { shelves: [side, ...shelves.filter(sh => sh.id !== SIDEBAR)], shown: o.shown === true };
}

// ── the DOM side: where a drop lands ────────────────────────────────────────────────────────────────────────────
/** The shelf under a screen point and the place among its items a drop there takes, or null. A shelf under the point
 *  wins; else an element marked `data-uif-shelf-fallback="<id>"` (a whole sidebar) takes it at the end of that shelf. */
export function shelfAt(x: number, y: number, doc: Document = document): { id: string; index: number } | null {
  const under = doc.elementsFromPoint(x, y) as HTMLElement[];
  const el = under.find(e => e.dataset?.uifShelf !== undefined);
  if (!el) {
    const fb = under.find(e => e.dataset?.uifShelfFallback !== undefined);
    return fb ? { id: fb.dataset.uifShelfFallback!, index: Number.MAX_SAFE_INTEGER } : null;
  }
  let index = 0;
  el.querySelectorAll<HTMLElement>('[data-uif-shelf-item]').forEach(it => {
    if (it.dataset.dragging !== undefined) return;
    const r = it.getBoundingClientRect();
    if (y > r.bottom || (y >= r.top && x > r.left + r.width / 2)) index++;
  });
  return { id: el.dataset.uifShelf!, index };
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface ShelvesStore {
  get(): ShelvesState;
  set(f: (s: ShelvesState) => ShelvesState): void;
  subscribe(f: () => void): () => void;
}
/** Shelves kept under `key` in localStorage. */
export function createShelves(key: string): ShelvesStore {
  let state = (() => { try { return parseShelves(JSON.parse(localStorage.getItem(key) || 'null')); } catch { return defaultShelves(); } })();
  const fns = new Set<() => void>();
  return {
    get: () => state,
    set(f) {
      state = f(state);
      try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage off */ }
      fns.forEach(fn => fn());
    },
    subscribe(f) { fns.add(f); return () => { fns.delete(f); }; },
  };
}

/** A button is being dragged off the field (true) or not any more (false): the sidebar appears for the drop. The bar
 *  and the floating buttons say so; the shelves component listens. */
const dragOffFns = new Set<(off: boolean) => void>();
export function notifyDragOff(off: boolean) { dragOffFns.forEach(f => f(off)); }
export function onDragOff(f: (off: boolean) => void) { dragOffFns.add(f); return () => { dragOffFns.delete(f); }; }

/** The page's drop handler: the bar and the floating buttons call it when a button is let go over a shelf. One per
 *  page (the shelves component sets it); without one, shelves are not drop targets. */
let dropHandler: ((id: string, shelf: string, index: number) => void) | null = null;
export function setShelfDrop(f: typeof dropHandler) { dropHandler = f; }
/** A button let go at (x, y): put on the shelf there and true, or false (not over a shelf, or no shelves here). */
export function dropOnShelf(id: string, x: number, y: number): boolean {
  if (!dropHandler || typeof document === 'undefined') return false;
  const at = shelfAt(x, y);
  if (!at) return false;
  dropHandler(id, at.id, at.index);
  return true;
}
