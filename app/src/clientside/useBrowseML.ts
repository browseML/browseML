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
import { askBrowse, browseCached, browseState, download, downloadState, loadBrowse, markKeptBad, sessionCleanup, useLocalModel, warmBrowse } from '../bankml/free';
import { getLimits } from './limits';
import { rememberedModel } from './Folders';
import { deliver, type DeliveryHooks, type Outcome } from '../bankml/deliver';

/** Said in place of an answer while browseML is not ready; the card under it offers the import. */
export const NOT_READY = 'Click to load the model in your browser.';
export const WIDGET = 'browseml';
export const RECEIPT = 'receipt';
const WHERE = 'browseML — bankML in this browser (Bonsai-1.7B Q1_0)';

type Held = { text: string; outputId: string };

export function useBrowseML(uif: MutableRefObject<UIFContextValue | null>) {
  const [live, setLive] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ how: Outcome; ok: boolean } | null>(null);
  const [last, setLast] = useState<Verdict | null>(null);
  const [, tick] = useState(0);
  const held = useRef<Held | null>(null);
  useEffect(() => { sessionCleanup(); }, []);

  /** The prompt cache: the page's system prompt read into the engine now (or its slot restored from an earlier
   *  visit), so the next question reads only itself. The field composes it as it will for a question (forSend). */
  const warm = async () => {
    const f = uif.current;
    if (!f || !browseState() || !getLimits().warm) return;
    await warmBrowse(f.context.forSend('', '').system);
  };
  /** The page opened with the model already kept here: started and warmed in the background (nothing is downloaded). */
  const preload = async () => {
    if (browseState() || !getLimits().warm) return;
    try {
      if (await browseCached()) await loadBrowse();
      else {
        // a remembered folder (persistent access) whose model was used: read from there, no download, no prompt
        const r = await rememberedModel();
        if (!r) return;
        const u = await useLocalModel(r.file, () => {}, { keep: getLimits().keepCopy, named: r.named });
        if (!u.ok) return;
      }
      tick(n => n + 1);
      await warm();
    } catch { /* the card says so when asked */ }
  };

  /** browseML verified (the card's import, or a model already kept): warmed, then the held question is asked. */
  const ready = async () => {
    tick(n => n + 1);
    await warm();
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

  const hooksFor = (outputId: string, markReply: (p: ReplyMarks) => void, question: string, verdict: { v: Verdict | null }): DeliveryHooks => {
    let lineId: string | null = null;
    return {
      line(text, tone, kind) {
        const out = uif.current?.outputs;
        if (!out) return;
        // the delivery: drawn as the receipt's closed accordion (the text stays, for .history and copies)
        const patch = kind === 'delivery'
          ? { text, tone, kind, widget: RECEIPT, widgetOnly: true, data: { line: text, ok: !!verdict.v?.ok, receipt: verdict.v?.receipt ?? null, usage: verdict.v?.usage ?? null, at: Date.now() } }
          : { text, tone, kind };
        if (lineId) out.update(outputId, lineId, patch);
        else if (text) lineId = out.append(outputId, { role: 'system', ...patch });
        // kept in .memory as a delivery record (never sent to the model): the question, the receipt, the counts
        if (kind === 'delivery' && verdict.v) {
          void uif.current?.context.keep({ carrier: 'browseML', question, verified: verdict.v.ok, receipt: verdict.v.receipt ?? null,
            usage: verdict.v.usage ?? null, model: browseState()?.model ?? null, output: outputId }, text);
        }
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
    const verdict: { v: Verdict | null } = { v: null };
    const hooks = hooksFor(outputId, markReply, text, verdict);
    const settle = (done: (v: Verdict) => void) => (v: Verdict) => {
      verdict.v = v;
      setLast(v);
      // only an answer whose receipt matched is read aloud
      if (!v.ok) markReply({ silent: true });
      annotate({ engine: 'browseml', model: browseState()?.model ?? 'Bonsai-1.7B-Q1_0.gguf', receipt: v.receipt ?? null, verified: v.ok, ...(v.usage ? { usage: v.usage } : {}) });
      done(v);
    };
    return deliver(done => askBrowse(context.system, turnsOf(outputId), text, settle(done), undefined, signal), hooks, {
      where: WHERE, receipts: true, signal,
      prepare: async progress => {
        if (browseState()) return null;
        // kept in this browser already: started (bankML checks it) without asking anything of the visitor
        if (await browseCached()) {
          try { await loadBrowse(progress); }
          catch (e) {
            // the kept copy does not start (refused by bankML's check, or no response): offer to overwrite it
            const why = String((e as Error).message || e);
            markKeptBad(`the model kept in this browser could not be used: ${why}`);
            held.current = { text, outputId };
            return { note: 'The model kept in this browser could not be used. Overwrite it with a fresh copy, or use a model file you have.', widget: WIDGET };
          }
          tick(n => n + 1);
          progress('reading browseML\'s prompt once — kept in this browser for next time…');
          await warm();
          return null;
        }
        // a remembered folder (persistent access) whose model was used: read from there, no download
        if (getLimits().rememberFolders) {
          const r = await rememberedModel().catch(() => null);
          if (r) {
            progress(`reading the model from ${r.from}…`);
            const u = await useLocalModel(r.file, progress, { keep: getLimits().keepCopy, named: r.named });
            if (u.ok && browseState()) { tick(n => n + 1); await warm(); return null; }
          }
        }
        // asked first (the visitor's limiter): the card's button starts it
        if (getLimits().askFirst) { held.current = { text, outputId }; return { note: NOT_READY, widget: WIDGET }; }
        // asking is the go-ahead: the model is loaded now, in the background, its progress in the window's card
        uif.current?.outputs.append(outputId, { role: 'system', text: '', widget: WIDGET });
        progress('Loading the model in your browser…');
        const v = await download();
        if (!v) {
          held.current = { text, outputId };
          return { note: `The model could not be loaded (${downloadState().error ?? downloadState().phase}). Try again below.`, widget: WIDGET };
        }
        tick(n => n + 1);
        progress('reading browseML\'s prompt once — kept in this browser for next time…');
        await warm();
        return null;
      },
    });
  };

  return { onSend, ready, preload, warm, live, outcome, last, isReady: !!browseState() };
}
