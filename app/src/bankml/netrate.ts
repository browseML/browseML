// SPDX-License-Identifier: MIT
// Network speed, as networks count it: bits per second, in the unit that fits — b/s, kb/s, Mb/s, Gb/s, Tb/s (powers of
// 1000) — and, for the record, exact to 18 decimals: bits × 10¹⁸ ÷ elapsed microseconds in integer arithmetic (BigInt),
// never a float. The 18 decimals are exact for what was measured; the browser's clock itself is coarser (it rounds
// performance.now() to tens of microseconds), which is the measurement's own precision, not the arithmetic's.

const UNITS = ['b/s', 'kb/s', 'Mb/s', 'Gb/s', 'Tb/s'] as const;

/** A byte rate shown as bits per second in the unit that fits: "2.40 Mb/s", "850 kb/s", "1.20 Gb/s". */
export function fmtRate(bytesPerSec: number): string {
  if (!isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 b/s';
  let v = bytesPerSec * 8, i = 0;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${UNITS[i]}`;
}

/** `bytes` received in `ms` (performance.now's milliseconds), as bits per second exact to 18 decimals: a string. */
export function exactRate(bytes: number, ms: number): string {
  const us = BigInt(Math.max(1, Math.round(ms * 1000)));        // the elapsed time, in whole microseconds as measured
  const scaled = (BigInt(Math.round(bytes)) * 8n * 10n ** 18n * 1_000_000n) / us;  // b/s in units of 10⁻¹⁸
  const s = 10n ** 18n;
  return `${scaled / s}.${(scaled % s).toString().padStart(18, '0')}`;
}
