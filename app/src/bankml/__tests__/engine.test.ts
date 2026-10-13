// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { slackWindow } from '../engine';

describe('slackWindow (keeps bankML\'s prompt-cache prefix for 4 turns at a time)', () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => i);
  it('keeps everything up to 16', () => {
    expect(slackWindow(turns(0))).toEqual([]);
    expect(slackWindow(turns(16))).toEqual(turns(16));
  });
  it('then drops 4 at once, so the first kept exchange changes every 4 turns', () => {
    const starts = [17, 18, 19, 20, 21, 22, 23, 24, 25].map(n => slackWindow(turns(n))[0]);
    expect(starts).toEqual([4, 4, 4, 4, 8, 8, 8, 8, 12]);
    for (const n of [17, 20, 21, 40, 99]) {
      const w = slackWindow(turns(n));
      expect(w.length).toBeGreaterThanOrEqual(13);
      expect(w.length).toBeLessThanOrEqual(16);
      expect(w[w.length - 1]).toBe(n - 1);
    }
  });
});
