// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseHost } from '../host';
import { addThought, addToDay, DEFAULT_SHARE, engineCaps, isFinal, kindsTaken, measuredSpeeds, parseKinds, parsePool, parseShare, pauseReason, restAfter, THOUGHTS_KEPT, toggleKind,
  usedToday } from '../modules/shareCore';

describe('the share host', () => {
  const share = { label: 'mindX', join: '/sharedcpu/join', update: '/sharedcpu/update', pull: '/sharedcpu/pull', result: '/sharedcpu/result',
    leave: '/sharedcpu/leave', me: '/sharedcpu/me', token: 'mindx_realm_token', signin: '/activity' };
  it('a share host on same-origin paths is kept', () => {
    expect(parseHost({ share }).share).toEqual(share);
  });
  it('the public pool view is kept only on the same origin', () => {
    expect(parseHost({ share: { ...share, insight: '/insight/sharedcpu' } }).share?.insight).toBe('/insight/sharedcpu');
    expect(parseHost({ share: { ...share, insight: 'https://evil.example/i' } }).share?.insight).toBeUndefined();
  });
  it('one path anywhere else drops it, so the token can never leave the origin', () => {
    expect(parseHost({ share: { ...share, result: 'https://evil.example/r' } }).share).toBeUndefined();
    expect(parseHost({ share: { ...share, pull: '//evil.example/p' } }).share).toBeUndefined();
    expect(parseHost({ share: { ...share, token: '' } }).share).toBeUndefined();
    const { me: _, ...noMe } = share;
    expect(parseHost({ share: noMe }).share).toBeUndefined();
  });
});

describe('the share settings', () => {
  it('malformed fields fall back one by one', () => {
    expect(parseShare(null)).toEqual(DEFAULT_SHARE);
    expect(parseShare({ pct: 'all', pauseAt: 'never', maxJobTokens: 999 })).toEqual({ ...DEFAULT_SHARE, pauseAt: 'never' });
  });
  it('the share is clamped to 5..100 in steps of 5', () => {
    expect(parseShare({ pct: 0 }).pct).toBe(5);
    expect(parseShare({ pct: 250 }).pct).toBe(100);
    expect(parseShare({ pct: 33 }).pct).toBe(35);
  });
});

describe('the duty cycle', () => {
  it('rests so the host gets its share of the engine over time', () => {
    expect(restAfter(10_000, 25)).toBe(30_000);    // 10 s given, 30 s rest → 25 %
    expect(restAfter(10_000, 50)).toBe(10_000);
    expect(restAfter(10_000, 100)).toBe(0);
    expect(restAfter(-5, 50)).toBe(0);
  });
});

describe('when sharing waits', () => {
  const ok = { charging: true, pressure: 'nominal' as const, hidden: false, visitorBusy: false, usedTodayMs: 0 };
  it('goes on when nothing stands in the way', () => {
    expect(pauseReason(ok, DEFAULT_SHARE)).toBeNull();
    expect(pauseReason({ ...ok, charging: null }, DEFAULT_SHARE)).toBeNull();          // no battery: a desktop
  });
  it('the visitor first, then battery, pressure, a hidden tab, the daily cap', () => {
    expect(pauseReason({ ...ok, visitorBusy: true, charging: false }, DEFAULT_SHARE)).toBe('your own question first');
    expect(pauseReason({ ...ok, charging: false }, DEFAULT_SHARE)).toMatch(/battery/);
    expect(pauseReason({ ...ok, charging: false }, { ...DEFAULT_SHARE, onlyCharging: false })).toBeNull();
    expect(pauseReason({ ...ok, pressure: 'serious' }, DEFAULT_SHARE)).toBe('CPU pressure serious');
    expect(pauseReason({ ...ok, pressure: 'fair' }, DEFAULT_SHARE)).toBeNull();
    expect(pauseReason({ ...ok, pressure: 'critical' }, { ...DEFAULT_SHARE, pauseAt: 'never' })).toBeNull();
    expect(pauseReason({ ...ok, hidden: true }, { ...DEFAULT_SHARE, pauseHidden: true })).toBe('tab hidden');
    expect(pauseReason({ ...ok, usedTodayMs: 30 * 60_000 }, DEFAULT_SHARE)).toMatch(/30 min/);
    expect(pauseReason({ ...ok, usedTodayMs: 10 ** 9 }, { ...DEFAULT_SHARE, dailyMinutes: 0 })).toBeNull();
  });
  it('the daily budget starts again each day', () => {
    const b = addToDay(addToDay(null, 1000, '2026-10-19'), 500, '2026-10-19');
    expect(usedToday(b, '2026-10-19')).toBe(1500);
    expect(usedToday(b, '2026-10-20')).toBe(0);
    expect(addToDay(b, 200, '2026-10-20')).toEqual({ day: '2026-10-20', ms: 200 });
  });
});

describe('distributed.mind: the kinds of thought', () => {
  const cat = parseKinds({ answer: { label: 'answer', about: 'a completion', unverified_ok: true },
    probe: { label: 'coach probe', about: 'the coach asks', unverified_ok: false }, 'BAD ID': { label: 'x', about: 'y' }, evil: { label: 3 } });
  it('only well-formed kinds from the host are kept', () => {
    expect(Object.keys(cat)).toEqual(['answer', 'probe']);
    expect(cat.probe.unverified_ok).toBe(false);
    expect(parseKinds('nope')).toEqual({});
  });
  it('no choice yet means every kind the host offers; a choice is kept within the catalogue', () => {
    expect(kindsTaken(DEFAULT_SHARE, cat)).toEqual(['answer', 'probe']);
    expect(kindsTaken({ ...DEFAULT_SHARE, kinds: ['probe', 'gone'] }, cat)).toEqual(['probe']);
    expect(kindsTaken({ ...DEFAULT_SHARE, kinds: ['gone'] }, cat)).toEqual(['answer', 'probe']);
  });
  it('a kind toggles, but the last one cannot be turned off', () => {
    const one = { ...DEFAULT_SHARE, kinds: toggleKind(DEFAULT_SHARE, cat, 'answer') };
    expect(one.kinds).toEqual(['probe']);
    expect(toggleKind(one, cat, 'probe')).toEqual(['probe']);
    expect(toggleKind(one, cat, 'answer')).toEqual(['probe', 'answer']);
  });
  it('the choice survives storage, and junk falls back to every kind', () => {
    expect(parseShare({ kinds: ['probe', 'probe'] }).kinds).toEqual(['probe']);
    expect(parseShare({ kinds: [1, 2] }).kinds).toBeNull();
    expect(parseShare({ kinds: [] }).kinds).toBeNull();
  });
  it('a barred refusal is final; anything else may be retried', () => {
    expect(isFinal({ barred: true })).toBe(true);
    expect(isFinal({})).toBe(false);
    expect(isFinal(null)).toBe(false);
  });
  it('the thoughts list keeps the newest few', () => {
    let l: ReturnType<typeof addThought> = [];
    for (let i = 0; i < THOUGHTS_KEPT + 3; i++) l = addThought(l, { at: i, kind: 'answer', purpose: '', tokens: 1, ms: 1, verdict: 'accepted' });
    expect(l.length).toBe(THOUGHTS_KEPT);
    expect(l[0].at).toBe(THOUGHTS_KEPT + 2);
  });
});

describe('the distributed mind now', () => {
  it('the pool view keeps what the panel shows and drops junk', () => {
    const v = parsePool({ contributors: 3, available: 2, queued: 1, totals: { core_seconds: 42.5 },
      top: [{ rank: 1, wallet: '0x1111…1111', core_seconds: 30, jobs: 4, trusted: true }, null, 'x'] });
    expect(v).toEqual({ contributors: 3, available: 2, queued: 1, coreSeconds: 42.5,
      top: [{ rank: 1, wallet: '0x1111…1111', core_seconds: 30, jobs: 4, trusted: true }] });
    expect(parsePool({ nope: 1 })).toBeNull();
    expect(parsePool(null)).toBeNull();
  });
});

describe('the speeds sent at join', () => {
  it("this browser's measured speeds at its thread count, or nothing", () => {
    const rows = [{ threads: 2, answers: 3, gen: 6.12345, prompt: 12.8 }, { threads: 4, answers: 0, gen: 0, prompt: 0 }];
    expect(measuredSpeeds(rows, 2)).toEqual({ gen_tps: 6.123, prompt_tps: 12.8 });
    expect(measuredSpeeds(rows, 4)).toEqual({});
    expect(measuredSpeeds(rows, 8)).toEqual({});
    expect(measuredSpeeds([{ threads: 1, answers: 1, gen: NaN, prompt: 3 }], 1)).toEqual({ prompt_tps: 3 });
  });
});

describe('what computes here', () => {
  it('the engine id always; the GPU only when bankML runs on one', () => {
    expect(engineCaps({ version: '0.8.9', gpu: 'off', gpuTime: 80 })).toEqual({ engine: 'browseml/0.8.9' });
    expect(engineCaps({ version: '0.8.9', gpu: 'high-performance', gpuTime: 80, gpuNote: 'Apple M2 · WebGPU' }))
      .toEqual({ engine: 'browseml/0.8.9', gpu: { name: 'Apple M2', share: 0.8 } });
    expect(engineCaps({ version: '0.8.9', gpu: 'low-power', gpuTime: 0 })).toEqual({ engine: 'browseml/0.8.9' });
    expect(engineCaps(null)).toEqual({ engine: 'browseml/unknown' });
  });
});
