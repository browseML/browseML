// SPDX-License-Identifier: MIT
import { describe, expect, it, beforeEach } from 'vitest';
import { CARRIER, FOOTER, TAB, TAB_ORDER, loadPrefs } from '../answerers';
import { sseChat } from '../engine';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
});

describe('who answers', () => {
  it('four tabs, in this order', () => {
    expect(TAB_ORDER.map(e => TAB[e])).toEqual(['bankML · free CPU', 'browseML', 'your own bankML', 'Hugging Face']);
  });
  it('a first visit starts on the free CPU', () => {
    expect(loadPrefs('k', TAB_ORDER).engine).toBe('space');
    mem.set('k', JSON.stringify({ engine: 'browse' }));
    expect(loadPrefs('k', TAB_ORDER).engine).toBe('browse');
    mem.set('k', JSON.stringify({ engine: 'nope' }));
    expect(loadPrefs('k', TAB_ORDER).engine).toBe('space');
  });
  it('the free CPU says what it is, and that it is public', () => {
    const p = loadPrefs('k', TAB_ORDER);
    expect(CARRIER.space(p)).toMatch(/^Bonsai on Hugging Face's free CPU — llama\.cpp, not bankML's engine, no receipt\./);
    expect(CARRIER.space(p)).toMatch(/public/);
    expect(FOOTER.space!()).toBe("Bonsai on Hugging Face's free CPU — llama.cpp, not bankML's engine, no receipt");
    expect(CARRIER.hf(p)).toMatch(/no included inference credit since 2026-10-07/);
  });
});

describe('a provider\'s stream (the router, through the credential module)', () => {
  it('yields the content and reports the usage', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n',
      '\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
    let usage: unknown = null, text = '';
    for await (const p of sseChat(body, u => { usage = u; })) text += p;
    expect(text).toBe('Hello');
    expect(usage).toEqual({ prompt_tokens: 12, completion_tokens: 2 });
  });
  it('an error in the stream is thrown', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"error":{"message":"402 payment required"}}\n')); c.close(); } });
    await expect((async () => { for await (const _ of sseChat(body, () => {})) void _; })()).rejects.toThrow(/402/);
  });
});
