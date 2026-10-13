// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseSettings, rateOf, DEFAULT_SETTINGS } from '../free';


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

import { recognise } from '../free';
describe('a model already on this computer', () => {
  const model = { title: 'Bonsai-1.7B · 1-bit (Q1_0)', bytes: 248_302_272, sha256: '3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3' };
  it('another size is not this model (no hashing needed)', () => {
    const r = recognise({ name: 'Bonsai-8B-Q1_0.gguf', size: 1_160_000_000 }, model)!;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/not this model/);
  });
  it('the right size waits for its sha256', () => {
    expect(recognise({ name: 'x.gguf', size: model.bytes }, model)).toBeNull();
  });
  it('the pinned sha256 is recognised (any case); another is refused', () => {
    expect(recognise({ name: 'x.gguf', size: model.bytes, sha256: model.sha256.toUpperCase() }, model)).toMatchObject({ ok: true, name: model.title });
    const bad = recognise({ name: 'x.gguf', size: model.bytes, sha256: '00'.repeat(32) }, model)!;
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toMatch(/not the model browseML answers from/);
  });
});
