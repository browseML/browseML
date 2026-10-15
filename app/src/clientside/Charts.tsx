// SPDX-License-Identifier: MIT
// The panel's graphs, drawn in SVG here (uPlot's and stats.js's ideas, re-made): what ran, never an estimate.
//   SpeedChart — each answer as a bar of its writing speed (green) with its reading speed as a line (orange), the
//                average writing speed dashed, the scale and the last values labelled; hover a bar for its numbers
//   Trace      — a value over the last minute as a filled line, with its now / min / max
import type { AnswerRecord } from '../bankml/usage';

const GREEN = '#0ECB81', ORANGE = '#F7931A', GRID = 'rgba(148,163,184,.18)', TEXT = '#94a3b8';

export function SpeedChart({ answers, h = 92 }: { answers: AnswerRecord[]; h?: number }) {
  const a = answers.slice(-24), W = 300, pad = { l: 26, r: 6, t: 8, b: 14 };
  if (!a.length) return <div className="cp-chart is-empty">no answers yet: tok/s appear here as you ask</div>;
  const max = Math.max(1, ...a.map(x => Math.max(x.genPerSec, x.promptPerSec))) * 1.1;
  const iw = W - pad.l - pad.r, ih = h - pad.t - pad.b, bw = iw / a.length;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const avg = a.reduce((n, x) => n + x.genPerSec, 0) / a.length, last = a[a.length - 1];
  const line = a.map((x, i) => `${pad.l + bw * (i + 0.5)},${y(x.promptPerSec)}`).join(' ');
  return (
    <figure className="cp-chart">
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label={`writing ${last.genPerSec.toFixed(2)} tok/s, reading ${last.promptPerSec.toFixed(2)} tok/s, over the last ${a.length} answers`}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke={GRID} />
            <text x={pad.l - 4} y={y(max * f) + 3} fill={TEXT} fontSize="8" textAnchor="end">{(max * f).toFixed(f ? 1 : 0)}</text>
          </g>
        ))}
        {a.map((x, i) => (
          <rect key={i} x={pad.l + bw * i + bw * 0.15} width={bw * 0.7} y={y(x.genPerSec)} height={pad.t + ih - y(x.genPerSec)} fill={GREEN} opacity={i === a.length - 1 ? 1 : 0.6} rx="1.5">
            <title>{`answer ${i + 1}: writing ${x.genPerSec.toFixed(2)} tok/s · reading ${x.promptPerSec.toFixed(2)} tok/s · ${x.threads} threads · ${x.completion} tokens`}</title>
          </rect>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(avg)} y2={y(avg)} stroke={GREEN} strokeDasharray="3 3" opacity=".8" />
        {a.length > 1 ? <polyline points={line} fill="none" stroke={ORANGE} strokeWidth="1.5" /> : <circle cx={pad.l + bw / 2} cy={y(last.promptPerSec)} r="2.5" fill={ORANGE} />}
        <text x={pad.l} y={h - 3} fill={TEXT} fontSize="8">{a.length} answer{a.length === 1 ? '' : 's'}</text>
        <text x={W - pad.r} y={h - 3} fill={TEXT} fontSize="8" textAnchor="end">tok/s</text>
      </svg>
      <figcaption>
        <span style={{ color: GREEN }}>■ writing {last.genPerSec.toFixed(2)}</span> <span>avg {avg.toFixed(2)}</span>
        <span style={{ color: ORANGE }}>— reading {last.promptPerSec.toFixed(2)}</span>
      </figcaption>
    </figure>
  );
}

export function Trace({ values, label, unit, color = ORANGE, h = 40, fmt = (v: number) => v.toFixed(0) }: { values: number[]; label: string; unit: string; color?: string; h?: number; fmt?(v: number): string }) {
  const W = 300, v = values.length ? values : [0];
  const max = Math.max(...v, 1e-9), min = Math.min(...v), now = v[v.length - 1];
  const pts = v.map((x, i) => `${(i / Math.max(1, v.length - 1)) * W},${h - 2 - ((x - min) / (max - min || 1)) * (h - 6)}`);
  return (
    <figure className="cp-trace">
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${label} ${fmt(now)} ${unit}`}>
        <polygon points={`0,${h} ${pts.join(' ')} ${W},${h}`} fill={color} opacity=".14" />
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
      <figcaption><b>{fmt(now)}</b> {unit} {label}<span>min {fmt(min)} · max {fmt(max)}</span></figcaption>
    </figure>
  );
}

/** Several live series on one time axis (the monitor's last minute): each scaled to its own maximum (labelled), drawn
 *  as a smooth monotone curve with a faint fill, a legend with the value now, and the values under the pointer.
 *  d3's idioms (scales, a monotone curve, a shared x axis), re-made in a few lines of SVG: no library to download. */
export interface Series { label: string; color: string; values: number[]; unit: string; max?: number; fmt?(v: number): string }
export function MonitorChart({ series, h = 96, seconds = 60 }: { series: Series[]; h?: number; seconds?: number }) {
  const W = 300, pad = { l: 4, r: 4, t: 6, b: 14 }, iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
  const n = Math.max(2, ...series.map(s => s.values.length));
  const x = (i: number, len: number) => pad.l + iw - ((len - 1 - i) / (seconds - 1)) * iw;
  // a monotone cubic (Fritsch–Carlson, as d3.curveMonotoneX): no overshoot between samples
  const path = (pts: [number, number][]) => {
    if (pts.length < 2) return '';
    const m = pts.map((p, i) => {
      const a = pts[i - 1], b = pts[i + 1];
      const d0 = a ? (p[1] - a[1]) / (p[0] - a[0]) : NaN, d1 = b ? (b[1] - p[1]) / (b[0] - p[0]) : NaN;
      if (!a) return d1; if (!b) return d0;
      return d0 * d1 <= 0 ? 0 : (3 * (d0 + d1)) / ((2 * d1 + d0) / d0 + (d1 + 2 * d0) / d1);
    });
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = (x1 - x0) / 3;
      d += `C${x0 + dx},${y0 + dx * m[i]} ${x1 - dx},${y1 - dx * m[i + 1]} ${x1},${y1}`;
    }
    return d;
  };
  const drawn = series.map(s => {
    const v = s.values.slice(-seconds), max = s.max ?? Math.max(1e-9, ...v) * 1.15;
    const pts = v.map((y, i) => [x(i, v.length), pad.t + ih - Math.min(1, y / max) * ih] as [number, number]);
    return { s, v, max, pts, d: path(pts) };
  });
  return (
    <figure className="cp-chart cp-monitor-chart">
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label={series.map(s => `${s.label} ${(s.fmt ?? ((v: number) => v.toFixed(1)))(s.values[s.values.length - 1] ?? 0)} ${s.unit}`).join(', ')}>
        {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + ih * (1 - f)} y2={pad.t + ih * (1 - f)} stroke={GRID} />)}
        {[0, 15, 30, 45].map(t => <text key={t} x={pad.l + iw - (t / (seconds - 1)) * iw} y={h - 3} fill={TEXT} fontSize="8" textAnchor={t ? 'middle' : 'end'}>{t ? `−${t}s` : 'now'}</text>)}
        {drawn.map(({ s, d, pts }) => d && <g key={s.label}>
          <path d={`${d}L${pts[pts.length - 1][0]},${pad.t + ih}L${pts[0][0]},${pad.t + ih}Z`} fill={s.color} opacity=".10" />
          <path d={d} fill="none" stroke={s.color} strokeWidth="1.6" />
        </g>)}
        {Array.from({ length: Math.min(n, seconds) }, (_, i) => {
          const len = Math.min(n, seconds), xi = x(i, len), w = iw / (seconds - 1);
          return <rect key={i} x={xi - w / 2} y={pad.t} width={w} height={ih} fill="transparent">
            <title>{`${len - 1 - i} s ago\n${drawn.map(({ s, v }) => { const val = v[i - (len - v.length)]; return `${s.label}: ${val === undefined ? '—' : (s.fmt ?? ((q: number) => q.toFixed(1)))(val)} ${s.unit}`; }).join('\n')}`}</title>
          </rect>;
        })}
      </svg>
      <figcaption>{drawn.map(({ s, v, max }) => <span key={s.label} style={{ color: s.color }}>— {s.label} {(s.fmt ?? ((q: number) => q.toFixed(1)))(v[v.length - 1] ?? 0)} {s.unit} <small>(scale {(s.fmt ?? ((q: number) => q.toFixed(1)))(max)})</small></span>)}</figcaption>
    </figure>
  );
}
