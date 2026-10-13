// SPDX-License-Identifier: MIT
// PERSONA: who answers, and how they open. browseML's own persona is built in (read from browseml.persona each visit,
// so its facts stay current); the visitor makes others — a name, an opening message, the system prompt — switches
// between them, and imports or exports .persona files (bankML .persona v1: name, system_prompt, and here `opening`).
// Switching changes the prompt every question is asked with; the new prompt is read once and kept (the prompt cache).
// The opening message is the persona's first words: shown when it is switched to, never sent to the model.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Button } from 'dreamknob';
import type { UIFContextValue } from '../components/UIFContext';
import { parsePersona } from '../core/context';
import { loadPersonaText } from '../bankml/engine';
import { browseState, warmBrowse } from '../bankml/free';

type Say = (text: string, tone?: 'ok' | 'bad' | 'working') => void;
export interface Persona { id: string; name: string; opening: string; system_prompt: string }
const LIST = 'browseml:personas', ACTIVE = 'browseml:persona-active';
export const BUILTIN = 'browseml';
const BUDGET = 600;  // tokens: the persona repo's budget (a long prompt is slow to read on a CPU)
const tokens = (t: string) => Math.ceil(t.length / 4);

const load = (): Persona[] => { try { const x = JSON.parse(localStorage.getItem(LIST) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
const store = (l: Persona[]) => { try { localStorage.setItem(LIST, JSON.stringify(l)); } catch { /* storage off */ } };
export const activeId = () => { try { return localStorage.getItem(ACTIVE) || BUILTIN; } catch { return BUILTIN; } };
const setActive = (id: string) => { try { localStorage.setItem(ACTIVE, id); } catch { /* storage off */ } };

/** A persona as a .persona file (bankML .persona v1, with its opening message). */
export const toFile = (p: Persona) => JSON.stringify({ persona: p.id, name: p.name, kind: 'persona', format: 'bankML .persona v1', opening: p.opening, system_prompt: p.system_prompt }, null, 1) + '\n';
/** A .persona file read (any bankML .persona with a system_prompt; `opening` if it has one). */
export function fromFile(text: string, id = `p-${Date.now()}`): Persona {
  const d = parsePersona(text) as { name?: string; persona?: string; opening?: unknown; system_prompt?: string };
  if (!d.system_prompt?.trim()) throw new Error('this .persona has no system_prompt');
  return { id, name: String(d.name ?? d.persona ?? 'persona'), opening: typeof d.opening === 'string' ? d.opening : '', system_prompt: d.system_prompt };
}

/** Keep a persona in the list (a new one added, an existing one replaced); PERSONA shows it on its next render. */
export function savePersona(p: Persona) {
  const l = load();
  store(l.some(x => x.id === p.id) ? l.map(x => (x.id === p.id ? p : x)) : [...l, p]);
  savedFns.forEach(f => f());
}
const savedFns = new Set<() => void>();

/** The persona in use (built in: read from browseml.persona). */
export async function activePersona(): Promise<Persona> {
  const id = activeId();
  if (id !== BUILTIN) { const p = load().find(x => x.id === id); if (p) return p; }
  return fromFile(await loadPersonaText('browseml.persona'), BUILTIN);
}

/** Put a persona in the field's context (its .persona), and read its prompt once if browseML is running. */
export async function applyPersona(f: UIFContextValue, p: Persona) {
  f.context.setPersonaText(toFile(p));
  setActive(p.id);
  savedFns.forEach(f => f());
  await new Promise(r => setTimeout(r, 0));
  if (browseState()) void warmBrowse(f.context.forSend('', '').system, p.name);
}

export function PersonaSection({ uif, say }: { uif: MutableRefObject<UIFContextValue | null>; say: Say }) {
  const [list, setList] = useState<Persona[]>(load);
  const [active, setAct] = useState(activeId);
  const [builtin, setBuiltin] = useState<Persona | null>(null);
  const [draft, setDraft] = useState<Persona | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void loadPersonaText('browseml.persona').then(t => setBuiltin(fromFile(t, BUILTIN))).catch(() => {}); }, []);
  useEffect(() => { const f = () => { setList(load()); setAct(activeId()); }; savedFns.add(f); return () => { savedFns.delete(f); }; }, []);
  const all = [...(builtin ? [builtin] : []), ...list];
  const current = all.find(p => p.id === active) ?? builtin;

  const use = async (p: Persona) => {
    const f = uif.current;
    if (!f) return;
    await applyPersona(f, p);
    setAct(p.id);
    // its opening message, in a window of its own (the persona's first words, not the model's)
    if (p.opening.trim()) { const id = f.outputs.spawn(p.name); f.outputs.append(id, { role: 'system', text: p.opening }); }
    say(`${p.name} answers now${browseState() ? ': reading the new prompt once (kept for next time)' : ''}`, 'ok');
  };
  const save = () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.system_prompt.trim()) return say('a persona needs a name and a system prompt', 'bad');
    const next = list.some(p => p.id === draft.id) ? list.map(p => (p.id === draft.id ? draft : p)) : [...list, draft];
    setList(next); store(next); say(`saved ${draft.name}`, 'ok');
    if (draft.id === active) void use(draft);
    setDraft(null);
  };
  const remove = (p: Persona) => {
    const next = list.filter(x => x.id !== p.id);
    setList(next); store(next);
    if (p.id === active && builtin) void use(builtin);
    say(`removed ${p.name}`, 'ok');
  };
  const exportIt = (p: Persona) => {
    const url = URL.createObjectURL(new Blob([toFile(p)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${p.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'persona'}.persona` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const importIt = async (f: File | undefined) => {
    if (!f) return;
    try { const p = fromFile(await f.text()); setDraft(p); say(`read ${f.name}: check it, then SAVE`, 'ok'); }
    catch (e) { say(`${f.name}: ${String((e as Error).message || e)}`, 'bad'); }
  };

  return (
    <div className="cp-persona">
      <div className="cp-persona-list" role="radiogroup" aria-label="who answers">
        {all.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === active} className={p.id === active ? 'is-on' : ''} onClick={() => void use(p)}>{p.name}</button>
        ))}
      </div>
      {current && !draft && (
        <p className="cp-fine">{current.opening ? `“${current.opening}”` : 'no opening message'} · about {tokens(current.system_prompt)} tokens</p>
      )}
      {draft ? (
        <div className="cp-persona-edit">
          <label>name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={40} /></label>
          <label>opening message<textarea rows={2} value={draft.opening} placeholder="the first words, shown when it is switched to" onChange={e => setDraft({ ...draft, opening: e.target.value })} /></label>
          <label>system prompt<textarea rows={7} value={draft.system_prompt} onChange={e => setDraft({ ...draft, system_prompt: e.target.value })} /></label>
          <p className={`cp-fine ${tokens(draft.system_prompt) > BUDGET ? 'is-bad' : ''}`}>about {tokens(draft.system_prompt)} of {BUDGET} tokens{tokens(draft.system_prompt) > BUDGET ? ': long prompts are slow to read on a CPU' : ''}</p>
          <div className="cp-buttons">
            <Button color="#0ECB81" onClick={save}>SAVE</Button>
            <Button onClick={() => setDraft(null)}>CANCEL</Button>
          </div>
        </div>
      ) : (
        <div className="cp-buttons">
          <Button onClick={() => setDraft({ id: `p-${Date.now()}`, name: '', opening: '', system_prompt: '' })}>NEW</Button>
          {current && <Button onClick={() => setDraft(current.id === BUILTIN ? { ...current, id: `p-${Date.now()}`, name: `${current.name} (copy)` } : current)}>{current.id === BUILTIN ? 'COPY' : 'EDIT'}</Button>}
          {current && current.id !== BUILTIN && <Button onClick={() => remove(current)}>DELETE</Button>}
          {current && <Button onClick={() => exportIt(current)}>EXPORT</Button>}
          <Button onClick={() => file.current?.click()}>IMPORT</Button>
          <input ref={file} type="file" accept=".persona,application/json" hidden onChange={e => { void importIt(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}
