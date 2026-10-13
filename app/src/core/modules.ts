import type { ComponentType, ReactNode } from 'react';
import type { Action } from './actions';
import type { UIFContextValue } from '../components/UIFContext';

/** How a window shows in the ▤ menu and its title bar. */
export interface WindowInfo {
  /** Unique id: the window's command (`thot`, `thot open`, `thot close`) and its key in saved layouts. */
  id: string;
  /** The menu and title label, e.g. ".persona" or "THOT". */
  file: string;
  icon: string;
  summary: string;
}

export interface ModuleWindowProps {
  uif: UIFContextValue;
  close(): void;
  /** Renders its children into the window's title bar (import/export buttons and the like). */
  Tools: ComponentType<{ children?: ReactNode }>;
}

/** A window a module adds. Its body owns its state; the frame (move, resize, stacking, keyboard) is the field's. */
export interface ModuleWindow extends WindowInfo {
  Body: ComponentType<ModuleWindowProps>;
  /** Short state for the ▤ menu's right column, e.g. "3 notes". */
  detail?(uif: UIFContextValue): string;
}

/**
 * A module extends the field: windows (in the ▤ menu, each also a command and a button you can place) and actions.
 * The five context windows are the built-in "context" module; add more with `<UltimateBar modules={[…]}>`.
 */
export interface UIFModule {
  id: string;
  label: string;
  windows?: ModuleWindow[];
  actions?: Action[];
}

export const WINDOW_ID = /^[a-z][\w.-]{0,40}$/;

/** One toggle action per window, so each can go on the bar, float, or be typed. */
export function windowAction(w: WindowInfo): Action {
  return {
    id: `win-${w.id}`,
    label: w.file,
    command: w.id,
    aliases: w.file.startsWith('.') ? [w.file] : [],
    icon: w.icon,
    description: `${w.id} [open|close] - the ${w.file} window: ${w.summary.toLowerCase()}`,
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const arg = ctx.args[0];
      if (arg === 'open') ctx.windows.show(w.id);
      else if (arg === 'close') ctx.windows.hide(w.id);
      else ctx.windows.toggle(w.id);
    },
  };
}

/** Every window of these modules, checked: ids must be valid and unique. */
export function collectWindows(modules: UIFModule[]): ModuleWindow[] {
  const seen = new Set<string>();
  const out: ModuleWindow[] = [];
  for (const m of modules) {
    for (const w of m.windows ?? []) {
      if (!WINDOW_ID.test(w.id)) throw new Error(`module ${m.id}: window id "${w.id}" is not valid (a-z, digits, _ . -)`);
      if (seen.has(w.id)) throw new Error(`module ${m.id}: window id "${w.id}" is already taken`);
      seen.add(w.id);
      out.push(w);
    }
  }
  return out;
}
