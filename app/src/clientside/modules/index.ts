// SPDX-License-Identifier: MIT
// MODULES: what extends browseML's pure core, each one optional. The core is the field, the engine, the control panel;
// a module adds windows and actions to the field (core/modules.ts) or effects to the page, and the visitor can remove it
// (MODULES in the control panel; it applies on the next load). A host's edition (browseml-host.json) adds its own.
import type { UIFModule } from '../../core/modules';

export interface ModuleInfo { id: string; label: string; note: string; make(): UIFModule; /** Only on some hosts (read after the host file). */ when?: () => boolean }
const KEY = 'browseml:modules-off';
export const modulesOff = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; } };
export const setModuleOn = (id: string, on: boolean) => {
  const off = new Set(modulesOff());
  if (on) off.delete(id); else off.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...off])); } catch { /* storage off */ }
};
/** The modules this page includes, less the ones the visitor turned off. */
export const activeModules = (all: ModuleInfo[]): UIFModule[] => { const off = new Set(modulesOff()); return all.filter(m => !off.has(m.id)).map(m => m.make()); };
