import type { OutputField, Rect } from '../types';

export type BusMessage =
  | { type: 'hub:hello' }
  | { type: 'out:hello'; id: string }
  | { type: 'out:bye'; id: string }
  | { type: 'out:state'; id: string; field: OutputField; active: boolean }
  | { type: 'out:home'; id: string }
  | { type: 'out:ping'; id: string }
  | { type: 'out:geom'; id: string; geom: Rect }
  | { type: 'out:request-home'; id: string }
  | { type: 'out:request-close'; id: string }
  | { type: 'out:request-rename'; id: string; title: string }
  | { type: 'out:input'; id: string; text: string }
  | { type: 'out:remember'; id: string; text: string };

export interface Bus {
  post(msg: BusMessage): void;
  on(listener: (msg: BusMessage) => void): () => void;
  close(): void;
}

/** A BroadcastChannel shared by the hub page and its pop-out windows. */
export function createBus(name: string): Bus {
  const listeners = new Set<(msg: BusMessage) => void>();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`uif:${name}`) : null;
  if (channel) channel.onmessage = e => listeners.forEach(l => l(e.data as BusMessage));
  return {
    post: msg => channel?.postMessage(msg),
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => channel?.close(),
  };
}

export const OUTPUT_PARAM = 'uif-output';
export const KEY_PARAM = 'uif-key';

export function isOutputWindow(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(OUTPUT_PARAM);
}
