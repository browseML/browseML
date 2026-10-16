// SPDX-License-Identifier: MIT
// GITMIND, in the browser: browseML's .memory kept as a git history that gitmind (github.com/Professor-Codephreak/
// gitmind) and bankML's memgit read as their own. Every change to .memory is a commit — git's own objects (blob, tree,
// commit), git's own ids (SHA-1 over "<type> <size>\0<content>") — in the layout bankML's memgit gives each .memory:
//   browseml.memory   the notes, JSONL, as browseML keeps them
//   .gitignore        ".gitmind/" (gitmind's ledger stays beside the repository, not in it)
//   SOURCE            where this .memory lives
// and each change is a gitmind ledger event (kind "snapshot", transition advance / reset). A restore is a new commit
// (forward only, as memgit restores); history is never rewritten. The export is a real git bundle (v2: a packfile of
// zlib-deflated objects, SHA-1 trailer) that `git clone browseml-memory.bundle` reads; the ledger exports as
// .gitmind/ledger.jsonl. Nothing here leaves the browser unless the visitor saves a file.

export const FILE = 'browseml.memory';
export const IGNORE = '.gitmind/\n';
const AUTHOR = 'browseML .memory <memory@browseml.local>';
const enc = new TextEncoder();

// ---- git objects ------------------------------------------------------------------------------------------------
export type Kind = 'commit' | 'tree' | 'blob';
export interface GitObject { kind: Kind; body: Uint8Array; id: string }

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)));
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const sha1 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array(b)));

/** A git object and its id: SHA-1 over "<kind> <size>\0<body>", as `git hash-object` computes it. */
export async function object(kind: Kind, body: Uint8Array | string): Promise<GitObject> {
  const b = typeof body === 'string' ? enc.encode(body) : body;
  return { kind, body: b, id: hex(await sha1(concat([enc.encode(`${kind} ${b.length}\0`), b]))) };
}
/** A tree of files (mode 100644), entries sorted by name as git sorts them (bytes). */
export async function tree(files: { name: string; blob: string }[]): Promise<GitObject> {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return object('tree', concat(sorted.flatMap(f => [enc.encode(`100644 ${f.name}\0`), unhex(f.blob)])));
}
/** A commit: its tree, its parent (none for the first), one author and committer, a time in seconds (UTC). */
export function commitBody(treeId: string, parent: string | null, seconds: number, message: string): string {
  const who = `${AUTHOR} ${seconds} +0000`;
  return `tree ${treeId}\n${parent ? `parent ${parent}\n` : ''}author ${who}\ncommitter ${who}\n\n${message.trim()}\n`;
}

// ---- versions -----------------------------------------------------------------------------------------------------
export interface Version { n: number; at: number; text: string; subject: string; commit: string; tree: string; blob: string; parent: string | null }
export interface LedgerEvent { ts: number; kind: 'snapshot'; transition: 'advance' | 'reset'; head: string; prev_head: string | null; branch: 'main'; commit_count: number; subject: string }

/** The subject of a change, as memgit words them: notes added or removed, a restore, a clear. */
export function subjectFor(before: string, after: string, restoreOf?: string): string {
  if (restoreOf) return `restore ${FILE} to ${restoreOf.slice(0, 7)}`;
  const a = before.split('\n').filter(Boolean), b = after.split('\n').filter(Boolean);
  if (!b.length) return `clear ${FILE}`;
  const sa = new Set(a), sb = new Set(b);
  const added = b.filter(l => !sa.has(l)).length, removed = a.filter(l => !sb.has(l)).length;
  const parts = [added ? `add ${added} note${added === 1 ? '' : 's'}` : '', removed ? `remove ${removed} note${removed === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(', ') || `rewrite ${FILE}`;
}

/** The next version of .memory after `prev` (null: the first), as git objects; null when nothing changed. */
export async function nextVersion(prev: Version | null, text: string, at: number, source: string, restoreOf?: string):
  Promise<{ version: Version; objects: GitObject[] } | null> {
  if (prev && prev.text === text) return null;
  const blob = await object('blob', text), ign = await object('blob', IGNORE), src = await object('blob', source);
  const t = await tree([{ name: FILE, blob: blob.id }, { name: '.gitignore', blob: ign.id }, { name: 'SOURCE', blob: src.id }]);
  const subject = subjectFor(prev?.text ?? '', text, restoreOf);
  const c = await object('commit', commitBody(t.id, prev?.commit ?? null, Math.floor(at / 1000), subject));
  return { version: { n: (prev?.n ?? 0) + 1, at, text, subject, commit: c.id, tree: t.id, blob: blob.id, parent: prev?.commit ?? null }, objects: [blob, ign, src, t, c] };
}

/** The gitmind ledger event for a version (gitmind's snapshot(): advance when HEAD moves forward). */
export const ledgerEvent = (v: Version, prev: Version | null): LedgerEvent => ({
  ts: v.at / 1000, kind: 'snapshot', transition: prev ? 'advance' : 'reset', head: v.commit, prev_head: prev?.commit ?? null,
  branch: 'main', commit_count: v.n, subject: v.subject,
});

// ---- the bundle -------------------------------------------------------------------------------------------------
const TYPE: Record<Kind, number> = { commit: 1, tree: 2, blob: 3 };
async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([new Uint8Array(b)]).stream().pipeThrough(new CompressionStream('deflate'));  // 'deflate' is zlib (RFC 1950), as git wants
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function packHeader(kind: Kind, size: number): Uint8Array {
  const out: number[] = [];
  let c = (TYPE[kind] << 4) | (size & 15);
  size >>>= 4;
  while (size) { out.push(c | 0x80); c = size & 0x7f; size >>>= 7; }
  out.push(c);
  return Uint8Array.from(out);
}
/** A packfile (version 2, whole objects, no deltas) of these objects, each once. */
export async function pack(objects: GitObject[]): Promise<Uint8Array> {
  const seen = new Set<string>(), uniq = objects.filter(o => !seen.has(o.id) && seen.add(o.id));
  const head = new Uint8Array(12);
  head.set(enc.encode('PACK'), 0);
  new DataView(head.buffer).setUint32(4, 2);
  new DataView(head.buffer).setUint32(8, uniq.length);
  const parts: Uint8Array[] = [head];
  for (const o of uniq) parts.push(packHeader(o.kind, o.body.length), await deflate(o.body));
  const body = concat(parts);
  return concat([body, await sha1(body)]);
}
/** A git bundle (v2) of the history whose newest commit is `head`: `git clone` reads it, `git bundle verify` checks it. */
export async function bundle(head: string, objects: GitObject[]): Promise<Uint8Array> {
  return concat([enc.encode(`# v2 git bundle\n${head} refs/heads/main\n${head} HEAD\n\n`), await pack(objects)]);
}
/** Every object of a list of versions (oldest first), rebuilt from their texts: the bundle needs no stored objects. */
export async function objectsOf(versions: Version[], source: string): Promise<GitObject[]> {
  const out: GitObject[] = [];
  let prev: Version | null = null;
  for (const v of versions) {
    const r = await nextVersion(prev, v.text, v.at, source, v.subject.startsWith('restore ') ? v.subject.split(' to ')[1] : undefined);
    if (!r) continue;
    if (r.version.commit !== v.commit) throw new Error(`version ${v.n} does not rebuild to its commit (${v.commit.slice(0, 7)})`);
    out.push(...r.objects);
    prev = r.version;
  }
  return out;
}
