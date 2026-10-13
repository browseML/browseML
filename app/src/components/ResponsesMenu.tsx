// SPDX-License-Identifier: MIT
// The field's Responses menu: every response window at once — new, tile, cascade, call home, clear, close all — and
// the settings they share (text size, where answers go, open filling the screen). Each window also fills the screen
// on a double-click of its header (⤢), and shrinks back on another (or Esc).
import { useEffect, useRef, useState } from 'react';
import { useUIF } from './UIFContext';
import { responseSettings, type ResponseSettings } from '../core/responseSettings';

export function ResponsesMenu() {
  const { outputs } = useUIF();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(responseSettings.get());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => responseSettings.subscribe(setS), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const list = outputs.list();
  const n = list.length;
  const active = list.find(o => o.id === outputs.activeId);
  const act = (f: () => void) => () => { f(); setOpen(false); };
  const set = (c: Partial<ResponseSettings>) => responseSettings.set(c);
  const item = (label: string, hint: string, f: () => void, disabled = false, danger = false) => (
    <button type="button" role="menuitem" className={`uif-windows-item ${danger ? 'is-danger' : ''}`} disabled={disabled} onClick={act(f)}>
      <span className="uif-windows-file">{label}</span><span className="uif-windows-detail">{hint}</span>
    </button>
  );
  return (
    <div className="uif-windows-menu uif-responses-menu" ref={ref}>
      <button type="button" className={`uif-windows-toggle ${open ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Response windows (${n})`} title={`Response windows: ${n} open — tile, cascade, close all, settings`} onClick={() => setOpen(o => !o)}>
        ❏{n > 0 && <span className="uif-responses-count">{n}</span>}
      </button>
      {open && (
        <div className="uif-windows-list uif-responses-list" role="menu" aria-label="Response windows" onKeyDown={e => e.key === 'Escape' && setOpen(false)}>
          <div className="uif-menu-head">Response windows · {n} open</div>
          {item('New window', 'spawn', () => { const id = outputs.spawn(); if (s.openMaximized) outputs.maximize(id, true); })}
          {item('Tile', 'fill the screen, side by side', () => outputs.tile(), n === 0)}
          {item('Cascade', 'stacked, a step apart', () => outputs.cascade(), n === 0)}
          {item('Call all home', 'back beside the field', () => outputs.callHome('all'), n === 0)}
          {item(active?.maximized ? 'Shrink back' : 'Fill the screen', active ? `the active one: ${active.title}` : 'no active window',
            () => active && outputs.maximize(active.id), !active)}
          {item('Clear all', 'empty every window', () => outputs.clearAll(), n === 0)}
          {item('Close all', `${n} window${n === 1 ? '' : 's'}`, () => outputs.closeAll(), n === 0, true)}
          <div className="uif-menu-head">Settings</div>
          <div className="uif-menu-row" role="group" aria-label="Text size">
            <span>Text</span>
            {(['s', 'm', 'l', 'xl'] as const).map(k => (
              <button key={k} type="button" aria-pressed={s.textSize === k} className={s.textSize === k ? 'is-on' : ''} onClick={() => set({ textSize: k })}>{k.toUpperCase()}</button>
            ))}
          </div>
          <div className="uif-menu-row" role="group" aria-label="Answers go">
            <span>Answers</span>
            <button type="button" aria-pressed={s.answerIn === 'active'} className={s.answerIn === 'active' ? 'is-on' : ''} onClick={() => set({ answerIn: 'active' })}>active window</button>
            <button type="button" aria-pressed={s.answerIn === 'new'} className={s.answerIn === 'new' ? 'is-on' : ''} onClick={() => set({ answerIn: 'new' })}>new window each</button>
          </div>
          <label className="uif-menu-row uif-menu-check">
            <input type="checkbox" checked={s.openMaximized} onChange={e => set({ openMaximized: e.target.checked })} /> new windows fill the screen
          </label>
          <label className="uif-menu-row uif-menu-check" title="Off: the details are still kept in .memory and in the T-mode log (last)">
            <input type="checkbox" checked={s.details} onChange={e => set({ details: e.target.checked })} /> show delivery details under answers
          </label>
          <label className="uif-menu-row uif-menu-check" title="Off: ask from the input field. A window's ⋯ menu turns one on for that window.">
            <input type="checkbox" checked={s.replyField} onChange={e => set({ replyField: e.target.checked })} /> a reply field in every window
          </label>
          <div className="uif-menu-foot">double-click a window's header: fill the screen / shrink back · Esc shrinks · T mode: close all, tile, cascade, max</div>
        </div>
      )}
    </div>
  );
}
