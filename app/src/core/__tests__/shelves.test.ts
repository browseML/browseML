// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { SIDEBAR, addPanel, defaultShelves, parseShelves, removePanel, renameShelf, shelfOf, shelfPut, shelfTake } from '../shelves';

describe('shelves', () => {
  it('start with the sidebar menu', () => {
    expect(defaultShelves()).toEqual({ shelves: [{ id: SIDEBAR, title: 'menu', ids: [] }], shown: false });
  });
  it('put a button on one shelf at a place, taking it off any other', () => {
    let s = addPanel(defaultShelves(), 'tools').state;
    s = shelfPut(s, 'a', SIDEBAR)!;
    s = shelfPut(s, 'b', SIDEBAR, 0)!;
    expect(s.shelves[0].ids).toEqual(['b', 'a']);
    s = shelfPut(s, 'a', 'panel-1')!;
    expect(s.shelves.map(x => x.ids)).toEqual([['b'], ['a']]);
    expect(shelfOf(s, 'a')).toBe('panel-1');
    expect(shelfPut(s, 'a', 'nope')).toBeNull();
    expect(shelfOf(shelfTake(s, 'a'), 'a')).toBeNull();
  });
  it('add, rename and remove panels; the sidebar stays', () => {
    let s = addPanel(defaultShelves()).state;
    const r = addPanel(s, '  load  ');
    expect(r.id).toBe('panel-2');
    s = shelfPut(r.state, 'x', 'panel-2')!;
    expect(s.shelves[2].title).toBe('load');
    expect(renameShelf(s, 'panel-2', 'mine').shelves[2].title).toBe('mine');
    expect(renameShelf(s, 'panel-2', '   ')).toBe(s);
    const gone = removePanel(s, 'panel-2')!;
    expect(gone.freed).toEqual(['x']);
    expect(gone.state.shelves.map(x => x.id)).toEqual([SIDEBAR, 'panel-1']);
    expect(removePanel(s, SIDEBAR)).toBeNull();
    expect(addPanel(removePanel(s, 'panel-1')!.state).id).toBe('panel-1');
  });
  it('parse what was stored: bad shapes give the default, the sidebar first, a button on one shelf', () => {
    expect(parseShelves(null)).toEqual(defaultShelves());
    expect(parseShelves({ shelves: 3 })).toEqual(defaultShelves());
    const p = parseShelves({ shelves: [
      { id: 'panel-1', title: 'p', ids: ['a', 'b', 7] },
      { id: 'sidebar', title: '', ids: ['b', 'c'] },
      { id: 'evil', ids: ['d'] },
      { id: 'panel-1', ids: ['e'] },
    ] });
    expect(p.shelves).toEqual([{ id: 'sidebar', title: 'sidebar', ids: ['c'] }, { id: 'panel-1', title: 'p', ids: ['a', 'b'] }]);
    expect(p.shown).toBe(false);
    expect(parseShelves({ shelves: [], shown: true }).shown).toBe(true);
    expect(shelfPut({ ...defaultShelves(), shown: true }, 'a', SIDEBAR)!.shown).toBe(true);
  });
});
