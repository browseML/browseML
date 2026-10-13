import type { DockEdge, Rect, UIFMode } from '../types';
import { WINDOW_ID } from './modules';
import type { ActionsLayout, CustomActionDef, Point } from './actions';

/** Where the input field sits and how it is set up. */
export type HubArrangement = 'auto' | 'stacked' | 'sideways';

/** The button row taken out of the field as its own floating bar. */
export interface IsolatedBar {
  x: number;
  y: number;
  vertical: boolean;
}

export interface HubLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: UIFMode;
  docked: DockEdge | null;
  /** Input above buttons, side by side, or chosen by height (auto). Optional: older files have none. */
  arrange?: HubArrangement;
  /** Where the isolated button row floats, or null when it is part of the field. */
  isolated?: IsolatedBar | null;
}

/**
 * A saved layout: the `.profile` file. It covers the bar (button order,
 * floating buttons, custom buttons), the input field and the strings toggle.
 * Output panels and their messages are content, not layout, and are left out.
 */
export interface UIFProfile {
  'uif.profile': 1;
  name: string;
  savedAt: string;
  actions: ActionsLayout;
  hub: HubLayout;
  strings: boolean;
  /** Open context windows and where they are. Optional: older files have none. */
  windows?: Partial<Record<string, Rect>>;
  /** What the host page adds to its layout (registerProfilePart), by name: kept as found here, checked by the host
   *  when applied. Optional: older files and other pages have none. */
  parts?: Record<string, unknown>;
}

export const STANDARD_PROFILE = 'standard';
export const PROFILE_EXTENSION = '.profile';

const MODES: UIFMode[] = ['chat', 'terminal', 'persona'];
const EDGES: DockEdge[] = ['top', 'bottom', 'left', 'right'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readCustom(v: unknown): CustomActionDef | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.label) || !isStr(v.payload)) return null;
  if (v.kind !== 'command' && v.kind !== 'send') return null;
  return {
    id: v.id,
    label: v.label,
    payload: v.payload,
    kind: v.kind,
    command: isStr(v.command) ? v.command : undefined,
    icon: isStr(v.icon) ? v.icon : undefined,
  };
}

/** Check and normalise untrusted profile data (an imported file). Throws with a reason. */
export function parseProfile(data: unknown, fallbackName = 'imported'): UIFProfile {
  const fail = (why: string): never => {
    throw new Error(`not a valid ${PROFILE_EXTENSION} file: ${why}`);
  };
  if (!isObj(data)) return fail('expected a JSON object');
  if (data['uif.profile'] !== 1) return fail('missing "uif.profile": 1');

  const a = isObj(data.actions) ? data.actions : fail('missing "actions"');
  if (!isStrArray(a.order) || !isStrArray(a.hidden)) return fail('"actions.order" and "actions.hidden" must be string lists');
  const custom = Array.isArray(a.custom) ? a.custom.map(readCustom) : [];
  if (custom.some(c => c === null)) return fail('a custom action is malformed');
  const floating: Record<string, Point> = {};
  if (isObj(a.floating)) {
    for (const [id, p] of Object.entries(a.floating)) {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) return fail(`floating position for "${id}" is malformed`);
      floating[id] = { x: p.x, y: p.y };
    }
  }

  const h = isObj(data.hub) ? data.hub : fail('missing "hub"');
  if (![h.x, h.y, h.width, h.height].every(isNum)) return fail('"hub" needs numeric x, y, width, height');
  const mode = MODES.includes(h.mode as UIFMode) ? (h.mode as UIFMode) : 'chat';
  const docked = EDGES.includes(h.docked as DockEdge) ? (h.docked as DockEdge) : null;
  const arrange = (['auto', 'stacked', 'sideways'] as const).find(a => a === h.arrange) ?? 'auto';
  let isolated: IsolatedBar | null = null;
  if (isObj(h.isolated)) {
    const b = h.isolated;
    if (!isNum(b.x) || !isNum(b.y)) return fail('"hub.isolated" needs numeric x and y');
    isolated = { x: b.x, y: b.y, vertical: b.vertical === true };
  }

  const windows: Partial<Record<string, Rect>> = {};
  if (isObj(data.windows)) {
    for (const [kind, r] of Object.entries(data.windows)) {
      if (!WINDOW_ID.test(kind)) continue;
      if (!isObj(r) || ![r.x, r.y, r.width, r.height].every(isNum)) return fail(`window "${kind}" is malformed`);
      windows[kind] = { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number };
    }
  }

  const parts: Record<string, unknown> = {};
  if (isObj(data.parts)) for (const [k, v] of Object.entries(data.parts)) if (isObj(v)) parts[k] = v;

  return {
    'uif.profile': 1,
    ...(Object.keys(parts).length ? { parts } : {}),
    name: isStr(data.name) && data.name.trim() ? data.name.trim() : fallbackName,
    savedAt: isStr(data.savedAt) ? data.savedAt : new Date().toISOString(),
    actions: { order: a.order, hidden: a.hidden, custom: custom as CustomActionDef[], floating },
    hub: { x: h.x as number, y: h.y as number, width: h.width as number, height: h.height as number, mode, docked, arrange, isolated },
    strings: data.strings === true,
    windows,
  };
}

/** A file name for a profile: `<name>.profile`, safe on every OS. */
export function profileFileName(name: string): string {
  const safe = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'layout';
  return safe + PROFILE_EXTENSION;
}

export function serializeProfile(profile: UIFProfile): string {
  return JSON.stringify(profile, null, 2) + '\n';
}
