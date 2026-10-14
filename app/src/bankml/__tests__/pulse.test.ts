import { beforeEach, describe, expect, it } from 'vitest';
import { follow, liveRate, onPulse, recentSurges, resetPulse, setActivity, setPulseClock, setReady, surge, surgeColor, targetHeat, token, toolRunning, noteRate, seedBest, bestRate, type Surge } from '../pulse';

describe("the processor's pulse", () => {
  let t = 0;
  beforeEach(() => { resetPulse(); t = 0; setPulseClock(() => t); });

  it('is cold when idle, embers when ready, and hotter as the engine works harder', () => {
    expect(targetHeat()).toBe(0);
    setReady(true); expect(targetHeat()).toBeCloseTo(0.06);
    setActivity('loading'); expect(targetHeat()).toBe(0.3);
    setActivity('verifying'); expect(targetHeat()).toBe(0.4);
    setActivity('reading'); expect(targetHeat()).toBe(0.7);
    setActivity('warming'); expect(targetHeat()).toBe(0.85);
  });

  it('measures the live writing speed from the tokens themselves, against the best this visit', () => {
    setActivity('reading');
    for (let i = 0; i < 11; i++) { token(); t += 250; }  // 4 tok/s
    expect(liveRate()).toBeCloseTo(4, 1);
    expect(targetHeat()).toBeCloseTo(0.95, 2);  // writing at the best speed seen: 0.35 + 0.6
    noteRate(8);                                // a recorded answer twice as fast
    expect(targetHeat()).toBeCloseTo(0.65, 2);
    t += 4000; expect(liveRate()).toBe(0);      // tokens older than three seconds no longer count
  });

  it('surges on a new speed record, never on the first measurement', () => {
    const got: Surge[] = []; onPulse(s => { if (s) got.push(s); });
    setActivity('reading');
    for (let i = 0; i < 8; i++) { token(); t += 500; }   // 2 tok/s: the first best, no surge
    expect(got.filter(s => s.kind === 'record')).toHaveLength(0);
    t += 4000;
    for (let i = 0; i < 12; i++) { token(); t += 200; }  // 5 tok/s: a record
    expect(got.some(s => s.kind === 'record')).toBe(true);
  });

  it('a diagnostic running keeps it burning; surges are kept briefly and coloured by kind', () => {
    toolRunning(true); expect(targetHeat()).toBe(0.55);
    toolRunning(false); expect(targetHeat()).toBe(0);
    surge('gpu', 3); expect(recentSurges()[1]).toMatchObject({ kind: 'gpu', strength: 1 });
    t += 2000; expect(recentSurges()).toHaveLength(0);
    expect(surgeColor('gpu')).toBe('#cfe8ff'); expect(surgeColor('stop')).toBe('#F6465D'); expect(surgeColor('receipt')).toBe('#0ECB81');
  });

  it('heats fast and cools slowly', () => {
    const up = follow(0, 1, 350), down = follow(1, 0, 350);
    expect(up).toBeGreaterThan(0.6);
    expect(1 - down).toBeLessThan(0.2);
  });
  it('takes a recorded best as its reference without a surge, and a record must beat it', () => {
    const seen: Surge[] = [];
    onPulse(s => { if (s) seen.push(s); });
    seedBest(4);
    seedBest(NaN); seedBest(2);
    expect(bestRate()).toBe(4);
    setActivity('writing');
    for (let i = 0; i < 8; i++) { t += 333; token(); }  // ~3 tok/s: below the seed, no record
    expect(seen.filter(s => s.kind === 'record')).toHaveLength(0);
    expect(targetHeat()).toBeLessThan(0.95);
  });
});
