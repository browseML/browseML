// SPDX-License-Identifier: MIT
// Magnetic docking: a panel dragged within reach of a viewport edge is drawn to it, and docks there when let go.
import type { DockEdge } from '../types';

/** How close (px) a panel's edge must come to the viewport's edge to be drawn to it. */
export const MAGNET_REACH = 28;

/** The viewport edge the panel is close enough to dock on (the nearest, when it is near two), or null. */
export function magnetEdge(
  r: { x: number; y: number; width: number; height: number },
  view: { width: number; height: number },
  reach = MAGNET_REACH,
): DockEdge | null {
  const gaps: [DockEdge, number][] = [
    ['top', r.y],
    ['bottom', view.height - (r.y + r.height)],
    ['left', r.x],
    ['right', view.width - (r.x + r.width)],
  ];
  let best: [DockEdge, number] | null = null;
  for (const g of gaps) if (g[1] <= reach && (!best || g[1] < best[1])) best = g;
  return best ? best[0] : null;
}
