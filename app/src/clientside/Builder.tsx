// SPDX-License-Identifier: MIT
// BUILDER: browseML builds with the visitor, on this computer.
//   .persona — describe who should answer; browseML fills the name, the opening message and the system prompt (each
//              field still the visitor's to edit), then USE, SAVE (to PERSONA) or EXPORT as a .persona file
//   .prompt  — describe a task; browseML writes a system prompt for it; SET makes it the prompt questions are asked with
//   .memory  — a note kept in .memory and given to the model with every question
// What browseML writes is a draft from a 1.7B model: read it before using it. Each fill is an answer like any other,
// with its receipt, logged in the ENGINE LOG.
import { useState, type MutableRefObject } from 'react';
import { Button, SegmentSwitch } from 'dreamknob';
import type { UIFContextValue } from '../components/UIFContext';
import { askBrowse, browseState, download, loadBrowse, browseCached } from '../bankml/free';
import { applyPersona, savePersona, toFile, type Persona } from './Persona';

type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;
const tokens = (t: string) => Math.ceil(t.length / 4);

const PERSONA_BUILDER = `You write .persona files for bankML: a persona a small language model answers as.
Reply with exactly three lines and nothing else:
NAME: a short name
OPENING: the persona's first words to a visitor, one or two sentences
PROMPT: the system prompt, in the second person ("You are <the name>, ..."), plain sentences, under 120 words, saying who it is, how it answers, and what it must not do
Write as the persona itself: never mention being a language model.`;
const PROMPT_BUILDER = `You write system prompts for a small language model. Reply with the system prompt only: second person ("You are ..."), plain sentences, under 100 words, saying the task, how to answer, and when to say "I don't know".`;

/** The three fields from browseML's reply (pure, so tested). */
export function parseFill(text: string): { name?: string; opening?: string; system_prompt?: string } {
  const t = text.replace(/\r/g, '');
  const field = (k: string) => t.match(new RegExp(`^\\s*\\**${k}\\**\\s*:\\s*\\**\\s*(.+)$`, 'im'))?.[1]?.trim();
  const prompt = t.match(/^\s*\**PROMPT\**\s*:\s*\**\s*([\s\S]+)$/im)?.[1]?.trim();
  return { name: field('NAME')?.replace(/^["'“]|["'”]$/g, ''), opening: field('OPENING'), system_prompt: prompt };
}

/** browseML, asked once with a builder's instructions as its system prompt: the text it wrote. */
async function ask(system: string, message: string, say: Say, maxTokens: number): Promise<string> {
  if (!browseState()) {
    say('starting browseML…', 'working');
    if (await browseCached()) await loadBrowse(); else if (!(await download())) throw new Error('browseML did not start');
  }
  say('browseML is writing (it reads the builder\'s instructions first)…', 'working');
  let text = '';
  for await (const p of askBrowse(system, [], message, () => {}, maxTokens)) { text += p; }
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

export function Builder({ uif, say }: { uif: MutableRefObject<UIFContextValue | null>; say: Say }) {
  const [mode, setMode] = useState(0);
  const [desc, setDesc] = useState('');
  const [p, setP] = useState<Persona>({ id: `p-${Date.now()}`, name: '', opening: '', system_prompt: '' });
  const [prompt, setPrompt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fillPersona = async () => {
    if (!desc.trim() || busy) return;
    setBusy(true);
    try {
      const f = parseFill(await ask(PERSONA_BUILDER, `Write the persona for: ${desc.trim()}`, say, 320));
      if (!f.system_prompt) throw new Error('browseML did not write the three lines: try again, or describe it differently');
      setP(x => ({ ...x, name: f.name || x.name, opening: f.opening || x.opening, system_prompt: f.system_prompt || x.system_prompt }));
      say('filled from the description: read it, edit it, then USE or SAVE', 'ok');
    } catch (e) { say(String((e as Error).message || e), 'bad'); }
    setBusy(false);
  };
  const fillPrompt = async () => {
    if (!desc.trim() || busy) return;
    setBusy(true);
    try { setPrompt(await ask(PROMPT_BUILDER, `The task: ${desc.trim()}`, say, 220)); say('written: read it, then SET', 'ok'); }
    catch (e) { say(String((e as Error).message || e), 'bad'); }
    setBusy(false);
  };
  const usePersona = async () => {
    const f = uif.current;
    if (!f || !p.name.trim() || !p.system_prompt.trim()) return say('a persona needs a name and a system prompt', 'bad');
    savePersona(p);
    await applyPersona(() => uif.current, p);
    if (p.opening.trim()) { const id = f.outputs.spawn(p.name); f.outputs.append(id, { role: 'system', text: p.opening }); }
    say(`${p.name} answers now (saved in PERSONA)`, 'ok');
  };
  const exportIt = () => {
    const url = URL.createObjectURL(new Blob([toFile(p)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${p.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'persona'}.persona` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="cp-builder">
      <SegmentSwitch options={['.persona', '.prompt', '.memory']} value={mode} color="#F7931A" size={26} onChange={i => setMode(i)} />
      {mode < 2 && (
        <label className="cp-build-desc">{mode === 0 ? 'describe who should answer' : 'describe the task'}
          <textarea rows={3} value={desc} placeholder={mode === 0 ? 'e.g. a patient chemistry tutor for 14-year-olds who checks units' : 'e.g. summarise a pasted email in three bullet points'} onChange={e => setDesc(e.target.value)} />
        </label>
      )}
      {mode === 0 && (
        <div className="cp-persona-edit">
          <div className="cp-buttons"><Button color="#0ECB81" onClick={() => void fillPersona()} disabled={busy || !desc.trim()}>{busy ? 'FILLING…' : 'FILL FROM DESCRIPTION'}</Button></div>
          <label>name<input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} maxLength={40} /></label>
          <label>opening message<textarea rows={2} value={p.opening} onChange={e => setP({ ...p, opening: e.target.value })} /></label>
          <label>system prompt<textarea rows={7} value={p.system_prompt} onChange={e => setP({ ...p, system_prompt: e.target.value })} /></label>
          <p className={`cp-fine ${tokens(p.system_prompt) > 600 ? 'is-bad' : ''}`}>about {tokens(p.system_prompt)} of 600 tokens · a draft from a 1.7B model: read it before using it</p>
          <div className="cp-buttons">
            <Button color="#0ECB81" onClick={() => void usePersona()} disabled={!p.name.trim() || !p.system_prompt.trim()}>USE</Button>
            <Button onClick={() => { if (!p.name.trim() || !p.system_prompt.trim()) return say('a persona needs a name and a system prompt', 'bad'); savePersona(p); say(`saved ${p.name} in PERSONA`, 'ok'); }}>SAVE</Button>
            <Button onClick={exportIt} disabled={!p.system_prompt.trim()}>EXPORT</Button>
            <Button onClick={() => { setP({ id: `p-${Date.now()}`, name: '', opening: '', system_prompt: '' }); setDesc(''); }}>NEW</Button>
          </div>
        </div>
      )}
      {mode === 1 && (
        <div className="cp-persona-edit">
          <div className="cp-buttons"><Button color="#0ECB81" onClick={() => void fillPrompt()} disabled={busy || !desc.trim()}>{busy ? 'WRITING…' : 'WRITE THE PROMPT'}</Button></div>
          <label>.prompt<textarea rows={6} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
          <div className="cp-buttons">
            <Button color="#0ECB81" disabled={!prompt.trim()} onClick={() => { const f = uif.current; if (!f) return; f.context.setPrompt(prompt); f.context.setPromptSource('prompt'); say('questions are asked with this .prompt now (PERSONA switches back)', 'ok'); }}>SET</Button>
            <Button onClick={() => { const f = uif.current; if (!f) return; f.context.setPromptSource('persona'); say('back to the persona\'s prompt', 'ok'); }}>USE THE PERSONA</Button>
          </div>
        </div>
      )}
      {mode === 2 && (
        <div className="cp-persona-edit">
          <label>a note for .memory (given to the model with every question)<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
          <div className="cp-buttons">
            <Button color="#0ECB81" disabled={!note.trim()} onClick={() => void uif.current?.context.remember(note.trim(), 'typed').then(() => { setNote(''); say('kept in .memory', 'ok'); })}>ADD TO .memory</Button>
          </div>
        </div>
      )}
    </div>
  );
}
