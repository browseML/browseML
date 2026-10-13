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

/** `tab`: 'shelved' shows the edge tab only after the panel was shelved; 'always' whenever it is closed, so it opens
 *  with no input field on screen. */
export function Shelves({ store, top, title = 'menu', tab = 'shelved' }: { store: ShelvesStore; top?: ReactNode; title?: string; tab?: 'shelved' | 'always' }) {
  const uif = useUIF();
  const { registry } = uif;
  useRegistryVersion(registry);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [peek, setPeek] = useState(false);
  const open = !!state.shown || peek;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => store.set(s => {
    const on = typeof v === 'function' ? v(!!s.shown) : v;
    return { ...s, shown: on, shelved: on ? false : s.shelved };
  });
  /** The toggle in the top-right corner: closed to the shelf (a tab on the left edge), not gone. */
  const shelve = () => { setPeek(false); store.set(s => ({ ...s, shown: false, shelved: true })); };
  // the right edge resizes the panel (kept)
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = state.width ?? 340;
    const move = (m: PointerEvent) => store.set(s => ({ ...s, width: Math.max(240, Math.min(720, Math.round(w0 + m.clientX - x0))) }));
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  const [adding, setAdding] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ action: Action; x: number; y: number } | null>(null);

  // a button dragged off the field: the sidebar appears, to take it
  useEffect(() => onDragOff(off => { if (off && !store.get().shown) store.set(s => ({ ...s, shown: true, shelved: false })); }), [store]);
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
          case 'close': shelve(); return;
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
      {!open && (state.shelved || tab === 'always') && (
        // the shelf: hover peeks the panel open, a press (or touch) pins it open
        <button type="button" className="uif-shelves-tab" aria-label={`Open the ${title}`} title={`${title}: hover to look, press to open`}
          onMouseEnter={() => setPeek(true)} onClick={() => setOpen(true)}>
          <span>{title}</span>
        </button>
      )}
      <aside className={`uif-shelves ${open ? 'is-open' : ''} ${peek && !state.shown ? 'is-peek' : ''}`} aria-label={title}
        style={open ? { ['--uif-shelves-width' as string]: `${state.width ?? 340}px` } : undefined}
        onMouseLeave={() => { if (peek && !state.shown) setPeek(false); }}
        data-uif-shelf-fallback={open ? SIDEBAR : undefined}>
        {open && (
          <div className="uif-shelves-head">
            <b>{title}</b>
            <button type="button" role="switch" aria-checked={!!state.shown} className={`uif-shelves-switch ${state.shown ? 'is-on' : ''}`}
              onClick={() => (state.shown ? shelve() : setOpen(true))}
              title={state.shown ? 'switch off: shelve it to the left edge (hover or touch the tab to open it again)' : 'switch on: keep it open'}>
              <span />
            </button>
          </div>
        )}
        {open && <div className="uif-shelves-resize" onPointerDown={resize} role="separator" aria-orientation="vertical" aria-label="Resize the panel" title="drag to resize" />}
        {open && top}
        {open && state.shelves.map(sh => (
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
