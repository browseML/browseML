// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { exactRate, fmtRate } from '../netrate';

describe('network speed', () => {
  it('in the unit that fits, as bits per second', () => {
    expect(fmtRate(0)).toBe('0 b/s');
    expect(fmtRate(10)).toBe('80.0 b/s');
    expect(fmtRate(125)).toBe('1.00 kb/s');
    expect(fmtRate(300_000)).toBe('2.40 Mb/s');
    expect(fmtRate(150_000_000)).toBe('1.20 Gb/s');
    expect(fmtRate(2e12)).toBe('16.0 Tb/s');
  });
  it('exact to 18 decimals', () => {
    expect(exactRate(248302272, 41234.567)).toBe('48173615.500800578310910843');  // Python's integers agree
    expect(exactRate(1, 3)).toBe('2666.666666666666666666');
    expect(exactRate(125, 1000)).toBe('1000.000000000000000000');
    expect(exactRate(0, 5)).toBe('0.000000000000000000');
  });
});
