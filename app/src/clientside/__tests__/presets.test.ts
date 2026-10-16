// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

describe('.settings, .preset, .default', async () => {
  const P = await import('../modules/presets');
  const F = await import('../../bankml/free');
  it('a .settings file keeps only valid values', () => {
    expect(P.parseSettingsFile({ settings: { threads: 4, ctx: 3000, maxTokens: 512, bogus: 1 }, limits: { power: 'low-power', fire: 'yes' } }))
      .toEqual({ format: 'browseML .settings v1', settings: { threads: 4, maxTokens: 512 }, limits: { power: 'low-power' } });
  });
  it('built-in presets are valid, and each persona has its default', () => {
    for (const p of P.PRESETS) expect(P.parseSettingsFile(p).settings).toEqual(p.settings);
    expect(P.presetFor('mindx')?.name).toBe('long-answers');
    expect(P.presetFor('browseml')?.name).toBe('balanced');
  });
  it('settings made before any persona was on record are adopted, not overwritten', () => {
    F.setBrowseSettings({ maxTokens: 512 });
    P.onPersonaSwitch(null, 'browseml');
    expect(F.browseSettings().maxTokens).toBe(512);
  });
  it('settings are kept per persona: leave, come back, restored', () => {
    F.setBrowseSettings({ maxTokens: 384 });
    P.onPersonaSwitch('browseml', 'mindx');           // first time: mindX's preset
    expect(F.browseSettings().maxTokens).toBe(1024);
    F.setBrowseSettings({ maxTokens: 2048 });         // the visitor's own change, for mindX
    P.onPersonaSwitch('mindx', 'browseml');           // back: browseML's own kept settings
    expect(F.browseSettings().maxTokens).toBe(384);
    P.onPersonaSwitch('browseml', 'mindx');           // and mindX's own, not its preset again
    expect(F.browseSettings().maxTokens).toBe(2048);
  });
});
