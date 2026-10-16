// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { clientFacts, intent, proposals, withFacts } from '../clientdata';
import { DEFAULT_SETTINGS } from '../free';

describe('questions about this computer', () => {
  it('ordinary questions trigger nothing', () => {
    for (const q of ['what is RAGE?', 'write a haiku about rain', 'add this to my memory notes', 'who are you?']) expect(intent(q)).toEqual([]);
  });
  it('machine questions name their topics', () => {
    expect(intent('how much memory does my computer have?')).toEqual(['memory']);
    expect(intent('how many cores and what GPU does this laptop have?')).toEqual(['cpu', 'gpu']);
    expect(intent('why is it so slow? how many tokens per second?')).toEqual(['speed']);
    expect(intent('how much storage is left in the cache?')).toEqual(['storage']);
    expect(intent('is my battery charging?')).toEqual(['battery']);
  });
  it('the lines are measured values, short, within budget', () => {
    const s = { cores: 4, threadsFree: 3, threadsUsed: 2, memoryGB: 8, engineMemoryMB: 612, gpu: 'AMD Radeon Vega 8 (integrated)', gpuBusy: 12,
      storage: ['browseML uses 260 MB (12.1 % of the quota)', 'available 1.8 GB'], lastAnswerTokPerSec: 2.76, model: 'Bonsai-1.7B-Q1_0.gguf',
      engineVersion: '0.4.4', simd: true, isolated: true, advice: ['2 threads gave the best writing speed here'] };
    const l = clientFacts(s, ['memory', 'cpu', 'speed']);
    expect(l[0]).toBe('memory: the browser reports 8 GB (a rounded floor) · the engine holds 612 MB');
    expect(l[1]).toBe('CPU: 4 logical cores · 3 free, measured · the engine uses 2');
    expect(l[2]).toBe('speed: the last answer was written at 2.76 tokens a second on 2 threads');
    expect(l.join('\n').length).toBeLessThanOrEqual(600);
    expect(clientFacts(s, [])).toEqual([]);
    expect(withFacts('q', [])).toBe('q');
    expect(withFacts('q', ['CPU: 4'])).toMatch(/^THIS COMPUTER .*\n- CPU: 4\n\nQuestion: q$/s);
  });
});

describe('adjustments, proposed exactly', () => {
  const s = { ...DEFAULT_SETTINGS, threads: 2, maxTokens: 256, ctx: 2048, cacheRam: 0 };
  it('each request is one validated change, with when it applies', () => {
    expect(proposals('please use 4 threads', s, 4)).toEqual([{ id: 'threads', label: 'threads 2 → 4', when: 'next load', settings: { threads: 4 } }]);
    expect(proposals('give me longer answers', s, 4)[0]).toMatchObject({ id: 'maxTokens', label: 'answers up to 256 → 384 tokens', when: 'next question' });
    expect(proposals('shorter answers please', s, 4)[0].settings).toEqual({ maxTokens: 128 });
    expect(proposals('I need more context', s, 4)[0]).toMatchObject({ settings: { ctx: 4096 }, when: 'next load' });
    expect(proposals('set the prompt cache to 64 MiB', s, 4)[0].settings).toEqual({ cacheRam: 64 });
    expect(proposals('turn the GPU off', s, 4, { gpuProbe: true })[0].limits).toEqual({ gpuProbe: false });
    expect(proposals('save my battery', s, 4, { power: 'high-performance' })[0].limits).toEqual({ power: 'low-power' });
  });
  it('what cannot be done is not proposed', () => {
    expect(proposals('use 16 threads', s, 4)).toEqual([]);          // more than this computer offers
    expect(proposals('use 2 threads', s, 4)).toEqual([]);           // already so
    expect(proposals('set the prompt cache to 77', s, 4)).toEqual([]);  // not a choice
    expect(proposals('what is the context of this story?', s, 4)).toEqual([]);
  });
});
