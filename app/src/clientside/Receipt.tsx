// SPDX-License-Identifier: MIT
// The receipt under an answer, as a closed accordion: one line (the verdict, the tokens, the speed); opened, the
// delivery in full and the receipt itself — the hashes of the request, the model and the answer, bankML's version.
// The control panel's RECEIPTS section lists every receipt kept (.history with each exchange, .memory as delivery
// records never sent to the model) and holds the "view receipts" toggle.
import { useEffect, useState, type MutableRefObject } from 'react';
import { ToggleSwitch } from 'dreamknob';
import type { UIFContextValue } from '../components/UIFContext';
import { getLimits, onLimits, setLimits } from './limits';

type R = Record<string, unknown> | null | undefined;
const short = (h: unknown) => (typeof h === 'string' && h.length > 20 ? `${h.slice(0, 16)}…` : String(h ?? '—'));

function useShow() {
  const [show, set] = useState(getLimits().showReceipts);
  useEffect(() => onLimits(() => set(getLimits().showReceipts)), []);
  return show;
}

/** The hashes and fields of a bankML receipt, as rows. */
function ReceiptRows({ receipt }: { receipt: R }) {
  if (!receipt) return <p className="cs-receipt-none">No receipt came with this answer.</p>;
  const keys = ['bankml', 'model_sha256', 'request_sha256', 'response_sha256', 'prompt_tokens', 'completion_tokens', 'created'];
  return (
    <>
      <dl className="cs-receipt-rows">
        {keys.filter(k => receipt[k] !== undefined).map(k => (
          <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd title={String(receipt[k])}>{k.endsWith('sha256') ? short(receipt[k]) : String(receipt[k])}</dd></div>
        ))}
      </dl>
      <details className="cs-receipt-raw"><summary>the receipt as bankML wrote it</summary><pre>{JSON.stringify(receipt, null, 2)}</pre></details>
    </>
  );
}

/** Under an answer (the 'receipt' widget): closed until opened. */
export function ReceiptAccordion({ data }: { data?: Record<string, unknown> }) {
  const show = useShow();
  if (!show || !data) return null;
  const ok = data.ok === true, u = (data.usage ?? {}) as Record<string, unknown>, line = String(data.line ?? '');
  const speed = line.match(/([\d.]+) tok\/s/)?.[1];
  return (
    <details className={`cs-receipt ${ok ? 'is-ok' : 'is-bad'}`}>
      <summary>
        <b>{ok ? '✓ receipt' : data.receipt ? '✗ receipt' : 'no receipt'}</b>
        {u.completion_tokens !== undefined && <span> · {String(u.prompt_tokens ?? '?')} → {String(u.completion_tokens)} tokens</span>}
        {speed && <span> · {speed} tok/s</span>}
      </summary>
      <p className="cs-receipt-line">{line}</p>
      <ReceiptRows receipt={data.receipt as R} />
    </details>
  );
}

/** The control panel's RECEIPTS: the toggle, and every receipt kept in .history (newest first). */
export function ReceiptsSection({ uif }: { uif: MutableRefObject<UIFContextValue | null> }) {
  const show = useShow();
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 2000); return () => window.clearInterval(t); }, []);
  const ctx = uif.current?.context;
  const history = (ctx?.history ?? []).filter(h => h.receipt !== undefined || h.verified !== undefined).slice(-30).reverse();
  const delivered = (ctx?.memory ?? []).filter(n => n.source?.kind === 'delivery').length;
  return (
    <div className="cp-receipts">
      <ToggleSwitch on={show} color="#F7931A" label="view receipts under answers" onChange={on => setLimits({ showReceipts: on })} />
      <p className="cp-fine">Kept either way: each receipt with its exchange in .history ({history.length} shown, the last 30), and as a delivery
        record in .memory ({delivered}), never sent to the model.</p>
      {history.length === 0 && <p className="cp-fine">No receipts yet: ask something.</p>}
      {history.map((h, i) => (
        <details key={`${h.ts}-${i}`} className={`cs-receipt ${h.verified ? 'is-ok' : 'is-bad'}`}>
          <summary><b>{h.verified ? '✓' : '✗'}</b> <span className="cp-receipt-q">{String(h.user).slice(0, 60)}</span></summary>
          <p className="cs-receipt-line">{new Date(h.ts * 1000).toLocaleString()} · {String(h.model ?? '')}</p>
          <ReceiptRows receipt={h.receipt as R} />
        </details>
      ))}
    </div>
  );
}
