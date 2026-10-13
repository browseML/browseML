// SPDX-License-Identifier: MIT
// What an answer is, for browseML's page: the turns sent, the receipt bankML returns and its verdict (checked here by
// the answer's sha256), the persona file shipped beside the page, and which past exchanges go back to the model.
// Nothing an engine returns becomes markup: the output fields render text only.

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
  /** A footer the page adds under the model's words, labelled as its own. */
  footer?: string;
  /** The delivery line as the answerer measured it, used instead of the page's own measure. */
  delivery?: string;
}

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
