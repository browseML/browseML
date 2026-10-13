// SPDX-License-Identifier: MIT
// Settings for the response windows, shared by every window and kept in this browser: the text size, where a new
// question's answer goes (the active window or a new one each time), and whether new windows open filling the screen.
import { loadJSON, saveJSON } from './storage';

export interface ResponseSettings {
  textSize: 's' | 'm' | 'l' | 'xl';
  /** 'active': into the active window (or a new one when there is none); 'new': a new window per question. */
  answerIn: 'active' | 'new';
  /** New windows open filling the screen. */
  openMaximized: boolean;
  /** Show how each answer was delivered (tokens, speed, carrier, receipt) under it. Off: the details are still kept,
   *  in .memory as a delivery record, and in the T-mode log (`last`). */
  details: boolean;
}

const KEY = 'uif:responses:settings';
const DEFAULTS: ResponseSettings = { textSize: 'm', answerIn: 'active', openMaximized: false, details: false };
export const TEXT_SIZES: Record<ResponseSettings['textSize'], string> = { s: '12.5px', m: '14px', l: '16px', xl: '19px' };

let current: ResponseSettings = { ...DEFAULTS, ...loadJSON<Partial<ResponseSettings>>(KEY, {}) };
const subscribers = new Set<(s: ResponseSettings) => void>();

function apply(s: ResponseSettings) {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--uif-output-font', TEXT_SIZES[s.textSize]);
}
apply(current);

export const responseSettings = {
  get: () => current,
  set(change: Partial<ResponseSettings>) {
    current = { ...current, ...change };
    saveJSON(KEY, current);
    apply(current);
    subscribers.forEach(f => f(current));
  },
  subscribe(f: (s: ResponseSettings) => void) {
    subscribers.add(f);
    return () => void subscribers.delete(f);
  },
};
