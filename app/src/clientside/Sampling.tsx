// SPDX-License-Identifier: MIT
// SAMPLING: Savante's controllers (the token.settings dials of the Savante Space), for browseML — answer length from 1
// (the single-token proof) to 2048, temperature, top-p, and under "more", top-k, min-p, repeat penalty and seed. Each
// with presets and one line on what it does. Unset is the engine's default (shown as "default"); DEFAULTS clears them
// all. Applied to the next question; bankML puts them in the request its receipt hashes.
import { useEffect, useState } from 'react';
import { Button } from 'dreamknob';
import { NO_SAMPLING, SAMPLING_RANGE, browseSettings, onBrowseSettings, setBrowseSettings, type Sampling } from '../bankml/free';

type Key = keyof Sampling | 'maxTokens';
interface Dial { key: Key; label: string; min: number; max: number; step: number; presets: [number, string][]; hint: string; fmt(v: number): string }
const DIALS: Dial[] = [
  { key: 'maxTokens', label: 'max tokens', min: 1, max: 2048, step: 1, presets: [[1, '1'], [16, '16'], [64, '64'], [256, '256'], [1024, '1024'], [2048, 'max']], fmt: v => String(v),
    hint: '1 is the single-token proof: one token counted by the engine is the model answering.' },
  { key: 'temperature', label: 'temperature', ...range('temperature'), step: 0.05, presets: [[0, '0 exact'], [0.3, '0.3'], [0.7, '0.7'], [1, '1.0']], fmt: v => v.toFixed(2),
    hint: '0 gives the same answer to the same question; higher is freer, and less reviewable.' },
  { key: 'top_p', label: 'top-p', ...range('top_p'), step: 0.05, presets: [[0.5, '0.5'], [0.9, '0.9'], [1, '1.0']], fmt: v => v.toFixed(2),
    hint: 'Keeps only the most likely words whose chances add up to this share.' },
];
const MORE: Dial[] = [
  { key: 'top_k', label: 'top-k', ...range('top_k'), step: 1, presets: [[1, '1 greedy'], [40, '40'], [0, '0 off']], fmt: v => String(v),
    hint: 'Only the k most likely next words are considered. 1 always takes the likeliest; 0 turns the limit off.' },
  { key: 'min_p', label: 'min-p', ...range('min_p'), step: 0.01, presets: [[0, '0 off'], [0.05, '0.05'], [0.1, '0.1']], fmt: v => v.toFixed(2),
    hint: 'Drops any word less likely than this share of the likeliest one.' },
  { key: 'repeat_penalty', label: 'repeat penalty', ...range('repeat_penalty'), step: 0.01, presets: [[1, '1.0 off'], [1.1, '1.1'], [1.3, '1.3']], fmt: v => v.toFixed(2),
    hint: 'Makes words already used less likely to repeat. 1.0 turns it off.' },
];
function range(k: keyof Sampling) { const [min, max] = SAMPLING_RANGE[k]; return { min, max }; }

export function SamplingDials() {
  const [, tick] = useState(0);
  useEffect(() => onBrowseSettings(() => tick(n => n + 1)), []);
  const s = browseSettings();
  const get = (k: Key): number | null => (k === 'maxTokens' ? s.maxTokens : s.sampling[k]);
  const set = (k: Key, v: number | null) => (k === 'maxTokens' ? setBrowseSettings({ maxTokens: v ?? 384 }) : setBrowseSettings({ sampling: { ...s.sampling, [k]: v } }));
  const dial = (d: Dial) => {
    const v = get(d.key);
    return (
      <div key={d.key} className="cp-dial">
        <div className="cp-slider-head"><b>{d.label}</b><span>{v === null ? 'default' : d.fmt(v)}</span></div>
        <input type="range" min={d.min} max={d.max} step={d.step} value={v ?? d.min} aria-label={d.label}
          onChange={e => set(d.key, d.step < 1 ? Number(Number(e.target.value).toFixed(2)) : Math.round(Number(e.target.value)))} />
        <div className="cp-presets">
          {d.presets.map(([x, l]) => <button key={l} type="button" className={v === x ? 'is-on' : ''} onClick={() => set(d.key, x)}>{l}</button>)}
          {d.key !== 'maxTokens' && <button type="button" className={v === null ? 'is-on' : ''} onClick={() => set(d.key, null)}>default</button>}
        </div>
        <p className="cp-fine">{d.hint}</p>
      </div>
    );
  };
  const seed = s.sampling.seed;
  return (
    <div className="cp-sampling">
      {DIALS.map(dial)}
      <details className="cp-more">
        <summary>more — top-k · min-p · repeat penalty · seed</summary>
        {MORE.map(dial)}
        <div className="cp-dial">
          <div className="cp-slider-head"><b>seed</b><span>{seed === null ? 'random' : seed}</span></div>
          <input type="number" min={0} max={2147483647} step={1} placeholder="random" value={seed ?? ''} aria-label="seed"
            onChange={e => set('seed', e.target.value === '' ? null : Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value)))))} />
          <p className="cp-fine">The same seed, settings and question give the same answer; at temperature 0 it is deterministic anyway.</p>
        </div>
      </details>
      <div className="cp-buttons">
        <Button onClick={() => setBrowseSettings({ sampling: NO_SAMPLING })}>DEFAULTS</Button>
      </div>
    </div>
  );
}
