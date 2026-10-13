// SPDX-License-Identifier: MIT
// Who answers, in the words every bankML page uses (bankML UIF, mindx.pythai.net/bankml): the tabs' names in their
// order, the note under each tab, where the model runs, the pill, and the visitor's choice as kept in localStorage.
// One copy, so no page names an answerer differently.
//  1. bankML · free CPU — the default; answers at once: Bonsai on Hugging Face's free CPU (llama.cpp, not bankML's
//     engine, no receipt) until bankML itself runs on that Space; then bankML, with its receipt checked.
//  2. browseML — bankML in this browser: a 248 MB download the visitor agrees to, verified, receipts checked.
//  3. your own bankML — bankml serve on 127.0.0.1:18093, started with --allow-origin for this page.
//  4. Hugging Face — a provider under the visitor's own account: not bankML, no receipt, the visitor's quota.
import { DEFAULT_ENDPOINT, DEFAULT_MODEL, type Engine, type VerifiedModel } from './engine';
import { SPACE_HONEST, SPACE_BANKML, FREE_SPACE } from './free';
import { MODE_BAR } from '../core/builtins';

export interface Prefs {
  engine: Engine; endpoint: string; model: string;
  /** The free CPU's model: Ternary-Bonsai-8B (default) or Bonsai-8B (1-bit). */
  spaceModel?: 'ternary' | 'bonsai';
  self?: import('./engine').SelfPlacement; selfStyle?: import('./engine').SelfStyle | 'clear';
}

/** The tabs, in this order, on every page. */
export const TAB_ORDER: readonly Engine[] = ['space', 'browse', 'local', 'hf'];

/** A visit's choice, or the first visit's: the free CPU (answers at once). A choice this page does not offer comes back to it. */
export function loadPrefs(key: string, offered: readonly Engine[]): Prefs {
  const d: Prefs = { engine: 'space', endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL, spaceModel: 'ternary' };
  let p = d;
  try { p = { ...d, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { /* storage off */ }
  return offered.includes(p.engine) ? p : { ...p, engine: offered[0] ?? 'space' };
}
export function savePrefs(key: string, p: Prefs) { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage off */ } }
export const nextEngine = (e: Engine, offered: readonly Engine[]): Engine => offered[(offered.indexOf(e) + 1) % offered.length];

/** The tabs' names. */
export const TAB: Record<Engine, string> = {
  space: 'bankML · free CPU',
  browse: 'browseML',
  local: 'your own bankML',
  hf: 'Hugging Face',
};
/** The longer names (T mode, titles). */
export const NAME: Record<Engine, string> = {
  space: "bankML · free CPU (Bonsai on Hugging Face's free CPU)",
  browse: 'browseML — bankML in this browser',
  local: 'your own bankML',
  hf: 'a Hugging Face provider — not bankML',
};
/** The free CPU's honest label now: Bonsai (no receipt), or bankML with a receipt once the Space runs it. */
export const spaceLabel = (bankml = false) => (bankml ? SPACE_BANKML : SPACE_HONEST);
export const ENGINE_SAYS: Record<Engine, (model: string, bankml?: boolean) => string> = {
  space: (_m, b) => `engine: ${spaceLabel(b)} — free, answers at once; what you type is processed on a public Space`,
  browse: () => "engine: browseML, bankML in this browser — free, the model checked against its sha256 pin, every answer's receipt checked here",
  local: () => "engine: your own bankML — bankML's arithmetic on your machine, every answer's receipt checked here",
  hf: (m) => `engine: ${m} through a Hugging Face provider — NOT bankML, no receipt, your quota`,
};
/** The note under each tab: where it runs, what it costs, what is private. */
export const CARRIER: Record<Engine, (p: Prefs, bankml?: boolean) => string> = {
  space: (_p, b) => `${spaceLabel(b)}. Answers at once, free, no sign-in, one answer at a time (the Space ${FREE_SPACE}). Public: what you type is processed on a public Hugging Face Space — do not type anything private.`,
  browse: () => 'bankML itself in this browser: bankML compiled to WebAssembly, Bonsai-1.7B Q1_0 — 248 MB downloaded once from huggingface.co when you agree, checked against its sha256 pin, kept here. Free. Nothing you type leaves this device; every receipt is checked on this page.',
  local: (p) => `Your machine: your bankml serve at ${p.endpoint}, started with --allow-origin for this page. Free. Nothing leaves your machine; every receipt is checked on this page.`,
  hf: (p) => `A Hugging Face inference provider (${p.model}) under your own account: not bankML · no receipt · your quota. Free accounts have no included inference credit since 2026-10-07. Your question goes to the provider.`,
};
/** Where the model runs (server side), for the environment line. */
export const RUNS_ON: Record<Engine, (p: Prefs, m?: VerifiedModel) => string> = {
  space: (p) => `Hugging Face's free public CPU — ${p.spaceModel === 'bonsai' ? 'Bonsai-8B (1-bit)' : 'Ternary-Bonsai-8B'} in llama.cpp (${FREE_SPACE})`,
  browse: () => 'this browser — bankML in WebAssembly, Bonsai-1.7B Q1_0',
  local: (p, m) => `your machine — bankml serve at ${p.endpoint}${m ? ` (${m.name})` : ''}`,
  hf: (p) => `a Hugging Face provider's servers — ${p.model}`,
};
export const PILL: Record<Engine, string> = { space: 'free CPU · not bankML', browse: 'browseML', local: 'bankML · yours', hf: 'HF · not bankML' };
/** The footer under every free-CPU answer (the honest label), and under every provider answer. */
export const FOOTER: Partial<Record<Engine, (bankml?: boolean) => string>> = {
  space: b => spaceLabel(b),
  hf: () => 'not bankML · no receipt · your quota',
};
/** Said in place of an answer when browseML is not downloaded yet (the consent card is shown above). */
export const OFFER = 'Not asked yet: browseML (bankML in this browser) needs a one-time download first — Bonsai-1.7B ' +
  'Q1_0, 248 MB, checked against its sha256 pin and then kept in this browser. The card in the browseML tab says what ' +
  'will happen; nothing downloads until you press "Download and verify", and then your question is asked. Or choose ' +
  'the free CPU tab, which answers at once.';
/** The command that starts the visitor's own bankML for a page at `origin`. */
export const serveCommand = (origin: string) =>
  `bankml serve MODEL.gguf --fork FORK.json --native --listen 127.0.0.1:18093 --allow-origin ${origin}`;
/** The chat bar starts with ⬇ (browseML), then the field's own. */
export const LOAD_FIRST = ['bankml-load', ...MODE_BAR.chat] as const;
