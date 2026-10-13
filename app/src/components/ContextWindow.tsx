import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Rect } from '../types';
import type { WindowInfo } from '../core/modules';
import { KEYBOARD_HINT, useDragResize } from '../hooks/useDragResize';
import { ResizeCorners } from './ResizeCorners';
import { useUIF } from './UIFContext';

export const WINDOW_SIZE = { width: 420, height: 360 };

interface Props {
  info: WindowInfo;
  rect: Rect;
  onRect(rect: Rect): void;
  onClose(): void;
  /** The body; it gets a `Tools` component that renders into the title bar. */
  children: (Tools: React.ComponentType<{ children?: React.ReactNode }>) => React.ReactNode;
}

/**
 * A window for one context file (.history, .memory, …), built on the drag/resize
 * template: move by the title bar, resize from any corner, arrow keys on the
 * focused title bar, and it comes to the front when pressed.
 */
export function ContextWindow({ info, rect, onRect, onClose, children }: Props) {
  const { raise, zIndexOf } = useUIF();
  const kind = info.id;
  const key = `win:${kind}`;
  // the body's title-bar tools render here (a portal), so a module window keeps its state in one place
  const [toolsEl, setToolsEl] = useState<HTMLSpanElement | null>(null);
  const Tools = useMemo(
    () =>
      function Tools({ children: c }: { children?: React.ReactNode }) {
        return toolsEl ? createPortal(c, toolsEl) : null;
      },
    [toolsEl],
  );
  const { position, size, setPosition, setSize, startDrag, startResize, onHandleKeyDown, isDragging } = useDragResize({
    initialPosition: { x: rect.x, y: rect.y },
    initialSize: { width: rect.width, height: rect.height },
    minWidth: 280,
    minHeight: 180,
    onCommit: onRect,
  });

  // Follow rect changes made elsewhere (a profile, or reopening at a new spot).
  useEffect(() => {
    setPosition({ x: rect.x, y: rect.y });
    setSize({ width: rect.width, height: rect.height });
  }, [rect, setPosition, setSize]);

  return (
    <section
      className={`uif-window uif-window-${kind} ${isDragging ? 'is-dragging' : ''}`}
      data-uif-window={kind}
      aria-label={info.file}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height, zIndex: zIndexOf(key) }}
      onPointerDownCapture={() => raise(key)}
      onKeyDown={e => {
        if (e.key === 'Escape' && e.target === e.currentTarget.querySelector('.uif-window-title')) onClose();
      }}
    >
      <header
        className="uif-window-title"
        onPointerDown={startDrag}
        onKeyDown={onHandleKeyDown}
        tabIndex={0}
        aria-label={`${info.file} window. ${KEYBOARD_HINT}. Escape closes.`}
      >
        <span className="uif-window-icon" aria-hidden="true">{info.icon}</span>
        <span className="uif-window-name">{info.file}</span>
        <span className="uif-window-summary">{info.summary}</span>
        <span className="uif-window-tools" onPointerDown={e => e.stopPropagation()}>
          <span className="uif-window-tools-slot" ref={setToolsEl} />
          <button type="button" title="Close" aria-label={`Close ${info.file}`} onClick={onClose}>
            ✕
          </button>
        </span>
      </header>
      <div className="uif-window-body">{children(Tools)}</div>
      <ResizeCorners onStart={startResize} />
    </section>
  );
}
