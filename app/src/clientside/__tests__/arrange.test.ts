// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { merge, move } from '../Arrange';

describe('arranging the control panel', () => {
  it('a saved order keeps its sections; new ones go where the page puts them; gone ones drop out', () => {
    expect(merge(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);  // c follows b, as on the page
    expect(merge(['c', 'a'], ['now', 'a', 'b', 'c'])).toEqual(['now', 'c', 'a', 'b']);
    expect(merge(['x', 'a'], ['a'])).toEqual(['a']);
    expect(merge([], ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('a section moved to a place', () => {
    expect(move(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(move(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(move(['a', 'b'], 'a', 9)).toEqual(['b', 'a']);
  });
});
