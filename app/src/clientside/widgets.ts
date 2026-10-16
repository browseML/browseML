// SPDX-License-Identifier: MIT
// WIDGETS from modules: a module registers a renderer by kind, and a message in a response window carrying
// { widget: 'module', data: { kind, … } } is drawn by it. The core knows only the one widget name.
import { createElement, type ComponentType } from 'react';

export interface ModuleWidgetProps { data: Record<string, unknown> }
const renderers = new Map<string, ComponentType<ModuleWidgetProps>>();
export function registerWidget(kind: string, c: ComponentType<ModuleWidgetProps>) { renderers.set(kind, c); }
export function ModuleWidget({ message }: { message: { data?: Record<string, unknown> } }) {
  const data = message.data ?? {}, C = renderers.get(String(data.kind ?? ''));
  return C ? createElement(C, { data }) : null;
}
