import { describe, expect, it } from 'vitest';
import {
  buildMessages,
  commitment,
  composeSystem,
  fromJSONL,
  MEMORY_HEADER,
  memoryBlock,
  merkleRoot,
  modelLabel,
  parseModel,
  parsePersona,
  personaLines,
  readHistoryRecord,
  readMemoryNote,
  setModelField,
  sha256Hex,
  toJSONL,
  type MemoryNote,
  deliveryLine,
} from '../context';

// Reference roots computed with bankml's merkle_root (sAGI/savante.py) on the same lines.
const LINES = [
  '{"ts": 1790632535.257, "user": "a", "assistant": "b"}',
  '{"ts": 2, "user": "ünï", "assistant": "c"}',
  '{"text":"x"}',
  'line4',
  'line5',
];
const BANKML_ROOTS: Record<number, string> = {
  1: '0cea6b07bb0b5d4241866332c54de5879adf175486fa656fec0be314b9f48c90',
  2: '2b3611b17c34973136c4a06d222314459679f38fa91e573056a7d28d46963c4a',
  3: '3d9e82558e5b140f86c51e7ed4ce1f481241f70c1b184637e65f88bc57f87f16',
  5: 'b0da63216467ae6676561bdb4437c662d54f4e8b39d355e74dcd5913299c1d5e',
};

const note = (text: string, ts: number): MemoryNote => ({ ts, at: '', text, sha256: '', source: { kind: 'typed' } });

describe('Merkle commitment (rfc6962-sha256, as bankml)', () => {
  it.each(Object.entries(BANKML_ROOTS))('matches bankml for %s record(s)', async (n, root) => {
    expect(await merkleRoot(LINES.slice(0, Number(n)))).toBe(root);
  });
  it('has no root for no records, and ignores blank lines', async () => {
    expect(await merkleRoot([])).toBeNull();
    expect(await merkleRoot(['', LINES[0], '  '])).toBe(BANKML_ROOTS[1]);
  });
  it('commitment counts records and hashes the file', async () => {
    const c = await commitment('x.history', LINES.slice(0, 2));
    expect(c).toMatchObject({ file: 'x.history', records: 2, merkle_root: BANKML_ROOTS[2], scheme: 'rfc6962-sha256' });
    expect(c.file_sha256).toBe(await sha256Hex(LINES.slice(0, 2).join('\n') + '\n'));
  });
});

describe('.memory', () => {
  it('builds the block newest first, under the bankml header, within the cap', () => {
    const block = memoryBlock([note('old', 1), note('new', 2)]);
    expect(block.startsWith(MEMORY_HEADER)).toBe(true);
    expect(block.slice(MEMORY_HEADER.length)).toBe('- new\n- old');
    expect(memoryBlock([])).toBe('');
    const many = Array.from({ length: 100 }, (_, i) => note('x'.repeat(50), i));
    expect(memoryBlock(many).length - MEMORY_HEADER.length).toBeLessThanOrEqual(2400);
  });
  it('reads bankml memory lines and rejects broken ones', () => {
    const notes = fromJSONL('{"ts": 1, "at": "2026-01-01T00:00:00Z", "text": "keep", "sha256": "ab", "source": {"kind": "response"}}\n\n', '.memory', readMemoryNote);
    expect(notes).toEqual([{ ts: 1, at: '2026-01-01T00:00:00Z', text: 'keep', sha256: 'ab', source: { kind: 'response' } }]);
    expect(() => fromJSONL('{"ts": 1}', '.memory', readMemoryNote)).toThrow(/line 1 is missing/);
    expect(() => fromJSONL('nope', '.memory', readMemoryNote)).toThrow(/line 1 is not JSON/);
  });
});

describe('.history', () => {
  it('keeps extra fields and round-trips', () => {
    const recs = fromJSONL('{"ts": 1, "user": "q", "assistant": "a", "receipt": {"bankml": "0.0.4"}}', '.history', readHistoryRecord);
    expect(recs[0].receipt).toEqual({ bankml: '0.0.4' });
    expect(fromJSONL(toJSONL(recs), '.history', readHistoryRecord)).toEqual(recs);
  });
});

describe('.persona', () => {
  it('reads boardroom lines like the boardroom does', () => {
    const p = parsePersona(JSON.stringify({
      name: 'CEO',
      behavioral_traits: ['decisive', 'strategic'],
      beliefs: { long_term_matters: true, hype_works: false },
      desires: { growth: 'high', comfort: 'low', safety: { priority: 'critical' } },
    }));
    expect(personaLines(p)).toEqual([
      'Behavioural traits: decisive, strategic',
      'Operating beliefs: long term matters',
      'Priorities: growth, safety',
    ]);
  });
  it('adds awareness facts (bankml.persona) after the other lines', () => {
    const p = parsePersona(JSON.stringify({
      name: 'bankML',
      awareness: { _doc: 'facts', facts: [{ fact: 'My home is github.com/cryptoAGI/bankml.', source: 'README' }, { fact: '  ' }, 'Plain string fact.'] },
    }));
    expect(personaLines(p)).toEqual(['What I know about myself:\n- My home is github.com/cryptoAGI/bankml.\n- Plain string fact.']);
    expect(personaLines(parsePersona('{"awareness": {"facts": "nope"}}'))).toEqual([]);
  });
  it('refuses malformed personas', () => {
    expect(() => parsePersona('[]')).toThrow(/JSON object/);
    expect(() => parsePersona('{"system_prompt": 3}')).toThrow(/system_prompt/);
  });
});

describe('composing the system prompt', () => {
  const persona = { name: 'Savante', system_prompt: 'You are Savante.', behavioral_traits: ['exact'] };
  it('prefers the persona prompt when asked, else .prompt', () => {
    expect(composeSystem({ prompt: 'P', persona, source: 'persona', memory: [] })).toEqual({
      system: 'You are Savante.\nBehavioural traits: exact',
      promptSource: 'persona.system_prompt',
    });
    expect(composeSystem({ prompt: 'P', persona, source: 'prompt', memory: [] }).promptSource).toBe('.prompt');
    expect(composeSystem({ prompt: '', persona: null, source: 'prompt', memory: [] })).toEqual({ system: '', promptSource: 'none' });
  });
  it('appends memory after the prompt', () => {
    expect(composeSystem({ prompt: 'P', persona: null, source: 'prompt', memory: [note('n', 1)] }).system).toBe(('P' + MEMORY_HEADER + '- n').trim());
  });
  it('builds chat messages: system, recent pairs, then the message', () => {
    const h = Array.from({ length: 20 }, (_, i) => ({ ts: i, user: `u${i}`, assistant: `a${i}` }));
    const m = buildMessages('S', h, 'now');
    expect(m[0]).toEqual({ role: 'system', content: 'S' });
    expect(m.length).toBe(1 + 12 * 2 + 1);
    expect(m[1].content).toBe('u8');
    expect(m[m.length - 1]).toEqual({ role: 'user', content: 'now' });
    expect(buildMessages('', [], 'x')).toEqual([{ role: 'user', content: 'x' }]);
  });
});

describe('.model', () => {
  const text = `# policy\nmodel_facet: blockchain.codephreak\ntask_class: reasoning   # general | reasoning\nlogical_model: auto\npinned: false\nlatest:\n  - id: a\n    repo: b\n`;
  it('reads top-level fields and keeps blocks as text', () => {
    const m = parseModel(text);
    expect(m).toMatchObject({ model_facet: 'blockchain.codephreak', task_class: 'reasoning', logical_model: 'auto', pinned: false });
    expect(m.latest).toBe('  - id: a\n    repo: b');
    expect(modelLabel(m)).toBe('auto · reasoning');
    expect(modelLabel({ logical_model: 'qwen3', pinned: true })).toBe('qwen3 (pinned)');
  });
  it('edits one field and keeps comments', () => {
    const next = setModelField(text, 'task_class', 'code_generation');
    expect(next).toContain('task_class: code_generation   # general | reasoning');
    expect(setModelField('a: 1\n', 'pinned', true)).toBe('a: 1\npinned: true\n');
  });
  it('refuses text it cannot read', () => {
    expect(() => parseModel('just words')).toThrow(/cannot read/);
  });
});

describe('.memory delivery records', () => {
  const record = {
    id: 'memory-0001', date: '2026-10-09', question: 'who are you?', answer: 'I am Savante.',
    carrier: { engine: 'llama.cpp b11192 llama-server', model: 'Ternary-Bonsai-8B-Q2_0_g64' },
    deliveries: 1, finish: 'stop', limit: 256, usage: { prompt_tokens: 303, completion_tokens: 66, total_tokens: 369 },
  };
  it('one line: the sagi record field for field, plus the note fields', async () => {
    const line = JSON.parse(await deliveryLine(record, 'Ternary-Bonsai-8B · 303 + 66 tokens', 1791530768));
    expect(line).toMatchObject({ ...record, ts: 1791530768, text: 'Ternary-Bonsai-8B · 303 + 66 tokens', source: { kind: 'delivery' } });
    expect(line.sha256).toBe(await sha256Hex('Ternary-Bonsai-8B · 303 + 66 tokens'));
    expect(readMemoryNote(line)?.source.kind).toBe('delivery');
  });
  it('kept, never sent: the memory block leaves deliveries out', async () => {
    const d = readMemoryNote(JSON.parse(await deliveryLine(record, 'a delivery', 1)))!;
    const n = { ts: 2, at: '', text: 'short answers', sha256: '', source: { kind: 'typed' as const } };
    expect(memoryBlock([d])).toBe('');
    expect(memoryBlock([d, n])).toContain('- short answers');
    expect(memoryBlock([d, n])).not.toContain('a delivery');
  });
});
