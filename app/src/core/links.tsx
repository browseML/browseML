// SPDX-License-Identifier: MIT
// Links in a model's text, made actual: http(s) URLs, and bare addresses on a few well-known hosts (github.com/…,
// huggingface.co/…), become <a> that open in a new tab. Nothing else changes: the rest stays text (React escapes it),
// no other scheme is linked, and a trailing full stop or bracket is left outside the link.
import { Fragment, type ReactNode } from 'react';

const URL_RE = /\b(?:https?:\/\/[^\s<>"'`]+|(?:github\.com|huggingface\.co|[a-z0-9-]+\.pythai\.net)\/[^\s<>"'`]*)/gi;

/** Split `text` into text and links (pure, so tested). */
export function linkParts(text: string): ({ text: string } | { href: string; label: string })[] {
  const out: ({ text: string } | { href: string; label: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let label = m[0];
    while (/[.,;:!?)\]]$/.test(label) && !(label.endsWith(')') && label.includes('('))) label = label.slice(0, -1);
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const href = /^https?:\/\//i.test(label) ? label : `https://${label}`;
    try { const u = new URL(href); if (u.protocol === 'https:' || u.protocol === 'http:') out.push({ href: u.href, label }); else out.push({ text: label }); }
    catch { out.push({ text: label }); }
    last = at + label.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function Linked({ text }: { text: string }): ReactNode {
  return linkParts(text).map((p, i) => ('href' in p
    ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.label}</a>
    : <Fragment key={i}>{p.text}</Fragment>));
}
