import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface DragState {
  index: number;
  /** Pointer position. */
  x: number;
  y: number;
  /** Pointer offset inside the grabbed item. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  /** Insertion index among the remaining items. */
  target: number;
  /** Pointer is far enough outside the container to count as "off" it. */
  outside: boolean;
  /** Pointer is over an element marked `data-uif-trash`; dropping removes the item. */
  overTrash: boolean;
}

interface Options {
  containerRef: React.RefObject<HTMLElement>;
  onReorder(from: number, to: number): void;
  onRemove(index: number): void;
  /**
   * Dropped outside the container (and not on a trash target). When given,
   * this replaces the default of removing the item, e.g. to place it freely.
   * `at` is where the item's top-left corner should go.
   */
  onDropOutside?(index: number, at: { x: number; y: number }): void;
  holdMs?: number;
  /** How far outside the container counts as "off the bar". */
  removeDistance?: number;
}

const HOLD_SLOP = 6;
const DRAG_SLOP = 3;

/** True when the point is over an element marked as a trash target (`data-uif-trash`). */
export function isOverTrash(x: number, y: number): boolean {
  return document.elementsFromPoint(x, y).some(el => (el as HTMLElement).dataset?.uifTrash !== undefined);
}

/**
 * Where an item dropped at (x, y) goes among a container's `data-uif-item`
 * children, skipping the item being dragged (pass -1 when it is not one of them).
 */
export function insertionIndex(container: HTMLElement, x: number, y: number, dragged = -1): number {
  let target = 0;
  container.querySelectorAll<HTMLElement>('[data-uif-item]').forEach(el => {
    if (Number(el.dataset.uifItem) === dragged) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (y > r.bottom || (y >= r.top && x > r.left + r.width / 2)) target++;
  });
  return target;
}

/**
 * Press and hold an item to enter arrange mode, then drag to reorder or drag
 * it off the container to remove it. Items need `data-uif-item={index}`.
 */
export function usePressHoldDrag({
  containerRef,
  onReorder,
  onRemove,
  onDropOutside,
  holdMs = 400,
  removeDistance = 40,
}: Options) {
  const [arranging, setArranging] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const arrangingRef = useRef(arranging);
  arrangingRef.current = arranging;
  const suppressClick = useRef(false);
  const cleanup = useRef<() => void>();
  const live = useRef({ onReorder, onRemove, onDropOutside });
  live.current = { onReorder, onRemove, onDropOutside };

  useEffect(() => () => cleanup.current?.(), []);

  const measure = useCallback(
    (x: number, y: number, dragged: number) => {
      const box = containerRef.current;
      const overTrash = isOverTrash(x, y);
      if (!box) return { target: 0, outside: false, overTrash };
      const b = box.getBoundingClientRect();
      const outside =
        x < b.left - removeDistance || x > b.right + removeDistance || y < b.top - removeDistance || y > b.bottom + removeDistance;
      return { target: insertionIndex(box, x, y, dragged), outside, overTrash };
    },
    [containerRef, removeDistance],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, index: number) => {
      if (e.button !== 0) return;
      cleanup.current?.();
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY };
      let armed = arrangingRef.current;
      let dragging = false;
      let last = start;

      const begin = () => {
        dragging = true;
        suppressClick.current = true;
        setDrag({
          index,
          x: last.x,
          y: last.y,
          offsetX: start.x - rect.left,
          offsetY: start.y - rect.top,
          width: rect.width,
          height: rect.height,
          ...measure(last.x, last.y, index),
        });
      };

      const timer = armed
        ? undefined
        : window.setTimeout(() => {
            armed = true;
            suppressClick.current = true;
            setArranging(true);
            navigator.vibrate?.(15);
          }, holdMs);

      const move = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        const dist = Math.hypot(last.x - start.x, last.y - start.y);
        if (!armed) {
          if (dist > HOLD_SLOP) {
            clearTimeout(timer);
            stop();
          }
          return;
        }
        if (!dragging) {
          if (dist > DRAG_SLOP) begin();
          return;
        }
        ev.preventDefault();
        setDrag(d => (d ? { ...d, x: last.x, y: last.y, ...measure(last.x, last.y, index) } : d));
      };

      const up = () => {
        clearTimeout(timer);
        stop();
        if (!dragging) return;
        const result = measure(last.x, last.y, index);
        setDrag(null);
        const { onDropOutside: place, onRemove: remove, onReorder: reorder } = live.current;
        if (result.overTrash) remove(index);
        else if (result.outside) {
          if (place) place(index, { x: last.x - (start.x - rect.left), y: last.y - (start.y - rect.top) });
          else remove(index);
        } else if (result.target !== index) reorder(index, result.target);
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
    [holdMs, measure],
  );

  /** Wrap an item's click handler so holds and drags don't also click. */
  const guardClick = useCallback((fn: () => void) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!arrangingRef.current) fn();
  }, []);

  const focusItem = useCallback(
    (index: number) =>
      requestAnimationFrame(() =>
        containerRef.current?.querySelector<HTMLElement>(`[data-uif-item="${index}"]`)?.focus(),
      ),
    [containerRef],
  );

  /** Keyboard arranging: arrows move, Delete removes, Escape finishes. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number, count: number) => {
      if (!arrangingRef.current) return;
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
      if (step) {
        const to = index + step;
        if (to >= 0 && to < count) {
          live.current.onReorder(index, to);
          focusItem(to);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        live.current.onRemove(index);
        focusItem(Math.max(0, index - 1));
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        setArranging(false);
      } else return;
      e.preventDefault();
    },
    [focusItem],
  );

  return { arranging, setArranging, drag, onPointerDown, onKeyDown, guardClick };
}
