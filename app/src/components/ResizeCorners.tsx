import React from 'react';
import type { Corner } from '../hooks/useDragResize';

const CORNERS: { corner: Corner; label: string }[] = [
  { corner: 'tl', label: 'top-left' },
  { corner: 'tr', label: 'top-right' },
  { corner: 'bl', label: 'bottom-left' },
  { corner: 'br', label: 'bottom-right' },
];

/** Resize grips on all four corners of a positioned panel. */
export function ResizeCorners({ onStart }: { onStart: (e: React.PointerEvent, corner: Corner) => void }) {
  return (
    <>
      {CORNERS.map(({ corner, label }) => (
        <div
          key={corner}
          className={`uif-corner corner-tab ${corner}`}
          onPointerDown={e => onStart(e, corner)}
          title={`Resize from the ${label} corner`}
          aria-hidden="true"
        />
      ))}
    </>
  );
}
