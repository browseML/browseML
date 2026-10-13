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
