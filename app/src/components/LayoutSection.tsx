import React, { useRef, useState } from 'react';
import type { LayoutApi } from '../types';
import { PROFILE_EXTENSION, STANDARD_PROFILE } from '../core/profile';

/** The "Layout" part of the + palette: save, load, export and import `.profile` files, and reset. */
export function LayoutSection({ layout }: { layout: LayoutApi }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const names = layout.list();

  const attempt = (fn: () => string) => {
    try {
      setNote({ text: fn() });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    attempt(() => {
      const p = layout.save(name);
      setName('');
      return `saved "${p.name}"`;
    });
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    attempt(() => `imported and applied "${layout.importProfile(text, file.name)}"`);
  };

  return (
    <div className="uif-palette-layout" role="tabpanel">
      <div className="uif-palette-row">
        <strong>Layout</strong>
        <span className="uif-palette-active">{layout.active ? `active: ${layout.active}` : 'not saved yet'}</span>
      </div>
      {names.length > 0 && (
        <ul className="uif-palette-list">
          {names.map(n => (
            <li key={n} className={n === layout.active ? 'is-active' : ''}>
              <button type="button" className="uif-palette-item" title="Apply this layout" onClick={() => attempt(() => (layout.load(n), `loaded "${n}"`))}>
                <span>{n}</span>
                <code>{PROFILE_EXTENSION}</code>
              </button>
              <button type="button" className="uif-link" title={`Download ${n}${PROFILE_EXTENSION}`} onClick={() => attempt(() => (layout.exportProfile(n), `exported "${n}"`))}>
                ⤓
              </button>
              <button type="button" className="uif-link" title="Delete this layout" onClick={() => attempt(() => (layout.remove(n), `deleted "${n}"`))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="uif-palette-fields" onSubmit={save}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Save layout as…" aria-label="Layout name" className="uif-input" />
        <button type="submit" className="uif-button" disabled={!name.trim()}>Save</button>
      </form>
      <div className="uif-palette-fields">
        <button type="button" className="uif-button is-quiet" onClick={() => fileRef.current?.click()}>Import {PROFILE_EXTENSION}</button>
        <button type="button" className="uif-button is-quiet" onClick={() => attempt(() => (layout.exportProfile(), 'exported the current layout'))}>Export current</button>
        <button
          type="button"
          className="uif-button is-quiet"
          title="Put every button, the field and the strings back to the standard layout. Saved layouts are kept."
          onClick={() => attempt(() => (layout.reset(), `reset to the ${STANDARD_PROFILE} layout`))}
        >
          Reset
        </button>
      </div>
      <input ref={fileRef} type="file" accept={`${PROFILE_EXTENSION},application/json,.json`} hidden onChange={importFile} />
      {note && <p className={`uif-palette-note ${note.error ? 'is-error' : ''}`} role="status">{note.text}</p>}
    </div>
  );
}
