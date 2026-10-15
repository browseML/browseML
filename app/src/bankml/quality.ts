// SPDX-License-Identifier: MIT
// QUALITY: how browseML's answers measure, from its own record (.history) — accuracy as the share of delivered answers
// whose receipt checked, and the clarity and genius of the answers that succeeded, by mindX editor.agent's own formulas
// (agents/editor_agent.py, _score_clarity and _score_genius; bars 0.90), ported to the letter so the browser and mindX
// score the same text the same way. Crude and transparent on purpose, as the editor says of them: you can read the
// formula. Not a substitute for taste.

export const CLARITY_BAR = 0.90, GENIUS_BAR = 0.90;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** editor.agent _score_clarity: an average near 16 words a sentence, few over 34. */
export function clarity(text: string): number {
  const s = sentences(text);
  if (!s.length) return 0;
  const lens = s.map(x => x.split(/\s+/).filter(Boolean).length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  const longFrac = lens.filter(n => n > 34).length / lens.length;
  const avgScore = Math.max(0, 1 - Math.abs(avg - 16) / 22);
  return clamp(0.7 * avgScore + 0.3 * (1 - longFrac));
}

const MARKERS = ['because', 'however', 'irony', 'paradox', 'precisely', 'exactly', 'not …', 'rather', 'sideways', 'the deeper',
  'the point is', 'make no mistake'];
/** editor.agent _score_genius: lexical diversity, insight markers, citations (plain text: visible URLs). 0 under 40 words. */
export function genius(text: string, linkCount = 0): number {
  const low = text.toLowerCase();
  const words = low.match(/[a-z][a-z'-]+/g) ?? [];
  if (words.length < 40) return 0;
  const ttr = new Set(words).size / words.length;
  const m = MARKERS.filter(k => low.includes(k)).length;
  const cites = linkCount || (low.match(/http/g)?.length ?? 0);
  return clamp(0.5 * Math.min(1, ttr / 0.55) + 0.3 * Math.min(1, m / 6) + 0.2 * Math.min(1, cites / 6));
}

export interface Rec { assistant?: unknown; verified?: unknown; receipt?: unknown; engine?: unknown }
export interface Quality {
  delivered: number;         // answers that came with a receipt (or a verdict)
  verified: number;          // of those, the receipt checked ✓
  accuracy: number | null;   // verified / delivered
  scored: number;            // verified answers long enough to score genius (40 words or more)
  short: number;             // verified answers under 40 words (clarity only; genius would read 0)
  clarity: { median: number; mean: number; pass: number } | null;   // over verified answers
  genius: { median: number; mean: number; pass: number } | null;    // over verified answers of 40 words or more
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const stats = (xs: number[], bar: number) => xs.length
  ? { median: med(xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length, pass: xs.filter(x => x >= bar).length } : null;

/** From .history: what was delivered, what succeeded, and how what succeeded reads. */
export function measure(history: Rec[]): Quality {
  const delivered = history.filter(h => typeof h.verified === 'boolean' || h.receipt != null);
  const ok = delivered.filter(h => h.verified === true && typeof h.assistant === 'string' && h.assistant.trim());
  const texts = ok.map(h => String(h.assistant));
  const long = texts.filter(t => (t.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).length >= 40);
  return {
    delivered: delivered.length, verified: ok.length,
    accuracy: delivered.length ? ok.length / delivered.length : null,
    scored: long.length, short: texts.length - long.length,
    clarity: stats(texts.map(t => clarity(t)), CLARITY_BAR),
    genius: stats(long.map(t => genius(t)), GENIUS_BAR),
  };
}
