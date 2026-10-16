// SPDX-License-Identifier: MIT
// SPARKS: the ragebar's own sparks, given to the field's buttons — subtle, yet alive.
//   press      a small burst from the button (8 sparks, about 300 ms), as the rage atlas sparks when it opens
//   working    a slow ember on a button while its work runs (streaming, downloading): .fx-ember
//   done       one candle-green ring when an answer's receipt checks, one red flicker when it does not: .fx-ok / .fx-bad
// One canvas over the page, pointer-transparent, drawn by one requestAnimationFrame loop that stops when no spark is
// left and pauses while the tab is hidden. With reduced motion asked for, or the fire limiter off, there are no sparks:
// colour alone says the same.
import { getLimits } from './limits';

const BUTTONS = '.uif-send, .uif-action, .uif-bar-tool, .uif-tools-toggle, .uif-mode-toggle, .rm-trigger, .rm-item';
const GREEN = [14, 203, 129], ORANGE = [247, 147, 26];
interface Spark { x: number; y: number; vx: number; vy: number; life: number; c: number[] }

let canvas: HTMLCanvasElement | null = null, ctx: CanvasRenderingContext2D | null = null, raf = 0;
let sparks: Spark[] = [];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Sparks are drawn only where motion is welcome and the fire is on. */
export const sparksAllowed = () => !reduced() && getLimits().fire !== false;

function surface() {
  if (canvas) return;
  canvas = Object.assign(document.createElement('canvas'), { className: 'fx-sparks', ariaHidden: 'true' });
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  size();
  addEventListener('resize', size);
}
function size() {
  if (!canvas) return;
  const d = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * d; canvas.height = innerHeight * d;
  ctx?.setTransform(d, 0, 0, d, 0, 0);
}
function frame(t0: number) {
  raf = 0;
  if (!ctx || !canvas || document.hidden) { sparks = []; return; }
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  sparks = sparks.filter(s => (s.life -= 0.055) > 0);
  for (const s of sparks) {
    s.x += s.vx; s.y += s.vy; s.vy += 0.06; s.vx *= 0.97;
    ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${(s.life * 0.9).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, 1.1 + s.life * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  if (sparks.length) raf = requestAnimationFrame(() => frame(t0));
  else ctx.clearRect(0, 0, innerWidth, innerHeight);
}
/** A small burst from an element's centre: green by default, orange for work starting. */
export function burst(el: Element, n = 8, color: 'green' | 'orange' = 'green') {
  if (!sparksAllowed()) return;
  surface();
  const r = el.getBoundingClientRect(), c = color === 'orange' ? ORANGE : GREEN;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 0.8 + Math.random() * 1.6;
    sparks.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 1, c });
  }
  if (sparks.length > 160) sparks = sparks.slice(-160);
  if (!raf) raf = requestAnimationFrame(t => frame(t));
}
/** The ember: a slow glow while work runs (CSS; reduced motion keeps a steady colour). */
export function ember(el: Element | null, on: boolean) { el?.classList.toggle('fx-ember', on); }
/** The outcome: one ring (ok) or one flicker (bad), then gone. */
export function outcome(el: Element | null, ok: boolean) {
  if (!el) return;
  el.classList.remove('fx-ok', 'fx-bad');
  void (el as HTMLElement).offsetWidth;  // restart the one-shot animation
  el.classList.add(ok ? 'fx-ok' : 'fx-bad');
  if (ok) burst(el, 6);
  setTimeout(() => el.classList.remove('fx-ok', 'fx-bad'), 900);
}

let wired = false;
/** Every press on a field button sparks: one listener for the page (buttons come and go). */
export function wireSparks() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('pointerdown', e => {
    const b = (e.target as Element | null)?.closest?.(BUTTONS);
    if (b && !(b as HTMLButtonElement).disabled) burst(b, 8);
  }, true);
}
