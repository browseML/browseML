// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { FOOTER_MARK, findReceipt, parseSettings, parseStats, plainText, rateOf, spaceDelivery, splitFooter, DEFAULT_SETTINGS } from '../free';

// the Space's stats as /mindx sent them on 2026-10-09 (Ternary-Bonsai-8B, "Name a prime number.")
const STATS_HTML = "<div class='mx-kv'><table><tr><td style='color:var(--mx-text2);padding:2px 12px 2px 0'>tokens</td><td>prompt <b>30</b> · completion <b>7</b> · total <b>37</b></td></tr><tr><td>speed</td><td>1.12 tok/s in 6.227 s on cpu (llama.cpp b11192)</td></tr><tr><td>context</td><td>37 of 4096</td></tr><tr><td>model</td><td>Ternary-Bonsai-8B · Q2_0_g64 · loaded now: ternary-bonsai-8b, bonsai-8b</td></tr><tr><td>stopped on</td><td>stop</td></tr><tr><td>chronos.oracle</td><td>first token <b>4.758</b> s · GPU <b>— (CPU only)</b> · CPU <b>98.24</b> s (llama-server)</td></tr></table></div>";

describe('the free CPU, as Savante renders it', () => {
  it('reads the Space\'s own stats', () => {
    const st = parseStats(plainText(STATS_HTML));
    expect(st).toMatchObject({ prompt: 30, completion: 7, tps: 1.12, seconds: 6.227, first: 4.758, stopped: 'stop' });
    expect(st.on).toBe('cpu (llama.cpp b11192)');
  });
  it('writes the delivery line from them, honestly', () => {
    const line = spaceDelivery(parseStats(plainText(STATS_HTML)), 'Ternary-Bonsai-8B');
    expect(line).toBe('delivered by the model — 30 prompt → 7 completion tokens · 1.12 tok/s · first token 4.758 s · Ternary-Bonsai-8B on cpu (llama.cpp b11192) · free public CPU (Gregory-L/mindXhfgradio) · no receipt (not bankML)');
    expect(spaceDelivery({}, 'bankML', 'ok')).toContain('✓ receipt');
  });
  it('no stats is no completion', () => {
    expect(parseStats('').completion).toBeUndefined();
    expect(spaceDelivery({}, 'x')).toContain('? prompt → 0 completion tokens');
  });
  it('splits the Space\'s footer off the model\'s words', () => {
    const full = 'Two is prime.' + FOOTER_MARK + ' (Savante) · public office: …';
    expect(splitFooter(full, true)).toEqual({ answer: 'Two is prime.', footer: '— sAGI (Savante) · public office: …' });
    expect(splitFooter('plain', true)).toEqual({ answer: 'plain', footer: '' });
  });
  it('while streaming, holds back what may be the start of the footer', () => {
    expect(splitFooter('Two is prime.\n', false).answer).toBe('Two is prime.');
    expect(splitFooter('Two is prime.\n\n— s', false).answer).toBe('Two is prime.');
    expect(splitFooter('Two is prime.\n\nThree', false).answer).toBe('Two is prime.\n\nThree');
    expect(splitFooter('Two is prime.\n', true).answer).toBe('Two is prime.\n');
  });
  it('finds a bankml_receipt among a future /bankml endpoint\'s outputs', () => {
    const r = { bankml: '0.5.0', model_sha256: 'aa', response_sha256: 'bb' };
    expect(findReceipt(['text', '<b>stats</b>', JSON.stringify({ bankml_receipt: r })])).toEqual(r);
    expect(findReceipt(['text', r])).toEqual(r);
    expect(findReceipt(['text', '{not json', null, 3])).toBeNull();
    expect(findReceipt(['text', { response_sha256: 'bb' }])).toBeNull();
  });
});

describe('browseML settings and download measures', () => {
  it('keeps only valid values', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ threads: 4, ctx: 2048, maxTokens: 1024, removeAfterSession: true, cacheRam: 64 })).toEqual({ threads: 4, ctx: 2048, maxTokens: 1024, removeAfterSession: true, cacheRam: 64 });
    expect(parseSettings({ threads: 0, ctx: 3000, maxTokens: 'x', removeAfterSession: 'yes', cacheRam: 100 })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('starts a low-memory device at the context it is advised, and keeps a chosen one', () => {
    expect(parseSettings({}, 4).ctx).toBe(2048);
    expect(parseSettings({}, 2).ctx).toBe(1024);
    expect(parseSettings({}, 8).ctx).toBe(DEFAULT_SETTINGS.ctx);
    expect(parseSettings({ ctx: 4096 }, 4).ctx).toBe(4096);
  });
  it('measures the rate over its window', () => {
    expect(rateOf([{ t: 0, got: 0 }])).toBeNull();
    expect(rateOf([{ t: 0, got: 0 }, { t: 100, got: 10 }])).toBeNull();
    expect(rateOf([{ t: 0, got: 0 }, { t: 1000, got: 5e6 }, { t: 2000, got: 10e6 }])).toBe(5e6);
  });
});
