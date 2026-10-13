// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { linkParts } from '../links';

describe('links in a model\'s text', () => {
  it('http(s) URLs and bare github.com / huggingface.co addresses become links; the full stop stays outside', () => {
    expect(linkParts('Source: github.com/browseML/browseML.')).toEqual([{ text: 'Source: ' }, { href: 'https://github.com/browseML/browseML', label: 'github.com/browseML/browseML' }, { text: '.' }]);
    expect(linkParts('see https://huggingface.co/spaces/PYTHAI/browseML, then')).toEqual([{ text: 'see ' }, { href: 'https://huggingface.co/spaces/PYTHAI/browseML', label: 'https://huggingface.co/spaces/PYTHAI/browseML' }, { text: ', then' }]);
  });
  it('nothing else is linked: other schemes and plain text stay text', () => {
    expect(linkParts('javascript:alert(1) and data:text/html,x')).toEqual([{ text: 'javascript:alert(1) and data:text/html,x' }]);
    expect(linkParts('no links here')).toEqual([{ text: 'no links here' }]);
  });
});
