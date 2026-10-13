// SPDX-License-Identifier: MIT
// How an answer is delivered, as on PYTHAI/savante: three things kept apart under each question.
//  · the answer   — only the text the model generated, streamed into the reply (React writes it as text, never markup)
//  · the footer   — a line the page adds (a provider's answer is not bankML), labelled as the page's
//  · the delivery — prompt → completion tokens, time to first token, tok/s, where it ran, the receipt's verdict
// With no completion tokens counted there was no delivery from the model: the reply says so instead of showing text,
// and the exchange never joins .history (the field keeps an undelivered reply out of it).
import type { ReplyMarks } from '../types';
import type { Verdict } from './engine';

export type Tone = 'ok' | 'bad' | 'working';

export interface DeliveryHooks {
  /** One line under the answer, updated in place: a status while it works, then the delivery. '' hides it. */
  line(text: string, tone?: Tone, kind?: 'status' | 'delivery'): void;
  /** A footer the page adds under the answer (not the model's words). */
  footer(text: string): void;
  /** While streaming: the pieces seen so far; null when the answer ended. */
  live(pieces: number | null): void;
  /** What the engine says about its reply (not delivered, with the words that say so; not read aloud). */
  mark(patch: ReplyMarks): void;
  /** A delivered answer's counts, for the session counter. */
  counted(prompt: number, completion: number): void;
  /** How the question ended, once: delivered (with its verdict), no delivery, stopped by the visitor, or an error. */
  ended?(how: Outcome, v: Verdict | null): void;
  /** A delivered answer's measurements (the numbers the delivery line shows), for a page's diagnostics. */
  measured?(m: Measured): void;
}

/** What the delivery line measured of one delivered answer. */
export interface Measured {
  where: string;
  receipts: boolean;
  verdict: Verdict | null;
  pieces: number;
  /** Time to first token, from the question being asked (after any download or offer). */
  ttftMs: number | null;
  /** First token to the end. */
  streamMs: number;
  /** Completion tokens over streamMs; null without a count. */
  tokPerSec: number | null;
}

export type Outcome = 'delivered' | 'none' | 'stopped' | 'error';

export interface DeliveryOptions {
  /** Where the model runs, as the delivery line names it. */
  where: string;
  /** Whether this answerer puts a receipt on every answer (bankML does; a provider does not). */
  receipts: boolean;
  /** A footer the page adds under every answer it asks for (shown from the start, so a stopped answer has it too). */
  footer?: string;
  /** Aborted when the visitor stops the answer (SendMeta.signal). */
  signal?: AbortSignal;
  /** Called first: resolves to a note when the answerer is not ready (nothing is asked then), null when it is. */
  prepare?: (progress: (line: string) => void) => Promise<string | null>;
  now?: () => number;
}

export const NO_DELIVERY = 'No delivery from the model: it counted no completion tokens, so there is no answer to show.';
export const NO_TEXT = 'No delivery from the model: it wrote no answer text (only reasoning, or nothing), so there is no answer to show.';

/** Plain hints for the errors a visitor meets, appended to the error's own words. */
export function hintFor(message: string, origin = typeof location !== 'undefined' ? location.origin : 'this page'): string {
  const m = String(message);
  if (/\b402\b|credit|payment required/i.test(m)) return 'Your Hugging Face Inference Providers credits appear to be spent for this period.';
  if (/\b404\b|not supported|no provider|model not found/i.test(m)) return 'No live provider serves that model: choose another in the .model window (owner/name).';
  if (/127\.0\.0\.1|localhost|loopback|local network|private network|your bankML/i.test(m)) {
    return `The browser may be keeping this page from 127.0.0.1: allow it to reach apps and services on this device (the local-network permission), and start serve with --allow-origin ${origin}.`;
  }
  if (/free CPU|hf\.space|gradio|mindXhfgradio/i.test(m)) return 'The free CPU Space did not answer: it may be waking up or busy — ask again in a minute, or use browseML (bankML in this browser).';
  if (/credential module|not signed in/i.test(m)) return 'Sign in (or paste a token) in the Hugging Face tab, or use the free CPU tab.';
  if (/download|browseml|dynamically imported|sha256|quota ?exceeded/i.test(m)) return 'The download failed: check the connection and press "Download and verify" in the browseML tab to try again.';
  if (/failed to fetch|networkerror|load failed|network/i.test(m)) return 'The network request failed: check the connection and ask again.';
  return '';
}

const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** The receipt's verdict in a few words. */
export function receiptWords(v: Verdict | null, receipts: boolean): string {
  if (!receipts) return 'no receipt (not bankML)';
  if (!v?.receipt) return '✗ no receipt came with this answer';
  return v.ok ? '✓ receipt: the answer matches its sha256' : '✗ receipt: the answer does NOT match its sha256';
}

/** The delivery line under a delivered answer; pure, so it is tested. */
export function deliveryLine(d: {
  where: string; receipts: boolean; verdict: Verdict | null; pieces: number; ttftMs: number | null; streamMs: number;
}): { text: string; tone?: Tone } {
  const u = d.verdict?.usage;
  const counts = u?.completion_tokens !== undefined
    ? `${u.prompt_tokens ?? '?'} prompt → ${u.completion_tokens} completion tokens`
    : `no token count was sent · ${d.pieces} pieces`;
  const tps = u?.completion_tokens && d.streamMs > 0 ? ` · ${(u.completion_tokens / (d.streamMs / 1000)).toFixed(2)} tok/s` : '';
  const first = d.ttftMs !== null ? ` · first token ${secs(d.ttftMs)}` : '';
  return {
    text: `delivered by the model — ${counts}${first}${tps} · ${d.where} · ${receiptWords(d.verdict, d.receipts)}`,
    tone: d.verdict?.ok ? 'ok' : d.receipts ? 'bad' : undefined,
  };
}

/** Was anything delivered? Text, and not a count of zero completion tokens. */
export const wasDelivered = (text: string, v: Verdict | null) => !!text.trim() && v?.usage?.completion_tokens !== 0;

/**
 * Wrap an engine's stream: the status line while it works ("reading the prompt", "streaming · N pieces"), the
 * no-delivery rule, the delivery line and footer under the answer, the session counter, and plain error hints.
 */
export async function* deliver(
  ask: (done: (v: Verdict) => void) => AsyncGenerator<string>,
  hooks: DeliveryHooks,
  opts: DeliveryOptions,
): AsyncGenerator<string> {
  const now = opts.now ?? (() => performance.now());
  let verdict: Verdict | null = null;
  let text = '', pieces = 0, first: number | null = null, ended = false, t0 = 0;
  const stopped = () => !!opts.signal?.aborted;
  try {
    if (opts.prepare) {
      const note = await opts.prepare(l => hooks.line(l, 'working', 'status'));
      if (note) {
        ended = true;
        hooks.mark({ text: note, undelivered: true, silent: true });
        hooks.line('a note from this page, not the model: nothing was asked yet', 'working', 'status');
        return;
      }
    }
    t0 = now();
    hooks.line(`${opts.where}: reading the prompt…`, 'working', 'status');
    // the page's footer goes under the answer from the start: an answer stopped part-way still says who wrote it
    if (opts.footer) hooks.footer(`added by this page, not the model: ${opts.footer}`);
    for await (const piece of ask(v => { verdict = v; })) {
      if (stopped()) break;
      if (first === null) first = now();
      text += piece;
      pieces += 1;
      hooks.live(pieces);
      hooks.line(`streaming · ${pieces} pieces · ${opts.where}`, 'working', 'status');
      yield piece;
    }
    ended = !stopped();
  } catch (e) {
    ended = true;
    const msg = String((e as Error)?.message || e);
    const hint = hintFor(msg);
    hooks.line(`no delivery — ${opts.where} did not answer`, 'bad', 'delivery');
    hooks.ended?.('error', null);
    throw new Error(hint ? `${msg}\n\n${hint}` : msg);
  } finally {
    hooks.live(null);
    // stopped by the visitor (the field says so under the answer): the line keeps who was writing, and nothing counts
    if (!ended) {
      hooks.line(`stopped after ${pieces} piece${pieces === 1 ? '' : 's'} · ${opts.where}`, 'bad', 'status');
      hooks.ended?.('stopped', null);
    }
  }
  if (!ended) return;
  const v = verdict as Verdict | null;
  if (!wasDelivered(text, v)) {
    const u = v?.usage;
    hooks.mark({ text: u?.completion_tokens ? NO_TEXT : NO_DELIVERY, undelivered: true, silent: true });
    hooks.line(`no delivery — ${u?.prompt_tokens ?? '?'} prompt → ${u?.completion_tokens ?? 0} completion tokens · ${opts.where}`, 'bad', 'delivery');
    hooks.ended?.('none', v);
    return;
  }
  const end = now();
  const d = deliveryLine({ where: opts.where, receipts: opts.receipts, verdict: v, pieces, ttftMs: first === null ? null : first - t0, streamMs: first === null ? 0 : end - first });
  // the answerer's own measure (the Space's stats), as Savante shows it; else the page's
  hooks.line(v?.delivery ?? d.text, v?.delivery ? (v.ok ? 'ok' : v.receipt ? 'bad' : undefined) : d.tone, 'delivery');
  // a footer the answerer's host added after the model's words: kept apart, labelled as its own
  if (v?.footer) hooks.footer(`added by the Space, not the model: ${v.footer}`);
  hooks.counted(v?.usage?.prompt_tokens ?? 0, v?.usage?.completion_tokens ?? 0);
  const streamMs = first === null ? 0 : end - first, c = v?.usage?.completion_tokens;
  hooks.measured?.({
    where: opts.where, receipts: opts.receipts, verdict: v, pieces, ttftMs: first === null ? null : first - t0, streamMs,
    tokPerSec: c && streamMs > 0 ? c / (streamMs / 1000) : null,
  });
  hooks.ended?.('delivered', v);
}

// ── the environment: where the model runs (server side) and what this device offers (read here, never sent) ──
/** What this browser reports of the device (null where it reports nothing); read here, never sent. */
export interface DeviceFacts { threads: number | null; ramGB: number | null; gpu: string | null; webgpu: boolean }
export function deviceFacts(nav: Navigator = navigator): DeviceFacts {
  const n = nav as Navigator & { deviceMemory?: number; gpu?: unknown };
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '') : '';
  } catch { /* no WebGL */ }
  return {
    threads: n.hardwareConcurrency || null,
    ramGB: n.deviceMemory || null,
    gpu: gpu ? gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 60) : null,
    webgpu: !!n.gpu,
  };
}
export function deviceLine(nav: Navigator = navigator): string {
  const f = deviceFacts(nav);
  return [
    `${f.threads ?? '?'} CPU threads`,
    // the browser rounds and caps what it reports (8 GB at most)
    f.ramGB ? `${f.ramGB >= 8 ? '≥ 8' : f.ramGB} GB RAM` : 'RAM not reported',
    f.gpu ? `GPU ${f.gpu}` : 'GPU not reported',
    f.webgpu ? 'WebGPU yes' : 'WebGPU no',
  ].join(' · ');
}
