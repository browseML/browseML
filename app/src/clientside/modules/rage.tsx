// SPDX-License-Identifier: MIT
// The rage module: ✵ rage, the top choice of the field's ▤ menu, opens the rage atlas (Atlas.tsx) in a window of the
// field. Its source is the host's atlas when the host serves one (mindx.pythai.net: mindX's docs, signed-in
// participants), else this browser's own: .memory, .history and the control panel's sections — so it is never empty.
import { useMemo } from 'react';
import type { ModuleInfo } from './index';
import type { ModuleWindowProps } from '../../core/modules';
import { AtlasPanel, passagesBlock } from '../Atlas';
import { addAugmenter } from '../augment';
import { host } from '../host';
import { hostSource, localSource, type LocalInput } from '../atlasSource';

function RageBody({ uif, close }: ModuleWindowProps) {
  const h = host().atlas;
  const src = useMemo(() => (h ? hostSource(h) : localSource((): LocalInput => ({
    memory: (uif.context.memory ?? []).map(m => ({ text: m.text, at: m.at, source: m.source as { kind?: string } })),
    history: (uif.context.history ?? []) as LocalInput['history'],
    sections: [...document.querySelectorAll('.cp-fold-head')].map(e => (e.textContent || '').replace(/[▾▸]/g, '').trim()).filter(Boolean),
  }))), [h]);  // eslint-disable-line react-hooks/exhaustive-deps
  return <AtlasPanel src={src} close={close} />;
}

export const rageModule: ModuleInfo = {
  id: 'rage', label: 'rage', note: 'the rage atlas, first in the ▤ menu: travel a host\'s docs, or this browser\'s own .memory and .history',
  make: () => (addAugmenter(() => passagesBlock()), {
    id: 'rage', label: 'RAGE', first: true,
    windows: [{ id: 'rage', file: '✵ rage', icon: '✵', summary: 'Travel the atlas: trail, collected, kindred, its thread, converge',
      detail: () => (host().atlas ? host().atlas!.label : 'this browser'), Body: RageBody }],
  }),
};
