// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseHost } from '../host';
import { enginesLine, withPassages } from '../Atlas';

describe('the host file', () => {
  const atlas = { label: 'mindX docs', api: '/atlas/docs', search: '/atlas/docs/search', doc: '/doc/', token: 'mindx_realm_token', signin: '/activity' };
  it('no file, or not an object: nothing changes', () => {
    expect(parseHost(undefined)).toEqual({});
    expect(parseHost('mindx')).toEqual({});
  });
  it('a persona and an atlas on same-origin paths are kept', () => {
    expect(parseHost({ persona: 'mindx', atlas })).toEqual({ persona: 'mindx', atlas });
  });
  it('an atlas pointing anywhere else is dropped, so the token can never leave the origin', () => {
    expect(parseHost({ atlas: { ...atlas, search: 'https://evil.example/s' } }).atlas).toBeUndefined();
    expect(parseHost({ atlas: { ...atlas, api: '//evil.example/a' } }).atlas).toBeUndefined();
    expect(parseHost({ atlas: { ...atlas, token: '' } }).atlas).toBeUndefined();
    expect(parseHost({ atlas: { ...atlas, signin: 'https://x' } }).atlas?.signin).toBeUndefined();
  });
  it('a persona id that is not a plain name is ignored', () => {
    expect(parseHost({ persona: '../x' }).persona).toBeUndefined();
  });
});

describe('pinned passages with a question', () => {
  it('none: the question as typed', () => {
    expect(withPassages('what is RAGE?', [])).toBe('what is RAGE?');
  });
  it('the passages first, named by document, then the question', () => {
    const s = withPassages('what is RAGE?', [{ doc: 'rage/RAGE', t: 'RAGE', text: 'RAGE is  retrieval\nfirst.' }]);
    expect(s).toBe('Passages from the documentation (context, not evidence; name the document you use):\n[rage/RAGE] RAGE is retrieval first.\n\nQuestion: what is RAGE?');
  });
  it('cut to fit: never more than about 1,500 characters of passages', () => {
    const long = { doc: 'A', t: 'A', text: 'x'.repeat(5000) };
    const s = withPassages('q', [long, { doc: 'B', t: 'B', text: 'y'.repeat(5000) }]);
    expect(s.length).toBeLessThan(1700);
    expect(s).toContain('…');
    expect(s.endsWith('Question: q')).toBe(true);
  });
});

describe('what answered a search', () => {
  it('words and meaning, with the model', () => {
    expect(enginesLine({ words_ms: 380, meaning_ms: 12400, model: 'mxbai-embed-large' })).toBe('words 380 ms · meaning 12.4 s (mxbai-embed-large)');
  });
  it('words only, and why', () => {
    expect(enginesLine({ words_ms: 401, meaning: 'timed out after 20 s (the embedder is busy); words only' }))
      .toBe('words 401 ms · meaning: timed out after 20 s (the embedder is busy); words only');
  });
  it('memories when asked; nothing when nothing is said', () => {
    expect(enginesLine({ words_ms: 1, memories_ms: 470 })).toBe('words 1 ms · memories 470 ms');
    expect(enginesLine(undefined)).toBe('');
  });
});
