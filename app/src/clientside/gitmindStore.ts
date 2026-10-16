// SPDX-License-Identifier: MIT
// GITMIND's store in this browser: .memory's versions and gitmind's ledger, in IndexedDB (browseml-gitmind), and the
// tracker that commits a version whenever .memory changes — one at a time, in order. Versions are kept until the visitor
// forgets them; the git objects are not stored (each version keeps its text) and are rebuilt, id for id, for an export.
import { bundle, ledgerEvent, nextVersion, objectsOf, type LedgerEvent, type Version } from '../bankml/gitmind';

const DB = 'browseml-gitmind', ON = 'browseml:gitmind';
const fns = new Set<() => void>();
export const onGitmind = (f: () => void) => { fns.add(f); return () => { fns.delete(f); }; };
const changed = () => fns.forEach(f => f());

/** Versions are kept unless the visitor turned them off. */
export const gitmindOn = () => { try { return localStorage.getItem(ON) !== '0'; } catch { return true; } };
export const setGitmindOn = (on: boolean) => { try { localStorage.setItem(ON, on ? '1' : '0'); } catch { /* storage off */ } changed(); };

function open(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('versions', { keyPath: 'n' }); r.result.createObjectStore('ledger', { autoIncrement: true }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });

export async function versions(): Promise<Version[]> {
  try { const db = await open(); return await req(db.transaction('versions').objectStore('versions').getAll() as IDBRequest<Version[]>); } catch { return []; }
}
export async function ledger(): Promise<LedgerEvent[]> {
  try { const db = await open(); return await req(db.transaction('ledger').objectStore('ledger').getAll() as IDBRequest<LedgerEvent[]>); } catch { return []; }
}
async function put(v: Version, e: LedgerEvent) {
  const db = await open();
  const t = db.transaction(['versions', 'ledger'], 'readwrite');
  t.objectStore('versions').put(v);
  t.objectStore('ledger').add(e);
  await new Promise<void>((ok, bad) => { t.oncomplete = () => ok(); t.onerror = () => bad(t.error); });
}
/** Every version and the ledger removed (the next change starts a new history). */
export async function forgetVersions() {
  try { const db = await open(); const t = db.transaction(['versions', 'ledger'], 'readwrite'); t.objectStore('versions').clear(); t.objectStore('ledger').clear(); } catch { /* off */ }
  changed();
}

/** Where this .memory lives: the origin (this store is per origin, so the source — and every commit id — is stable). */
export const source = () => `browseML ${location.origin}\n`;
let queue: Promise<unknown> = Promise.resolve();
let restoring: Version | null = null;
/** Say that the next change of .memory is a restore of `v` (so its commit says so). */
export const markRestore = (v: Version) => { restoring = v; };

/** Commit .memory's text if it changed since the last version. In order: a change waits for the one before it. */
export function track(text: string): Promise<Version | null> {
  const run = async () => {
    if (!gitmindOn() || typeof indexedDB === 'undefined') return null;
    const all = await versions(), prev = all.length ? all[all.length - 1] : null;
    const r = restoring && restoring.text === text ? restoring : null;
    restoring = null;
    const next = await nextVersion(prev, text, Date.now(), source(), r?.commit);
    if (!next) return null;
    await put(next.version, ledgerEvent(next.version, prev));
    changed();
    return next.version;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => null);
  return p;
}

/** The history as a git bundle, rebuilt from the versions (each checked to rebuild to its own commit). */
export async function exportBundle(): Promise<{ bytes: Uint8Array; head: string; count: number } | null> {
  const vs = await versions();
  if (!vs.length) return null;
  const head = vs[vs.length - 1].commit;
  return { bytes: await bundle(head, await objectsOf(vs, source())), head, count: vs.length };
}
/** gitmind's ledger, as .gitmind/ledger.jsonl. */
export async function exportLedger(): Promise<string> {
  return (await ledger()).map(e => JSON.stringify(e)).join('\n') + '\n';
}
