// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseSettings, rateOf, DEFAULT_SETTINGS, NO_SAMPLING } from '../free';


describe('browseML settings and download measures', () => {
  it('keeps only valid values', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ threads: 4, ctx: 2048, maxTokens: 1024, removeAfterSession: true, cacheRam: 64 })).toEqual({ threads: 4, ctx: 2048, maxTokens: 1024, removeAfterSession: true, cacheRam: 64, sampling: NO_SAMPLING, keptPrompts: 4 });
    // any answer length from 1 (the single-token proof) to 2048
    expect(parseSettings({ maxTokens: 1 }).maxTokens).toBe(1);
    expect(parseSettings({ maxTokens: 2049 }).maxTokens).toBe(DEFAULT_SETTINGS.maxTokens);
    // prompts kept read: 1 to 8
    expect(parseSettings({ keptPrompts: 8 }).keptPrompts).toBe(8);
    expect(parseSettings({ keptPrompts: 0 }).keptPrompts).toBe(4);
  });
  it("keeps sampling within Savante's ranges; anything else is the engine's default", () => {
    expect(parseSettings({ sampling: { temperature: 0, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.1, seed: 7 } }).sampling)
      .toEqual({ ...NO_SAMPLING, temperature: 0, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.1, seed: 7 });
    // the advanced tools: DRY, XTC, dynamic temperature — kept in range, whole numbers where the engine counts
    expect(parseSettings({ sampling: { dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 3, xtc_probability: 0.5, xtc_threshold: 0.1, dynatemp_range: 0.5, dynatemp_exponent: 2 } }).sampling)
      .toEqual({ ...NO_SAMPLING, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 3, xtc_probability: 0.5, xtc_threshold: 0.1, dynatemp_range: 0.5, dynatemp_exponent: 2 });
    expect(parseSettings({ sampling: { dry_multiplier: 3, dry_base: 0.9, dry_allowed_length: 2.5, xtc_probability: 1.5, xtc_threshold: 0.6, dynatemp_range: -1, dynatemp_exponent: 0 } }).sampling)
      .toEqual(NO_SAMPLING);
    expect(parseSettings({ sampling: { temperature: 3, top_p: 0, top_k: 1.5, min_p: -1, repeat_penalty: 0.5, seed: 'x' } }).sampling).toEqual(NO_SAMPLING);
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
