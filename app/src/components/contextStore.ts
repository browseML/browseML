import { useCallback, useMemo, useState } from 'react';
import {
  buildMessages,
  composeSystem,
  DEFAULT_MODEL_TEXT,
  fromJSONL,
  modelLabel,
  parseModel,
  parsePersona,
  readHistoryRecord,
  readMemoryNote,
  deliveryLine,
  sha256Hex,
  type HistoryRecord,
  type MemoryNote,
  type ModelSpec,
  type PersonaDoc,
  type PromptSource,
  type SendContext,
} from '../core/context';
import { loadJSON, saveJSON } from '../core/storage';
import type { ContextKind } from '../core/windows';

const MAX_HISTORY = 2000;
const MAX_MEMORY = 500;

export interface ContextApi {
  /** .history, oldest first. Stored as exact JSONL lines so imported files keep their commitment. */
  history: HistoryRecord[];
  historyLines: string[];
  appendHistory(record: HistoryRecord): void;
  clearHistory(): void;

  /** .memory, oldest first. */
  memory: MemoryNote[];
  memoryLines: string[];
  remember(text: string, kind?: 'typed' | 'response'): Promise<void>;
  /** Keep how an answer was delivered: one .memory line, never sent to the model (see deliveryLine). */
  keep(record: Record<string, unknown>, text: string): Promise<void>;
  forget(index: number): void;
  clearMemory(): void;

  /** .prompt: the system prompt text. */
  prompt: string;
  setPrompt(text: string): void;
  /** Which system prompt to use when the persona also has one. */
  promptSource: PromptSource;
  setPromptSource(source: PromptSource): void;

  /** .persona: the file text and its parsed form (null when empty). */
  personaText: string;
  persona: PersonaDoc | null;
  /** Set the persona from text; throws with a reason when it is not a valid .persona. Empty clears it. */
  setPersonaText(text: string): void;

  /** .model: the YAML text and its parsed form. */
  modelText: string;
  model: ModelSpec;
  modelError: string | null;
  setModelText(text: string): void;

  /** The context sent with a chat message into `outputId`. */
  forSend(text: string, outputId: string): SendContext;
  /** The file text for a context, as it would be exported. */
  fileText(kind: ContextKind): string;
  /** Read an imported file. History and memory are appended; the rest are replaced. Returns a summary. */
  importText(kind: ContextKind, text: string): string;
}

function linesFrom(text: string): string[] {
  return text.split(/\r?\n/).filter(l => l.trim());
}

/** State for the five context files, saved per storageKey. */
export function useContextStore(storageKey: string): ContextApi {
  const k = (name: string) => `uif:${storageKey}:${name}`;
  const [historyLines, setHistoryLines] = useState<string[]>(() => loadJSON(k('history'), []));
  const [memoryLines, setMemoryLines] = useState<string[]>(() => loadJSON(k('memory'), []));
  const [prompt, setPromptState] = useState<string>(() => loadJSON(k('prompt'), ''));
  const [promptSource, setPromptSourceState] = useState<PromptSource>(() => loadJSON(k('promptSource'), 'persona'));
  const [personaText, setPersonaTextState] = useState<string>(() => loadJSON(k('persona'), ''));
  const [modelText, setModelTextState] = useState<string>(() => loadJSON(k('model'), DEFAULT_MODEL_TEXT));

  const persist = useCallback(
    <T,>(name: string, setter: (v: T) => void) =>
      (v: T) => {
        setter(v);
        saveJSON(`uif:${storageKey}:${name}`, v);
      },
    [storageKey],
  );

  const history = useMemo(() => {
    try {
      return fromJSONL(historyLines.join('\n'), '.history', readHistoryRecord);
    } catch {
      return [];
    }
  }, [historyLines]);
  const memory = useMemo(() => {
    try {
      return fromJSONL(memoryLines.join('\n'), '.memory', readMemoryNote);
    } catch {
      return [];
    }
  }, [memoryLines]);
  const persona = useMemo(() => {
    if (!personaText.trim()) return null;
    try {
      return parsePersona(personaText);
    } catch {
      return null;
    }
  }, [personaText]);
  const { model, modelError } = useMemo(() => {
    try {
      return { model: parseModel(modelText), modelError: null };
    } catch (err) {
      return { model: {}, modelError: (err as Error).message };
    }
  }, [modelText]);

  return useMemo<ContextApi>(() => {
    const saveHistory = persist<string[]>('history', setHistoryLines);
    const saveMemory = persist<string[]>('memory', setMemoryLines);
    const setPrompt = persist<string>('prompt', setPromptState);
    const setPromptSource = persist<PromptSource>('promptSource', setPromptSourceState);
    const savePersona = persist<string>('persona', setPersonaTextState);
    const setModelText = persist<string>('model', setModelTextState);

    const addHistory = (lines: string[]) =>
      setHistoryLines(prev => {
        const next = [...prev, ...lines].slice(-MAX_HISTORY);
        saveJSON(k('history'), next);
        return next;
      });
    const addMemory = (lines: string[]) =>
      setMemoryLines(prev => {
        const next = [...prev, ...lines].slice(-MAX_MEMORY);
        saveJSON(k('memory'), next);
        return next;
      });

    return {
      history,
      historyLines,
      appendHistory: record => addHistory([JSON.stringify(record)]),
      clearHistory: () => saveHistory([]),

      memory,
      memoryLines,
      async remember(text, kind = 'typed') {
        const clean = text.trim();
        if (!clean) return;
        const ts = Date.now() / 1000;
        const note: MemoryNote = { ts, at: new Date(ts * 1000).toISOString(), text: clean, sha256: await sha256Hex(clean), source: { kind } };
        addMemory([JSON.stringify(note)]);
      },
      async keep(record, text) {
        addMemory([await deliveryLine(record, text)]);
      },
      clearMemory: () => saveMemory([]),
      forget(index) {
        setMemoryLines(prev => {
          const next = prev.filter((_, i) => i !== index);
          saveJSON(k('memory'), next);
          return next;
        });
      },

      prompt,
      setPrompt,
      promptSource,
      setPromptSource,

      personaText,
      persona,
      setPersonaText(text) {
        if (text.trim()) parsePersona(text);
        savePersona(text);
      },

      modelText,
      model,
      modelError,
      setModelText,

      forSend(text, outputId) {
        const { system, promptSource: from } = composeSystem({ prompt, persona, source: promptSource, memory });
        // Each output is its own thread: the recent exchanges in that output.
        const thread = history.filter(h => h.output_id === outputId);
        const recent = thread.slice(-12);
        return {
          system,
          messages: buildMessages(system, recent, text),
          promptSource: from,
          prompt,
          persona,
          memory,
          model,
          modelText,
          history: recent,
        };
      },

      fileText(kind) {
        switch (kind) {
          case 'history':
            return historyLines.length ? historyLines.join('\n') + '\n' : '';
          case 'memory':
            return memoryLines.length ? memoryLines.join('\n') + '\n' : '';
          case 'prompt':
            return prompt;
          case 'persona':
            return personaText;
          case 'model':
            return modelText;
        }
      },

      importText(kind, text) {
        switch (kind) {
          case 'history': {
            const recs = fromJSONL(text, '.history', readHistoryRecord);
            addHistory(linesFrom(text));
            return `added ${recs.length} exchange(s)`;
          }
          case 'memory': {
            const notes = fromJSONL(text, '.memory', readMemoryNote);
            addMemory(linesFrom(text));
            return `added ${notes.length} note(s)`;
          }
          case 'prompt':
            setPrompt(text);
            return 'prompt replaced';
          case 'persona': {
            const p = parsePersona(text);
            savePersona(text);
            return `persona set to ${p.name ?? p.persona ?? 'unnamed'}`;
          }
          case 'model': {
            const m = parseModel(text);
            setModelText(text);
            return `model set to ${modelLabel(m)}`;
          }
        }
      },
    };
    // k is derived from storageKey, which persist already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, historyLines, memory, memoryLines, prompt, promptSource, personaText, persona, modelText, model, modelError, persist]);
}
