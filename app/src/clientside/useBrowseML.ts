// SPDX-License-Identifier: MIT
// browseML's one answerer: bankML in this browser. Hugging Face is only where the model comes from (pulled in the
// background when the visitor imports it); nothing else is asked of anyone. A question asked before browseML is ready
// is held in its response window, whose card (BrowseCard, the 'browseml' widget) offers "Import browseML"; when the
// model is verified, the held question is asked. Each answer follows Savante's delivery pattern (deliver.ts): the
// answer, the delivery line, and the receipt checked here.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { UIFContextValue } from '../components/UIFContext';
import type { ReplyMarks, SendMeta } from '../types';
import { slackWindow, type Turn, type Verdict } from '../bankml/engine';
import { askBrowse, browseCached, browseState, loadBrowse, sessionCleanup } from '../bankml/free';
import { deliver, type DeliveryHooks, type Outcome } from '../bankml/deliver';

/** Said in place of an answer while browseML is not ready; the card under it offers the import. */
export const NOT_READY = 'Click to load the model in your browser.';
export const WIDGET = 'browseml';
const WHERE = 'browseML — bankML in this browser (Bonsai-1.7B Q1_0)';

type Held = { text: string; outputId: string };

export function useBrowseML(uif: MutableRefObject<UIFContextValue | null>) {
  const [live, setLive] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ how: Outcome; ok: boolean } | null>(null);
  const [last, setLast] = useState<Verdict | null>(null);
  const [, tick] = useState(0);
  const held = useRef<Held | null>(null);
  useEffect(() => { sessionCleanup(); }, []);

  /** browseML verified (the card's import, or a model already kept): the held question is asked in its window. */
  const ready = () => {
    tick(n => n + 1);
    const q = held.current;
    held.current = null;
    const f = uif.current;
    if (q && f?.outputs.list().some(w => w.id === q.outputId)) f.sendTo(q.text, q.outputId);
  };

  const turnsOf = (outputId: string): Turn[] =>
    slackWindow((uif.current?.context.history ?? []).filter(h => h.output_id === outputId)).flatMap(h => [
      { role: 'user' as const, content: typeof h.sent === 'string' ? h.sent : h.user },
      { role: 'assistant' as const, content: h.assistant },
    ]);

  const hooksFor = (outputId: string, markReply: (p: ReplyMarks) => void): DeliveryHooks => {
    let lineId: string | null = null;
    return {
      line(text, tone, kind) {
        const out = uif.current?.outputs;
        if (!out) return;
        if (lineId) out.update(outputId, lineId, { text, tone, kind });
        else if (text) lineId = out.append(outputId, { role: 'system', text, tone, kind });
      },
      footer(text) { uif.current?.outputs.append(outputId, { role: 'system', kind: 'footer', text }); },
      live: n => setLive(n),
      mark: markReply,
      counted() { /* the usage log counts (usage.ts) */ },
      ended(how, v) { setOutcome({ how, ok: how === 'delivered' && !!v?.ok }); },
    };
  };

  const onSend = (text: string, meta: SendMeta) => {
    const { outputId, context, annotate, markReply, signal } = meta;
    const hooks = hooksFor(outputId, markReply);
    const settle = (done: (v: Verdict) => void) => (v: Verdict) => {
      setLast(v);
      // only an answer whose receipt matched is read aloud
      if (!v.ok) markReply({ silent: true });
      annotate({ engine: 'browseml', model: browseState()?.model ?? 'Bonsai-1.7B-Q1_0.gguf', receipt: v.receipt ?? null, verified: v.ok, ...(v.usage ? { usage: v.usage } : {}) });
      done(v);
    };
    return deliver(done => askBrowse(context.system, turnsOf(outputId), text, settle(done)), hooks, {
      where: WHERE, receipts: true, signal,
      prepare: async progress => {
        if (browseState()) return null;
        // kept in this browser already: started (bankML checks it) without asking anything of the visitor
        if (await browseCached()) { await loadBrowse(progress); tick(n => n + 1); return null; }
        held.current = { text, outputId };
        return { note: NOT_READY, widget: WIDGET };
      },
    });
  };

  return { onSend, ready, live, outcome, last, isReady: !!browseState() };
}
