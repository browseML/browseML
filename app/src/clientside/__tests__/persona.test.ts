// SPDX-License-Identifier: MIT
// @ts-nocheck — reads the persona file with Node's fs, which the app has no types for.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromFile } from '../Persona';

describe('a .persona file', () => {
  it("browseML's own: its name, its opening message, its prompt with the real links", () => {
    // @ts-ignore — Node's fs, for the file as served
    const p = fromFile(readFileSync(join(__dirname, '../../../../web/browseml.persona'), 'utf8'), 'browseml');
    expect(p.name).toBe('browseML');
    expect(p.opening).toMatch(/^browseML knows best/);
    expect(p.system_prompt).toMatch(/https:\/\/github\.com\/browseML\/browseML/);
  });
  it('any bankML .persona with a system_prompt reads; without an opening message, none', () => {
    expect(fromFile(JSON.stringify({ persona: 'savante', system_prompt: 'You are Savante.' }), 'x')).toEqual({ id: 'x', name: 'savante', opening: '', system_prompt: 'You are Savante.' });
    expect(() => fromFile(JSON.stringify({ name: 'empty' }))).toThrow(/no system_prompt/);
    expect(() => fromFile('not json')).toThrow(/not JSON/);
  });
});
