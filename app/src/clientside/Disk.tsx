// SPDX-License-Identifier: MIT
// HARD DRIVE: what browseML keeps on this computer, and control of it — the browser's storage, a copy of the model on
// the disk (a chosen folder, else Downloads), a copy for a local bankML (the model and its FORK.json, ready for
// `bankml serve`), and removing them. With persistent access on, a saved folder is remembered: the next visit starts
// from it with no download, even after the browser's storage is cleared.
import { useEffect, useState } from 'react';
import { Button, IndicatorLamp, ToggleSwitch } from 'dreamknob';
import { askPersist, browseSettings, clearBrowseCache, downloadState, keptFiles, keptModel, onBrowseSettings, onDownload, persisted, setBrowseSettings, type KeptFile } from '../bankml/free';
import { canPickFolders, keepFolder } from '../bankml/folders';
import { mb } from '../bankml/caps';
import { getLimits, onLimits, setLimits } from './limits';
import { CacheReport } from './CacheReport';

const GREEN = '#0ECB81', ORANGE = '#F7931A', RED = '#F6465D';
const SAVED = 'browseml:disk-copy';
const FORK = 'browseML/Bonsai-1.7B-Q1_0.gguf.FORK.json';
interface Saved { where: string; name: string; bytes: number; at: number; how: 'folder' | 'downloads'; bankml?: boolean }
const readSaved = (): Saved | null => { try { return JSON.parse(localStorage.getItem(SAVED) || 'null'); } catch { return null; } };

type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;

/** Save one file: into `dir` (written, size checked), or to Downloads. */
async function put(dir: FileSystemDirectoryHandle | null, name: string, body: Response, bytes: number | null, say: Say): Promise<void> {
  if (!dir) {
    const url = URL.createObjectURL(await body.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return;
  }
  const fh = await dir.getFileHandle(name, { create: true });
  if (bytes !== null && (await fh.getFile()).size === bytes) return;  // already there
  let n = 0, shown = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({ transform(c, out) {
    n += c.byteLength; out.enqueue(c);
    if (bytes && n - shown > 16 << 20) { shown = n; say(`writing ${name}: ${mb(n)} / ${mb(bytes)}`, 'working'); }
  } });
  await body.body!.pipeThrough(count).pipeTo(await fh.createWritable());
  const size = (await fh.getFile()).size;
  if (bytes !== null && size !== bytes) throw new Error(`${name} is ${mb(size)}, not ${mb(bytes)}: try again`);
}

/** A copy of the kept model on the disk; for bankML, with its FORK.json beside it. */
export async function saveCopy(say: Say, forBankml = false): Promise<Saved | null> {
  const m = await keptModel();
  if (!m) { say('no model in this browser to copy', 'bad'); return null; }
  let dir: FileSystemDirectoryHandle | null = null;
  if (canPickFolders()) {
    const w = window as unknown as { showDirectoryPicker(o: { id: string; mode: 'readwrite' }): Promise<FileSystemDirectoryHandle> };
    try { dir = await w.showDirectoryPicker({ id: forBankml ? 'bankml-models' : 'browseml-models', mode: 'readwrite' }); }
    catch (e) { if ((e as Error).name !== 'AbortError') say(String((e as Error).message || e), 'bad'); return null; }
  }
  say(`saving ${m.name} (${mb(m.bytes)})…`, 'working');
  await put(dir, m.name, m.response, m.bytes, say);
  if (forBankml) {
    const f = await fetch(FORK);
    if (!f.ok) { say("the model's FORK.json did not load: reload the page", 'bad'); return null; }
    await put(dir, `${m.name}.FORK.json`, f, null, say);
  }
  if (dir && getLimits().rememberFolders) await keepFolder({ id: `${dir.name}-${Date.now()}`, name: dir.name, handle: dir, added: Date.now(), model: [m.name] });
  const saved: Saved = { where: `${dir ? dir.name : 'Downloads'}/${m.name}`, name: m.name, bytes: m.bytes, at: Date.now(), how: dir ? 'folder' : 'downloads', bankml: forBankml };
  try { localStorage.setItem(SAVED, JSON.stringify(saved)); } catch { /* storage off */ }
  say(`✓ saved: ${saved.where}${forBankml ? ` + FORK.json — bankml serve ${dir ? dir.name : 'Downloads'}/${m.name} --fork ${m.name}.FORK.json` : ''}`, 'ok');
  return saved;
}

export function Disk({ say }: { say: Say }) {
  const [, tick] = useState(0);
  const [kept, setKept] = useState<KeptFile[]>([]);
  const [keep, setKeep] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<Saved | null>(readSaved);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const limits = getLimits(), s = browseSettings(), dl = downloadState();
  const [stamp, setStamp] = useState(0);
  const refresh = () => { void keptFiles().then(setKept); void persisted().then(setKeep); setStamp(n => n + 1); };
  useEffect(() => {
    refresh();
    const a = onLimits(() => tick(n => n + 1)), b = onBrowseSettings(() => tick(n => n + 1));
    const c = onDownload(d => { tick(n => n + 1); if (d.phase === 'verified') refresh(); });
    return () => { a(); b(); c(); };
  }, []);
  const model = kept.filter(f => f.where === 'Cache Storage').reduce((n, f) => n + f.bytes, 0);
  const save = async (forBankml = false) => {
    if (busy) return;
    setBusy(true);
    try { const r = await saveCopy(say, forBankml); if (r) setSaved(r); } catch (e) { say(String((e as Error).message || e), 'bad'); }
    setBusy(false);
  };
  const owed = limits.diskCopy && !saved && dl.phase === 'verified' && model > 0;
  const twice = !!saved && saved.how === 'folder' && limits.rememberFolders && model > 0;
  const freeBrowserCopy = async () => {
    const n = await clearBrowseCache();
    setLimits({ keepCopy: false });
    refresh();
    say(`freed ${mb(n)} · read from ${saved?.where} each visit`, 'ok');
  };

  return (
    <div className="cp-disk">
      <CacheReport stamp={stamp} />
      <dl>
        <div className="cp-row"><dt>kept</dt><dd className={keep ? 'is-ok' : undefined}>
          <IndicatorLamp on={!!keep} readOnly size={8} color={keep ? GREEN : ORANGE} aria-label="persisted" /> {keep === null ? 'not reported' : keep ? 'persistent' : 'may be evicted'}
        </dd></div>
        <div className="cp-row"><dt>model</dt><dd>{model ? `${mb(model)} in browser` : 'not in browser'}</dd></div>
        <div className="cp-row"><dt>disk copy</dt><dd className={saved ? 'is-ok' : undefined}>{saved ? `${saved.where}${saved.bankml ? ' + FORK.json' : ''}` : 'none'}</dd></div>
      </dl>
      <div className="cp-limits">
        <ToggleSwitch on={limits.diskCopy} color={ORANGE} label="keep a copy on disk"
          onChange={on => { setLimits({ diskCopy: on }); if (on && !saved && model) void save(); }} />
        <ToggleSwitch on={s.removeAfterSession} color={ORANGE} label="remove from browser after session"
          onChange={on => setBrowseSettings({ removeAfterSession: on })} />
      </div>
      {twice && <p className="cp-said is-working" role="status">On disk twice: free the browser's {mb(model)}.</p>}
      {owed && <p className="cp-said is-working" role="status">Model ready: SAVE COPY.</p>}
      <div className="cp-buttons">
        <Button onClick={() => void save()} color={owed ? ORANGE : undefined} disabled={busy || !model}>{busy ? 'SAVING…' : 'SAVE COPY'}</Button>
        <Button onClick={() => void save(true)} disabled={busy || !model}>SAVE FOR bankML</Button>
        {twice && <Button color={ORANGE} onClick={() => void freeBrowserCopy()}>FREE BROWSER COPY</Button>}
        {keep === false && <Button onClick={() => void askPersist().then(v => { setKeep(v); say(v ? 'storage persistent' : 'the browser declined', v ? 'ok' : undefined); })}>PERSIST</Button>}
        {!confirm
          ? <Button onClick={() => setConfirm(true)} disabled={!model}>CLEAR</Button>
          : <Button color={RED} onClick={() => void clearBrowseCache().then(n => { setConfirm(false); refresh(); say(`cleared ${mb(n)}${saved ? ` · ${saved.where} stays` : ''}`, 'ok'); })}>CLEAR {mb(model)}?</Button>}
        <Button onClick={refresh}>REFRESH</Button>
      </div>
      <p className="cp-fine">{canPickFolders() ? 'Saves into a folder you choose (size checked).' : 'Saves to Downloads (Brave: enable brave://flags/#file-system-access-api for folders).'} SAVE FOR bankML adds the FORK.json for <code>bankml serve</code>.</p>
    </div>
  );
}
