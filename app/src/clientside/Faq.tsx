// SPDX-License-Identifier: MIT
// The FAQ, answered by browseML itself: each question is asked in its own response window, so the visitor reads the
// answer from the model running on their own computer, with a receipt. Before the model is loaded, the window offers
// "Import browseML" and asks the question as soon as it is ready. The facts the model answers from are in
// browseml.persona, beside the page.
import type { MutableRefObject } from 'react';
import type { UIFContextValue } from '../components/UIFContext';

export const FAQ: readonly string[] = [
  'What is browseML?',
  'Does anything I type leave my computer?',
  'How do I know an answer really came from you?',
  'How is the model checked before you answer?',
  'Which model are you, and how big is it?',
  'How fast are you on my computer?',
  'How much memory do you use, and can I limit it?',
  'How do I remove you from my browser?',
];

export function Faq({ uif }: { uif: MutableRefObject<UIFContextValue | null> }) {
  const ask = (q: string) => {
    const f = uif.current;
    if (!f) return;
    // its own window, titled by the question
    f.sendTo(q, f.outputs.spawn(q.replace(/\?$/, '').slice(0, 40)));
  };
  return (
    <section className="cs-faq" aria-labelledby="cs-faq-title">
      <h2 id="cs-faq-title">Questions? Ask browseML.</h2>
      <p>Load the model into your browser once, and browseML answers these itself — on your computer, with a receipt.</p>
      <div className="cs-faq-list">
        {FAQ.map(q => (
          <button key={q} type="button" className="cs-faq-q" onClick={() => ask(q)}>{q}</button>
        ))}
      </div>
    </section>
  );
}
