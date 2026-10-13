// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseFill } from '../Builder';

describe("the .persona builder reads browseML's three lines", () => {
  it('NAME, OPENING, and PROMPT to the end (several lines kept)', () => {
    expect(parseFill('NAME: Ada\nOPENING: Hello, I check units.\nPROMPT: You are Ada, a chemistry tutor.\nAnswer in two sentences.'))
      .toEqual({ name: 'Ada', opening: 'Hello, I check units.', system_prompt: 'You are Ada, a chemistry tutor.\nAnswer in two sentences.' });
  });
  it('bold markers and quotes are tolerated; a missing PROMPT leaves it empty', () => {
    expect(parseFill('**NAME:** "Ada"\n**OPENING:** Hi.\n**PROMPT:** You are Ada.')).toEqual({ name: 'Ada', opening: 'Hi.', system_prompt: 'You are Ada.' });
    expect(parseFill('I cannot do that.').system_prompt).toBeUndefined();
  });
});
