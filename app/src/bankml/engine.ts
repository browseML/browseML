// SPDX-License-Identifier: MIT
// bankML, behind the ultimate input field: its answerers, never confused (the free CPU and browseML are in free.ts).
//  · local — this browser talks to `bankml serve` on the visitor's machine (started with --allow-origin for this
//    page): bankML's verified arithmetic, the visitor's CPU and RAM, a receipt on every answer whose sha256 is
//    checked here. Free; nothing leaves the visitor's machine.
//  · hf — a Hugging Face provider answers under bankML's persona, billed to the visitor's quota. NOT bankML's
//    arithmetic, no receipt; said on every answer. The token never enters this file: the request goes through the
//    GPL-3.0-only credential module's fetchWithToken (credsBridge.ts), which attaches it and refuses other hosts.
// Nothing an engine or a provider returns becomes markup: the output fields render text only.
// What the model is told comes from the input field's windows: .prompt or .persona (bankml.persona by default),
// .memory, and this output's .history — composed by the field into meta.context.system. bankML adds SELF.

import { creds } from './credsBridge';

/** space: "bankML · free CPU" (Bonsai on Hugging Face's free CPU, free.ts; the default) · browse: browseML, bankML in
 *  this browser (free.ts) · local: your own bankml serve · hf: a Hugging Face provider (not bankML). */
export type Engine = 'local' | 'hf' | 'browse' | 'space';
export type Turn = { role: 'user' | 'assistant'; content: string };

export interface Receipt {
  bankml?: string;
  model_sha256?: string;
  request_sha256?: string;
  response_sha256?: string;
  [k: string]: unknown;
}

export interface Verdict {
  ok: boolean;
  line: string;
  receipt: Receipt | null;
  /** serve's own counts from the final chunk: prompt and completion tokens, and how many came from its cache */
  usage?: { prompt_tokens?: number; completion_tokens?: number; cache_n?: number; finish?: string };
  /**
   * The user message exactly as it was sent (with SELF when it rides with the question). Replaying it unchanged in
   * later turns keeps the earlier exchanges a prefix serve's prompt cache already holds.
   */
  sent?: string;
  /** A footer the answerer's host added after the model's words (the Space's), split off and labelled as its own. */
  footer?: string;
  /** The delivery line as the answerer measured it (the Space's own stats), used instead of the page's measure. */
  delivery?: string;
}

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:18093';
export const DEFAULT_MODEL = 'Qwen/Qwen3-8B';
const MAX_TOKENS = 384;

const clean = (ep: string) => ep.trim().replace(/\/+$/, '') || DEFAULT_ENDPOINT;

export async function sha256hex(text: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A thinking model may still put its reasoning in the content as <think>…</think>: keep the answer only. */
export const answerOnly = (t: string) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');

/** bankml.persona as text, for the .persona window (the file is shipped beside the page, as in the bankml repo). */
export async function loadPersonaText(url = 'bankml.persona'): Promise<string> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`the persona could not be read: HTTP ${r.status}`);
  return r.text();
}

/**
 * Which past exchanges go back to the model. Past 12 the window does not slide one exchange per turn: it grows to
 * 16, then drops 4 at once, so the prompt right after the system message stays the same for 4 turns and bankML's
 * prompt cache keeps the prefix (sliding by one defeats it — see the bankml skill, "Pitfalls").
 */
export function slackWindow<T>(turns: T[], keep = 12, slack = 4): T[] {
  const n = turns.length;
  if (n <= keep + slack) return turns;
  const size = keep + 1 + ((n - keep - slack - 1) % slack);
  return turns.slice(n - size);
}

/** The verified model behind `GET /bankml`, for the .model window. */
export interface VerifiedModel {
  name: string;
  sha256: string;
  bankml: string;
}

async function getJSON(ep: string, path: string): Promise<any | null> {
  try {
    const r = await fetch(clean(ep) + path, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** What `GET /bankml` says: the verified model, or why there is none. */
export async function probe(ep: string): Promise<{ ok: boolean; line: string; model?: VerifiedModel }> {
  const b = await getJSON(ep, '/bankml');
  if (!b) {
    return {
      ok: false,
      line: `not reachable at ${clean(ep)} — start it with: bankml serve MODEL.gguf --fork FORK.json --native --allow-origin ${location.origin}`,
    };
  }
  const v = b.verified || {};
  if (v.guard !== 'play') return { ok: false, line: 'connected, but no verified model is loaded yet' };
  const model = { name: String(v.name || b.resident || 'model'), sha256: String(v.model_sha256 || ''), bankml: String(v.bankml || '') };
  return { ok: true, model, line: `✓ ${model.name} · bankML ${model.bankml} · sha256 ${model.sha256.slice(0, 12)}…` };
}

/** The .model file for an engine: the verified, pinned model of your bankML, or the provider model (not bankML). */
export function modelFile(engine: Engine, m: { local?: VerifiedModel; provider: string }): string {
  if (engine === 'browse') {
    return `# bankML in this browser (browseML): the model is checked against its sha256 pin before it answers; free
model_facet: bankml.browser
task_class: general          # general | reasoning | code_generation | simple_chat
logical_model: Bonsai-1.7B-Q1_0
pinned: true
`;
  }
  if (engine === 'space') {
    return `# Bonsai on the free public CPU (Hugging Face Space Gregory-L/mindXhfgradio, llama.cpp): NOT bankML, no receipt, free
model_facet: hf.space
task_class: general          # general | reasoning | code_generation | simple_chat
logical_model: Ternary-Bonsai-8B-Q2_0_g64
pinned: true
`;
  }
  if (engine === 'hf') {
    return `# a Hugging Face provider answers: NOT bankML, no receipt, billed to your quota
model_facet: hf.provider
task_class: general          # general | reasoning | code_generation | simple_chat
logical_model: ${m.provider}
pinned: false
`;
  }
  const l = m.local;
  return `# the model your bankML serves, verified: the guard passed and the sha256 matched its pin (GET /bankml)
model_facet: bankml.local
task_class: general          # general | reasoning | code_generation | simple_chat
logical_model: ${l ? l.name : 'auto'}
pinned: ${l ? 'true' : 'false'}
${l ? `model_sha256: ${l.sha256}\nbankml: ${l.bankml}\n` : ''}`;
}

/**
 * How SELF reads. `aware` (default since 0.1.8): the console's two lines, with the first saying what the model is
 * (architecture, parameters, weights, as serve's registry reports them) and naming the other verified models it can
 * load. `console` (0.1.7): byte for byte sAGI/console.py's `self_text` — two lines, who is
 * speaking ("I am bankML <v>. The model file I run is <name> …: it is what I compute with, not who I am"), then
 * every measurement with its unit on one line. `long`: 0.1.6's nine lines, same first line. `legacy`: the console's
 * old first line, "the model I am running: <name>", kept so the 0.1.6 A/B can be reproduced (with it, a 1-bit 8B
 * model twice answered "I am … Bonsai-8B"; with the new line, 3 of 3 "I am bankML").
 */
export type SelfStyle = 'aware' | 'console' | 'long' | 'legacy';

/** One model bankML can run, as its registry describes it (GET /bankml and the native /api/tags). */
export interface ModelFacts {
  name: string;
  arch?: string | null;
  parameters?: string | null;
  quantization?: string | null;
}

/** What bankML measures of itself now, as sAGI/console.py `self_block` reads it: null where it was not measured. */
export interface SelfBlock {
  /** The resident model's facts (architecture, size, weights), when serve reports them. */
  facts?: ModelFacts | null;
  /** The other verified models in serve's registry (one is resident at a time). */
  others?: ModelFacts[];
  model: string | null;
  model_sha256: string | null;
  bankml: string | null;
  prompt_tokens_total: number | null;
  completion_tokens_total: number | null;
  last_ttft_ms: number | null;
  last_prompt_tps: number | null;
  last_eval_tps: number | null;
  cpu_percent: number | null;
  rss_bytes: number | null;
  mem_available_bytes: number | null;
  gpu_busy_percent: number | null;
  gpu_limit: number | null;
  gpu_allocated_bytes: number | null;
  package_watts: number | null;
  joules_per_token: number | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);

export async function selfBlock(ep: string): Promise<SelfBlock> {
  const [b, u, m, t] = await Promise.all([
    getJSON(ep, '/bankml'),
    getJSON(ep, '/bankml/usage'),
    getJSON(ep, '/bankml/metrics'),
    getJSON(ep, '/api/tags'), // the registry, on serve --native; null elsewhere
  ]);
  const B = b || {}, U = u || {}, M = m || {};
  const tags: { name?: string; details?: { parameter_size?: string; quantization_level?: string } }[] = Array.isArray(t?.models) ? t.models : [];
  const bare = (n: string) => n.replace(/:latest$/, '');
  const resident = str(B.resident);
  const factsOf = (name: string): ModelFacts => {
    const tag = tags.find(x => bare(x.name || '') === name);
    return { name, parameters: str(tag?.details?.parameter_size), quantization: str(tag?.details?.quantization_level) };
  };
  const last = (M.records || [{}]).slice(-1)[0] || {};
  const gpu = (Array.isArray(U.gpus) && U.gpus[0]) || {};
  const lim = U.gpu_limiter || {};
  const v = B.verified || {};
  const registry: string[] = Array.isArray(B.models) ? B.models.filter((x: unknown): x is string => typeof x === 'string') : [];
  const mine = resident ? factsOf(resident) : null;
  return {
    facts: mine && { ...mine, name: str(v.name) ?? mine.name, arch: str(v.arch) },
    others: registry.filter(n => n !== resident).map(factsOf),
    model: str(v.name) ?? str(B.resident), model_sha256: str(v.model_sha256), bankml: str(v.bankml),
    prompt_tokens_total: num(M.prompt_tokens), completion_tokens_total: num(M.completion_tokens),
    last_ttft_ms: num(last.ttft_ms), last_prompt_tps: num(last.prompt_tps), last_eval_tps: num(last.eval_tps),
    cpu_percent: num(U.cpu_percent), rss_bytes: num(U.rss_bytes), mem_available_bytes: num(U.mem_available_bytes),
    gpu_busy_percent: num(gpu.busy_percent), gpu_limit: num(lim.limit), gpu_allocated_bytes: num(lim.allocated_bytes),
    package_watts: num(U.package_watts), joules_per_token: num(M.joules_per_token),
  };
}

/** The SELF text for a block; pure, so it is tested against the console's own function. */
const WEIGHTS: Record<string, string> = { Q1_0: '1-bit', Q2_0_g64: 'ternary', Q2_0: 'ternary', F16: '16-bit', BF16: '16-bit', F32: '32-bit', Q8_0: '8-bit' };

/** "qwen3, 8.2B parameters, 1-bit Q1_0 weights": what serve reports about a model, nothing guessed. */
export function describeModel(f: ModelFacts | null | undefined): string {
  if (!f) return '';
  const q = f.quantization ? `${WEIGHTS[f.quantization] ? WEIGHTS[f.quantization] + ' ' : ''}${f.quantization} weights` : '';
  return [f.arch, f.parameters ? `${f.parameters} parameters` : '', q].filter(Boolean).join(', ');
}

export function selfTextFrom(sb: SelfBlock, style: SelfStyle = 'aware'): string {
  const v = (x: number | null, unit = '', scale = 1, d = 1) => (x === null ? 'not measured' : (x * scale).toFixed(d) + unit);
  const sha = (sb.model_sha256 || '').slice(0, 16);
  let who =
    '- I am bankML' + (sb.bankml ? ` ${sb.bankml}` : '') + `. The model file I run is ${sb.model || 'none'}` +
    (sha ? ` (sha256 ${sha}…)` : '') + ': it is what I compute with, not who I am';
  if (style === 'aware') {
    // the console's line, plus what the model is and which others the registry holds, as serve reports them
    const d = describeModel(sb.facts);
    const inside = [d, sha ? `sha256 ${sha}…` : ''].filter(Boolean).join('; ');
    who =
      '- I am bankML' + (sb.bankml ? ` ${sb.bankml}` : '') + `. The model file I run is ${sb.model || 'none'}` +
      (inside ? ` (${inside})` : '') + ': it is what I compute with, not who I am';
    const others = (sb.others || []).map(o => (describeModel(o) ? `${o.name} (${describeModel(o)})` : o.name));
    if (others.length) who += `. I can also load, one at a time and each verified before it answers: ${others.join(', ')}`;
  }
  if (style === 'console' || style === 'aware') {
    const now =
      '- measured now: tokens read in total ' + v(sb.prompt_tokens_total, '', 1, 0) +
      ', written ' + v(sb.completion_tokens_total, '', 1, 0) +
      '; my last answer: first token after ' + v(sb.last_ttft_ms, ' milliseconds', 1, 0) +
      ', reading at ' + v(sb.last_prompt_tps, ' tokens per second') +
      ', writing at ' + v(sb.last_eval_tps, ' tokens per second') +
      '; CPU ' + v(sb.cpu_percent, ' percent of one core') +
      '; memory I hold ' + v(sb.rss_bytes, ' GB', 1e-9, 2) + ', still available ' + v(sb.mem_available_bytes, ' GB', 1e-9, 2) +
      '; GPU busy ' + v(sb.gpu_busy_percent, ' percent', 1, 0) + ', my GPU limit ' + v(sb.gpu_limit, ' percent of its memory and time', 100, 0) +
      ', GPU memory I hold ' + v(sb.gpu_allocated_bytes, ' MB', 1e-6, 0) +
      '; power ' + v(sb.package_watts, ' watts') + ', energy per token I write ' + v(sb.joules_per_token, ' joules', 1, 3);
    return who + '\n' + now;
  }
  const first =
    style === 'legacy'
      ? `- the model I am running: ${sb.model || 'none'} (sha256 ${sha}…), bankML ${sb.bankml}`
      : who;
  return [
    first,
    `- tokens I have read in total (prompts): ${v(sb.prompt_tokens_total, '', 1, 0)}`,
    `- tokens I have written in total (answers): ${v(sb.completion_tokens_total, '', 1, 0)}`,
    `- time to first token of my last answer: ${v(sb.last_ttft_ms, ' milliseconds', 1, 0)}`,
    `- prompt reading speed of my last answer: ${v(sb.last_prompt_tps, ' tokens per second')}`,
    `- generation speed of my last answer: ${v(sb.last_eval_tps, ' tokens per second')}`,
    `- CPU use right now: ${v(sb.cpu_percent, ' percent of one core')}`,
    `- memory I hold (RSS): ${v(sb.rss_bytes, ' GB', 1e-9, 2)}; memory still available on this machine: ${v(sb.mem_available_bytes, ' GB', 1e-9, 2)}`,
    `- power the CPU package draws: ${v(sb.package_watts, ' watts')}; energy per token I write: ${v(sb.joules_per_token, ' joules', 1, 3)}`,
  ].join('\n');
}

/** SELF for the endpoint now. A stored 0.1.6 "clear" choice is the long form; "console" there meant legacy. */
export async function selfText(ep: string, style: SelfStyle | 'clear' = 'aware'): Promise<string> {
  const s: SelfStyle = style === 'clear' ? 'long' : style;
  return selfTextFrom(await selfBlock(ep), s);
}

/**
 * Ask the visitor's own bankML. Yields the answer as it streams; when the stream ends, `done` receives the
 * receipt's verdict — the sha256 of the text received, compared with the receipt's response_sha256.
 */
/**
 * Where SELF goes. `system` (as sAGI/console.py): in the system message, so it changes the prompt before the history
 * every turn and serve's cache ends there. `turn`: with the new question; with the question replayed exactly as sent
 * (`Verdict.sent`, kept in .history), every earlier exchange stays a prefix serve's cache holds. Measured on the
 * real serve with each answer's cache_n (see the 0.1.3 commit).
 */
export type SelfPlacement = 'turn' | 'system';

// ── the page's own log: what each request did, for the operator and for test harnesses ───────────────────────────
export interface LogEntry {
  at: number;
  level: 'info' | 'error';
  event: string;
  [k: string]: unknown;
}
const LOG = 'bankml-ui:log';
const LOG_KEEP = 200;
export function readLog(): LogEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG) || '[]'); } catch { return []; }
}
export function log(level: LogEntry['level'], event: string, fields: Record<string, unknown> = {}) {
  const entry: LogEntry = { at: Date.now() / 1000, level, event, ...fields };
  try { localStorage.setItem(LOG, JSON.stringify([...readLog(), entry].slice(-LOG_KEEP))); } catch { /* storage off */ }
  (level === 'error' ? console.error : console.info)('[bankml-ui]', event, fields);
}
export function clearLog() {
  try { localStorage.removeItem(LOG); } catch { /* storage off */ }
}

export async function* askLocal(
  ep: string,
  composed: string,
  history: Turn[],
  message: string,
  done: (v: Verdict) => void,
  placement: SelfPlacement = 'system',
  style: SelfStyle | 'clear' = 'aware',
): AsyncGenerator<string> {
  // the field's composed system prompt (.prompt or the persona's, persona lines, .memory), and SELF
  const self = 'SELF (measured by bankML just now):\n' + (await selfText(ep, style));
  const system = placement === 'system' ? (composed ? composed + '\n\n' : '') + self : composed;
  const question = placement === 'turn' ? `${message}\n\n${self}` : message;
  const t0 = performance.now();
  const msgs = [...(system ? [{ role: 'system', content: system }] : []), ...history, { role: 'user', content: question }];
  log('info', 'request', { endpoint: clean(ep), placement, messages: msgs.length, chars: msgs.reduce((n, m) => n + m.content.length, 0) });
  let r: Response;
  try {
    r = await fetch(clean(ep) + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, stream: true, max_tokens: MAX_TOKENS }),
    });
  } catch (e) {
    // the browser gives no detail; the common causes, in order
    log('error', 'fetch failed', { ms: Math.round(performance.now() - t0), error: String(e) });
    throw new Error(`could not reach your bankML at ${clean(ep)} (${String((e as Error).message || e)}): is serve running with --allow-origin ${location.origin}, and did you allow this page to reach this device?`);
  }
  if (!r.ok || !r.body) {
    const body = (await r.text()).slice(0, 300);
    log('error', 'http error', { status: r.status, body });
    throw new Error(`bankML answered HTTP ${r.status}: ${body}`);
  }
  log('info', 'headers', { ms: Math.round(performance.now() - t0) });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', first = 0;
  let receipt: Receipt | null = null;
  let usage: Verdict['usage'];
  let engineError: string | null = null;
  let finished = false;
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
        const d = JSON.parse(line.slice(5));
        if (d.bankml_receipt) { receipt = d.bankml_receipt; continue; }
        // serve reports a run that failed after the headers as {"error": …} in the stream (serve.rs native_chat)
        if (d.error !== undefined) { engineError = typeof d.error === 'string' ? d.error : JSON.stringify(d.error); continue; }
        const choice = d.choices?.[0];
        if (choice?.finish_reason) {
          usage = { prompt_tokens: d.usage?.prompt_tokens, completion_tokens: d.usage?.completion_tokens, cache_n: d.timings?.cache_n, finish: choice.finish_reason };
        }
        const piece: string | undefined = choice?.delta?.content;
        if (piece) {
          if (!first) { first = performance.now(); log('info', 'first token', { ms: Math.round(first - t0) }); }
          text += piece;
          yield piece;
        }
      }
    }
    finished = true;
  } catch (e) {
    finished = true;
    log('error', 'stream broken', { ms: Math.round(performance.now() - t0), chars: text.length, error: String(e) });
    throw new Error(`the answer stopped after ${text.length} characters: the connection to your bankML broke (${String((e as Error).message || e)})`);
  } finally {
    // stopped by the visitor: close the stream, so serve stops writing
    if (!finished) void reader.cancel().catch(() => {});
  }
  if (engineError) {
    log('error', 'engine error', { ms: Math.round(performance.now() - t0), error: engineError });
    throw new Error(`bankML could not finish this answer: ${engineError}`);
  }
  const ok = !!receipt && (await sha256hex(text)) === receipt.response_sha256;
  log(ok ? 'info' : 'error', 'done', { ms: Math.round(performance.now() - t0), chars: text.length, receipt: !!receipt, verified: ok, ...usage });
  const counts = usage?.prompt_tokens !== undefined ? ` · prompt ${usage.prompt_tokens} tokens, ${usage.cache_n ?? 0} from cache` : '';
  done({
    ok,
    receipt,
    usage,
    sent: question,
    line: receipt
      ? `${ok ? '✓' : '✗'} receipt · bankML ${receipt.bankml} · model sha256 ${String(receipt.model_sha256 || '').slice(0, 12)}… · answer sha256 ${ok ? 'matches the text received' : 'does NOT match the text received'}${counts}`
      : `✗ no receipt came with this answer${text ? '' : ' (and no text: see "log")'}`,
  });
}

// ── a Hugging Face provider (not bankML) ────────────────────────────────────────────────────────────────────────
export const ROUTER = 'https://router.huggingface.co/v1/chat/completions';
export const isRepoId = (model: string) => /^[\w.-]+\/[\w.-]+$/.test(model);

/** Parse an OpenAI-shaped SSE stream: the pieces of content, and the usage when it comes. */
export async function* sseChat(body: ReadableStream<Uint8Array>, usage: (u: { prompt_tokens?: number; completion_tokens?: number }) => void): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '', finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let d: any;
        try { d = JSON.parse(data); } catch { continue; }
        if (d.error) throw new Error(typeof d.error === 'string' ? d.error : d.error.message || JSON.stringify(d.error));
        if (d.usage) usage({ prompt_tokens: d.usage.prompt_tokens, completion_tokens: d.usage.completion_tokens });
        const piece: string | undefined = d.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      }
    }
    finished = true;
  } finally {
    if (!finished) void reader.cancel().catch(() => {});
  }
}

export async function* askProvider(
  model: string,
  composed: string,
  turns: Turn[],
  message: string,
  done: (v: Verdict) => void,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const c = creds();
  if (!c) throw new Error('the credential module (bankml-creds.js) is not loaded on this page: no Hugging Face sign-in here');
  if (!c.status().signedIn) throw new Error('not signed in to Hugging Face: sign in (or paste a token) in the Hugging Face tab');
  if (!isRepoId(model)) throw new Error('the model must be a Hugging Face repository id, owner/name (set it in the .model window)');
  // the field's composed system prompt, told the truth about where it is running
  const system = composed + `\n\nWHERE THIS REPLY COMES FROM: you speak for bankML — its design, its rule, its voice — but this particular reply is generated by ${model} through a Hugging Face inference provider, not by bankML's engine: there is no bankML arithmetic, no receipt and no SELF block behind it. Answer as bankML would about what bankML is and does; when asked about your speed, use, receipt, verification or what is running right now, say plainly that this reply comes from ${model}, not from bankML, and that the visitor's own bankML gives verified answers.`;
  // Qwen3 and other thinking models: /no_think in the prompt and enable_thinking off, or the whole budget can go to
  // reasoning and no answer arrives
  const r = await c.fetchWithToken(ROUTER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model, max_tokens: 512, stream: true, stream_options: { include_usage: true },
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: system + '\n/no_think' }, ...turns, { role: 'user', content: message }],
    }),
  });
  if (!r.ok || !r.body) {
    const body = (await r.text().catch(() => '')).slice(0, 300);
    throw new Error(`the Hugging Face router answered HTTP ${r.status}: ${body}`);
  }
  let raw = '', shown = '';
  let usage: Verdict['usage'];
  for await (const piece of sseChat(r.body, u => { usage = u; })) {
    raw += piece;
    const now = answerOnly(raw);
    if (now.length > shown.length && now.startsWith(shown)) { yield now.slice(shown.length); shown = now; }
  }
  // nothing shown (only reasoning, or nothing): the page says "no delivery from the model", not words of its own
  done({ ok: false, receipt: null, usage, line: `not bankML — ${model} via a Hugging Face provider · no receipt · your quota` });
}
