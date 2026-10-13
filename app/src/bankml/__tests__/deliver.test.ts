import { describe, expect, it } from 'vitest';
import { NO_DELIVERY, deliver, deliveryLine, hintFor, wasDelivered, type DeliveryHooks } from '../deliver';
import type { Verdict } from '../engine';
import type { ReplyMarks } from '../../types';

function recorder() {
  const lines: { text: string; tone?: string; kind?: string }[] = [];
  const marks: ReplyMarks[] = [];
  const footers: string[] = [];
  const counted: [number, number][] = [];
  const live: (number | null)[] = [];
  const ends: string[] = [];
  const hooks: DeliveryHooks = {
    line: (text, tone, kind) => lines.push({ text, tone, kind }),
    footer: t => footers.push(t),
    live: n => live.push(n),
    mark: m => marks.push(m),
    counted: (p, c) => counted.push([p, c]),
    ended: how => ends.push(how),
  };
  return { hooks, lines, marks, footers, counted, live, ends };
}
async function drain(g: AsyncGenerator<string>) {
  let text = '';
  for await (const p of g) text += p;
  return text;
}
const clock = () => { let t = 0; return () => (t += 100); };
const verdict = (completion: number | undefined, ok = true): Verdict => ({
  ok, line: '', receipt: ok ? { response_sha256: 'x' } : null, usage: { prompt_tokens: 12, completion_tokens: completion },
});

describe('the delivery under each answer', () => {
  it('a delivered answer: the model text only, then the delivery line, counted once', async () => {
    const r = recorder();
    const text = await drain(deliver(async function* (done) { yield 'Hello'; yield ' there'; done(verdict(2)); },
      r.hooks, { where: 'bankML in this browser', receipts: true, now: clock() }));
    expect(text).toBe('Hello there');
    expect(r.marks).toEqual([]);
    const last = r.lines[r.lines.length - 1];
    expect(last.kind).toBe('delivery');
    expect(last.tone).toBe('ok');
    expect(last.text).toMatch(/^delivered by the model — 12 prompt → 2 completion tokens · first token 0\.10 s · .* tok\/s · bankML in this browser · ✓ receipt/);
    expect(r.lines.some(l => l.text.startsWith('streaming · 2 pieces'))).toBe(true);
    expect(r.counted).toEqual([[12, 2]]);
    expect(r.live[r.live.length - 1]).toBeNull();
    expect(r.ends).toEqual(['delivered']);
  });

  it('no completion tokens counted: "No delivery from the model", not counted, kept out of the history', async () => {
    const r = recorder();
    await drain(deliver(async function* (done) { done(verdict(0)); }, r.hooks, { where: 'w', receipts: true }));
    expect(r.marks).toEqual([{ text: NO_DELIVERY, undelivered: true, silent: true }]);
    expect(r.lines[r.lines.length - 1]).toMatchObject({ tone: 'bad', kind: 'delivery' });
    expect(r.counted).toEqual([]);
    expect(r.ends).toEqual(['none']);
  });

  it('a provider with no token count but text: delivered, said so, with the page footer', async () => {
    const r = recorder();
    await drain(deliver(async function* (done) { yield 'hi'; done({ ok: false, line: '', receipt: null }); },
      r.hooks, { where: 'Qwen/Qwen3-8B via a Hugging Face provider', receipts: false, footer: 'not bankML · no receipt · your quota' }));
    expect(r.marks).toEqual([]);
    expect(r.lines[r.lines.length - 1].text).toContain('no token count was sent · 1 pieces');
    expect(r.lines[r.lines.length - 1].text).toContain('no receipt (not bankML)');
    expect(r.footers).toEqual(['added by this page, not the model: not bankML · no receipt · your quota']);
  });

  it('a provider answer stopped part-way keeps its footer and a line naming who wrote it; nothing is counted', async () => {
    const r = recorder();
    const stop = new AbortController();
    const g = deliver(async function* (done) { yield 'part'; yield 'more'; done({ ok: false, line: '', receipt: null }); },
      r.hooks, { where: 'Qwen/Qwen3-8B via a Hugging Face provider (not bankML)', receipts: false, footer: 'not bankML · no receipt · your quota', signal: stop.signal });
    expect((await g.next()).value).toBe('part');
    stop.abort();
    await g.return(undefined);
    expect(r.footers).toEqual(['added by this page, not the model: not bankML · no receipt · your quota']);
    expect(r.lines[r.lines.length - 1]).toMatchObject({ text: 'stopped after 1 piece · Qwen/Qwen3-8B via a Hugging Face provider (not bankML)', tone: 'bad' });
    expect(r.counted).toEqual([]);
    expect(r.ends).toEqual(['stopped']);
  });

  it('stopped while the stream was still finishing: never "delivered"', async () => {
    const r = recorder();
    const stop = new AbortController();
    await drain(deliver(async function* (done) { yield 'a'; stop.abort(); yield 'b'; done(verdict(2)); },
      r.hooks, { where: 'w', receipts: true, signal: stop.signal }));
    expect(r.lines.some(l => l.kind === 'delivery')).toBe(false);
    expect(r.counted).toEqual([]);
    expect(r.ends).toEqual(['stopped']);
  });

  it('not ready: the page offers, nothing is asked', async () => {
    const r = recorder();
    let asked = false;
    await drain(deliver(async function* () { asked = true; }, r.hooks, { where: 'w', receipts: true, prepare: async () => 'download first' }));
    expect(asked).toBe(false);
    expect(r.marks).toEqual([{ text: 'download first', undelivered: true, silent: true }]);
  });

  it('an error carries a plain hint', async () => {
    const r = recorder();
    await expect(drain(deliver(async function* () { throw new Error('TypeError: Failed to fetch'); }, r.hooks, { where: 'w', receipts: false })))
      .rejects.toThrow(/network request failed/);
    expect(r.lines[r.lines.length - 1]).toMatchObject({ tone: 'bad' });
    expect(r.ends).toEqual(['error']);
  });
});

describe('plain hints', () => {
  it('the download, the network, nothing else', () => {
    expect(hintFor('the download stopped at 5 of 9 bytes')).toMatch(/Import browseML/);
    expect(hintFor('TypeError: Failed to fetch')).toMatch(/network request failed/);
    expect(hintFor('something else')).toBe('');
    // browseML asks nothing of Hugging Face but the model: no hint sends anyone there
    for (const m of ['HTTP 402', 'no provider', 'hf.space', 'not signed in']) expect(hintFor(m)).not.toMatch(/Hugging Face|provider|free CPU|sign in/i);
  });
  it('the delivery line and the rule', () => {
    expect(wasDelivered('', verdict(3))).toBe(false);
    expect(wasDelivered('x', verdict(0))).toBe(false);
    expect(wasDelivered('x', null)).toBe(true);
    expect(deliveryLine({ where: 'w', receipts: true, verdict: { ...verdict(5), ok: false }, pieces: 5, ttftMs: 1500, streamMs: 1000 }))
      .toEqual({ text: 'delivered by the model — 12 prompt → 5 completion tokens · first token 1.50 s · 5.00 tok/s · w · ✗ receipt: the answer does NOT match its sha256', tone: 'bad' });
  });
});

describe('what a delivery measured, for a page\'s diagnostics', () => {
  it('a delivered answer reports its first token, stream time and speed; no delivery reports nothing', async () => {
    const r = recorder();
    const seen: import('../deliver').Measured[] = [];
    await drain(deliver(async function* (done) { yield 'a'; yield 'b'; done(verdict(4)); }, { ...r.hooks, measured: m => seen.push(m) },
      { where: 'w', receipts: true, now: clock() }));
    expect(seen).toHaveLength(1);
    // the clock ticks 100 ms a read: asked at 100, first token at 200, ended at 300
    expect(seen[0]).toMatchObject({ where: 'w', receipts: true, pieces: 2, ttftMs: 100, streamMs: 100, tokPerSec: 40 });
    expect(seen[0].verdict?.usage?.completion_tokens).toBe(4);
    const none: unknown[] = [];
    await drain(deliver(async function* (done) { done(verdict(0)); }, { ...r.hooks, measured: m => none.push(m) }, { where: 'w', receipts: true }));
    expect(none).toEqual([]);
  });
});
