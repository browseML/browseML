// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { availableFrom, claimOf } from '../tools';

describe('how much processor browseML claims', () => {
  it('all of it up to three threads free; one left for the unexpected from four', () => {
    expect([1, 2, 3, 4, 6, 8].map(claimOf)).toEqual([1, 2, 3, 3, 5, 7]);
  });
  it('threads free: the fewest workers that reach 90% of the best total; a dip on the way does not stop the count', () => {
    expect(availableFrom([100, 195, 280, 340, 345, 342, 340, 338])).toBe(4);           // 4 cores, then nothing more
    expect(availableFrom([100, 98, 260, 330, 335, 330, 320, 300])).toBe(4);            // a noisy burst at 2
    expect(availableFrom([100, 120, 125, 126, 124, 120, 118, 115])).toBe(2);            // busy: little to gain past 2
    expect(availableFrom([100, 101, 99, 100, 98, 97, 99, 100])).toBe(1);               // one core free
  });
});
