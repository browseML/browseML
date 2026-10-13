import React, { useEffect, useRef, useState } from 'react';
import { useUIF } from './UIFContext';

interface Line {
  id: string;
  color: string;
  d: string;
  dashed?: boolean;
}

interface Beacon {
  id: string;
  title: string;
  color: string;
  x: number;
  y: number;
  angle: number;
}

const INSET = 28;

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

/** Point where the ray from the viewport centre towards (tx, ty) leaves the inset viewport. */
function edgePoint(tx: number, ty: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  const angle = Math.atan2(ty - cy, tx - cx);
  if (tx >= INSET && tx <= w - INSET && ty >= INSET && ty <= h - INSET) return { x: tx, y: ty, angle };
  const dx = tx - cx;
  const dy = ty - cy;
  const t = Math.min(dx ? (cx - INSET) / Math.abs(dx) : Infinity, dy ? (cy - INSET) / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t, angle };
}

/**
 * The "strings": curves from the hub to each in-page output, and edge beacons
 * pointing at outputs that live in other windows (possibly on other monitors).
 */
export function Tethers() {
  const { fields, hubRef, outputs } = useUIF();
  const [lines, setLines] = useState<Line[]>([]);
  const [beacons, setBeacons] = useState<Beacon[]>([]);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    let frame = 0;
    let lastKey = '';
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const hub = hubRef.current?.getBoundingClientRect();
      if (!hub) return;
      const hx = hub.left + hub.width / 2;
      const hy = hub.top + hub.height / 2;
      const nextLines: Line[] = [];
      const nextBeacons: Beacon[] = [];
      // Viewport origin in screen coordinates, to compare with pop-out window positions.
      const vx = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const vy = window.screenY + (window.outerHeight - window.innerHeight);

      fieldsRef.current.forEach((f, i) => {
        if (f.placement === 'inline') {
          const el = document.querySelector(`[data-uif-output="${f.id}"]`);
          if (!el) return;
          const r = el.getBoundingClientRect();
          // Leave from the hub's side that faces the output, arrive at the output's facing side.
          const toLeft = r.left + r.width / 2 < hx;
          const sx = toLeft ? hub.left : hub.right;
          const tx = toLeft ? r.right : r.left;
          nextLines.push({ id: f.id, color: f.color, d: curve(sx, hy, tx, r.top + 16) });
        } else {
          const g = f.screenGeom;
          // Until the window reports in, point right, stacked.
          const tx = g ? g.x + g.width / 2 - vx : window.innerWidth + 400;
          const ty = g ? g.y + g.height / 2 - vy : window.innerHeight / 2 + i * 40;
          const p = edgePoint(tx, ty);
          nextBeacons.push({ id: f.id, title: f.title, color: f.color, ...p });
          nextLines.push({ id: f.id, color: f.color, d: curve(hx, hy, p.x, p.y), dashed: true });
        }
      });

      const key = JSON.stringify([nextLines, nextBeacons]);
      if (key !== lastKey) {
        lastKey = key;
        setLines(nextLines);
        setBeacons(nextBeacons);
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [hubRef]);

  return (
    <>
      <svg className="uif-tethers" aria-hidden="true">
        {lines.map(l => (
          <path
            key={l.id}
            d={l.d}
            stroke={l.color}
            strokeDasharray={l.dashed ? '6 6' : undefined}
            className={l.dashed ? 'uif-tether is-remote' : 'uif-tether'}
          />
        ))}
      </svg>
      {beacons.map(b => (
        <button
          key={b.id}
          type="button"
          className="uif-beacon"
          style={{ left: b.x, top: b.y, '--uif-color': b.color } as React.CSSProperties}
          title={`${b.title}: click to find it, double-click to call it home`}
          onClick={() => outputs.ping(b.id)}
          onDoubleClick={() => outputs.callHome(b.id)}
        >
          <span className="uif-beacon-arrow" style={{ transform: `rotate(${b.angle}rad)` }}>➤</span>
          <span className="uif-beacon-label">{b.title}</span>
        </button>
      ))}
    </>
  );
}
