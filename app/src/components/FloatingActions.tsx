import { dropOnShelf, notifyDragOff } from '../core/shelves';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Action, ActionRegistry, Point } from '../core/actions';
import { insertionIndex, isOverTrash } from '../hooks/usePressHoldDrag';

const HOLD_MS = 400;
const HOLD_SLOP = 6;
const SIZE = 36;
const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;

export interface FreeDrag {
  id: string;
  overBar: boolean;
  overTrash: boolean;
}

interface Props {
  registry: ActionRegistry;
  barRef: React.RefObject<HTMLElement>;
  arranging: boolean;
  pressed: Record<string, boolean>;
  onRun(action: Action): void;
  /** Reports the floating button being dragged (null when the drag ends). */
  onDragChange(drag: FreeDrag | null): void;
  zIndex: number;
}

/** Keep a floating button on screen. */
function clampToViewport(p: Point): Point {
  return {
    x: Math.max(0, Math.min(p.x, window.innerWidth - SIZE)),
    y: Math.max(0, Math.min(p.y, window.innerHeight - SIZE)),
  };
}

function nearBar(bar: HTMLElement | null, x: number, y: number, margin = 24): boolean {
  if (!bar) return false;
  const r = bar.getBoundingClientRect();
  return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
}

/**
 * Buttons placed anywhere on the screen. Tap runs the action. Press and hold
 * (or just drag while arranging) to move one: drop it anywhere to place it,
 * back on the bar to put it in that slot, or on the trash to hide it.
 */
export function FloatingActions(props: Props) {
  const items = props.registry.floating();
  const [, setTick] = useState(0);

  // Positions are clamped on render, so re-render when the window size changes.
  useEffect(() => {
    const onResize = () => setTick(t => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!items.length) return null;
  return createPortal(
    <>
      {items.map(({ action, at }) => (
        <FloatingButton key={action.id} action={action} at={clampToViewport(at)} {...props} />
      ))}
    </>,
    document.body,
  );
}

function FloatingButton({
  action,
  at,
  registry,
  barRef,
  arranging,
  pressed,
  onRun,
  onDragChange,
  zIndex,
}: Props & { action: Action; at: Point }) {
  const [live, setLive] = useState<Point | null>(null);
  const [state, setState] = useState<{ overBar: boolean; overTrash: boolean }>({ overBar: false, overTrash: false });
  const suppressClick = useRef(false);
  const cleanup = useRef<() => void>();
  const report = useRef(onDragChange);
  report.current = onDragChange;

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    cleanup.current?.();
    const start = { x: e.clientX, y: e.clientY };
    const offset = { x: start.x - at.x, y: start.y - at.y };
    let armed = arranging;
    let dragging = false;
    let last = start;

    const timer = armed
      ? undefined
      : window.setTimeout(() => {
          armed = true;
          suppressClick.current = true;
          navigator.vibrate?.(15);
        }, HOLD_MS);

    const measure = (p: Point) => ({ overBar: nearBar(barRef.current, p.x, p.y), overTrash: isOverTrash(p.x, p.y) });

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
      if (!dragging && dist <= 3) return;
      dragging = true;
      suppressClick.current = true;
      ev.preventDefault();
      const m = measure(last);
      setLive({ x: last.x - offset.x, y: last.y - offset.y });
      setState(m);
      report.current({ id: action.id, ...m });
      notifyDragOff(true);
    };

    const up = () => {
      clearTimeout(timer);
      stop();
      if (!dragging) return;
      const m = measure(last);
      setLive(null);
      setState({ overBar: false, overTrash: false });
      report.current(null);
      notifyDragOff(false);
      if (m.overTrash) registry.hide(action.id);
      // over a shelf (the sidebar menu, a button panel): off the screen, onto the shelf
      else if (dropOnShelf(action.id, last.x, last.y)) registry.hide(action.id);
      else if (m.overBar && barRef.current) registry.dockAt(action.id, insertionIndex(barRef.current, last.x, last.y));
      else registry.float(action.id, clampToViewport({ x: last.x - offset.x, y: last.y - offset.y }));
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
  };

  // Keyboard: arrow keys move it, Shift for larger steps, Delete hides, Home puts it back on the bar.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (d[e.key]) registry.float(action.id, clampToViewport({ x: at.x + d[e.key][0] * step, y: at.y + d[e.key][1] * step }));
    else if (e.key === 'Delete' || e.key === 'Backspace') registry.hide(action.id);
    else if (e.key === 'Home') registry.dockAt(action.id);
    else return;
    e.preventDefault();
  };

  const pos = live ?? at;
  return (
    <button
      type="button"
      className={[
        'uif-action',
        'uif-action-floating',
        arranging ? 'is-arranging' : '',
        live ? 'is-moving' : '',
        state.overTrash ? 'is-removing' : '',
        state.overBar ? 'is-docking' : '',
        pressed[action.id] ? 'is-pressed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: pos.x, top: pos.y, zIndex }}
      aria-pressed={action.id in pressed ? !!pressed[action.id] : undefined}
      aria-label={action.label}
      title={`${action.label}  (${action.command}) - hold to move; arrow keys move, Home returns it to the bar, Delete hides it`}
      data-uif-floating={action.id}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onRun(action);
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <span className="uif-action-icon">{action.icon ?? action.label.slice(0, 1).toUpperCase()}</span>
    </button>
  );
}
