import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface Options {
  initialPosition: { x: number; y: number };
  initialSize: { width: number; height: number };
  minWidth: number;
  /** At most this wide; the screen's width when not given (a panel may fill the whole screen). */
  maxWidth?: number;
  minHeight: number;
  /** At most this tall; the screen's height when not given. */
  maxHeight?: number;
  draggable?: boolean;
  resizable?: boolean;
  /** Called once when a drag or resize ends (`how`: a pointer drag, a pointer resize, or a key). */
  onCommit?: (rect: { x: number; y: number; width: number; height: number }, how: 'drag' | 'resize' | 'key') => void;
}

interface Gesture {
  kind: 'drag' | 'resize';
  corner?: Corner;
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pixels of a dragged panel that always stay inside the viewport. */
const KEEP_VISIBLE = 60;

/** Pull a position back so the panel can still be grabbed. */
function keepReachable(p: { x: number; y: number }, width: number) {
  return {
    x: clamp(p.x, KEEP_VISIBLE - width, window.innerWidth - KEEP_VISIBLE),
    y: clamp(p.y, 0, window.innerHeight - KEEP_VISIBLE / 2),
  };
}

type Box = { x: number; y: number; width: number; height: number };
type Limits = Pick<Options, 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight'>;

/**
 * Resize `start` by dragging `corner` by (dx, dy). The opposite corner stays put,
 * and the moving edge stops at the viewport edge.
 */
function resizeFrom(start: Box, corner: Corner, dx: number, dy: number, limits: Limits): Box {
  const { minWidth, minHeight } = limits;
  const maxWidth = limits.maxWidth ?? Infinity, maxHeight = limits.maxHeight ?? Infinity;
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  const roomX = left ? start.x + start.width : window.innerWidth - start.x;
  const roomY = top ? start.y + start.height : window.innerHeight - start.y;
  const width = clamp(start.width + (left ? -dx : dx), minWidth, Math.max(minWidth, Math.min(maxWidth, roomX)));
  const height = clamp(start.height + (top ? -dy : dy), minHeight, Math.max(minHeight, Math.min(maxHeight, roomY)));
  return {
    x: left ? start.x + start.width - width : start.x,
    y: top ? start.y + start.height - height : start.y,
    width,
    height,
  };
}

const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Help text for a keyboard-operable handle (use as its aria-description or title). */
export const KEYBOARD_HINT = 'Arrow keys move; Alt+arrow keys resize; hold Shift for larger steps';

/** Pointer-driven move and corner resize for a fixed-position panel. */
export function useDragResize(opts: Options) {
  // A saved position may come from a larger window.
  const [position, setPosition] = useState(() => keepReachable(opts.initialPosition, opts.initialSize.width));
  const [size, setSize] = useState(opts.initialSize);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  // The listeners read the latest values through refs, so they subscribe once per gesture.
  const live = useRef({ opts, position, size });
  live.current = { opts, position, size };

  /** Begin a drag. `from` starts it at another position than the stored one (a docked panel being pulled free). */
  const startDrag = useCallback((e: React.PointerEvent, from?: { x: number; y: number }) => {
    if (live.current.opts.draggable === false || e.button !== 0) return;
    const { position: p, size: s } = live.current;
    if (from) setPosition(from);
    setGesture({ kind: 'drag', startX: e.clientX, startY: e.clientY, ...p, ...(from ?? {}), ...s });
    e.preventDefault();
  }, []);

  const startResize = useCallback((e: React.PointerEvent, corner: Corner) => {
    if (live.current.opts.resizable === false) return;
    const { position: p, size: s } = live.current;
    setGesture({ kind: 'resize', corner, startX: e.clientX, startY: e.clientY, ...p, ...s });
    e.stopPropagation();
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!gesture) return;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (gesture.kind === 'drag') {
        // Keep enough of the panel on screen to grab it again.
        setPosition(keepReachable({ x: gesture.x + dx, y: gesture.y + dy }, gesture.width));
        return;
      }
      const next = resizeFrom(gesture, gesture.corner ?? 'br', dx, dy, live.current.opts);
      setSize({ width: next.width, height: next.height });
      setPosition({ x: next.x, y: next.y });
    };
    const up = () => {
      setGesture(null);
      const { position: p, size: s, opts } = live.current;
      opts.onCommit?.({ ...p, ...s }, gesture.kind);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
  }, [gesture]);

  /**
   * Keyboard equivalent for a focusable handle. Arrow keys move the panel and
   * Alt+arrow keys resize it from the bottom-right corner. Shift uses larger steps.
   */
  const onHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const dir = ARROWS[e.key];
    if (!dir || e.ctrlKey || e.metaKey) return;
    const { opts, position: p, size: s } = live.current;
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const [dx, dy] = [dir[0] * step, dir[1] * step];
    let box: Box;
    if (e.altKey) {
      if (opts.resizable === false) return;
      box = resizeFrom({ ...p, ...s }, 'br', dx, dy, opts);
    } else {
      if (opts.draggable === false) return;
      box = { ...keepReachable({ x: p.x + dx, y: p.y + dy }, s.width), ...s };
    }
    e.preventDefault();
    setPosition({ x: box.x, y: box.y });
    setSize({ width: box.width, height: box.height });
    opts.onCommit?.(box, 'key');
  }, []);

  // When the window shrinks, bring panels that fell outside it back within reach.
  useEffect(() => {
    const onResize = () =>
      setPosition(p => {
        const next = keepReachable(p, live.current.size.width);
        return next.x === p.x && next.y === p.y ? p : next;
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    position,
    size,
    setPosition,
    setSize,
    isDragging: gesture?.kind === 'drag',
    isResizing: gesture?.kind === 'resize',
    startDrag,
    startResize,
    onHandleKeyDown,
  };
}
