// SPDX-License-Identifier: MIT
// The presets module: .settings, .preset and .default, tailored to each .persona.
//   .settings   what this computer may take for a persona (BrowseSettings + the limits that shape a load), as a file
//   .preset     a named .settings: light, balanced, fast, long-answers built in; the visitor's own saved beside them
//   .default    which preset each persona starts with (browseML → balanced, mindX → long-answers), the visitor's to change
// Settings are kept per persona: switching away keeps the persona's own .settings; switching to one restores its own,
// or, the first time, applies its preset from .default. Every value goes through the settings' own validators.
import { useEffect, useState } from 'react';
import { Button } from 'dreamknob';
import type { ModuleInfo } from './index';
import type { ModuleWindowProps } from '../../core/modules';
import { browseSettings, onBrowseSettings, parseSettings, setBrowseSettings, type BrowseSettings } from '../../bankml/free';
import { getLimits, parseLimits, setLimits, type Limits } from '../limits';
import { BUILTINS } from '../Persona';

export interface SettingsFile { format: 'browseML .settings v1'; settings: Partial<BrowseSettings>; limits?: Partial<Pick<Limits, 'power' | 'gpuProbe' | 'spareCore' | 'lowMemory' | 'fire'>> }
export interface Preset extends SettingsFile { name: string; for: string; note: string }
export const PRESETS: Preset[] = [
  { format: 'browseML .settings v1', name: 'light', for: 'any', note: 'two threads, a short context, no GPU, the fire off: for a phone or a busy computer',
    settings: { threads: 2, ctx: 2048, maxTokens: 256, cacheRam: 0 }, limits: { gpuProbe: false, fire: false, power: 'low-power' } },
  { format: 'browseML .settings v1', name: 'balanced', for: 'any', note: 'as many threads as are free, answers of 256 tokens; the context this device suits',
    settings: { threads: null, maxTokens: 256 } },
  { format: 'browseML .settings v1', name: 'fast', for: 'any', note: 'every thread, a prompt cache of 64 MiB, the GPU where exact',
    settings: { threads: null, maxTokens: 256, cacheRam: 64 }, limits: { gpuProbe: true, power: 'high-performance', spareCore: false } },
  { format: 'browseML .settings v1', name: 'long-answers', for: 'any', note: 'answers up to 1024 tokens: for a persona that explains (the context stays what this device suits)',
    settings: { maxTokens: 1024 } },
];
export const BUILTIN_DEFAULT: Record<string, string> = { browseml: 'balanced', mindx: 'long-answers' };

const OWN = 'browseml:presets', DEF = 'browseml:preset-default', PER = (id: string) => `browseml:settings:${id}`;
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };

/** A .settings file read: every value checked by the settings' own validators; unknown keys dropped. */
export function parseSettingsFile(raw: unknown): SettingsFile {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { settings?: unknown; limits?: unknown };
  const given = (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Record<string, unknown>;
  const all = parseSettings(given) as unknown as Record<string, unknown>;
  const settings = Object.fromEntries(Object.keys(given).filter(k => k in all && JSON.stringify(all[k]) === JSON.stringify(given[k])).map(k => [k, all[k]])) as Partial<BrowseSettings>;
  const lg = (o.limits && typeof o.limits === 'object' ? o.limits : {}) as Record<string, unknown>;
  const lp = parseLimits(lg) as unknown as Record<string, unknown>;
  const limits = Object.fromEntries(['power', 'gpuProbe', 'spareCore', 'lowMemory', 'fire'].filter(k => k in lg && lp[k] === lg[k]).map(k => [k, lp[k]])) as SettingsFile['limits'];
  return { format: 'browseML .settings v1', settings, ...(limits && Object.keys(limits).length ? { limits } : {}) };
}
export const presets = (): Preset[] => [...PRESETS, ...read<Preset[]>(OWN, []).filter(p => p && typeof p.name === 'string')];
export const defaults = (): Record<string, string> => ({ ...BUILTIN_DEFAULT, ...read<Record<string, string>>(DEF, {}) });
export const presetFor = (persona: string): Preset | undefined => presets().find(p => p.name === defaults()[persona]);
/** What this computer may take now, as a .settings file. */
export const current = (): SettingsFile => {
  const l = getLimits();
  return { format: 'browseML .settings v1', settings: browseSettings(), limits: { power: l.power, gpuProbe: l.gpuProbe, spareCore: l.spareCore, lowMemory: l.lowMemory, fire: l.fire } };
};
export function applyFile(f: SettingsFile) {
  const p = parseSettingsFile(f);
  if (Object.keys(p.settings).length) setBrowseSettings(p.settings);
  if (p.limits) setLimits(p.limits);
}
/** A persona switch: keep the one left, restore the one arrived at (or, the first time, its preset). Settings the visitor
 *  made before this module knew any persona are adopted as the arrived persona's own. */
export function onPersonaSwitch(from: string | null, to: string) {
  // no persona on record yet, but settings already made here: they are this persona's own — adopted, never overwritten
  if (!from && (localStorage.getItem('browseml:settings') || localStorage.getItem('browseml:limits')) && !read(PER(to), null)) {
    write(PER(to), current());
    return;
  }
  if (from && from !== to) write(PER(from), current());
  const own = read<SettingsFile | null>(PER(to), null);
  if (own) applyFile(own);
  else { const p = presetFor(to); if (p) applyFile(p); }
}

function save(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function SettingsBody(_: ModuleWindowProps) {
  const [, tick] = useState(0);
  const [msg, setMsg] = useState('');
  useEffect(() => onBrowseSettings(() => tick(n => n + 1)), []);
  const cur = current(), def = defaults();
  const personas = [...BUILTINS.map(b => b.id), ...read<{ id: string }[]>('browseml:personas', []).map(p => p.id)];
  const importFile = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (typeof j.name === 'string') {  // a .preset: kept beside the built-ins
        const p: Preset = { ...parseSettingsFile(j), name: j.name.slice(0, 40), for: typeof j.for === 'string' ? j.for : 'any', note: typeof j.note === 'string' ? j.note.slice(0, 200) : '' };
        write(OWN, [...read<Preset[]>(OWN, []).filter(x => x.name !== p.name), p]); setMsg(`preset ${p.name} kept`);
      } else { applyFile(j); setMsg('.settings applied'); }
      tick(n => n + 1);
    } catch (e) { setMsg(`not a .settings or .preset file: ${String((e as Error).message || e)}`); }
  };
  return (
    <div className="ps">
      <dl>
        <div className="cp-row"><dt>.settings</dt><dd>threads {cur.settings.threads ?? 'auto'} · context {cur.settings.ctx} · answers {cur.settings.maxTokens} · cache {cur.settings.cacheRam} MiB · {cur.limits?.power}{cur.limits?.gpuProbe ? '' : ' · GPU off'}</dd></div>
      </dl>
      <ul className="ps-list">{presets().map(p => (
        <li key={p.name}><b>{p.name}</b> <span className="cp-fine">{p.note}</span>
          <button type="button" className="atl-act" onClick={() => { applyFile(p); setMsg(`${p.name} applied (threads, context and cache on the next load)`); }}>apply</button></li>
      ))}</ul>
      <div className="ps-def"><span className="cp-fine">.default — the preset each persona starts with:</span>
        {personas.map(id => (
          <label key={id} className="ps-row">{id}
            <select value={def[id] ?? ''} onChange={e => { write(DEF, { ...read<Record<string, string>>(DEF, {}), [id]: e.target.value }); tick(n => n + 1); }}>
              <option value="">(none: keep what is set)</option>
              {presets().map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select></label>
        ))}</div>
      <div className="cp-buttons">
        <Button onClick={() => save(JSON.stringify(cur, null, 1) + '\n', 'browseml.settings')}>EXPORT .settings</Button>
        <Button onClick={() => save(JSON.stringify({ ...cur, name: 'mine', for: 'any', note: '' }, null, 1) + '\n', 'mine.preset')}>EXPORT AS .preset</Button>
        <label className="atl-act">import<input type="file" accept=".settings,.preset,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      {msg && <p className="cp-said" role="status">{msg}</p>}
      <p className="cp-fine">Settings are kept per persona: switching keeps the one you leave and restores the one you come to — or, the first time, its preset.</p>
    </div>
  );
}

let wired = false;
export const presetsModule: ModuleInfo = {
  id: 'presets', label: 'presets', note: '.settings, .preset and .default: settings kept per persona, presets built in and your own',
  make() {
    if (!wired) {
      wired = true;
      addEventListener('browseml:persona', e => { const d = (e as CustomEvent<{ from: string | null; to: string }>).detail; onPersonaSwitch(d.from, d.to); });
    }
    return { id: 'presets', label: 'presets',
      windows: [{ id: 'settings', file: '.settings', icon: '⚙', summary: 'Settings per persona, presets and the default', Body: SettingsBody,
        detail: () => `${browseSettings().threads ?? 'auto'} threads · ${browseSettings().maxTokens} tok` }] };
  },
};
