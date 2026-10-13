// SPDX-License-Identifier: MIT
// MODELS ON THIS COMPUTER: folder control. The visitor grants folders (read-only); browseML lists the models it finds
// and which it can run (named by the pinned sha256, or the pinned size, checked when used), uses one with no download,
// and — when persistent access is on — keeps the folders for the next visit (reconnecting with one press if the
// browser asks again). Where the browser has no File System Access API (Firefox, Safari; Brave with the API turned
// off), a folder can still be read for this visit through a folder input.
import { useEffect, useRef, useState } from 'react';
import { Button, ToggleSwitch } from 'dreamknob';
import {
  canPickFolders, classify, forgetAllFolders, forgetFolder, fromFileList, keepFolder, keptFolders, permission, pickFolder,
  reconnect, scan, type FoundFile, type KeptFolder,
} from '../bankml/folders';
import { useLocalModel } from '../bankml/free';
import { MODEL_BYTES, mb } from '../bankml/caps';
import { getLimits, onLimits, setLimits } from './limits';

const PIN = '3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3';
const MODEL = { bytes: MODEL_BYTES, sha256: PIN };
const ORANGE = '#F7931A';

interface Folder { id: string; name: string; handle?: FileSystemDirectoryHandle; kept: boolean; perm: 'granted' | 'prompt' | 'denied'; found: FoundFile[] | null; scanning?: boolean }

/** This visit's folders (the kept ones read back from IndexedDB, and any granted now). */
let visit: Folder[] = [];
const fns = new Set<() => void>();
const set = (f: Folder[]) => { visit = f; fns.forEach(x => x()); };

export function Folders({ onReady, say }: { onReady(): void; say(text: string, tone?: 'ok' | 'bad' | 'working'): void }) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); fns.add(f); const g = onLimits(f); return () => { fns.delete(f); g(); }; }, []);
  const limits = getLimits();
  const input = useRef<HTMLInputElement>(null);
  const supported = canPickFolders();

  // the kept folders, once, with their permission now
  useEffect(() => {
    if (visit.length) return;
    void keptFolders().then(async ks => {
      const fs: Folder[] = [];
      for (const k of ks) fs.push({ id: k.id, name: k.name, handle: k.handle, kept: true, perm: await permission(k.handle), found: null });
      if (fs.length) set(fs);
    });
  }, []);

  const rescan = async (f: Folder) => {
    if (!f.handle) return;
    set(visit.map(x => (x.id === f.id ? { ...x, scanning: true } : x)));
    try {
      const found = await scan(f.handle);
      set(visit.map(x => (x.id === f.id ? { ...x, found, scanning: false } : x)));
      const ours = found.filter(x => classify(x, MODEL) !== 'other').length;
      say(`${f.name}: ${found.length} model file${found.length === 1 ? '' : 's'}${ours ? `, ${ours} browseML can run` : ''}`, ours ? 'ok' : undefined);
    } catch (e) { set(visit.map(x => (x.id === f.id ? { ...x, scanning: false } : x))); say(`${f.name}: ${String((e as Error).message || e)}`, 'bad'); }
  };
  const add = async () => {
    if (!supported) return input.current?.click();
    try {
      const h = await pickFolder();
      const f: Folder = { id: `${h.name}-${Date.now()}`, name: h.name, handle: h, kept: false, perm: 'granted', found: null };
      if (getLimits().rememberFolders) { await keepFolder({ id: f.id, name: f.name, handle: h, added: Date.now() }); f.kept = true; }
      set([...visit, f]);
      await rescan(f);
    } catch (e) { if ((e as Error).name !== 'AbortError') say(String((e as Error).message || e), 'bad'); }
  };
  const fromInput = (files: FileList | null) => {
    if (!files?.length) return;
    const found = fromFileList(files);
    const name = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name).split('/')[0];
    set([...visit, { id: `${name}-${Date.now()}`, name, kept: false, perm: 'granted', found }]);
    say(`${name}: ${found.length} model file${found.length === 1 ? '' : 's'} (this visit only)`);
  };
  const remove = async (f: Folder) => { if (f.kept) await forgetFolder(f.id); set(visit.filter(x => x.id !== f.id)); };
  const again = async (f: Folder) => {
    if (!f.handle) return;
    const p = await reconnect(f.handle);
    set(visit.map(x => (x.id === f.id ? { ...x, perm: p } : x)));
    if (p === 'granted') await rescan({ ...f, perm: p });
  };
  const use = async (f: Folder, x: FoundFile) => {
    try {
      const file = x.file ?? (await x.handle!.getFile());
      say(`checking ${x.name}…`, 'working');
      const r = await useLocalModel(file, line => say(line, 'working'), { keep: getLimits().keepCopy, named: x.named });
      if (!r.ok) return say(r.reason, 'bad');
      say(`✓ ${r.name} from ${f.name}/${x.path.join('/')} — no download${getLimits().keepCopy ? '' : ', nothing kept in this browser'}`, 'ok');
      // remembered: the next visit starts it from here
      if (f.kept && f.handle) await keepFolder({ id: f.id, name: f.name, handle: f.handle, added: Date.now(), model: x.path });
      if (r.verified) onReady();
    } catch (e) { say(String((e as Error).message || e), 'bad'); }
  };

  return (
    <div className="cp-folders">
      <p className="cp-fine">
        {supported
          ? 'Folders you choose are read here, read-only; nothing is uploaded. browseML recognises its model by name (Ollama and Hugging Face blobs are named by their sha256) or by size and sha256.'
          : 'This browser cannot keep access to folders (Brave: turn on brave://flags/#file-system-access-api). A folder can still be read for this visit.'}
      </p>
      <div className="cp-buttons">
        <Button onClick={() => void add()}>ADD FOLDER</Button>
      </div>
      <input ref={input} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={e => fromInput(e.target.files)} />
      <div className="cp-limits">
        <ToggleSwitch on={limits.rememberFolders} color={ORANGE} label="persistent access: remember these folders" disabled={!supported}
          onChange={async on => {
            setLimits({ rememberFolders: on });
            if (on) { for (const f of visit) if (f.handle && !f.kept) { await keepFolder({ id: f.id, name: f.name, handle: f.handle, added: Date.now() }); f.kept = true; } set([...visit]); }
            else { await forgetAllFolders(); set(visit.map(f => ({ ...f, kept: false }))); say('persistent access off: no folder is remembered', 'ok'); }
          }} />
        <ToggleSwitch on={limits.keepCopy} color={ORANGE} label="keep a copy in this browser (off: read from the folder each visit)" onChange={on => setLimits({ keepCopy: on })} />
      </div>
      {visit.map(f => (
        <div key={f.id} className="cp-folder">
          <div className="cp-folder-head">
            <b title={f.kept ? 'remembered' : 'this visit'}>{f.kept ? '★ ' : ''}{f.name}</b>
            {f.perm === 'prompt' && <Button onClick={() => void again(f)}>RECONNECT</Button>}
            {f.handle && f.perm === 'granted' && <Button onClick={() => void rescan(f)}>{f.scanning ? 'SCANNING…' : 'RESCAN'}</Button>}
            <Button onClick={() => void remove(f)}>REMOVE</Button>
          </div>
          {f.perm === 'prompt' && <p className="cp-fine">The browser asks again before this folder is read: RECONNECT.</p>}
          {f.found && !f.found.length && <p className="cp-fine">No model files here.</p>}
          {f.found && f.found.length > 0 && (
            <ul className="cp-found">
              {f.found.map(x => {
                const v = classify(x, MODEL);
                return (
                  <li key={x.path.join('/')} className={`is-${v}`}>
                    <span className="cp-found-name" title={x.path.join('/')}>{x.name}</span>
                    <span className="cp-found-size">{mb(x.size)}</span>
                    <span className="cp-found-verdict">{v === 'named' ? "browseML's model ✓ (named by its sha256)" : v === 'size' ? 'the right size: checked when used' : 'another model (not run in the browser yet)'}</span>
                    {v !== 'other' && <Button onClick={() => void use(f, x)}>USE</Button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** The next visit: a remembered folder whose model was used, read again with no prompt when the browser kept the
 *  grant. Returns the file and its name-sha (if any), or null. */
export async function rememberedModel(): Promise<{ file: File; named?: string; from: string } | null> {
  if (!getLimits().rememberFolders) return null;
  const { fileAt } = await import('../bankml/folders');
  for (const k of await keptFolders() as KeptFolder[]) {
    if (!k.model || (await permission(k.handle)) !== 'granted') continue;
    const file = await fileAt(k.handle, k.model);
    if (file && file.size === MODEL_BYTES) {
      const m = k.model[k.model.length - 1].match(/^(?:sha256[-:])?([0-9a-f]{64})$/i);
      return { file, named: m?.[1], from: `${k.name}/${k.model.join('/')}` };
    }
  }
  return null;
}
