// SPDX-License-Identifier: MIT
// SAMPLING: Savante's controllers (the token.settings dials of the Savante Space), for browseML — answer length from 1
// (the single-token proof) to 2048, temperature, top-p, and under "more", top-k, min-p, repeat penalty and seed; then
// three advanced tools from llama-server's own chain, as bankML reproduces it (its `oracle_samplers`): DRY, XTC and
// dynamic temperature, each switched on and off as a whole. Unset is the engine's default (llama.cpp's, shown on the
// slider, dimmed); DEFAULTS clears them all. Applied to the next question; bankML puts them in the request its receipt
// hashes. Interaction: drag (the value rides above the thumb), arrow keys, double-click to go back to the default,
// click the value to type one; the line at the top lists what the next question sends, each removable.
import { useEffect, useRef, useState } from 'react';
import { Button } from 'dreamknob';
import { NO_SAMPLING, SAMPLING_RANGE, browseSettings, onBrowseSettings, setBrowseSettings, type Sampling } from '../bankml/free';

type Key = keyof Sampling | 'maxTokens';
interface Dial { key: Key; label: string; min: number; max: number; step: number; presets: [number, string][]; hint: string; fmt(v: number): string }

/** llama.cpp's defaults (common_params_sampling), which bankML's engine uses for a field the request leaves out. */
const ENGINE: Partial<Record<Key, number>> = {
  temperature: 0.8, top_p: 0.95, top_k: 40, min_p: 0.05, repeat_penalty: 1,
  dry_multiplier: 0, dry_base: 1.75, dry_allowed_length: 2, xtc_probability: 0, xtc_threshold: 0.1, dynatemp_range: 0, dynatemp_exponent: 1,
};
const f2 = (v: number) => v.toFixed(2);
const int = (v: number) => String(v);
function range(k: keyof Sampling) { const [min, max] = SAMPLING_RANGE[k]; return { min, max }; }

const DIALS: Dial[] = [
  { key: 'maxTokens', label: 'max tokens', min: 1, max: 2048, step: 1, presets: [[1, '1'], [16, '16'], [64, '64'], [256, '256'], [1024, '1024'], [2048, 'max']], fmt: int,
    hint: '1 is the single-token proof: one token counted by the engine is the model answering.' },
  { key: 'temperature', label: 'temperature', ...range('temperature'), step: 0.05, presets: [[0, '0 exact'], [0.3, '0.3'], [0.7, '0.7'], [1, '1.0']], fmt: f2,
    hint: '0 gives the same answer to the same question; higher is freer, and less reviewable.' },
  { key: 'top_p', label: 'top-p', ...range('top_p'), step: 0.05, presets: [[0.5, '0.5'], [0.9, '0.9'], [1, '1.0']], fmt: f2,
    hint: 'Keeps only the most likely words whose chances add up to this share.' },
];
const MORE: Dial[] = [
  { key: 'top_k', label: 'top-k', ...range('top_k'), step: 1, presets: [[1, '1 greedy'], [40, '40'], [0, '0 off']], fmt: int,
    hint: 'Only the k most likely next words are considered. 1 always takes the likeliest; 0 turns the limit off.' },
  { key: 'min_p', label: 'min-p', ...range('min_p'), step: 0.01, presets: [[0, '0 off'], [0.05, '0.05'], [0.1, '0.1']], fmt: f2,
    hint: 'Drops any word less likely than this share of the likeliest one.' },
  { key: 'repeat_penalty', label: 'repeat penalty', ...range('repeat_penalty'), step: 0.01, presets: [[1, '1.0 off'], [1.1, '1.1'], [1.3, '1.3']], fmt: f2,
    hint: 'Makes words already used less likely to repeat. 1.0 turns it off.' },
];

/** The advanced tools: each on when its first field is set above 0; ON sets `start`, OFF clears every field. */
interface Tool { id: string; name: string; short: string; what: string; start: Partial<Sampling>; dials: Dial[] }
const TOOLS: Tool[] = [
  { id: 'dry', name: 'DRY', short: 'DRY', what: "Don't Repeat Yourself: a word that would continue a sequence already written is penalised, more for each extra word repeated. Catches loops a repeat penalty misses, without punishing single words.",
    start: { dry_multiplier: 0.8 },
    dials: [
      { key: 'dry_multiplier', label: 'strength', ...range('dry_multiplier'), step: 0.05, presets: [[0.5, '0.5'], [0.8, '0.8'], [1.2, '1.2']], fmt: f2, hint: 'How hard a repeat is pushed down. 0 turns DRY off.' },
      { key: 'dry_base', label: 'growth', ...range('dry_base'), step: 0.05, presets: [[1.5, '1.5'], [1.75, '1.75'], [2, '2.0']], fmt: f2, hint: "How fast the penalty grows with the repeat's length." },
      { key: 'dry_allowed_length', label: 'allowed length', ...range('dry_allowed_length'), step: 1, presets: [[2, '2'], [3, '3'], [4, '4']], fmt: int, hint: 'Repeats up to this many words go free (names, fixed phrases).' },
    ] },
  { id: 'xtc', name: 'XTC', short: 'XTC', what: 'Exclude Top Choices: now and then, the most obvious words are set aside — every candidate above the threshold except the least likely of them — so the wording is less predictable while staying sensible.',
    start: { xtc_probability: 0.5, xtc_threshold: 0.1 },
    dials: [
      { key: 'xtc_probability', label: 'how often', ...range('xtc_probability'), step: 0.05, presets: [[0.25, '0.25'], [0.5, '0.5'], [1, 'always']], fmt: f2, hint: 'The chance, at each word, that the top choices are set aside. 0 turns XTC off.' },
      { key: 'xtc_threshold', label: 'threshold', ...range('xtc_threshold'), step: 0.01, presets: [[0.05, '0.05'], [0.1, '0.1'], [0.2, '0.2']], fmt: f2, hint: 'A word counts as a top choice above this chance. Lower sets more aside.' },
    ] },
  { id: 'dynatemp', name: 'DYNAMIC TEMPERATURE', short: 'dyn. temp', what: "Temperature that follows the model's certainty: lower where it is sure of the next word, higher where it is not, within temperature ± range.",
    start: { dynatemp_range: 0.5 },
    dials: [
      { key: 'dynatemp_range', label: 'range', ...range('dynatemp_range'), step: 0.05, presets: [[0.25, '±0.25'], [0.5, '±0.5'], [1, '±1.0']], fmt: f2, hint: 'How far the temperature may move either way. 0 turns it off.' },
      { key: 'dynatemp_exponent', label: 'curve', ...range('dynatemp_exponent'), step: 0.1, presets: [[0.5, '0.5'], [1, '1 linear'], [2, '2']], fmt: v => v.toFixed(1), hint: 'Above 1 stays cool until the model is quite unsure; below 1 warms sooner.' },
    ] },
];
const ALL: Dial[] = [...DIALS, ...MORE, ...TOOLS.flatMap(t => t.dials.map(d => ({ ...d, label: `${t.short} ${d.label}` })))];
const dialOf = (k: Key) => ALL.find(d => d.key === k);

export function SamplingDials() {
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => onBrowseSettings(() => tick(n => n + 1)), []);
  const s = browseSettings();
  const get = (k: Key): number | null => (k === 'maxTokens' ? s.maxTokens : s.sampling[k]);
  const set = (k: Key, v: number | null) => (k === 'maxTokens' ? setBrowseSettings({ maxTokens: v ?? 384 }) : setBrowseSettings({ sampling: { ...browseSettings().sampling, [k]: v } }));
  const setMany = (patch: Partial<Sampling>) => setBrowseSettings({ sampling: { ...browseSettings().sampling, ...patch } });
  const sent = (Object.keys(s.sampling) as (keyof Sampling)[]).filter(k => s.sampling[k] !== null);
  const copy = async () => {
    const request = Object.fromEntries([['max_tokens', s.maxTokens], ...sent.map(k => [k, s.sampling[k]])]);
    try { await navigator.clipboard.writeText(JSON.stringify(request, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard here */ }
  };
  return (
    <div className="cp-sampling">
      <div className="cp-sent" aria-live="polite">
        <span className="cp-sent-label">the next question sends</span>
        <span className="cp-chip is-fixed">max tokens {s.maxTokens}</span>
        {sent.map(k => {
          const d = dialOf(k), x = s.sampling[k] as number;
          return (
            <button key={k} type="button" className="cp-chip" title="Remove: back to the engine's default" onClick={() => set(k, null)}>
              {d?.label ?? k} {d ? d.fmt(x) : x} <span aria-hidden>✕</span>
            </button>
          );
        })}
        {sent.length === 0 && <span className="cp-sent-none">and the engine's defaults for the rest</span>}
      </div>
      {DIALS.map(d => <DialRow key={d.key} d={d} v={get(d.key)} set={set} />)}
      <details className="cp-more">
        <summary>more — top-k · min-p · repeat penalty · seed</summary>
        {MORE.map(d => <DialRow key={d.key} d={d} v={get(d.key)} set={set} />)}
        <div className={`cp-dial${s.sampling.seed !== null ? ' is-set' : ''}`}>
          <div className="cp-slider-head"><b>seed</b><span>{s.sampling.seed === null ? 'random' : s.sampling.seed}</span></div>
          <input type="number" min={0} max={2147483647} step={1} placeholder="random" value={s.sampling.seed ?? ''} aria-label="seed"
            onChange={e => set('seed', e.target.value === '' ? null : Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value)))))} />
          <p className="cp-fine">The same seed, settings and question give the same answer; at temperature 0 it is deterministic anyway.</p>
        </div>
      </details>
      <details className="cp-more cp-advanced">
        <summary>advanced — DRY · XTC · dynamic temperature{TOOLS.some(t => isOn(t, s.sampling)) ? ` (${TOOLS.filter(t => isOn(t, s.sampling)).map(t => t.short).join(', ')} on)` : ''}</summary>
        <p className="cp-fine">llama-server's own samplers, reproduced by bankML token for token (its sampler oracle), so the receipt still says exactly what ran.</p>
        {TOOLS.map(t => {
          const on = isOn(t, s.sampling);
          return (
            <div key={t.id} className={`cp-sampler${on ? ' is-on' : ''}`}>
              <div className="cp-sampler-head">
                <b>{t.name}</b>
                <button type="button" role="switch" aria-checked={on} aria-label={t.name} className="cp-switch"
                  onClick={() => setMany(on ? Object.fromEntries(t.dials.map(d => [d.key, null])) as Partial<Sampling> : t.start)}>
                  <span className="cp-switch-knob" aria-hidden />{on ? 'ON' : 'OFF'}
                </button>
              </div>
              <p className="cp-fine">{t.what}</p>
              {on && t.dials.map(d => <DialRow key={d.key} d={d} v={get(d.key)} set={set} />)}
            </div>
          );
        })}
      </details>
      <div className="cp-buttons">
        <Button onClick={() => setBrowseSettings({ sampling: NO_SAMPLING })}>DEFAULTS</Button>
        <Button onClick={copy}>{copied ? 'COPIED' : 'COPY AS JSON'}</Button>
      </div>
    </div>
  );
}

function isOn(t: Tool, s: Sampling) { return (s[t.dials[0].key as keyof Sampling] ?? 0) > 0; }

/** One dial: a semi-transparent slider whose fill shows the value, the value riding above the thumb while it moves,
 *  presets, double-click for the default, and the value itself editable. Unset, it rests (dimmed) on the engine's default. */
function DialRow({ d, v, set }: { d: Dial; v: number | null; set(k: Key, v: number | null): void }) {
  const [active, setActive] = useState(false);
  const [typing, setTyping] = useState(false);
  const typed = useRef<HTMLInputElement>(null);
  useEffect(() => { if (typing) typed.current?.select(); }, [typing]);
  const def = ENGINE[d.key];
  const shown = v ?? def ?? d.min;
  const pct = Math.max(0, Math.min(100, ((shown - d.min) / (d.max - d.min)) * 100));
  const clamp = (x: number) => { const c = Math.max(d.min, Math.min(d.max, x)); return d.step < 1 ? Number(c.toFixed(2)) : Math.round(c); };
  const resettable = d.key !== 'maxTokens';
  const reset = () => { if (resettable) set(d.key, null); };
  const commit = (text: string) => { setTyping(false); const x = Number(text); if (text.trim() !== '' && isFinite(x)) set(d.key, clamp(x)); };
  return (
    <div className={`cp-dial${v !== null && resettable ? ' is-set' : ''}${active ? ' is-active' : ''}`}>
      <div className="cp-slider-head">
        <b onDoubleClick={reset} title={resettable ? "Double-click: the engine's default" : undefined}>{d.label}</b>
        {typing
          ? <input ref={typed} className="cp-value-edit" type="number" defaultValue={shown} min={d.min} max={d.max} step={d.step} aria-label={`${d.label}: type a value`}
              onBlur={e => commit(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(e.currentTarget.value); else if (e.key === 'Escape') setTyping(false); }} />
          : <button type="button" className="cp-value" title="Click to type a value" onClick={() => setTyping(true)}>
              {v === null ? `default${def !== undefined ? ` ${d.fmt(def)}` : ''}` : d.fmt(v)}
            </button>}
      </div>
      <div className="cp-range" style={{ ['--fill' as string]: `${pct}%` }}>
        <input type="range" min={d.min} max={d.max} step={d.step} value={shown} aria-label={d.label} aria-valuetext={v === null ? 'default' : d.fmt(v)}
          onPointerDown={() => setActive(true)} onPointerUp={() => setActive(false)} onPointerCancel={() => setActive(false)}
          onFocus={() => setActive(true)} onBlur={() => setActive(false)} onDoubleClick={reset}
          onChange={e => set(d.key, clamp(Number(e.target.value)))} />
        <output className="cp-bubble" aria-hidden>{d.fmt(shown)}</output>
      </div>
      <div className="cp-presets">
        {d.presets.map(([x, l]) => <button key={l} type="button" className={v === x ? 'is-on' : ''} onClick={() => set(d.key, x)}>{l}</button>)}
        {resettable && <button type="button" className={v === null ? 'is-on' : ''} onClick={reset}>default</button>}
      </div>
      <p className="cp-fine">{d.hint}</p>
    </div>
  );
}
