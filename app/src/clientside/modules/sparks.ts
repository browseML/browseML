// SPDX-License-Identifier: MIT
// The sparks module: the ragebar's sparks on the field's buttons (sparks.ts). It listens to two events the page emits
// whether or not it is here — browseml:working (detail: boolean) and browseml:outcome (detail: { ok }) — so the core
// knows nothing of it.
import type { ModuleInfo } from './index';
import { ember, outcome, wireSparks } from '../sparks';

const send = () => document.querySelector('.uif-send');
let listening = false;
export const sparksModule: ModuleInfo = {
  id: 'sparks', label: 'sparks', note: 'subtle effects on the field\'s buttons: a burst on press, an ember while working, a ring when a receipt checks',
  make() {
    wireSparks();
    if (!listening) {
      listening = true;
      addEventListener('browseml:working', e => ember(send(), !!(e as CustomEvent<boolean>).detail));
      addEventListener('browseml:outcome', e => outcome(send(), !!(e as CustomEvent<{ ok: boolean }>).detail?.ok));
    }
    return { id: 'sparks', label: 'sparks' };
  },
};
