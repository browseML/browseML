// SPDX-License-Identifier: MIT
// HOST: what the site serving browseML adds, read once from browseml-host.json beside the page. Absent (the usual
// case: browseML on its own), nothing changes. mindx.pythai.net serves one that makes mindX the persona a first visit
// starts with and docks the mindX docs atlas (Atlas.tsx), searched through the host's own pgvectorscale store.
//   { "persona": "mindx",
//     "atlas": { "label": "mindX docs", "api": "/atlas/docs", "search": "/atlas/docs/search", "doc": "/doc/",
//                "token": "mindx_realm_token", "signin": "/activity?from=/bankml/app.html" } }
// The token is read from this origin's localStorage under that key (the host's own sign-in puts it there) and sent
// only to the host's own paths: they must be same-origin paths, so it can never be sent anywhere else.

export interface AtlasHost { label: string; api: string; search: string; doc: string; token: string; signin?: string }
/** Where a host keeps memories, for its edition's memory push (mindX: /gitmind/ingest, /gitmind/ingested). */
export interface MemoryHost { label: string; push: string; ingested: string; token: string; signin?: string }
export interface Host { persona?: string; atlas?: AtlasHost; memory?: MemoryHost }

const local = (u: unknown): u is string => typeof u === 'string' && u.startsWith('/') && !u.startsWith('//');

/** A host file read: only what is well formed is kept (an atlas whose paths are not same-origin is dropped). */
export function parseHost(x: unknown): Host {
  if (!x || typeof x !== 'object') return {};
  const o = x as Record<string, unknown>, h: Host = {};
  if (typeof o.persona === 'string' && /^[\w-]{1,40}$/.test(o.persona)) h.persona = o.persona;
  const a = o.atlas as Record<string, unknown> | undefined;
  if (a && local(a.api) && local(a.search) && local(a.doc) && typeof a.token === 'string' && a.token) {
    h.atlas = { label: typeof a.label === 'string' && a.label ? a.label : 'docs', api: a.api, search: a.search, doc: a.doc, token: a.token,
      ...(local(a.signin) ? { signin: a.signin } : {}) };
  }
  const m = o.memory as Record<string, unknown> | undefined;
  if (m && local(m.push) && local(m.ingested) && typeof m.token === 'string' && m.token) {
    h.memory = { label: typeof m.label === 'string' && m.label ? m.label : 'host', push: m.push, ingested: m.ingested, token: m.token,
      ...(local(m.signin) ? { signin: m.signin } : {}) };
  }
  return h;
}

let current: Host = {};
const fns = new Set<() => void>();
/** The host file, read once per visit (no file, or a broken one: {}). */
export const hostReady: Promise<Host> = (typeof fetch === 'function'
  ? fetch('browseml-host.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
  : Promise.resolve({})).then(x => { current = parseHost(x); fns.forEach(f => f()); return current; });
export const host = () => current;
export const onHost = (f: () => void) => { fns.add(f); return () => { fns.delete(f); }; };
