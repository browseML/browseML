// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { claimOf } from '../tools';

describe('how much processor browseML claims', () => {
  it('all of it up to three threads free; one left for the unexpected from four', () => {
    expect([1, 2, 3, 4, 6, 8].map(claimOf)).toEqual([1, 2, 3, 3, 5, 7]);
  });
});
