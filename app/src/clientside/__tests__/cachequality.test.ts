// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { accuracy, accuracyLines, bytesIEC, bytesSI, reportLines, roomLevel, summarize } from '../../bankml/storage';
import { clarity, genius, measure } from '../../bankml/quality';
import { MODEL_BYTES } from '../../bankml/caps';

const entries = [
  { cache: 'browseml-models', name: 'Bonsai-1.7B-Q1_0.gguf', bytes: 248_302_272 },
  { cache: 'browseml-slots', name: 'mindx', bytes: 12_000_000 },
  { cache: 'browseml-other', name: 'x', bytes: 1000 },
];

describe('the cache report', () => {
  it('browseML by kind, the site, what is available', () => {
    const r = summarize(entries, { keys: 3, bytes: 2000 }, { usage: 300_000_000, quota: 2_000_000_000 }, true);
    expect(r.parts.map(p => [p.id, p.bytes])).toEqual([['model', 248_302_272], ['prompts', 12_000_000], ['caches', 1000], ['records', 2000]]);
    expect(r.browseml).toBe(260_305_272);
    expect(r.site).toBe(300_000_000);
    expect(r.available).toBe(1_700_000_000);
    expect(r.lagging).toBe(false);
  });
  it('an estimate that lags is never shown below the count', () => {
    const r = summarize(entries, { keys: 0, bytes: 0 }, { usage: 0, quota: 1e9 }, null);
    expect(r.site).toBe(r.browseml);
    expect(r.lagging).toBe(true);
  });
  it('room as feedback: under the model is bad, under twice is low', () => {
    expect(roomLevel(MODEL_BYTES - 1)).toBe('bad');
    expect(roomLevel(2 * MODEL_BYTES - 1)).toBe('low');
    expect(roomLevel(2 * MODEL_BYTES)).toBe('ok');
    expect(roomLevel(null)).toBe('ok');
  });
  it('units: decimal and binary', () => {
    expect(bytesSI(248_302_272)).toBe('248 MB');
    expect(bytesIEC(248_302_272)).toBe('236.8 MiB');
    expect(bytesIEC(5_000_000)).toBe('4.768 MiB');
    expect(bytesSI(999)).toBe('999 B');
  });
  it('three levels, each adding to the one before', () => {
    const r = summarize(entries, { keys: 3, bytes: 2000 }, { usage: 300_000_000, quota: 2_000_000_000 }, false);
    const v = reportLines(r, 'visual'), e = reportLines(r, 'enhanced', 64), s = reportLines(r, 'scientific', 64);
    expect(v).toHaveLength(3);
    expect(e.slice(0, 3)).toEqual(v);
    expect(s.slice(0, e.length)).toEqual(e);
    expect(e.join('\n')).toMatch(/up to 64 MiB/);
    expect(s.join('\n')).toMatch(/browseml-models\/Bonsai-1.7B-Q1_0.gguf: 248302272 B/);
  });
  it('accuracy: the estimate against the count, read success, stability', () => {
    const counted = summarize(entries, { keys: 0, bytes: 0 }, null, true).browseml;  // 260,303,272
    const r = summarize(entries, { keys: 0, bytes: 0 }, { usage: counted + 4000, quota: 1e9 }, true);
    const a = accuracy(r, { caches: { ok: 3, n: 3 }, local: { ok: 3, n: 3 }, estimate: { ok: 2, n: 3 }, persisted: { ok: 3, n: 3 } }, [r.browseml, r.browseml]);
    expect(a.estimateDelta).toBe(4000);
    const l = accuracyLines(a, 'scientific').join('\n');
    expect(l).toMatch(/reads 4.00 kB above the count/);
    expect(l).toMatch(/estimate 2\/3/);
    expect(l).toMatch(/moved 0 B over the last 2 reads \(repeatable\)/);
  });
});

describe('answer quality: mindX editor.agent formulas, to the letter', () => {
  // the reference numbers are mindX's own Python (agents/editor_agent.py) on the same texts
  const T = [
    'bankML answers in the browser. It checks the model first.',
    'RAGE is retrieval first, generation second, because an answer that cannot point to its source is a guess; however the engine is precisely as good as what it retrieves, and the point is that every passage carries its document name so the reader can check it rather than trust it. See https://rage.pythai.net and https://mindx.pythai.net for more. Make no mistake: the irony is that the smallest model, given the right passage, answers better than a large one without it.',
    'One. Two words here. ' + 'word '.repeat(40) + 'end.',
  ];
  const ref = [[0.65, 0.0], [0.581818181818, 0.866666666667], [0.868181818182, 0.121212121212]];
  it('clarity and genius equal mindX\'s', () => {
    T.forEach((t, i) => { expect(clarity(t)).toBeCloseTo(ref[i][0], 10); expect(genius(t)).toBeCloseTo(ref[i][1], 10); });
  });
  it('accuracy from the record: verified of delivered; scores over what succeeded', () => {
    const q = measure([
      { assistant: T[1], verified: true }, { assistant: T[0], verified: true }, { assistant: 'x', verified: false },
      { assistant: 'not delivered' },
    ]);
    expect(q.delivered).toBe(3);
    expect(q.verified).toBe(2);
    expect(q.accuracy).toBeCloseTo(2 / 3, 12);
    expect(q.scored).toBe(1);
    expect(q.short).toBe(1);
    expect(q.genius!.median).toBeCloseTo(0.866666666667, 10);
    expect(q.clarity!.median).toBeCloseTo((0.65 + 0.581818181818) / 2, 10);
  });
  it('nothing delivered: no accuracy, no scores', () => {
    expect(measure([])).toMatchObject({ delivered: 0, accuracy: null, clarity: null, genius: null });
  });
});
