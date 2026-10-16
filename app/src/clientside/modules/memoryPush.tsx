// SPDX-License-Identifier: MIT
// The memory push — the mindX edition's module (only where browseml-host.json names a `memory` host): this browser's
// .memory, as gitmind keeps it (GITMIND: every change a commit), sent to where the host keeps memories. mindX stores each
// new note as a memory of the signed-in participant (gitmind_note), embeds it, and the rage atlas's memories search
// finds it — for that participant alone. Notes only: delivery records stay here. Nothing is sent until PUSH is pressed,
// or "push after each change" is turned on (off by default); the host's token goes only to its own same-origin paths.
import { useEffect, useState } from 'react';
import { Button, ToggleSwitch } from 'dreamknob';
import type { ModuleInfo } from './index';
import type { ModuleWindowProps } from '../../core/modules';
import { host, type MemoryHost } from '../host';
import { onGitmind, versions } from '../gitmindStore';
import type { Version } from '../../bankml/gitmind';

const AUTO = 'browseml:memory-push-auto', LAST = 'browseml:memory-push-last';
const token = (m: MemoryHost) => { try { return localStorage.getItem(m.token) || ''; } catch { return ''; } };
const autoOn = () => { try { return localStorage.getItem(AUTO) === '1'; } catch { return false; } };

/** What is sent for a version: its head commit and its notes (typed and response; delivery records stay here). */
export function payload(v: Version, source = 'browseml'): { source: string; head: string; notes: { text: string; at?: string; kind?: string }[] } {
  const notes: { text: string; at?: string; kind?: string }[] = [];
  for (const l of v.text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const n = JSON.parse(l) as { text?: unknown; at?: unknown; source?: { kind?: unknown } };
      const kind = typeof n.source?.kind === 'string' ? n.source.kind : 'typed';
      if (typeof n.text === 'string' && n.text.trim() && kind !== 'delivery') notes.push({ text: n.text, ...(typeof n.at === 'string' ? { at: n.at } : {}), kind });
    } catch { /* not a note */ }
  }
  return { source, head: v.commit, notes };
}

export async function push(m: MemoryHost, v: Version): Promise<{ ok: boolean; text: string }> {
  const t = token(m);
  if (!t) return { ok: false, text: 'sign in to push' };
  try {
    const r = await fetch(m.push, { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload(v)) });
    if (r.status === 401 || r.status === 403) return { ok: false, text: 'sign in to push' };
    if (!r.ok) return { ok: false, text: `the host says ${r.status}` };
    const j = await r.json() as { new?: number; held_already?: number };
    const text = `${v.commit.slice(0, 7)}: ${j.new ?? 0} new, ${j.held_already ?? 0} already held`;
    try { localStorage.setItem(LAST, JSON.stringify({ head: v.commit, text, at: Date.now() })); } catch { /* storage off */ }
    return { ok: true, text };
  } catch (e) { return { ok: false, text: String((e as Error).message || e) }; }
}

// push after each change, when turned on: the newest version once
let pushedHead = '';
function autoPush() {
  const m = host().memory;
  if (!m || !autoOn()) return;
  void versions().then(vs => { const v = vs[vs.length - 1]; if (v && v.commit !== pushedHead) { pushedHead = v.commit; void push(m, v); } });
}

function PushBody(_: ModuleWindowProps) {
  const m = host().memory!;
  const [vs, setVs] = useState<Version[]>([]);
  const [auto, setAuto] = useState(autoOn);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(() => { try { const j = JSON.parse(localStorage.getItem(LAST) || 'null'); return j ? { ok: true, text: j.text } : null; } catch { return null; } });
  const [held, setHeld] = useState<{ notes?: number | null; embedded?: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void versions().then(setVs);
    const t = token(m);
    if (t) void fetch(m.ingested, { credentials: 'omit', headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null)).then(setHeld).catch(() => setHeld(null));
  };
  useEffect(() => { refresh(); return onGitmind(refresh); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const head = vs[vs.length - 1];
  const n = head ? payload(head).notes.length : 0;
  return (
    <div className="mp">
      <dl>
        <div className="cp-row"><dt>this browser</dt><dd>{head ? <><code>{head.commit.slice(0, 7)}</code> · {n} note{n === 1 ? '' : 's'}</> : 'no version yet (GITMIND)'}</dd></div>
        <div className="cp-row"><dt>{m.label} holds</dt><dd>{held ? `${held.notes ?? '—'} notes · ${held.embedded ?? '—'} embedded` : token(m) ? 'reading…' : 'sign in to see'}</dd></div>
        {said && <div className="cp-row"><dt>last push</dt><dd className={said.ok ? 'is-ok' : 'is-bad'}>{said.text}</dd></div>}
      </dl>
      <div className="cp-limits"><ToggleSwitch on={auto} color="#F7931A" label="push after each change"
        onChange={v => { try { localStorage.setItem(AUTO, v ? '1' : '0'); } catch { /* storage off */ } setAuto(v); }} /></div>
      <div className="cp-buttons">
        <Button color="#0ECB81" disabled={busy || !head || !n} onClick={() => { setBusy(true); void push(m, head!).then(r => { setSaid(r); setBusy(false); refresh(); }); }}>
          {busy ? 'PUSHING…' : `PUSH TO ${m.label}`}</Button>
        {!token(m) && m.signin && <a className="atl-act" href={m.signin}>sign in</a>}
      </div>
      <p className="cp-fine">Sends this browser's .memory notes (not delivery records) and its gitmind head to {m.label}, where they become your
        memories: kept once each, embedded there, found by the rage atlas's memories search — yours alone. Nothing is sent until you press PUSH or turn on
        "push after each change".</p>
    </div>
  );
}

export const memoryPushModule: ModuleInfo = {
  id: 'memory-push', label: 'memory push', when: () => !!host().memory,
  note: "the mindX edition's: this browser's gitmind .memory pushed to where the host keeps memories (only on such a host)",
  make() {
    onGitmind(autoPush);
    return { id: 'memory-push', label: 'memory push',
      windows: [{ id: 'memory-push', file: `⇪ ${host().memory?.label ?? 'host'} memory`, icon: '⇪', summary: "Push this browser's .memory to the host's memories",
        Body: PushBody }] };
  },
};
