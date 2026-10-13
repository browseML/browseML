// SPDX-License-Identifier: MIT
// The control panel, arranged by the visitor: every section can be dragged by its grip (⠿) to a new place — with a
// mouse, a pen or a finger (pointer events, not HTML drag-and-drop, which touch screens do not send) — hidden with –,
// and brought back from the SHOW row at the bottom. The order and what is hidden are kept in this browser.
// Keyboard: on a grip, ↑ and ↓ move the section.
import { Children, createContext, isValidElement, useContext, useRef, useState, type ReactElement, type ReactNode, type PointerEvent as RPointerEvent } from 'react';

const KEY = 'browseml:cp:arrange';
interface Saved { order: string[]; hidden: string[] }
const read = (): Saved => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && Array.isArray(s.order) && Array.isArray(s.hidden)) return s; } catch { /* off */ } return { order: [], hidden: [] }; };
const write = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage off */ } };

/** A saved order with the sections it does not know yet put where the page has them (pure, so tested). */
export function merge(saved: string[], ids: string[]): string[] {
  const out = saved.filter(id => ids.includes(id));
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    const before = ids.slice(0, i).reverse().find(x => out.includes(x));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
  });
  return out;
}
/** `order` with `id` moved to position `to` (pure, so tested). */
export function move(order: string[], id: string, to: number): string[] {
  const out = order.filter(x => x !== id);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
}

interface Ctx { grip(id: string): { onPointerDown(e: RPointerEvent): void; onKeyDown(e: React.KeyboardEvent): void }; hide(id: string): void; dragging: string | null }
const ArrangeCtx = createContext<Ctx | null>(null);
export const useArrange = () => useContext(ArrangeCtx);

export function Arrange({ children, titles }: { children: ReactNode; titles: Record<string, string> }) {
  const kids = Children.toArray(children).filter(isValidElement) as ReactElement<{ id: string }>[];
  const ids = kids.map(k => k.props.id);
  const [s, setS] = useState<Saved>(() => { const r = read(); return { order: merge(r.order, ids), hidden: r.hidden }; });
  const order = merge(s.order, ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const save = (n: Saved) => { setS(n); write(n); };
  const shown = order.filter(id => !s.hidden.includes(id));

  /** The index among the shown sections the pointer is over (before the section whose middle is below it). */
  const indexAt = (y: number) => {
    const els = [...(box.current?.querySelectorAll<HTMLElement>(':scope > [data-arrange]') ?? [])];
    const i = els.findIndex(el => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return i < 0 ? els.length : i;
  };
  const grip = (id: string) => ({
    onPointerDown(e: RPointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      setDragging(id);
      const moveTo = (ev: PointerEvent) => setDrop(indexAt(ev.clientY));
      const up = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', moveTo); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        const at = indexAt(ev.clientY), from = shown.indexOf(id);
        setDragging(null); setDrop(null);
        if (ev.type === 'pointerup' && at !== from && at !== from + 1) {
          // a place among the shown sections, as a place in the whole order
          const target = at >= shown.length ? order.length : order.indexOf(shown[at]);
          save({ ...s, order: move(order, id, target > order.indexOf(id) ? target - 1 : target) });
        }
      };
      el.addEventListener('pointermove', moveTo); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    },
    onKeyDown(e: React.KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const i = shown.indexOf(id), j = e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (j < 0 || j >= shown.length) return;
      save({ ...s, order: move(order, id, order.indexOf(shown[j])) });
    },
  });
  const hide = (id: string) => save({ ...s, hidden: [...s.hidden, id] });

  return (
    <ArrangeCtx.Provider value={{ grip, hide, dragging }}>
      <div className="cp-arrange" ref={box}>
        {shown.map((id, i) => (
          <div key={id} data-arrange={id} className={`cp-arranged ${dragging === id ? 'is-dragging' : ''} ${drop === i && dragging && dragging !== id ? 'is-drop-before' : ''}`}>
            {kids.find(k => k.props.id === id)}
          </div>
        ))}
        {dragging && drop === shown.length && <div className="cp-drop-end" />}
      </div>
      {(s.hidden.length > 0 || s.order.length > 0) && (
        <div className="cp-arrange-foot">
          {s.hidden.filter(id => ids.includes(id)).map(id => (
            <button key={id} type="button" onClick={() => save({ ...s, hidden: s.hidden.filter(x => x !== id) })}>SHOW {titles[id] ?? id}</button>
          ))}
          <button type="button" onClick={() => save({ order: [], hidden: [] })}>RESET LAYOUT</button>
        </div>
      )}
    </ArrangeCtx.Provider>
  );
}
