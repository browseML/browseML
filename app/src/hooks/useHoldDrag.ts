import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface HoldDragPoint {
  x: number;
  y: number;
  /** Pointer offset inside the pressed element when the press began. */
  offsetX: number;
  offsetY: number;
}

interface Options {
  /** Press this long (ms) before a drag starts. 0 drags at once. */
  holdMs?: number;
  onMove?(p: HoldDragPoint): void;
  onDrop(p: HoldDragPoint): void;
  /** A press released before the hold, without moving. */
  onTap?(): void;
}

const HOLD_SLOP = 6;

/**
 * Press and hold one element, then drag it; `onDrop` gets where it was released.
 * Part of the drag template (see usePressHoldDrag for lists of items).
 */
export function useHoldDrag({ holdMs = 400, onMove, onDrop, onTap }: Options) {
  const [dragging, setDragging] = useState<HoldDragPoint | null>(null);
  const live = useRef({ onMove, onDrop, onTap });
  live.current = { onMove, onDrop, onTap };
  const cleanup = useRef<() => void>();
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      cleanup.current?.();
      const r = e.currentTarget.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY };
      const offset = { offsetX: start.x - r.left, offsetY: start.y - r.top };
      let armed = holdMs === 0;
      let moved = false;
      let last = start;
      const timer = armed ? undefined : window.setTimeout(() => {
        armed = true;
        navigator.vibrate?.(15);
        const p = { ...last, ...offset };
        setDragging(p);
        live.current.onMove?.(p);
      }, holdMs);

      const move = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        if (!armed) {
          if (Math.hypot(last.x - start.x, last.y - start.y) > HOLD_SLOP) {
            clearTimeout(timer);
            moved = true;
            stop();
          }
          return;
        }
        ev.preventDefault();
        const p = { ...last, ...offset };
        setDragging(p);
        live.current.onMove?.(p);
      };
      const up = () => {
        clearTimeout(timer);
        stop();
        if (armed) {
          setDragging(null);
          live.current.onDrop({ ...last, ...offset });
        } else if (!moved) live.current.onTap?.();
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        cleanup.current = undefined;
      };
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      cleanup.current = () => {
        clearTimeout(timer);
        stop();
      };
    },
    [holdMs],
  );

  return { onPointerDown, dragging };
}
