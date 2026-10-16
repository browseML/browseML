// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { bm25, complexity, instantPath, localAtlas } from '../atlasSource';
import { activeModules, type ModuleInfo } from '../modules';

const input = {
  memory: [{ text: 'the operator prefers verdicts', at: '2026-10-15T10:00:00Z', source: { kind: 'typed' } }, { text: 'ternary kernels are exact', at: '2026-10-16T09:00:00Z', source: { kind: 'response' } }],
  history: [{ user: 'how fast is the ternary kernel?', assistant: 'about 0.2 s a token', sent_at: '2026-10-15T11:00:00Z' }, { user: 'what is RAGE?', assistant: 'retrieval first, generation second', at: '2026-10-16T08:00:00Z' }],
  sections: ['NOW', 'HARD DRIVE', 'GITMIND'],
};

describe("this browser's own atlas", () => {
  it('.memory by kind, .history by day (newest first), the control panel', () => {
    const a = localAtlas(input);
    expect(a.tree.map(b => [b.id, b.n])).toEqual([['memory', 2], ['history', 2], ['panel', 3]]);
    expect(a.tree[1].paths.map(p => p.label)).toEqual(['2026-10-16', '2026-10-15']);
    expect(a.docs['his:0'].t).toBe('how fast is the ternary kernel?');
  });
  it('BM25 finds by word, best first; nothing for nothing', () => {
    const a = localAtlas(input);
    expect(bm25(a, 'ternary kernel', 5).map(h => h.doc)).toEqual(expect.arrayContaining(['mem:1', 'his:0']));
    expect(bm25(a, 'retrieval', 5)[0].doc).toBe('his:1');
    expect(bm25(a, 'zebra', 5)).toEqual([]);
  });
  it("v1's instant path: titles and notes holding the word", () => {
    const a = localAtlas(input);
    expect(instantPath(a, 'GIT').map(h => h.doc)).toEqual(['cp:GITMIND']);
    expect(instantPath(a, 'x')).toEqual([]);
  });
  it("v1's complexity: nodes and tags, amber past 0.8, at most 1", () => {
    expect(complexity(0, 0)).toBe(0);
    expect(complexity(10, 5)).toBeCloseTo(0.2, 12);
    expect(complexity(100, 100)).toBe(1);
  });
});

describe('modules', () => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const m = (id: string, first = false): ModuleInfo => ({ id, label: id, note: '', make: () => ({ id, label: id, first }) });
  it('turned off, a module is not made at all', () => {
    localStorage.setItem('browseml:modules-off', JSON.stringify(['b']));
    expect(activeModules([m('a'), m('b')]).map(x => x.id)).toEqual(['a']);
    localStorage.removeItem('browseml:modules-off');
    expect(activeModules([m('a'), m('b')]).map(x => x.id)).toEqual(['a', 'b']);
  });
});
