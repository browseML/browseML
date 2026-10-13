// SPDX-License-Identifier: MIT
// HARD DRIVE: what browseML keeps on this computer, and the visitor's control of it. The browser's storage (how much
// this site uses of what it may, whether the browser keeps it under pressure, the files kept, removing them after the
// session or now), and a copy of the model on the disk itself: saved into a folder the visitor chooses (File System
// Access, written and its size checked) or, where the browser cannot write folders (Firefox, Safari; Brave with the API
// off), to its downloads. With persistent access on, the folder is remembered and the next visit starts from that copy
// with no download, even when the browser's storage has been cleared.
import { useEffect, useState } from 'react';
import { Button, IndicatorLamp, ToggleSwitch } from 'dreamknob';
import { askPersist, browseSettings, clearBrowseCache, downloadState, keptFiles, keptModel, onBrowseSettings, onDownload, persisted, setBrowseSettings, storageEstimate, type KeptFile } from '../bankml/free';
import { canPickFolders, keepFolder } from '../bankml/folders';
import { MODEL_BYTES, mb } from '../bankml/caps';
import { getLimits, onLimits, setLimits } from './limits';

const GREEN = '#0ECB81', ORANGE = '#F7931A';
const SAVED = 'browseml:disk-copy';
interface Saved { where: string; name: string; bytes: number; at: number; how: 'folder' | 'downloads' }
const readSaved = (): Saved | null => { try { return JSON.parse(localStorage.getItem(SAVED) || 'null'); } catch { return null; } };

type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;

/** A copy of the kept model on the disk: into a chosen folder (checked by size), else to the browser's downloads. */
export async function saveCopy(say: Say): Promise<Saved | null> {
  const m = await keptModel();
  if (!m) { say('no model is kept in this browser to copy: import it first (or it is already read from a folder on this computer)', 'bad'); return null; }
  let saved: Saved;
  if (canPickFolders()) {
    const w = window as unknown as { showDirectoryPicker(o: { id: string; mode: 'readwrite' }): Promise<FileSystemDirectoryHandle> };
    let dir: FileSystemDirectoryHandle;
    try { dir = await w.showDirectoryPicker({ id: 'browseml-models', mode: 'readwrite' }); }
    catch (e) { if ((e as Error).name !== 'AbortError') say(String((e as Error).message || e), 'bad'); return null; }
    const fh = await dir.getFileHandle(m.name, { create: true });
    const there = await fh.getFile();
    if (there.size !== m.bytes) {
      say(`writing ${m.name} (${mb(m.bytes)}) into ${dir.name}…`, 'working');
      let n = 0, last = 0;
      const count = new TransformStream<Uint8Array, Uint8Array>({ transform(c, out) {
        n += c.byteLength; out.enqueue(c);
        if (n - last > 16 << 20) { last = n; say(`writing ${m.name}: ${mb(n)} of ${mb(m.bytes)}…`, 'working'); }
      } });
      await m.response.body!.pipeThrough(count).pipeTo(await fh.createWritable());
      const size = (await fh.getFile()).size;
      if (size !== m.bytes) { say(`the copy in ${dir.name} is ${mb(size)}, not ${mb(m.bytes)}: try again`, 'bad'); return null; }
    }
    if (getLimits().rememberFolders) await keepFolder({ id: `${dir.name}-${Date.now()}`, name: dir.name, handle: dir, added: Date.now(), model: [m.name] });
    saved = { where: `${dir.name}/${m.name}`, name: m.name, bytes: m.bytes, at: Date.now(), how: 'folder' };
  } else {
    say(`saving ${m.name} (${mb(m.bytes)}) to your downloads…`, 'working');
    const url = URL.createObjectURL(await m.response.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: m.name });
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    saved = { where: `downloads/${m.name}`, name: m.name, bytes: m.bytes, at: Date.now(), how: 'downloads' };
  }
  try { localStorage.setItem(SAVED, JSON.stringify(saved)); } catch { /* storage off */ }
  say(`✓ a copy of the model on this computer: ${saved.where} (${mb(saved.bytes)})${saved.how === 'folder'
    ? getLimits().rememberFolders ? ' · remembered: the next visit starts from it' : ' · turn on persistent access (MODELS ON THIS COMPUTER) to start from it next visit'
    : ' · next time: MODELS ON THIS COMPUTER → ADD FOLDER → your downloads, USE'}`, 'ok');
  return saved;
}

export function Disk({ say }: { say: Say }) {
  const [, tick] = useState(0);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [kept, setKept] = useState<KeptFile[]>([]);
  const [keep, setKeep] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<Saved | null>(readSaved);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const limits = getLimits(), s = browseSettings(), dl = downloadState();
  const refresh = () => { void storageEstimate().then(setEst); void keptFiles().then(setKept); void persisted().then(setKeep); };
  useEffect(() => {
    refresh();
    const a = onLimits(() => tick(n => n + 1)), b = onBrowseSettings(() => tick(n => n + 1));
    const c = onDownload(d => { tick(n => n + 1); if (d.phase === 'verified') refresh(); });
    return () => { a(); b(); c(); };
  }, []);
  const model = kept.filter(f => f.where === 'Cache Storage').reduce((n, f) => n + f.bytes, 0);
  const save = async () => { if (busy) return; setBusy(true); try { const r = await saveCopy(say); if (r) setSaved(r); } catch (e) { say(String((e as Error).message || e), 'bad'); } setBusy(false); };
  const owed = limits.diskCopy && !saved && dl.phase === 'verified' && model > 0;
  // the same disk holds it twice when a remembered folder has the copy and the browser keeps one too
  const twice = !!saved && saved.how === 'folder' && limits.rememberFolders && model > 0;
  const freeBrowserCopy = async () => {
    const n = await clearBrowseCache();
    setLimits({ keepCopy: false });
    refresh();
    say(`freed ${mb(n)}: the model is read from ${saved?.where} each visit (keep a copy in this browser: off)`, 'ok');
  };

  return (
    <div className="cp-disk">
      <dl>
        <div className="cp-row"><dt>browser storage</dt><dd>{est ? `${mb(est.usage)} used of ${mb(est.quota)} this site may use` : 'not reported'}</dd></div>
        {est && <div className="cp-row"><dt>room left</dt><dd className={est.quota - est.usage < MODEL_BYTES ? 'is-bad' : undefined}>{mb(Math.max(0, est.quota - est.usage))}{est.quota - est.usage < MODEL_BYTES ? ` · less than the model (${mb(MODEL_BYTES)}): free disk space or use a copy on the disk` : ''}</dd></div>}
        <div className="cp-row"><dt>kept under pressure</dt><dd className={keep ? 'is-ok' : undefined}>
          <IndicatorLamp on={!!keep} readOnly size={8} color={keep ? GREEN : ORANGE} aria-label="persisted" /> {keep === null ? 'not reported' : keep ? 'yes: the browser keeps it' : 'no: the browser may remove it when space runs low'}
        </dd></div>
        <div className="cp-row"><dt>the model in this browser</dt><dd>{model ? mb(model) : 'not kept here'}</dd></div>
        <div className="cp-row"><dt>a copy on the disk</dt><dd className={saved ? 'is-ok' : undefined}>{saved ? `${saved.where} · ${mb(saved.bytes)} · ${new Date(saved.at).toLocaleDateString()}` : 'none saved from here'}</dd></div>
      </dl>
      <div className="cp-limits">
        <ToggleSwitch on={limits.diskCopy} color={ORANGE} label="keep a copy of the model on this computer's disk"
          onChange={on => { setLimits({ diskCopy: on }); if (on && !saved && model) void save(); }} />
        <ToggleSwitch on={s.removeAfterSession} color={ORANGE} label="remove the model from this browser after the session"
          onChange={on => setBrowseSettings({ removeAfterSession: on })} />
      </div>
      {twice && <p className="cp-said is-working" role="status">The model is on this disk twice: in {saved!.where} (remembered, the next visit starts from it) and in this browser ({mb(model)}). FREE THE BROWSER'S COPY gives {mb(model)} back.</p>}
      {owed && <p className="cp-said is-working" role="status">The model is here: SAVE A COPY puts it on the disk ({canPickFolders() ? 'a folder you choose' : 'your downloads'}).</p>}
      <div className="cp-buttons">
        <Button onClick={() => void save()} color={owed ? ORANGE : undefined} disabled={busy || !model}>{busy ? 'SAVING…' : 'SAVE A COPY'}</Button>
        {twice && <Button color={ORANGE} onClick={() => void freeBrowserCopy()}>FREE THE BROWSER'S COPY</Button>}
        {keep === false && <Button onClick={() => void askPersist().then(v => { setKeep(v); say(v ? 'the browser keeps browseML\'s storage now' : 'the browser did not agree to keep it (Brave and Chrome decide from how the site is used)', v ? 'ok' : undefined); })}>KEEP STORAGE</Button>}
        {!confirm
          ? <Button onClick={() => (model ? setConfirm(true) : say('nothing of browseML is kept in this browser'))} disabled={!model}>CLEAR</Button>
          : <Button color="#F6465D" onClick={() => void clearBrowseCache().then(n => { setConfirm(false); refresh(); say(`cleared: ${mb(n)} removed from this browser${saved ? ` (the copy at ${saved.where} stays)` : ''}`, 'ok'); })}>CLEAR {mb(model)}?</Button>}
        <Button onClick={refresh}>REFRESH</Button>
      </div>
      <p className="cp-fine">{canPickFolders()
        ? 'SAVE A COPY writes the model into a folder you choose (you grant it write access once) and checks its size. Nothing leaves this computer.'
        : 'This browser cannot write into folders (Brave: brave://flags/#file-system-access-api), so SAVE A COPY saves to your downloads.'}</p>
    </div>
  );
}
