// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { browseVerdicts, ctxCapFor, installPlan, mb, ramEstimate, readCaps, recognise, serveLines, SPACE_ORIGINS, type Caps } from '../caps';

const UA = {
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  linuxArm: 'Mozilla/5.0 (X11; Linux aarch64; rv:131.0) Gecko/20100101 Firefox/131.0',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  androidTab: 'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  cros: 'Mozilla/5.0 (X11; CrOS x86_64 16002.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
};

describe('this device, from what the browser says (nothing sent)', () => {
  it('recognises the usual machines', () => {
    expect(recognise({ userAgent: UA.linux, platform: 'Linux x86_64' })).toBe('linux-x64');
    expect(recognise({ uaPlatform: 'Linux', architecture: 'x86', userAgent: UA.linux })).toBe('linux-x64');
    expect(recognise({ uaPlatform: 'Linux', architecture: 'arm', userAgent: UA.linux })).toBe('linux-arm');
    expect(recognise({ userAgent: UA.linuxArm, platform: 'Linux aarch64' })).toBe('linux-arm');
    expect(recognise({ uaPlatform: 'Windows', userAgent: UA.win, platform: 'Win32' })).toBe('windows');
    expect(recognise({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('mac');
    expect(recognise({ userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('tablet');  // iPadOS
    expect(recognise({ userAgent: UA.iphone, platform: 'iPhone' })).toBe('phone');
    expect(recognise({ uaPlatform: 'Android', mobile: true, userAgent: UA.androidPhone })).toBe('phone');
    expect(recognise({ uaPlatform: 'Android', mobile: false, userAgent: UA.androidTab })).toBe('tablet');
    expect(recognise({ userAgent: UA.androidTab })).toBe('tablet');
    expect(recognise({ uaPlatform: 'Chrome OS', userAgent: UA.cros })).toBe('chromeos');
    expect(recognise({})).toBe('unknown');
  });
  it('gives the install steps for each', () => {
    const o = 'https://mindx.pythai.net';
    const linux = installPlan('linux-x64', o);
    expect(linux.verdict).toBe('fast');
    expect(linux.commands[0]).toBe('git clone https://github.com/cryptoAGI/bankml && cd bankml && ./install.sh');
    expect(linux.commands.join('\n')).toContain(`--native --listen 127.0.0.1:18093 --allow-origin ${o}`);
    expect(installPlan('windows', o).commands[0]).toMatch(/^wsl --install/);
    expect(installPlan('mac', o).lede).toMatch(/NEON is on the 0\.5\.0 road/);
    expect(installPlan('linux-arm', o).suggest).toContain('browse');
    // install.sh stops off Linux x86-64 (it needs `ss`, and its llama.cpp is x86-64): build and serve natively there
    for (const p of ['mac', 'linux-arm'] as const) {
      const c = installPlan(p, o).commands.join('\n');
      expect(c).not.toMatch(/install\.sh/);
      expect(c).toMatch(/cargo build --release/);
      expect(c).toMatch(/--native .*--allow-origin https:\/\/mindx\.pythai\.net/);
    }
    expect(installPlan('phone', o)).toMatchObject({ verdict: 'no', commands: [] });
    expect(serveLines(SPACE_ORIGINS[0])[0]).toMatch(/install\.sh start --space/);
  });
});

const caps = (c: Partial<Caps> = {}): Caps => ({ wasm: true, simd: true, relaxedSimd: true, isolated: true, cores: 8, memoryGB: 8, speech: null, storage: true, persist: true, ...c });
describe('browseML here, said plainly', () => {
  it('no SIMD: unavailable, the free CPU offered', () => {
    const v = browseVerdicts(caps({ simd: false }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ level: 'bad' });
    expect(v[0].text).toMatch(/free CPU/);
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
