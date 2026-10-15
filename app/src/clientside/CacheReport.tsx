// SPDX-License-Identifier: MIT
// CACHE: what browseML keeps here, what this site holds, and what is available, at three levels of detail —
// VISUAL (one bar, three numbers), ENHANCED (by kind, persistence, room against the model, the prompt cache in memory)
// and SCIENTIFIC (exact bytes in both units, every entry, the browser's own breakdown, how and when it was read).
import { useEffect, useState } from 'react';
import { LEVELS, bytesIEC, bytesSI, reportLines, roomLevel, share, storageReport, type Detail, type StorageReport } from '../bankml/storage';
import { browseSettings } from '../bankml/free';

const KEY = 'browseml:cache-detail';
const readLevel = (): Detail => { try { const v = localStorage.getItem(KEY); return (LEVELS as readonly string[]).includes(v ?? '') ? v as Detail : 'visual'; } catch { return 'visual'; } };
const COLORS: Record<string, string> = { model: '#0ECB81', prompts: '#F7931A', caches: '#5AD1FF', records: '#B48CFF', site: '#64748b' };

export function CacheReport({ stamp }: { stamp: number }) {
  const [r, setR] = useState<StorageReport | null>(null);
  const [level, setLevel] = useState<Detail>(readLevel);
  useEffect(() => { void storageReport().then(setR); }, [stamp]);
  useEffect(() => { try { localStorage.setItem(KEY, level); } catch { /* storage off */ } }, [level]);
  if (!r) return <p className="cp-fine">reading the browser's storage…</p>;
  const q = r.quota, rest = r.site !== null ? Math.max(0, r.site - r.browseml) : 0, lv = roomLevel(r.available);
  const seg = (bytes: number, color: string, title: string) => q && bytes > 0
    ? <span key={title} className="cr-seg" style={{ width: `${Math.max(0.6, 100 * bytes / q)}%`, background: color }} title={`${title}: ${bytesSI(bytes)}`} /> : null;
  return (
    <div className="cr">
      <div className="cr-levels" role="radiogroup" aria-label="detail">
        {LEVELS.map(l => (
          <button key={l} type="button" role="radio" aria-checked={level === l} className={'cr-level' + (level === l ? ' is-on' : '')} onClick={() => setLevel(l)}>{l}</button>
        ))}
      </div>
      {q !== null && (
        <div className="cr-bar" role="img" aria-label={`browseML ${bytesSI(r.browseml)}, the rest of this site ${bytesSI(rest)}, available ${bytesSI(r.available ?? 0)}, of ${bytesSI(q)}`}>
          {level === 'visual' ? seg(r.browseml, COLORS.model, 'browseML') : r.parts.map(p => seg(p.bytes, COLORS[p.id], p.label))}
          {seg(rest, COLORS.site, 'the rest of this site')}
        </div>
      )}
      <dl className="cr-nums">
        <div className="cp-row"><dt>browseML</dt><dd>{bytesSI(r.browseml)}{q ? <small> · {share(r.browseml, q)}</small> : null}</dd></div>
        <div className="cp-row"><dt>total</dt><dd>{r.site !== null && q !== null ? `${bytesSI(r.site)} of ${bytesSI(q)}` : 'not reported'}</dd></div>
        <div className="cp-row"><dt>available</dt><dd className={lv === 'bad' ? 'is-bad' : lv === 'low' ? 'is-working' : 'is-ok'}>{r.available !== null ? bytesSI(r.available) : 'not reported'}</dd></div>
      </dl>
      {level !== 'visual' && (
        <ul className="cr-lines">{reportLines(r, level, browseSettings().cacheRam).slice(3).map((l, i) => {
          const part = r.parts.find(p => l.trim().startsWith(p.label + ':'));
          return <li key={i} className={l.startsWith('  ') ? 'is-sub' : undefined}>{part && <i style={{ background: COLORS[part.id] }} />}{l.trim()}</li>;
        })}</ul>
      )}
      {level === 'scientific' && <p className="cp-fine">browseML {r.browseml} B = {bytesIEC(r.browseml)} · units: kB/MB/GB are powers of 1000, KiB/MiB/GiB of 1024</p>}
    </div>
  );
}
