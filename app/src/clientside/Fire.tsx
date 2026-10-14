// SPDX-License-Identifier: MIT
// The processor's fire, across the whole page: flames along the bottom of the window whose height and colour follow
// what the engine is doing (bankml/pulse.ts — the live writing speed against the best this visit, the prompt being
// read or warmed, the download, a diagnostic running), embers drifting up over everything, the edges glowing when it
// runs hot, and electrical surges — branching arcs with a flash — on the engine's own events: blue-white for the GPU's
// verdict, green for a receipt or a new speed record, red for an error or STOP, orange for a question or a load.
// Behind the page (the content stays readable, the fire shows between it), the arcs over it for their instant.
// Cheap by design, so it never costs the speed it shows: a low-resolution fire automaton (the classic one), at most
// 30 frames a second, asleep (no frames at all) when cold and calm, paused in a background tab; with reduced motion,
// a still glow. LIMITERS turns it off. Most of a canvas's cost is the browser compositing it each frame, so the flames
// and embers live on a canvas over the lower 45% of the window only, in plain alpha (a blend mode cost a fifth of a
// core more, measured in Brave), and the arcs on a page-wide canvas drawn only while one is alive (0.6.13).
import { useEffect, useRef } from 'react';
import { activity, follow, onPulse, recentSurges, surgeColor, targetHeat, type Surge } from '../bankml/pulse';
import { getLimits, onLimits } from './limits';

const CELL = 6;            // screen pixels per fire cell
const ROWS = 56;           // the automaton's height in cells (the flames reach up to ROWS · CELL at full heat)
const FRAME = 1000 / 30;
const FRAME_BUSY = 1000 / 15;  // while the engine computes (reading, writing, warming, verifying), the CPU is its
const STRIP = 0.45;        // the flames' canvas: this share of the window's height, from the bottom (its cost follows
                           // its area: 60% → 40% took Brave from 39–47% to 27% of a core, the flames hot, 0.6.15)

/** black → red → orange → yellow → white, with opacity rising with the intensity (0–36). */
const PALETTE: [number, number, number, number][] = Array.from({ length: 37 }, (_, i) => {
  const t = i / 36;
  const r = Math.min(255, 40 + t * 3 * 255), g = Math.max(0, Math.min(255, (t - 0.3) * 2.2 * 255)), b = Math.max(0, Math.min(255, (t - 0.75) * 4 * 255));
  return [r, g, b, i === 0 ? 0 : Math.min(190, 30 + t * 200)];  // never opaque: the page shows through
});

/** What the fire costs, measured on itself: frames a second, milliseconds of the page's main thread per frame, and
 *  that time as a share of the main thread, over the last second it drew (DIAGNOSTICS shows it). */
export interface FireStats { on: boolean; asleep: boolean; fps: number; msPerFrame: number; share: number; frames: number; parts: Record<Part, number> }
type Part = 'automaton' | 'blit' | 'glow' | 'embers' | 'arcs';
const NO_PARTS = (): Record<Part, number> => ({ automaton: 0, blit: 0, glow: 0, embers: 0, arcs: 0 });
const stats: FireStats = { on: true, asleep: true, fps: 0, msPerFrame: 0, share: 0, frames: 0, parts: NO_PARTS() };
let win = { t: 0, frames: 0, ms: 0, parts: NO_PARTS() };
export const fireStats = (): FireStats => ({ ...stats, parts: { ...stats.parts } });
(globalThis as { __browsemlFire?: () => FireStats }).__browsemlFire = fireStats;

interface Ember { x: number; y: number; vx: number; vy: number; life: number; max: number }
interface Bolt { pts: [number, number][][]; color: string; born: number; strength: number }

export function ProcessorFire() {
  const ref = useRef<HTMLCanvasElement>(null), arcRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, av = arcRef.current!;
    const ctx = cv.getContext('2d'), actx = av.getContext('2d');
    if (!ctx || !actx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // W × SH: the flames' canvas (the window's lower part); W × H: the arcs' (the whole window)
    let W = 0, H = 0, SH = 0, cols = 0, cells = new Uint8Array(0), img: ImageData | null = null, arcsDrawn = false;
    const low = document.createElement('canvas'), lctx = low.getContext('2d')!;
    const resize = () => {
      W = cv.width = av.width = innerWidth; H = av.height = innerHeight;
      SH = cv.height = Math.min(H, Math.max(ROWS * CELL + 80, Math.round(H * STRIP)));
      cv.style.height = `${SH}px`;
      cols = Math.ceil(W / CELL); cells = new Uint8Array(cols * ROWS);
      low.width = cols; low.height = ROWS; img = lctx.createImageData(cols, ROWS);
    };
    resize();
    let heat = 0, flare = 0, raf = 0, last = performance.now(), lastFrame = 0;
    const embers: Ember[] = [], bolts: Bolt[] = [];
    let enabled = getLimits().fire;
    stats.on = enabled;

    // an arc: from a point on the top edge or a side down toward the fire line, jagged by midpoint displacement, with
    // a branch or two
    const arc = (x0: number, y0: number, x1: number, y1: number, rough: number, depth: number): [number, number][] => {
      if (depth === 0) return [[x0, y0], [x1, y1]];
      const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * rough, my = (y0 + y1) / 2 + (Math.random() - 0.5) * rough * 0.5;
      const a = arc(x0, y0, mx, my, rough / 2, depth - 1);
      return [...a.slice(0, -1), ...arc(mx, my, x1, y1, rough / 2, depth - 1)];
    };
    const strike = (s: Surge) => {
      const n = 1 + Math.round(s.strength * 2), paths: [number, number][][] = [];
      for (let i = 0; i < n; i++) {
        const fromSide = Math.random() < 0.35, x0 = fromSide ? (Math.random() < 0.5 ? 0 : W) : Math.random() * W;
        const y0 = fromSide ? Math.random() * H * 0.5 : 0;
        const x1 = Math.random() * W, y1 = H - ROWS * CELL * (0.3 + heat * 0.5);
        const main = arc(x0, y0, x1, y1, Math.min(W, H) * 0.35, 7);
        paths.push(main);
        const k = Math.floor(main.length * (0.3 + Math.random() * 0.4)), [bx, by] = main[k];
        paths.push(arc(bx, by, bx + (Math.random() - 0.5) * 260, by + 80 + Math.random() * 180, 120, 5));
      }
      bolts.push({ pts: paths, color: surgeColor(s.kind), born: performance.now(), strength: s.strength });
      flare = Math.min(1.5, flare + 0.5 * s.strength);
    };

    const still = () => {
      // reduced motion: a glow along the bottom, as strong as the heat; no movement, no arcs
      ctx.clearRect(0, 0, W, SH);
      const h = targetHeat();
      if (!enabled || h <= 0.01) return;
      const g = ctx.createLinearGradient(0, SH, 0, SH - 220 * h);
      g.addColorStop(0, `rgba(246, 70, 93, ${0.35 * h})`); g.addColorStop(0.5, `rgba(247, 147, 26, ${0.18 * h})`); g.addColorStop(1, 'rgba(247, 147, 26, 0)');
      ctx.fillStyle = g; ctx.fillRect(0, SH - 220 * h, W, 220 * h);
    };

    const frame = (t: number) => {
      raf = 0;
      if (document.hidden || !enabled) { ctx.clearRect(0, 0, W, SH); if (arcsDrawn) { actx.clearRect(0, 0, W, H); arcsDrawn = false; } Object.assign(stats, { asleep: true, fps: 0, share: 0 }); win = { t: 0, frames: 0, ms: 0, parts: NO_PARTS() }; return; }
      const a0 = activity(), busy = a0 === 'reading' || a0 === 'writing' || a0 === 'warming' || a0 === 'verifying';
      if (t - lastFrame < (busy && !bolts.length ? FRAME_BUSY : FRAME) - 2) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(100, t - last); last = t; lastFrame = t;
      const t0 = performance.now();
      stats.asleep = false;
      let mark = t0;
      const part = (k: Part) => { const now = performance.now(); win.parts[k] += now - mark; mark = now; };
      heat = follow(heat, targetHeat(), dt);
      flare *= Math.exp(-dt / 300);
      const fuel = Math.min(1, heat + flare * 0.6);

      // the fire automaton: a source row as hot as the heat, each cell taking the one below it, cooled and drifted
      const src = Math.round(fuel * 36), top = (ROWS - 1) * cols;
      for (let x = 0; x < cols; x++) cells[top + x] = Math.max(0, src - (Math.random() < 0.25 ? 3 : 0));
      for (let y = 0; y < ROWS - 1; y++) {
        for (let x = 0; x < cols; x++) {
          const below = cells[(y + 1) * cols + x], decay = (Math.random() * 3.4) | 0;
          const dx = Math.min(cols - 1, Math.max(0, x - decay + 1));
          cells[y * cols + dx] = Math.max(0, below - (decay & 1) - (fuel < 0.4 ? 1 : 0));
        }
      }
      part('automaton');
      const d = img!.data;
      for (let i = 0; i < cells.length; i++) { const p = PALETTE[cells[i]]; d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = p[3]; }
      lctx.putImageData(img!, 0, 0);
      ctx.clearRect(0, 0, W, SH);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(low, 0, SH - ROWS * CELL, W, ROWS * CELL);
      part('blit');

      // the lower corners glow when it runs hot (a surge flashes them), fading every way: no edge
      const glow = Math.max(0, fuel - 0.55) * 1.6 + flare * 0.4;
      if (glow > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        const rad = Math.min(W * 0.35, SH);
        for (const x0 of [0, W]) {
          const g = ctx.createRadialGradient(x0, SH, 0, x0, SH, rad);
          g.addColorStop(0, `rgba(246, 70, 93, ${Math.min(0.35, 0.22 * glow)})`); g.addColorStop(1, 'rgba(247, 147, 26, 0)');
          ctx.fillStyle = g; ctx.fillRect(x0 === 0 ? 0 : W - rad, SH - rad, rad, rad);
        }
      }

      part('glow');
      // embers: born at the flames' top, rising over the whole page
      if (Math.random() < fuel * 0.9 && embers.length < 140) {
        embers.push({ x: Math.random() * W, y: SH - ROWS * CELL * fuel * 0.7, vx: (Math.random() - 0.5) * 0.6, vy: -(0.6 + Math.random() * 1.8 * fuel), life: 0, max: 1500 + Math.random() * 3500 });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.life += dt; e.x += e.vx * dt / 16 + Math.sin((e.life + i * 97) / 400) * 0.3; e.y += e.vy * dt / 16;
        if (e.life > e.max || e.y < -10) { embers.splice(i, 1); continue; }
        const a = (1 - e.life / e.max) * Math.min(1, e.y / (SH * 0.3));  // fading out before the canvas's top
        ctx.fillStyle = `rgba(255, ${Math.round(150 + 80 * a)}, 60, ${a * 0.85})`;
        ctx.fillRect(e.x, e.y, 2, 2);
      }

      part('embers');
      // surges, on the page-wide canvas, drawn only while one is alive: each arc flickers for ~400 ms, glowing, then fades
      if (bolts.length || arcsDrawn) { actx.clearRect(0, 0, W, H); arcsDrawn = bolts.length > 0; }
      actx.globalCompositeOperation = 'lighter';
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i], age = t - b.born;
        if (age > 450) { bolts.splice(i, 1); continue; }
        if (Math.random() < 0.25) continue;  // flicker
        const a = (1 - age / 450) * (0.6 + 0.4 * b.strength);
        // the glow as a wide faint stroke under the bright one (a canvas shadow blur cost far more)
        actx.strokeStyle = b.color; actx.lineJoin = 'round';
        b.pts.forEach((path, j) => {
          actx.beginPath(); actx.moveTo(path[0][0], path[0][1]);
          for (let k = 1; k < path.length; k++) actx.lineTo(path[k][0], path[k][1]);
          actx.globalAlpha = a * 0.22; actx.lineWidth = j % 2 === 0 ? 9 : 5; actx.stroke();
          actx.globalAlpha = a; actx.lineWidth = j % 2 === 0 ? 2.2 : 1.1; actx.stroke();
        });
        if (age < 70) { actx.fillStyle = b.color; actx.globalAlpha = 0.07 * b.strength; actx.fillRect(0, 0, W, H); }  // the flash
        actx.globalAlpha = 1;
      }
      actx.globalCompositeOperation = 'source-over';
      ctx.globalCompositeOperation = 'source-over';
      part('arcs');

      // asleep when cold and calm: no frames at all until the next pulse
      const calm = heat < 0.012 && targetHeat() < 0.012 && flare < 0.02 && !embers.length && !bolts.length;
      if (!calm) raf = requestAnimationFrame(frame);
      else { cells.fill(0); ctx.clearRect(0, 0, W, SH); if (arcsDrawn) { actx.clearRect(0, 0, W, H); arcsDrawn = false; } }
      // its own cost: this frame's time on the main thread, summed over a second
      const end = performance.now();
      if (!win.t) win = { t: t0, frames: 0, ms: 0, parts: win.parts };
      win.frames++; win.ms += end - t0; stats.frames++;
      if (end - win.t >= 1000) {
        const span = end - win.t;
        const parts = NO_PARTS();
        for (const k of Object.keys(parts) as Part[]) parts[k] = win.parts[k] / win.frames;
        Object.assign(stats, { fps: win.frames * 1000 / span, msPerFrame: win.ms / win.frames, share: win.ms / span, parts });
        win = { t: end, frames: 0, ms: 0, parts: NO_PARTS() };
      }
      if (calm) { Object.assign(stats, { asleep: true, fps: 0, share: 0 }); win = { t: 0, frames: 0, ms: 0, parts: NO_PARTS() }; }
    };
    const wake = () => { if (reduced) { still(); return; } if (!raf && enabled && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const offPulse = onPulse((s) => { if (s && enabled && !reduced && !document.hidden) strike(s); wake(); });
    const offLimits = onLimits(() => { enabled = stats.on = getLimits().fire; if (!enabled) { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, SH); actx.clearRect(0, 0, W, H); arcsDrawn = false; } else wake(); });
    const onVis = () => wake();
    const onResize = () => { resize(); wake(); };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('resize', onResize);
    // a surge that happened before the page drew (the model opened while loading) still shows
    recentSurges(300).forEach(strike);
    wake();
    return () => { cancelAnimationFrame(raf); offPulse(); offLimits(); document.removeEventListener('visibilitychange', onVis); removeEventListener('resize', onResize); };
  }, []);
  return <><canvas ref={ref} className="cs-fire" aria-hidden /><canvas ref={arcRef} className="cs-arcs" aria-hidden /></>;
}
