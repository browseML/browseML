// SPDX-License-Identifier: MIT
// AUGMENT: what modules add to a question as the model reads it. Each augmenter returns a block (or ""); the blocks
// come first, then "Question: …". The record of the exchange keeps the question as typed. With no module adding
// anything, the question goes as it is — the pure core.
type Augmenter = (question: string) => string;
const augmenters: Augmenter[] = [];
export function addAugmenter(f: Augmenter) { if (!augmenters.includes(f)) augmenters.push(f); }
export function augment(question: string): string {
  const blocks = augmenters.map(f => { try { return f(question); } catch { return ''; } }).filter(Boolean);
  return blocks.length ? `${blocks.join('\n\n')}\n\nQuestion: ${question}` : question;
}
