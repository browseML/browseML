// SPDX-License-Identifier: MIT
// ENGINE LOG: bankML's own lines (its errors, warnings and steps, as the engine logs them) and the page's steps — the
// download, the verification, the prompt cache, each answer's receipt — the last 300, newest at the bottom. Kept in
// this tab only; COPY puts them on the clipboard for a report.
import { useEffect, useRef, useState } from 'react';
import { Button } from 'dreamknob';
import { clearEngineLog, engineLogLines, onEngineLog } from '../bankml/free';

export function EngineLog() {
  const [, tick] = useState(0);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => onEngineLog(() => tick(n => n + 1)), []);
  const lines = engineLogLines();
  useEffect(() => { const p = pre.current; if (p) p.scrollTop = p.scrollHeight; });
  const text = lines.map(l => `${new Date(l.at).toLocaleTimeString()} ${l.kind.padEnd(6)} ${l.text}`).join('\n');
  return (
    <div className="cp-log">
      <pre ref={pre} className="cp-log-lines" aria-live="off">
        {lines.length ? lines.map((l, i) => <span key={i} className={`is-${l.kind}`}>{new Date(l.at).toLocaleTimeString()} {l.kind.padEnd(6)} {l.text}{'\n'}</span>) : 'nothing yet: ON, or a question, starts bankML and its log'}
      </pre>
      <div className="cp-buttons">
        <Button onClick={() => void navigator.clipboard?.writeText(text)} disabled={!lines.length}>COPY</Button>
        <Button onClick={clearEngineLog} disabled={!lines.length}>CLEAR LOG</Button>
      </div>
    </div>
  );
}
