// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it } from 'vitest';
import { advise, clearUsage, median, recordAnswer, recordLoad, recordWarm, setClock, summarize, usageLog, type AnswerRecord } from '../usage';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  setClock(() => 1000);
});

const answer = (p: Partial<AnswerRecord>): Omit<AnswerRecord, 'at'> => ({
  threads: 4, ctx: 4096, cacheRam: 0, build: 'browseml-mt-relaxed.wasm', prompt: 100, completion: 50, cached: 0,
  promptPerSec: 5, genPerSec: 2.5, promptMs: 20000, genMs: 20000, memory: 330e6, ...p,
});
const load = { source: 'download' as const, fetched: 248302272, retries: 0, modelMs: 30000, openMs: 6000, totalMs: 36000, memory: 317e6, threads: 4, ctx: 4096, cacheRam: 0, build: 'browseml-mt.wasm' };
const now = { memoryGB: 4, threads: 4, ctx: 4096, cacheRam: 0 };

describe('usage records', () => {
  it('are kept, the last 50 of each, and cleared', () => {
    for (let i = 0; i < 55; i++) recordAnswer(answer({ prompt: i }));
    recordLoad(load);
    const u = usageLog();
    expect(u.answers).toHaveLength(50);
    expect(u.answers[0].prompt).toBe(5);
    expect(u.loads[0]).toMatchObject({ at: 1000, memory: 317e6 });
    clearUsage();
    expect(usageLog()).toEqual({ loads: [], answers: [], warms: [] });
  });
  it('survive storage that is off or not theirs', () => {
    mem.set('browseml:usage', '{"nope":1}');
    expect(usageLog()).toEqual({ loads: [], answers: [] });
    (globalThis as any).localStorage = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
    expect(() => recordAnswer(answer({}))).not.toThrow();
  });
});

describe('summarize', () => {
  it('medians per thread count, the peak memory, the longest exchange, the cache share', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([0, NaN])).toBe(0);
    const s = summarize({ loads: [{ ...load, at: 1 }], answers: [
      { ...answer({ threads: 2, genPerSec: 1.5 }), at: 1 }, { ...answer({ threads: 4, genPerSec: 2.7, memory: 400e6 }), at: 2 },
      { ...answer({ threads: 4, genPerSec: 2.5, prompt: 900, cached: 300 }), at: 3 },
    ] });
    expect(s.byThreads).toEqual([{ threads: 2, answers: 1, gen: 1.5, prompt: 5 }, { threads: 4, answers: 2, gen: 2.6, prompt: 5 }]);
    expect(s.peakMemory).toBe(400e6);
    expect(s.longest).toEqual({ tokens: 950, ctx: 4096 });
    expect(s.cacheShare).toBeCloseTo(300 / 1100);
  });
});

describe('advise: only from what was measured', () => {
  it('says so when nothing was measured', () => {
    expect(advise({ loads: [], answers: [] }, now)[0].text).toMatch(/nothing measured yet/);
  });
  it('memory against what the device reports, worst first', () => {
    const v = advise({ loads: [{ ...load, at: 1, memory: 1.2e9 }], answers: [] }, { ...now, memoryGB: 2 });
    expect(v[0]).toMatchObject({ level: 'bad' });
    expect(v[0].text).toMatch(/1200 MB at most, 60% of the 2 GB/);
    expect(advise({ loads: [{ ...load, at: 1 }], answers: [] }, { ...now, memoryGB: null })[0].text).toMatch(/does not report/);
  });
  it('a smaller context when the conversations use little of it', () => {
    const u = { loads: [], answers: [{ ...answer({ prompt: 300, completion: 100 }), at: 1 }, { ...answer({}), at: 2 }] };
    expect(advise(u, now).map(v => v.text).join('\n')).toMatch(/held 400 of 4096 tokens: a 1024-token context/);
    const full = { loads: [], answers: [{ ...answer({ prompt: 3600, completion: 200 }), at: 1 }, { ...answer({}), at: 2 }] };
    expect(advise(full, now).find(v => /near the 4096-token context/.test(v.text))?.level).toBe('warn');
  });
  it('the fastest threads measured, or fewer when they are nearly as fast', () => {
    const a = (threads: number, genPerSec: number) => ({ ...answer({ threads, genPerSec }), at: 1 });
    expect(advise({ loads: [], answers: [a(2, 1.4), a(4, 2.7)] }, { ...now, threads: 2 }).map(v => v.text).join('\n')).toMatch(/4 threads measured fastest here \(2\.70 tok\/s writing\); 2 are chosen now/);
    expect(advise({ loads: [], answers: [a(2, 2.5), a(4, 2.7)] }, now).map(v => v.text).join('\n')).toMatch(/2 threads wrote 2\.50 tok\/s, within 10% of 4/);
    expect(advise({ loads: [], answers: [a(4, 2.7)] }, now).map(v => v.text).join('\n')).toMatch(/measured at 4 threads only/);
  });
  it('a prompt cache that reused nothing gives its memory back', () => {
    const u = { loads: [], answers: [1, 2, 3].map(at => ({ ...answer({ cacheRam: 64 }), at })) };
    expect(advise(u, { ...now, cacheRam: 64 }).map(v => v.text).join('\n')).toMatch(/64 MiB prompt cache reused nothing in 3 answers/);
  });
  it('the pieces the connection cut', () => {
    expect(advise({ loads: [{ ...load, at: 1, retries: 2 }], answers: [] }, now).map(v => v.text).join('\n')).toMatch(/cut 2 pieces/);
  });
  it('the prompt cache, as measured: a restore against the last read', () => {
    recordWarm({ how: 'warmed', tokens: 397, bytes: 45.5e6, ms: 206000, threads: 2 });
    expect(advise(usageLog(), now).map(v => v.text).join('\n')).toMatch(/prompt was read once \(397 tokens, 206 s\) and kept/);
    recordWarm({ how: 'restored', tokens: 397, bytes: 45.5e6, ms: 300, threads: 2 });
    expect(advise(usageLog(), now).map(v => v.text).join('\n')).toMatch(/397 prompt tokens restored in 0\.3 s, where reading them took 206 s/);
  });
});
