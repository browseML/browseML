// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { browseVerdicts, ctxCapFor, mb, ramEstimate, readCaps, type Caps } from '../caps';


const caps = (c: Partial<Caps> = {}): Caps => ({ wasm: true, simd: true, relaxedSimd: true, isolated: true, cores: 8, memoryGB: 8, speech: null, storage: true, persist: true, ...c });

describe('browseML here, said plainly', () => {
  it('no SIMD: unavailable', () => {
    const v = browseVerdicts(caps({ simd: false }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ level: 'bad' });
    expect(v[0].text).toMatch(/WebAssembly SIMD/);
    expect(v[0].text).not.toMatch(/free CPU|Hugging Face/);
  });
  it('threads only when isolated', () => {
    expect(browseVerdicts(caps({ isolated: false }))[0].text).toMatch(/^threads: one/);
    expect(browseVerdicts(caps())[0].text).toMatch(/^threads: yes/);
  });
  it('storage and memory', () => {
    expect(browseVerdicts(caps(), { available: 100e6 }).some(x => x.level === 'bad' && /storage/.test(x.text))).toBe(true);
    expect(browseVerdicts(caps(), { available: 10e9 }).some(x => x.level === 'bad')).toBe(false);
    expect(browseVerdicts(caps({ memoryGB: 1 }), { phone: true }).some(x => x.level === 'warn' && /phone reports 1 GB/.test(x.text))).toBe(true);
  });
  it('one memory rule for the card, the controls and the default context', () => {
    expect(ctxCapFor(null)).toBeNull();
    expect(ctxCapFor(8)).toBeNull();
    expect(ctxCapFor(4)).toBe(2048);
    expect(ctxCapFor(2)).toBe(1024);
    // a 4 GB device at context 4096: the consent card warns as the controls do; at 2048 neither does
    expect(browseVerdicts(caps({ memoryGB: 4 }), { ctx: 4096 }).some(x => x.level === 'warn' && /keep the context at 2048/.test(x.text))).toBe(true);
    expect(browseVerdicts(caps({ memoryGB: 4 }), { ctx: 2048 }).some(x => /^memory/.test(x.text))).toBe(false);
  });
  it('sizes a small file in KB, not "0.0 MB"', () => {
    expect(mb(6_800)).toBe('6.8 KB');
    expect(mb(3_000_000)).toBe('3.0 MB');
    expect(mb(248_302_272)).toBe('248 MB');
  });
  it('estimates memory as weights + KV + scratch', () => {
    expect(ramEstimate(4096)).toBe(248_302_272 + 4096 * 114_688 + 96e6);
  });
  it('validates the SIMD probes here (Node has SIMD)', () => {
    const c = readCaps();
    expect(c.wasm).toBe(true);
    expect(c.simd).toBe(true);
  });
});
