/** The context windows reachable from the field's Windows menu. */
export const CONTEXT_KINDS = ['history', 'memory', 'prompt', 'persona', 'model'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export const CONTEXT_INFO: Record<ContextKind, { file: string; icon: string; summary: string }> = {
  history: { file: '.history', icon: '⟲', summary: 'Every message sent and received, across outputs' },
  memory: { file: '.memory', icon: '◈', summary: 'Long-term notes given to the model with every message' },
  prompt: { file: '.prompt', icon: '¶', summary: 'The system prompt sent with every message' },
  persona: { file: '.persona', icon: '☺', summary: 'Who the model speaks as' },
  model: { file: '.model', icon: '⚙', summary: 'Which model answers, and its settings' },
};

export function isContextKind(v: string): v is ContextKind {
  return (CONTEXT_KINDS as readonly string[]).includes(v);
}

/** Accepts "memory", ".memory" or "mem". */
export function resolveContextKind(ref: string | undefined): ContextKind | undefined {
  if (!ref) return undefined;
  const r = ref.trim().toLowerCase().replace(/^\./, '');
  if (isContextKind(r)) return r;
  return CONTEXT_KINDS.find(k => k.startsWith(r) && r.length >= 2);
}
