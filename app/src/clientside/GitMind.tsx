// SPDX-License-Identifier: MIT
// GITMIND (control panel): .memory's versions as git commits, gitmind-compatible — the head, the versions, RESTORE (a new
// commit, never a rewrite), and the two exports: the history as a git bundle (git clone reads it; gitmind and bankML's
// memgit read the repository it gives) and gitmind's ledger (.gitmind/ledger.jsonl).
import { useEffect, useState, type MutableRefObject } from 'react';
import { Button, ToggleSwitch } from 'dreamknob';
import type { UIFContextValue } from '../components/UIFContext';
import type { Version } from '../bankml/gitmind';
import { exportBundle, exportLedger, forgetVersions, gitmindOn, markRestore, onGitmind, setGitmindOn, versions } from './gitmindStore';

type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;
const ORANGE = '#F7931A', RED = '#F6465D';
const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
function save(bytes: Uint8Array | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function GitMindSection({ uif, say }: { uif: MutableRefObject<UIFContextValue | null>; say: Say }) {
  const [vs, setVs] = useState<Version[]>([]);
  const [on, setOn] = useState(gitmindOn);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const f = () => { void versions().then(setVs); setOn(gitmindOn()); }; f(); return onGitmind(f); }, []);
  const head = vs.length ? vs[vs.length - 1] : null;
  const restore = (v: Version) => {
    const c = uif.current?.context;
    if (!c || !head || v.text === head.text) return;
    markRestore(v);
    c.clearMemory();
    if (v.text.trim()) c.importText('memory', v.text);
    say(`.memory restored to ${v.commit.slice(0, 7)} — a new commit on top`, 'ok');
  };
  const bundleIt = async () => {
    setBusy(true);
    try {
      const b = await exportBundle();
      if (!b) say('no version yet', 'bad');
      else { save(b.bytes, 'browseml-memory.bundle', 'application/octet-stream'); say(`saved browseml-memory.bundle: ${b.count} commit${b.count === 1 ? '' : 's'}, head ${b.head.slice(0, 7)}`, 'ok'); }
    } catch (e) { say(String((e as Error).message || e), 'bad'); }
    setBusy(false);
  };
  return (
    <div className="gm">
      <dl>
        <div className="cp-row"><dt>head</dt><dd className={head ? 'is-ok' : undefined}>{head ? <><code>{head.commit.slice(0, 7)}</code> · {head.subject}</> : 'no version yet'}</dd></div>
        <div className="cp-row"><dt>versions</dt><dd>{vs.length} commit{vs.length === 1 ? '' : 's'} of .memory, kept in this browser</dd></div>
      </dl>
      <div className="cp-limits"><ToggleSwitch on={on} color={ORANGE} label="keep versions of .memory" onChange={v => setGitmindOn(v)} /></div>
      {vs.length > 0 && (
        <ul className="gm-list">{[...vs].reverse().slice(0, 12).map(v => (
          <li key={v.n}>
            <code title={v.commit}>{v.commit.slice(0, 7)}</code> <span className="gm-when">{when(v.at)}</span> {v.subject}
            {v !== head && v.text !== head?.text && <button type="button" className="gm-act" onClick={() => restore(v)}>restore</button>}
          </li>
        ))}</ul>
      )}
      <div className="cp-buttons">
        <Button onClick={() => void bundleIt()} disabled={busy || !vs.length}>{busy ? 'BUNDLING…' : 'EXPORT BUNDLE'}</Button>
        <Button onClick={() => void exportLedger().then(t => { save(t, 'ledger.jsonl', 'application/x-ndjson'); say('saved ledger.jsonl: put it in .gitmind/ of the clone', 'ok'); })} disabled={!vs.length}>EXPORT LEDGER</Button>
        {!confirm
          ? <Button onClick={() => setConfirm(true)} disabled={!vs.length}>FORGET</Button>
          : <Button color={RED} onClick={() => void forgetVersions().then(() => { setConfirm(false); say('versions forgotten; .memory itself is unchanged', 'ok'); })}>FORGET {vs.length}?</Button>}
      </div>
      <p className="cp-fine">Each change of .memory is a git commit (git's own ids), laid out as bankML's memgit keeps a .memory. The bundle is a
        git repository: <code>git clone browseml-memory.bundle memory</code>, then gitmind watches it (<code>python -m gitmind snapshot</code>);
        the ledger goes in <code>memory/.gitmind/</code>. Nothing leaves this browser unless you save a file.</p>
    </div>
  );
}
