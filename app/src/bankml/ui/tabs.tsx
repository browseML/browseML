// SPDX-License-Identifier: MIT
// Who answers, as tabs at the top of the conversation area: a real tablist (role=tab, arrow keys, Home/End, the active
// tab in bitcoin orange), a horizontally scrollable strip on a phone that never widens the page. And the Hugging Face
// tab's credentials section, drawn by the separate GPL-3.0-only credential module when the page loaded it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Engine } from '../engine';
import { TAB } from '../answerers';
import { creds, loadCreds, type BankmlCreds, type CredsStatus } from '../credsBridge';

export function AnswererTabs({ offered, active, choose, idBase = 'bk-tab', label = 'Who answers' }: {
  offered: readonly Engine[]; active: Engine; choose(e: Engine): void; idBase?: string; label?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  // the chosen tab stays in view in a scrolled strip (a phone), however it was chosen: only the strip scrolls, never
  // the page (scrollIntoView would also move the page to the strip when a card further down chose the tab)
  useEffect(() => {
    const t = refs.current[active], s = t?.parentElement;
    if (!t || !s || s.scrollWidth <= s.clientWidth) return;
    const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect();
    if (tr.left < sr.left) s.scrollLeft -= sr.left - tr.left + 8;
    else if (tr.right > sr.right) s.scrollLeft += tr.right - sr.right + 8;
  }, [active]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = offered.indexOf(active);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % offered.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + offered.length) % offered.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = offered.length - 1;
    if (j < 0) return;
    e.preventDefault();
    choose(offered[j]);
    refs.current[offered[j]]?.focus();
  };
  return (
    <div className="bk-tabs" role="tablist" aria-label={label}>
      {offered.map(e => (
        <button key={e} ref={el => { refs.current[e] = el; }} type="button" role="tab" id={`${idBase}-${e}`}
          aria-selected={e === active} aria-controls={`${idBase}-panel`} tabIndex={e === active ? 0 : -1}
          className={`bk-tab ${e === active ? 'is-active' : ''}`} onClick={() => choose(e)} onKeyDown={onKey}>
          {TAB[e]}
        </button>
      ))}
    </div>
  );
}

/** The credential module's status, live (null: not loaded on this page). */
export function useCreds(): { api: BankmlCreds | null; status: CredsStatus | null; loading: boolean } {
  const [api, setApi] = useState<BankmlCreds | null>(creds);
  const [loading, setLoading] = useState(!creds());
  const [, tick] = useState(0);
  useEffect(() => {
    if (api) return api.onChange(() => tick(n => n + 1));
    let live = true;
    void loadCreds().then(c => { if (live) { setApi(c); setLoading(false); } });
    return () => { live = false; };
  }, [api]);
  return { api, status: api ? api.status() : null, loading };
}

/** "Your credentials": the module's own panel, or why there is none. */
export function CredsSection() {
  const { api, loading } = useCreds();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { if (api && host.current) return api.mountPanel(host.current); }, [api]);
  if (!api) {
    return (
      <p className="bk-fine">
        {loading ? 'Loading the credential module…' : 'The credential module (bankml-creds.js) is not on this page: no Hugging Face sign-in is offered here. Everything else works without it.'}
      </p>
    );
  }
  return <div ref={host} className="bk-creds" />;
}
