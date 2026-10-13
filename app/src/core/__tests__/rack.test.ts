// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { ActionsLayout } from '../actions';
import { rackAdd, rackMove, rackRemove } from '../rack';
import { parseProfile } from '../profile';

const base = (): ActionsLayout => ({ order: ['load', 'spawn', 'panel', 'later'], hidden: ['help', 'rack'], custom: [], floating: { dock: { x: 4, y: 5 } } });
// 'later' is an id whose action registers later (a module's window): it keeps its place after the racked ones
const known = (id: string) => id !== 'later';

describe('the rack', () => {
  it('adds a hidden button at the end, or at a position', () => {
    expect(rackAdd(base(), 'help', known).order).toEqual(['load', 'spawn', 'panel', 'help', 'later']);
    const l = rackAdd(base(), 'help', known, 0);
    expect(l.order).toEqual(['help', 'load', 'spawn', 'panel', 'later']);
    expect(l.hidden).toEqual(['rack']);
  });
  it('racks a floating button, taking it off the page', () => {
    const l = rackAdd(base(), 'dock', known, 1);
    expect(l.order.slice(0, 2)).toEqual(['load', 'dock']);
    expect(l.floating).toEqual({});
  });
  it('clamps a position past the end', () => {
    expect(rackAdd(base(), 'help', known, 99).order).toEqual(['load', 'spawn', 'panel', 'help', 'later']);
  });
  it('removes a racked or floating button into the hidden ones', () => {
    const l = rackRemove(base(), 'spawn')!;
    expect(l.order).toEqual(['load', 'panel', 'later']);
    expect(l.hidden).toEqual(['help', 'rack', 'spawn']);
    expect(rackRemove(base(), 'dock')!.floating).toEqual({});
    expect(rackRemove(base(), 'help')).toBeNull();
  });
  it('moves a racked button; refuses one not racked', () => {
    expect(rackMove(base(), 'panel', known, 0)!.order).toEqual(['panel', 'load', 'spawn', 'later']);
    expect(rackMove(base(), 'load', known, 2)!.order).toEqual(['spawn', 'panel', 'load', 'later']);
    expect(rackMove(base(), 'help', known, 0)).toBeNull();
  });
});

describe('profile parts', () => {
  const profile = {
    'uif.profile': 1, name: 'p', actions: { order: [], hidden: [] }, hub: { x: 0, y: 0, width: 600, height: 120 },
  };
  it('keeps a host part as found (objects only)', () => {
    const p = parseProfile({ ...profile, parts: { panels: { v: 1, panels: [] }, junk: 3 } });
    expect(p.parts).toEqual({ panels: { v: 1, panels: [] } });
  });
  it('a file without parts has none', () => {
    expect(parseProfile(profile).parts).toBeUndefined();
  });
});
