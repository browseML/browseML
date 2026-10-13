// SPDX-License-Identifier: MIT
// The shelves on screen (core/shelves.ts): a sidebar at the left edge — the page's own content first (`top`), then
// the menu and the button panels the visitor adds. It is not there at first: it appears the moment a button is
// dragged off the field (somewhere to drop it) and stays until ✕ hides it (the shelves keep their buttons). Drop a button from the bar (hold it, drag) or a floating one on a shelf and it goes there; press a
// shelved button to run it; drag it to another shelf, back onto the bar, or anywhere on the screen to float it.
// + on a shelf adds any button to it; "+ panel" adds a panel; a panel's title renames on double-click; ✕ removes the
// panel and puts its buttons back on the bar. T mode: `shelf`. Render it inside the UltimateBar (it uses useUIF).
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUIF, useRegistryVersion } from './UIFContext';
import { insertionIndex } from '../hooks/usePressHoldDrag';
import {
  SIDEBAR, addPanel, onDragOff, removePanel, renameShelf, setShelfDrop, shelfAt, shelfOf, shelfPut, shelfTake, type ShelvesStore,
} from '../core/shelves';
import type { Action } from '../core/actions';

const SLOP = 5;

export function Shelves({ store, top }: { store: ShelvesStore; top?: ReactNode }) {
  const uif = useUIF();
  const { registry } = uif;
  useRegistryVersion(registry);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const open = !!state.shown;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => store.set(s => ({ ...s, shown: typeof v === 'function' ? v(!!s.shown) : v }));
  const [adding, setAdding] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ action: Action; x: number; y: number } | null>(null);

  // a button dragged off the field: the sidebar appears, to take it
  useEffect(() => onDragOff(off => { if (off && !store.get().shown) store.set(s => ({ ...s, shown: true })); }), [store]);
  // the bar and floating buttons drop here
  useEffect(() => {
    setShelfDrop((id, shelf, index) => store.set(s => shelfPut(s, id, shelf, index) ?? s));
    return () => setShelfDrop(null);
  }, [store]);
  // a button put back on the bar or floated (+, a profile, a command) leaves its shelf: one place per button
  useEffect(() => {
    const on = registry.visible().map(a => a.id).concat(registry.floating().map(f => f.action.id));
    const stray = on.filter(id => shelfOf(store.get(), id));
    if (stray.length) store.set(s => stray.reduce(shelfTake, s));
  });
  // `shelf` in T mode
  const live = useRef({ store, registry });
  live.current = { store, registry };
  useEffect(() => {
    registry.register({
      id: 'shelf', label: 'Shelves', command: 'shelf', aliases: ['shelves', 'panels'], icon: '☰', defaultHidden: true,
      description: 'shelf [list|open|close|panel <title>|put <command> [shelf]|take <command>|remove <panel>] - the sidebar menu and button panels; drag buttons onto them',
      run(ctx) {
        const { store: st, registry: reg } = live.current;
        const [sub, a, ...rest] = ctx.args;
        const find = (c?: string) => (c ? reg.find(c) ?? reg.get(c) : undefined);
        switch (sub) {
          case undefined: case 'list':
            st.get().shelves.forEach(sh => ctx.print(`${sh.id} (${sh.title}): ${sh.ids.map(id => reg.get(id)?.command ?? id).join(' ') || 'empty'}`));
            return;
          case 'open': setOpen(true); return;
          case 'close': setOpen(false); return;
          case 'panel': {
            let made = '';
            st.set(s => { const r = addPanel(s, [a, ...rest].filter(Boolean).join(' ')); made = r.id; return r.state; });
            setOpen(true);
            return ctx.print(`added ${made}: drag buttons onto it, or shelf put <command> ${made}`);
          }
          case 'put': {
            const act = find(a), to = rest[0] ?? SIDEBAR;
            if (!act) return ctx.print(`shelf put: no button "${a ?? ''}"`, 'err');
            const n = shelfPut(st.get(), act.id, to);
            if (!n) return ctx.print(`shelf put: no shelf "${to}" (shelf list)`, 'err');
            reg.hide(act.id); st.set(() => n);
            return ctx.print(`${act.command} is on ${to}`);
          }
          case 'take': {
            const act = find(a);
            if (!act || !shelfOf(st.get(), act.id)) return ctx.print(`shelf take: "${a ?? ''}" is on no shelf`, 'err');
            st.set(s => shelfTake(s, act.id)); reg.dockAt(act.id);
            return ctx.print(`${act.command} is back on the bar`);
          }
          case 'remove': {
            const r = removePanel(st.get(), a ?? '');
            if (!r) return ctx.print(`shelf remove: no panel "${a ?? ''}" (the sidebar stays)`, 'err');
            st.set(() => r.state); r.freed.forEach(id => reg.dockAt(id));
            return ctx.print(`removed ${a}; its buttons are back on the bar`);
          }
          default: return ctx.print('shelf list · open · close · panel <title> · put <command> [shelf] · take <command> · remove <panel>', 'err');
        }
      },
    });
    return () => registry.unregister('shelf');
  }, [registry]);

  /** Press a shelved button: a click runs it; a drag moves it (shelf, bar, or the screen). */
  const press = (e: React.PointerEvent, action: Action) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY, el = e.currentTarget as HTMLElement;
    let dragging = false;
    const move = (m: PointerEvent) => {
      if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < SLOP) return;
      if (!dragging) { dragging = true; el.dataset.dragging = ''; }
      setGhost({ action, x: m.clientX, y: m.clientY });
    };
    const up = (u: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      delete el.dataset.dragging;
      setGhost(null);
      if (!dragging) { if (u.type === 'pointerup') uif.runAction(action.id); return; }
      const sh = shelfAt(u.clientX, u.clientY);
      if (sh) { store.set(s => shelfPut(s, action.id, sh.id, sh.index) ?? s); return; }
      const bar = document.elementsFromPoint(u.clientX, u.clientY).map(n => (n as HTMLElement).closest?.('.uif-actionbar') as HTMLElement | null).find(Boolean);
      store.set(s => shelfTake(s, action.id));
      if (bar) registry.dockAt(action.id, insertionIndex(bar, u.clientX, u.clientY));
      else registry.float(action.id, { x: Math.max(4, u.clientX - 20), y: Math.max(4, u.clientY - 20) });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };

  const all = registry.all();
  const item = (id: string, menu: boolean) => {
    const a = registry.get(id);
    if (!a) return null;
    return (
      <button key={id} type="button" data-uif-shelf-item className={`uif-shelf-item ${menu ? 'is-menu' : ''}`}
        title={`${a.label} (${a.command}) — press to run; drag to the bar, another shelf, or anywhere`}
        aria-label={a.label} onPointerDown={e => press(e, a)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); uif.runAction(a.id); } }}>
        <span className="uif-shelf-icon" aria-hidden="true">{a.icon ?? a.label.slice(0, 1)}</span>
        {menu && <span className="uif-shelf-label">{a.label}</span>}
      </button>
    );
  };
  const adder = (shelf: string) => adding === shelf && (
    <select className="uif-shelf-add" autoFocus aria-label="Add a button to this shelf" defaultValue=""
      onBlur={() => setAdding(null)}
      onChange={e => {
        const id = e.target.value;
        if (id) { registry.hide(id); store.set(s => shelfPut(s, id, shelf) ?? s); }
        setAdding(null);
      }}>
      <option value="" disabled>add a button…</option>
      {all.filter(a => shelfOf(state, a.id) !== shelf).map(a => <option key={a.id} value={a.id}>{a.icon ? `${a.icon} ` : ''}{a.label} ({a.command})</option>)}
    </select>
  );

  return (
    <>
      <aside className={`uif-shelves ${open ? 'is-open' : ''}`} aria-label="Sidebar menu and button panels"
        data-uif-shelf-fallback={open ? SIDEBAR : undefined}>
        {open && (
          <button type="button" className="uif-shelves-close" onClick={() => setOpen(false)} aria-label="Hide the sidebar"
            title="hide the sidebar — it comes back when a button is dragged off the field (or: shelf open)">✕</button>
        )}
        {open && state.shelves.map((sh, i) => (
          <Fragment key={sh.id}>
          <section className={`uif-shelf ${sh.id === SIDEBAR ? 'is-menu' : 'is-panel'}`} data-uif-shelf={sh.id} aria-label={sh.title}>
            <header>
              {renaming === sh.id
                ? <input autoFocus defaultValue={sh.title} aria-label="Panel title" maxLength={40}
                    onBlur={e => { store.set(s => renameShelf(s, sh.id, e.target.value)); setRenaming(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                : <h3 onDoubleClick={() => sh.id !== SIDEBAR && setRenaming(sh.id)} title={sh.id === SIDEBAR ? '' : 'double-click to rename'}>{sh.title}</h3>}
              <button type="button" className="uif-shelf-btn" aria-label={`Add a button to ${sh.title}`} title="add a button" onClick={() => setAdding(sh.id)}>+</button>
              {sh.id !== SIDEBAR && (
                <button type="button" className="uif-shelf-btn" aria-label={`Remove the panel ${sh.title}`} title="remove the panel (its buttons go back to the bar)"
                  onClick={() => { const r = removePanel(store.get(), sh.id); if (r) { store.set(() => r.state); r.freed.forEach(id => registry.dockAt(id)); } }}>✕</button>
              )}
            </header>
            {adder(sh.id)}
            <div className="uif-shelf-items">
              {sh.ids.map(id => item(id, sh.id === SIDEBAR))}
              {!sh.ids.length && <p className="uif-shelf-empty">drop buttons here</p>}
            </div>
          </section>
          {/* the page's own content comes right after the menu (the menu stays a short drop strip at the top) */}
          {i === 0 && top}
          </Fragment>
        ))}
        {open && <button type="button" className="uif-shelf-newpanel" onClick={() => store.set(s => addPanel(s).state)}>+ panel</button>}
      </aside>
      {ghost && createPortal(
        <div className="uif-shelf-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">{ghost.action.icon ?? ghost.action.label.slice(0, 1)}</div>,
        document.body,
      )}
    </>
  );
}
