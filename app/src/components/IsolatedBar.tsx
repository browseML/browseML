import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { IsolatedBar as IsolatedBarState } from '../core/profile';
import { useDragResize } from '../hooks/useDragResize';
import { useUIF } from './UIFContext';

export const BAR_KEY = '__bar';

interface Props {
  state: IsolatedBarState;
  /** The new position (after a move), or null to join the field again. */
  onChange(next: IsolatedBarState | null): void;
  children: React.ReactNode;
}

/**
 * The button row on its own, floating: drag its grip to move it (arrow keys too), drop it on the field to join
 * it again, ⇅ turns it vertical (sideways) and back. Portaled to the body, so the field's backdrop-filter
 * does not capture its `position: fixed`.
 */
export function IsolatedBar({ state, onChange, children }: Props) {
  const { hubRef, raise, zIndexOf } = useUIF();
  const { position, setPosition, startDrag, onHandleKeyDown, isDragging } = useDragResize({
    initialPosition: { x: state.x, y: state.y },
    initialSize: { width: 60, height: 60 },
    minWidth: 60,
    maxWidth: 4000,
    minHeight: 40,
    maxHeight: 4000,
    resizable: false,
    onCommit: rect => {
      // dropped on the field: it joins the field again
      const hub = hubRef.current?.getBoundingClientRect();
      const cx = rect.x + 20;
      const cy = rect.y + 20;
      if (hub && cx >= hub.left && cx <= hub.right && cy >= hub.top && cy <= hub.bottom) onChange(null);
      else onChange({ ...state, x: Math.round(rect.x), y: Math.round(rect.y) });
    },
  });

  useEffect(() => {
    setPosition({ x: state.x, y: state.y });
  }, [state.x, state.y, setPosition]);

  // Taken out of the field, it comes to the front, so the field it left cannot cover it.
  useEffect(() => raise(BAR_KEY), [raise]);

  // The whole bar stays on screen: a long row standing up near the bottom moves up until its last button shows,
  // and again when the window shrinks.
  const barRef = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = barRef.current;
    if (!el || isDragging) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4));
    const y = Math.max(4, Math.min(r.top, window.innerHeight - r.height - 4));
    if (Math.abs(x - r.left) > 0.5 || Math.abs(y - r.top) > 0.5) setPosition({ x, y });
  };
  useLayoutEffect(fit);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  return createPortal(
    <div
      ref={barRef}
      className={`uif-isolated-bar ${state.vertical ? 'is-vertical' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ left: position.x, top: position.y, zIndex: zIndexOf(BAR_KEY) }}
      onPointerDownCapture={() => raise(BAR_KEY)}
      role="toolbar"
      aria-label="Button row, taken out of the field"
    >
      <span className="uif-isolated-tools">
        <button
          type="button"
          className="uif-bar-grip"
          onPointerDown={startDrag}
          onKeyDown={onHandleKeyDown}
          title="Drag to move; drop it on the field to put it back. Arrow keys move it."
          aria-label="Move the button row (drop on the field to join it)"
        >
          ⠿
        </button>
        <button
          type="button"
          className="uif-bar-tool"
          title={state.vertical ? 'Lay it flat' : 'Stand it up (sideways)'}
          aria-label={state.vertical ? 'Horizontal button row' : 'Vertical button row'}
          onClick={() => onChange({ ...state, vertical: !state.vertical })}
        >
          {state.vertical ? '⇆' : '⇅'}
        </button>
        <button type="button" className="uif-bar-tool" title="Put it back in the field" aria-label="Join the field" onClick={() => onChange(null)}>
          ⤓
        </button>
      </span>
      {children}
    </div>,
    document.body,
  );
}
