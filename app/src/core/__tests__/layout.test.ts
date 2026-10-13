import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionRegistry, type Action } from '../actions';
import { parseProfile, profileFileName, serializeProfile } from '../profile';

const action = (id: string, extra: Partial<Action> = {}): Action => ({ id, label: id, command: id, run: () => {}, ...extra });

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  });
});

const ids = (list: Action[]) => list.map(a => a.id);

describe('floating buttons', () => {
  it('floats a button off the bar and docks it back at an index', () => {
    const r = createActionRegistry({ actions: ['a', 'b', 'c'].map(id => action(id)) });
    r.float('b', { x: 100.4, y: 200.6 });
    expect(ids(r.visible())).toEqual(['a', 'c']);
    expect(r.floating().map(f => [f.action.id, f.at])).toEqual([['b', { x: 100, y: 201 }]]);
    r.dockAt('b', 0);
    expect(ids(r.visible())).toEqual(['b', 'a', 'c']);
    expect(r.floating()).toEqual([]);
  });

  it('hides a floating button and shows it back on the bar', () => {
    const r = createActionRegistry({ actions: ['a', 'b'].map(id => action(id)) });
    r.float('a', { x: 1, y: 1 });
    r.hide('a');
    expect(r.floating()).toEqual([]);
    expect(ids(r.hidden())).toEqual(['a']);
    r.show('a');
    expect(ids(r.visible())).toEqual(['b', 'a']);
  });

  it('persists floating positions', () => {
    const acts = ['a', 'b'].map(id => action(id));
    createActionRegistry({ actions: acts, storageKey: 'f' }).float('a', { x: 5, y: 6 });
    const again = createActionRegistry({ actions: acts, storageKey: 'f' });
    expect(again.floating().map(f => f.at)).toEqual([{ x: 5, y: 6 }]);
    expect(ids(again.visible())).toEqual(['b']);
  });
});

describe('snapshot, restore and reset', () => {
  const make = () =>
    createActionRegistry({ actions: [action('a'), action('b'), action('c'), action('x', { defaultHidden: true })] });

  it('restores a snapshot, custom actions included', () => {
    const r = make();
    r.reorder(0, 2);
    r.float('b', { x: 10, y: 20 });
    const custom = r.addCustom({ label: 'Go', payload: 'spawn go' });
    const snap = r.snapshot();

    r.reset();
    r.removeCustom(custom.id);
    expect(r.find('go')).toBeUndefined();

    r.restore(snap);
    expect(ids(r.visible())).toEqual(['c', 'a', custom.id]);
    expect(r.floating().map(f => f.action.id)).toEqual(['b']);
    expect(r.find('go')?.label).toBe('Go');
  });

  it('a snapshot is a copy, not a live view', () => {
    const r = make();
    const snap = r.snapshot();
    r.float('a', { x: 1, y: 1 });
    expect(snap.floating).toEqual({});
    expect(snap.order).toEqual(['a', 'b', 'c']);
  });

  it('resets to the standard layout, keeping custom actions hidden', () => {
    const r = make();
    r.reorder(2, 0);
    r.hide('a');
    r.show('x');
    r.float('b', { x: 3, y: 3 });
    const custom = r.addCustom({ label: 'Mine', payload: 'help' });
    r.reset();
    expect(ids(r.visible())).toEqual(['a', 'b', 'c']);
    expect(ids(r.hidden())).toEqual(['x', custom.id]);
    expect(r.floating()).toEqual([]);
  });

  it('places actions a snapshot does not know about', () => {
    const r = make();
    const snap = r.snapshot();
    r.register(action('late'));
    r.restore(snap);
    expect(ids(r.visible())).toContain('late');
  });
});

describe('.profile files', () => {
  const valid = {
    'uif.profile': 1,
    name: 'work',
    savedAt: '2026-10-06T00:00:00.000Z',
    actions: { order: ['a'], hidden: ['b'], custom: [{ id: 'c1', label: 'C', kind: 'send', payload: 'hi' }], floating: { d: { x: 1, y: 2 } } },
    hub: { x: 10, y: 20, width: 600, height: 130, mode: 'terminal', docked: 'bottom' },
    strings: true,
  };

  it('round-trips through serialize and parse', () => {
    const p = parseProfile(valid);
    expect(parseProfile(JSON.parse(serializeProfile(p)))).toEqual(p);
    expect(p.hub.mode).toBe('terminal');
    expect(p.actions.floating).toEqual({ d: { x: 1, y: 2 } });
  });

  it('rejects files that are not profiles', () => {
    expect(() => parseProfile([])).toThrow(/JSON object/);
    expect(() => parseProfile({ ...valid, 'uif.profile': 2 })).toThrow(/uif.profile/);
    expect(() => parseProfile({ ...valid, hub: { x: 'a' } })).toThrow(/numeric/);
    expect(() => parseProfile({ ...valid, actions: { ...valid.actions, custom: [{ id: 1 }] } })).toThrow(/custom action/);
    expect(() => parseProfile({ ...valid, actions: { ...valid.actions, floating: { d: { x: 1 } } } })).toThrow(/floating/);
  });

  it('normalises unknown modes and dock edges, and falls back to a name', () => {
    const p = parseProfile({ ...valid, name: '', hub: { ...valid.hub, mode: 'weird', docked: 'middle' } }, 'from-file');
    expect([p.name, p.hub.mode, p.hub.docked]).toEqual(['from-file', 'chat', null]);
  });

  it('makes safe file names', () => {
    expect(profileFileName('My Work / Layout')).toBe('My-Work-Layout.profile');
    expect(profileFileName('   ')).toBe('layout.profile');
  });
});
