import { describe, expect, it } from 'vitest';
import { MAGNET_REACH, magnetEdge } from '../dock';

const view = { width: 1366, height: 768 };
const box = (x: number, y: number) => ({ x, y, width: 600, height: 120 });

describe('magnetic docking', () => {
  it('far from every edge: no pull', () => expect(magnetEdge(box(300, 300), view)).toBeNull());
  it('within reach of one edge: that edge', () => {
    expect(magnetEdge(box(300, 10), view)).toBe('top');
    expect(magnetEdge(box(300, 768 - 120 - 5), view)).toBe('bottom');
    expect(magnetEdge(box(4, 300), view)).toBe('left');
    expect(magnetEdge(box(1366 - 600 - 20, 300), view)).toBe('right');
  });
  it('past the edge counts as at it', () => expect(magnetEdge(box(300, -40), view)).toBe('top'));
  it('in a corner: the nearer edge', () => expect(magnetEdge(box(2, 20), view)).toBe('left'));
  it('just outside reach: no pull', () => expect(magnetEdge(box(300, MAGNET_REACH + 1), view)).toBeNull());
});
