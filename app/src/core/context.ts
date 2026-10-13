/**
 * The context files behind the Windows menu, in the formats bankml's Savante UI
 * and mindX already use, so files move between them unchanged:
 *
 *   .history  JSONL, one exchange per line          (bankml savante.history)
 *   .memory   JSONL, one note per line              (bankml savante.memory)
 *   .prompt   plain text: the system prompt         (bankml/mindX *.prompt)
 *   .persona  JSON: mindX .persona v1 or boardroom  (mindX personas)
 *   .model    YAML: an inference policy             (cryptoAGI *.model)
 */

// ---- .history --------------------------------------------------------------

/** One exchange. Extra fields from other tools are kept as they are. */
export interface HistoryRecord {
  /** Seconds since the epoch, as bankml writes it. */
  ts: number;
  session?: string;
  /** The output field the exchange happened in (UIF addition). */
  output?: string;
  user: string;
  assistant: string;
  /** Where the system prompt came from, e.g. "persona.system_prompt". */
  prompt?: string;
  model?: string;
  [extra: string]: unknown;
}

// ---- .memory ---------------------------------------------------------------

export interface MemoryNote {
  ts: number;
  /** ISO time. */
  at: string;
  text: string;
  /** sha256 of `text`, hex. */
  sha256: string;
  /** typed and response notes reach the model; a delivery record (how an answer was delivered) is kept, never sent. */
  source: { kind: 'typed' | 'response' | 'delivery'; [extra: string]: unknown };
}

/** Header bankml puts above the notes in the system prompt. */
export const MEMORY_HEADER =
  '\n\nMEMORY — notes the operator kept from earlier conversations. They are context, not evidence: cite them as the operator\'s notes, never as findings.\n';
export const MEMORY_BLOCK_CHARS = 2400;

/** The notes as they reach the model: newest first, `- ` lines, capped like bankml. */
export function memoryBlock(notes: MemoryNote[], cap = MEMORY_BLOCK_CHARS): string {
  if (!notes.some(n => n.source.kind !== 'delivery')) return '';
  const lines: string[] = [];
  let used = 0;
  for (const n of [...notes].filter(n => n.source.kind !== 'delivery').sort((a, b) => b.ts - a.ts)) {
    const line = `- ${n.text.replace(/\s+/g, ' ').trim()}`;
    if (used + line.length + 1 > cap) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? MEMORY_HEADER + lines.join('\n') : '';
}

/**
 * A delivery record as one .memory line: the note fields the UIF reads (ts, at, text, sha256, source.kind
 * "delivery") beside the engine's own record. A record in the sagi .memory shape (id, date, question, answer,
 * carrier, deliveries, finish, limit, usage, timings, response_sha256) is kept field for field, so the same line
 * can be read by Savante's bind/skill_history.py. `text` is its one-line summary.
 */
export async function deliveryLine(record: Record<string, unknown>, text: string, now = Date.now() / 1000): Promise<string> {
  const ts = typeof record.ts === 'number' ? record.ts : now;
  const summary = text.replace(/\s+/g, ' ').trim();
  return JSON.stringify({ ...record, ts, at: new Date(ts * 1000).toISOString(), text: summary, sha256: await sha256Hex(summary), source: { kind: 'delivery' } });
}

// ---- .persona --------------------------------------------------------------

/**
 * A persona. Two shapes are understood: mindX ".persona v1" (`system_prompt`,
 * `mantra`, `voice_examples`, …) and the boardroom shape (`role`,
 * `behavioral_traits`, `beliefs`, `desires`, …). Unknown keys are kept.
 */
export interface PersonaDoc {
  name?: string;
  persona?: string;
  role?: string;
  description?: string;
  system_prompt?: string;
  communication_style?: string;
  behavioral_traits?: string[];
  beliefs?: Record<string, boolean>;
  desires?: Record<string, unknown>;
  [extra: string]: unknown;
}

export function parsePersona(text: string): PersonaDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a valid .persona file: it is not JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a valid .persona file: expected a JSON object');
  const p = data as PersonaDoc;
  if (p.system_prompt !== undefined && typeof p.system_prompt !== 'string') throw new Error('not a valid .persona file: "system_prompt" must be text');
  if (p.behavioral_traits !== undefined && !(Array.isArray(p.behavioral_traits) && p.behavioral_traits.every(t => typeof t === 'string')))
    throw new Error('not a valid .persona file: "behavioral_traits" must be a list of text');
  return p;
}

export function personaName(p: PersonaDoc | null): string | undefined {
  return p ? (p.name ?? p.persona ?? undefined) : undefined;
}

const HIGH = new Set(['high', 'critical']);

/** The persona's sourced facts about itself (`awareness.facts[].fact`, as in bankml.persona). */
export function awarenessFacts(p: PersonaDoc): string[] {
  const a = p.awareness;
  const facts = a && typeof a === 'object' ? (a as { facts?: unknown }).facts : undefined;
  if (!Array.isArray(facts)) return [];
  return facts
    .map(f => (typeof f === 'string' ? f : f && typeof f === 'object' ? (f as { fact?: unknown }).fact : undefined))
    .filter((f): f is string => typeof f === 'string' && !!f.trim())
    .map(f => f.trim());
}

/**
 * Lines appended after the prompt: boardroom traits, true beliefs and high
 * priorities, then the persona's awareness facts.
 */
export function personaLines(p: PersonaDoc): string[] {
  const lines: string[] = [];
  if (p.behavioral_traits?.length) lines.push(`Behavioural traits: ${p.behavioral_traits.join(', ')}`);
  const beliefs = Object.entries(p.beliefs ?? {}).filter(([, v]) => v === true).map(([k]) => k.replace(/_/g, ' '));
  if (beliefs.length) lines.push(`Operating beliefs: ${beliefs.join(', ')}`);
  const priorities = Object.entries(p.desires ?? {})
    .filter(([, v]) => {
      const level = typeof v === 'string' ? v : v && typeof v === 'object' ? (v as { priority?: unknown }).priority : undefined;
      return typeof level === 'string' && HIGH.has(level.toLowerCase());
    })
    .map(([k]) => k.replace(/_/g, ' '));
  if (priorities.length) lines.push(`Priorities: ${priorities.join(', ')}`);
  const facts = awarenessFacts(p);
  if (facts.length) lines.push(`What I know about myself:\n${facts.map(f => `- ${f}`).join('\n')}`);
  return lines;
}

// ---- .model ----------------------------------------------------------------

/** An inference policy, not a pinned weight file. Other keys are kept in `extra`. */
export interface ModelSpec {
  model_facet?: string;
  task_class?: string;
  logical_model?: string;
  pinned?: boolean;
  [extra: string]: unknown;
}

export const TASK_CLASSES = ['general', 'reasoning', 'code_generation', 'simple_chat'];
export const DEFAULT_MODEL_TEXT = `model_facet: uif.default
task_class: general          # general | reasoning | code_generation | simple_chat
logical_model: auto
pinned: false
`;

function scalar(raw: string): unknown {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~' || v === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  const q = /^(['"])(.*)\1$/.exec(v);
  return q ? q[2] : v;
}

/**
 * Read the top-level `key: value` lines of a .model file. Comments are
 * dropped; nested blocks (lists, maps) are kept as their raw text so the
 * file round-trips through the original text, not through this object.
 */
export function parseModel(text: string): ModelSpec {
  const out: ModelSpec = {};
  let block: string | null = null;
  let blockLines: string[] = [];
  const flush = () => {
    if (block) out[block] = blockLines.join('\n');
    block = null;
    blockLines = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\s/.test(line)) {
      if (block) blockLines.push(line);
      continue;
    }
    flush();
    const m = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) throw new Error(`not a valid .model file: cannot read "${line.trim()}"`);
    const value = m[2].replace(/\s+#.*$/, '');
    if (value.trim() === '') block = m[1];
    else out[m[1]] = scalar(value);
  }
  flush();
  return out;
}

/** Change one top-level scalar in the .model text, keeping comments and everything else. */
export function setModelField(text: string, key: string, value: string | boolean): string {
  const rendered = String(value);
  const re = new RegExp(`^(${key.replace(/[.]/g, '\\.')}\\s*:\\s*)([^#\\n]*?)(\\s*#.*)?$`, 'm');
  if (re.test(text)) return text.replace(re, (_m, head: string, _old: string, comment?: string) => `${head}${rendered}${comment ?? ''}`);
  return `${text.replace(/\s*$/, '\n')}${key}: ${rendered}\n`;
}

/** A short label for the model a message went to. */
export function modelLabel(spec: ModelSpec): string {
  const name = typeof spec.logical_model === 'string' && spec.logical_model ? spec.logical_model : 'auto';
  return spec.pinned ? `${name} (pinned)` : `${name} · ${spec.task_class ?? 'general'}`;
}

// ---- JSONL -----------------------------------------------------------------

export function toJSONL(records: unknown[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

/** Parse JSONL; `check` validates each record. Errors name the line. */
export function fromJSONL<T>(text: string, kind: string, check: (r: Record<string, unknown>) => T | null): T[] {
  const out: T[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      throw new Error(`not a valid ${kind} file: line ${i + 1} is not JSON`);
    }
    const ok = r && typeof r === 'object' && !Array.isArray(r) ? check(r as Record<string, unknown>) : null;
    if (!ok) throw new Error(`not a valid ${kind} file: line ${i + 1} is missing required fields`);
    out.push(ok);
  });
  return out;
}

export const readHistoryRecord = (r: Record<string, unknown>): HistoryRecord | null =>
  typeof r.user === 'string' && typeof r.assistant === 'string'
    ? ({ ...r, ts: typeof r.ts === 'number' ? r.ts : Date.now() / 1000 } as HistoryRecord)
    : null;

export const readMemoryNote = (r: Record<string, unknown>): MemoryNote | null => {
  if (typeof r.text !== 'string') return null;
  const ts = typeof r.ts === 'number' ? r.ts : Date.now() / 1000;
  const source = r.source && typeof r.source === 'object' ? (r.source as MemoryNote['source']) : { kind: 'typed' as const };
  return {
    ts,
    at: typeof r.at === 'string' ? r.at : new Date(ts * 1000).toISOString(),
    text: r.text,
    sha256: typeof r.sha256 === 'string' ? r.sha256 : '',
    source: source.kind === 'response' || source.kind === 'delivery' ? source : { ...source, kind: 'typed' },
  };
};

// ---- hashing and commitments (rfc6962-sha256, as bankml) --------------------

const enc = new TextEncoder();

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(...parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all));
}

export const MERKLE_SCHEME = 'rfc6962-sha256';

/**
 * Merkle root over JSONL lines, as bankml's `merkle_root`: leaf =
 * sha256(0x00 || exact line, without its newline), node =
 * sha256(0x01 || left || right), split at the largest power of two below n.
 * Null for no records.
 */
export async function merkleRoot(lines: string[]): Promise<string | null> {
  const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const kept = lines.filter(l => l.trim());
  if (!kept.length) return null;
  const leaves = await Promise.all(kept.map(l => sha256Bytes(new Uint8Array([0]), enc.encode(l))));
  const build = async (nodes: Uint8Array[]): Promise<Uint8Array> => {
    if (nodes.length === 1) return nodes[0];
    let k = 1;
    while (k * 2 < nodes.length) k *= 2;
    const [l, r] = await Promise.all([build(nodes.slice(0, k)), build(nodes.slice(k))]);
    return sha256Bytes(new Uint8Array([1]), l, r);
  };
  return hex(await build(leaves));
}

/** bankml's shareable commitment: it reveals the shape of the file, not its content. */
export async function commitment(file: string, lines: string[]) {
  const kept = lines.filter(l => l.trim());
  return {
    file,
    records: kept.length,
    merkle_root: await merkleRoot(kept),
    scheme: MERKLE_SCHEME,
    file_sha256: kept.length ? await sha256Hex(kept.map(l => l + '\n').join('')) : null,
  };
}

// ---- what reaches the model ------------------------------------------------

export type PromptSource = 'persona' | 'prompt';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Everything the host needs to call a model, sent with every chat message. */
export interface SendContext {
  /** The composed system prompt: prompt (or persona) + persona lines + memory block. */
  system: string;
  /** Ready for a chat API: system, then recent exchanges, then this message. */
  messages: ChatMessage[];
  /** Where the system prompt came from, e.g. "persona.system_prompt" or ".prompt". */
  promptSource: string;
  prompt: string;
  persona: PersonaDoc | null;
  memory: MemoryNote[];
  model: ModelSpec;
  /** The raw .model text. */
  modelText: string;
  /** The recent exchanges that were included in `messages`. */
  history: HistoryRecord[];
}

export const HISTORY_WINDOW = 12;
export const KEEP_CHARS = 4000;

const cut = (s: string, n = KEEP_CHARS) => (s.length > n ? s.slice(0, n) + '…' : s);

/** Choose and assemble the system prompt the way bankml and the boardroom do. */
export function composeSystem(opts: {
  prompt: string;
  persona: PersonaDoc | null;
  source: PromptSource;
  memory: MemoryNote[];
}): { system: string; promptSource: string } {
  const { prompt, persona, source, memory } = opts;
  const personaPrompt = persona?.system_prompt?.trim();
  let base: string;
  let from: string;
  if (source === 'persona' && personaPrompt) {
    base = personaPrompt;
    from = 'persona.system_prompt';
  } else if (prompt.trim()) {
    base = prompt.trim();
    from = '.prompt';
  } else if (personaPrompt) {
    base = personaPrompt;
    from = 'persona.system_prompt';
  } else {
    base = '';
    from = 'none';
  }
  const lines = persona ? personaLines(persona) : [];
  const system = [base, ...lines].filter(Boolean).join('\n') + memoryBlock(memory);
  return { system: system.trim(), promptSource: from };
}

/** System message, then the last exchanges as user/assistant pairs, then the new message. */
export function buildMessages(system: string, history: HistoryRecord[], text: string, window = HISTORY_WINDOW): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const h of history.slice(-window)) {
    msgs.push({ role: 'user', content: cut(h.user) }, { role: 'assistant', content: cut(h.assistant) });
  }
  msgs.push({ role: 'user', content: text });
  return msgs;
}
