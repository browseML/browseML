// SPDX-License-Identifier: MIT
// The client tools: this computer's controls (the DreamKnob rack) and the diagnostics from what actually ran, with
// the line that says what the last control did. One component, shown in two places: the field's 🛠 tray and the top
// of the sidebar (it opens with them). Both read and set the same stores (browseML's settings, the usage records), so
// a knob turned in one is turned in the other.
import { useState } from 'react';
import { ClientRack, useUsage } from './ClientRack';
import { UsagePanel } from './UsagePanel';

export function ClientTools({ compact = false }: { compact?: boolean }) {
  const usage = useUsage();
  const [said, setSaid] = useState<{ text: string; tone?: 'ok' | 'bad' | 'working' } | null>(null);
  return (
    <div className={`cs-tools ${compact ? 'is-compact' : ''}`}>
      <ClientRack onSaid={(text, tone) => setSaid({ text, tone })} />
      {said && <p className={`cs-said ${said.tone ? `is-${said.tone}` : ''}`} role="status">{said.text}</p>}
      <UsagePanel usage={usage} />
    </div>
  );
}
