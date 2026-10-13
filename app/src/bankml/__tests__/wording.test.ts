// SPDX-License-Identifier: MIT
// @ts-nocheck — reads the sources with Node's fs, which the app has no types for.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('nothing says the free Space is coming', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === '__tests__' ? [] : walk(p)) : [p]; });
  it('no "coming", "soon" or "not live yet" in the sources', () => {
    const root = join(__dirname, '..', '..');
    const hits = [...walk(root), join(root, '..', 'README.md'), join(root, '..', 'app.html')]
      .filter(f => /\.(tsx?|css|html|md)$/.test(f))
      .flatMap(f => readFileSync(f, 'utf8').split('\n').map((l, i) => ({ f, i, l })))
      .filter(x => /\b(coming|soon)\b|not live yet/i.test(x.l) && !/as soon as/i.test(x.l));
    expect(hits.map(h => `${h.f}:${h.i + 1}: ${h.l.trim()}`)).toEqual([]);
  });
});

