// SPDX-License-Identifier: MIT
// Models already on this computer, in folders the visitor grants. Read-only, on the visitor's word: a folder chosen
// with the File System Access API (showDirectoryPicker) — its handle kept in this browser's IndexedDB when the visitor
// turns persistent access on, so the next visit can reconnect — or, where that API is missing or off (Firefox, Safari,
// Brave by default), a folder input for this visit only. Nothing is uploaded; files are read where they are.
//
// Recognised:
//   · *.gguf anywhere (bankML's .models, LM Studio, llama.cpp, GPT4All, a download): by size, then by sha256
//   · content-addressed blobs whose name is their sha256 — Ollama's blobs/sha256-<hex>, the Hugging Face cache's
//     blobs/<hex> — recognised by name at once (bankML still checks the hash when it opens the file)
// The pure parts (what a file is, which one browseML can run) are exported for tests.

export interface FoundFile {
  /** Path inside the granted folder, e.g. ["models", "blobs", "sha256-…"]. */
  path: string[];
  name: string;
  size: number;
  kind: 'gguf' | 'blob';
  /** The sha256 the file's name claims (content-addressed blobs). */
  named?: string;
  /** How to read it: a handle (File System Access) or the File itself (folder input). */
  handle?: FileSystemFileHandle;
  file?: File;
}

export type Verdict = 'named' | 'size' | 'other';
/** What a found file is to browseML: named by its pinned sha256 (recognised), the pinned size (hash to be sure),
 *  or another model (listed, not run here). */
export function classify(f: { size: number; named?: string }, model: { bytes: number; sha256: string }): Verdict {
  if (f.named && f.named.toLowerCase() === model.sha256.toLowerCase() && f.size === model.bytes) return 'named';
  if (f.size === model.bytes) return 'size';
  return 'other';
}

const MIN = 8 << 20;          // smaller than 8 MB: not a model
const SKIP = new Set(['node_modules', '.git', '.cache-tmp', 'target', '__pycache__', '.Trash']);
const HEX64 = /^(?:sha256[-:])?([0-9a-f]{64})$/i;

/** Is this file a model to list: a .gguf, or a large blob named by a sha256. Pure. */
export function asModel(name: string, size: number): { kind: 'gguf' | 'blob'; named?: string } | null {
  if (size < MIN) return null;
  if (/\.gguf$/i.test(name)) return { kind: 'gguf' };
  const m = name.match(HEX64);
  return m ? { kind: 'blob', named: m[1].toLowerCase() } : null;
}

export interface ScanLimits { depth?: number; entries?: number }
/** Walk a granted folder (read-only) for models; bounded in depth and entries. */
export async function scan(dir: FileSystemDirectoryHandle, { depth = 6, entries = 20000 }: ScanLimits = {}): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  let seen = 0;
  const walk = async (d: FileSystemDirectoryHandle, path: string[], left: number) => {
    // values() is the async iterator every File System Access implementation has
    for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (++seen > entries) return;
      if (h.kind === 'directory') {
        if (left > 0 && !SKIP.has(h.name)) await walk(h as FileSystemDirectoryHandle, [...path, h.name], left - 1);
        continue;
      }
      const fh = h as FileSystemFileHandle;
      let file: File;
      try { file = await fh.getFile(); } catch { continue; }
      const m = asModel(fh.name, file.size);
      if (m) out.push({ path: [...path, fh.name], name: fh.name, size: file.size, ...m, handle: fh });
    }
  };
  await walk(dir, [], depth);
  return out;
}

/** The same, from a folder input's files (webkitdirectory): for this visit only. */
export function fromFileList(files: FileList | File[]): FoundFile[] {
  const out: FoundFile[] = [];
  for (const f of Array.from(files)) {
    const m = asModel(f.name, f.size);
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (m) out.push({ path: rel.split('/'), name: f.name, size: f.size, ...m, file: f });
  }
  return out;
}

export const canPickFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Ask the visitor for a folder (read-only). */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const w = window as unknown as { showDirectoryPicker(o?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle> };
  return w.showDirectoryPicker({ id: 'browseml-models', mode: 'read' });
}

type Perm = 'granted' | 'prompt' | 'denied';
type WithPerm = FileSystemHandle & { queryPermission?(o: { mode: 'read' }): Promise<Perm>; requestPermission?(o: { mode: 'read' }): Promise<Perm> };
/** Whether a kept folder may be read now ('granted'), needs a press to reconnect ('prompt'), or was refused. */
export async function permission(h: FileSystemHandle): Promise<Perm> {
  try { return (await (h as WithPerm).queryPermission?.({ mode: 'read' })) ?? 'granted'; } catch { return 'denied'; }
}
/** Ask again (must come from a press). */
export async function reconnect(h: FileSystemHandle): Promise<Perm> {
  try { return (await (h as WithPerm).requestPermission?.({ mode: 'read' })) ?? 'granted'; } catch { return 'denied'; }
}

// ── persistent access: folder handles kept in IndexedDB (only when the visitor turns it on) ──────────────────────
export interface KeptFolder { id: string; name: string; handle: FileSystemDirectoryHandle; added: number; model?: string[] }
const DB = 'browseml-folders', STORE = 'folders';
function db(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, bad) => { const r = f(d.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
}
export async function keptFolders(): Promise<KeptFolder[]> { try { return await tx('readonly', s => s.getAll() as IDBRequest<KeptFolder[]>); } catch { return []; } }
export async function keepFolder(f: KeptFolder): Promise<void> { await tx('readwrite', s => s.put(f)); }
export async function forgetFolder(id: string): Promise<void> { await tx('readwrite', s => s.delete(id)); }
export async function forgetAllFolders(): Promise<void> { await tx('readwrite', s => s.clear()); }

/** The file at a kept path inside a granted folder (the model found there last time), or null. */
export async function fileAt(dir: FileSystemDirectoryHandle, path: string[]): Promise<File | null> {
  try {
    let d = dir;
    for (const p of path.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return await (await d.getFileHandle(path[path.length - 1])).getFile();
  } catch { return null; }
}
