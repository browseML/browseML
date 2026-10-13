// SPDX-License-Identifier: MIT OR Apache-2.0
//! overlord_dsp.py, line for line, for the stages the proof of concept covers:
//!
//!   bit-exact targets (no FFT inside; same operations in the same order as the numba-compiled reference):
//!     `wsola` (overlord_dsp._wsola), `dtw` (overlord_dsp._dtw), `interp_arange` + `linspace` (np.interp over
//!     np.arange, np.linspace), `pitch_shift` (resample + WSOLA);
//!   SNR targets (go through an FFT, whose butterfly order differs from pocketfft's):
//!     `fft_filter`, `fundamental`, `lowpass`, `envelope`, `voiced_gate`, `analytic`, `harmonic_overtones`,
//!     `octave_divider` — and for the divider the zero-crossing events themselves are held EXACTLY, since a single
//!     moved crossing flips the square for a whole cycle.
//!
//! No `mul_add` anywhere: the reference has no FMA contraction (numba without fastmath, numpy), so neither does this.

use crate::fft::{dft, RealPlan, C};
use std::f64::consts::PI;

/// numpy's hanning (and numba's np_hanning_impl): 0.5 + 0.5*cos(pi*n/(M-1)), n = 1-M, 3-M, ..., M-1.
pub fn hanning(m: usize) -> Vec<f64> {
    if m == 0 {
        return vec![];
    }
    if m == 1 {
        return vec![1.0];
    }
    let d = (m - 1) as f64;
    (0..m)
        .map(|i| {
            let n = (1 - m as i64 + 2 * i as i64) as f64;
            0.5 + 0.5 * (PI * n / d).cos()
        })
        .collect()
}

/// overlord_dsp._wsola: overlap-add `x` read at `pos` (one per output sample) - time moves, pitch stays.
pub fn wsola(x: &[f64], pos: &[f64], win: usize, hop: usize, tol: usize) -> Vec<f64> {
    wsola_with_window(x, pos, &hanning(win), hop, tol)
}

/// WSOLA with the window supplied. WHY: the window is the only libm result (cos) that reaches WSOLA's argmax, and an
/// argmax is discontinuous - one ulp in one window value can pick a different segment, after which every later choice
/// diverges (measured on wasm32: libm's cos moved 14 of 704 window values by an ulp and pitch_shift fell to -1.3 dB
/// SNR against the reference). Passing the reference's own window bits makes the result target-independent.
pub fn wsola_with_window(x: &[f64], pos: &[f64], w: &[f64], hop: usize, tol: usize) -> Vec<f64> {
    let win = w.len();
    let n_out = pos.len();
    let lx = x.len() as i64;
    let mut out = vec![0.0f64; n_out + win];
    let mut norm = vec![0.0f64; n_out + win];
    let (wi, tol) = (win as i64, tol as i64);
    let mut prev: i64 = -1;
    let mut t = 0usize;
    while t < n_out {
        let target = (pos[t] as i64) - wi / 2; // int() truncates toward zero; pos >= 0
        let mut best = target;
        if prev >= 0 {
            let nat = prev + hop as i64;
            let mut bestc = -1e18f64;
            for d in -tol..=tol {
                let s = target + d;
                if s < 0 || s + wi > lx || nat < 0 || nat + wi > lx {
                    continue;
                }
                let (xs, xn) = (&x[s as usize..(s + wi) as usize], &x[nat as usize..(nat + wi) as usize]);
                let mut c = 0.0f64;
                let mut q = 0;
                while q < win {
                    c += xs[q] * xn[q];
                    q += 4;
                }
                if c > bestc {
                    bestc = c;
                    best = s;
                }
            }
        }
        if best < 0 {
            best = 0;
        }
        if best + wi > lx {
            best = lx - wi;
        }
        if best < 0 {
            break;
        }
        let b = best as usize;
        let (o, nm) = (&mut out[t..t + win], &mut norm[t..t + win]);
        let xs = &x[b..b + win];
        for q in 0..win {
            o[q] += xs[q] * w[q];
            nm[q] += w[q];
        }
        prev = best;
        t += hop;
    }
    for q in 0..out.len() {
        if norm[q] > 1e-3 {
            out[q] /= norm[q];
        }
    }
    out[win / 2..win / 2 + n_out].to_vec()
}

/// overlord_dsp.warp: WSOLA with the reference's window (32 ms), hop (win/4) and tolerance (8 ms).
pub fn warp(x: &[f64], pos: &[f64], sr: usize) -> Vec<f64> {
    let win = ((0.032 * sr as f64) as usize) / 2 * 2;
    wsola(x, pos, win, win / 4, (0.008 * sr as f64) as usize)
}

/// overlord_dsp._dtw on a row-major n x m cost matrix: the path (pi, pj), exactly as the reference backtracks it.
pub fn dtw(cost: &[f64], n: usize, m: usize) -> (Vec<i64>, Vec<i64>) {
    let w = m + 1;
    let mut d = vec![f64::INFINITY; (n + 1) * w];
    d[0] = 0.0;
    for i in 1..=n {
        let (above, row) = d.split_at_mut(i * w);
        let above = &above[(i - 1) * w..];
        let row = &mut row[..w];
        let crow = &cost[(i - 1) * m..i * m];
        for j in 1..=m {
            let c = crow[j - 1];
            let mut best = above[j - 1];
            if above[j] < best {
                best = above[j];
            }
            if row[j - 1] < best {
                best = row[j - 1];
            }
            row[j] = c + best;
        }
    }
    let (mut i, mut j) = (n, m);
    let (mut pi, mut pj) = (Vec::with_capacity(n + m), Vec::with_capacity(n + m));
    while i > 0 && j > 0 {
        pi.push(i as i64 - 1);
        pj.push(j as i64 - 1);
        let (a, b, c) = (d[(i - 1) * w + j - 1], d[(i - 1) * w + j], d[i * w + j - 1]);
        if a <= b && a <= c {
            i -= 1;
            j -= 1;
        } else if b <= c {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    pi.reverse();
    pj.reverse();
    (pi, pj)
}

/// np.linspace(start, stop, num) (endpoint=True): i*step + start, the last set to stop.
pub fn linspace(start: f64, stop: f64, num: usize) -> Vec<f64> {
    if num == 0 {
        return vec![];
    }
    let div = num as i64 - 1;
    let delta = stop - start;
    let mut y: Vec<f64> = (0..num).map(|i| i as f64).collect();
    if div > 0 {
        let step = delta / div as f64;
        if step == 0.0 {
            for v in y.iter_mut() {
                *v = *v / div as f64 * delta;
            }
        } else {
            for v in y.iter_mut() {
                *v *= step;
            }
        }
    } else {
        for v in y.iter_mut() {
            *v *= delta;
        }
    }
    for v in y.iter_mut() {
        *v += start;
    }
    if num > 1 {
        y[num - 1] = stop;
    }
    y
}

/// np.interp(xs, np.arange(len(fp)), fp): numpy's compiled arr_interp for an integer grid (the bracketing index is
/// floor(x); slope = (fp[j+1]-fp[j]) / 1.0; result = slope*(x - j) + fp[j]; exact hits return fp[j]).
pub fn interp_arange(xs: &[f64], fp: &[f64]) -> Vec<f64> {
    let n = fp.len();
    let last = (n - 1) as f64;
    xs.iter()
        .map(|&x| {
            if x > last {
                fp[n - 1]
            } else if x < 0.0 {
                fp[0]
            } else {
                let j = x.floor() as usize;
                if j == n - 1 {
                    fp[j]
                } else if (j as f64) == x {
                    fp[j]
                } else {
                    let slope = (fp[j + 1] - fp[j]) / (((j + 1) as f64) - (j as f64));
                    let r = slope * (x - j as f64) + fp[j];
                    if r.is_nan() {
                        slope * (x - (j + 1) as f64) + fp[j + 1]
                    } else {
                        r
                    }
                }
            }
        })
        .collect()
}

/// overlord_dsp.pitch_shift: resample (pitch x r, length / r), then WSOLA back onto the original clock.
pub fn pitch_shift(x: &[f64], sr: usize, semitones: f64) -> Vec<f64> {
    let r = 2.0f64.powf(semitones / 12.0);
    let n = round_half_even(x.len() as f64 / r) as usize;
    let y = interp_arange(&linspace(0.0, (x.len() - 1) as f64, n), x);
    let den = std::cmp::max(1, x.len() - 1) as f64;
    let pos: Vec<f64> = (0..x.len()).map(|i| ((i * (n - 1)) as f64) / den).collect();
    warp(&y, &pos, sr)
}

fn round_half_even(v: f64) -> f64 {
    let r = v.round();
    if (v - v.trunc()).abs() == 0.5 {
        2.0 * (v / 2.0).round()
    } else {
        r
    }
}

/// overlord_dsp.fft_filter: zero-phase EQ by a gain curve over frequency, whole signal, n = next pow2 >= len+1.
pub fn fft_filter(x: &[f64], sr: usize, gain_of_hz: impl Fn(f64) -> f64) -> Vec<f64> {
    let n = (x.len() + 1).next_power_of_two().max(2);
    let plan = RealPlan::new(n);
    let mut xk = Vec::new();
    plan.forward(x, &mut xk);
    // np.fft.rfftfreq(n, 1.0/sr): k * (1.0 / (n * (1.0/sr)))
    let val = 1.0 / (n as f64 * (1.0 / sr as f64));
    for (k, v) in xk.iter_mut().enumerate() {
        let g = gain_of_hz(k as f64 * val);
        *v = C::new(v.re * g, v.im * g);
    }
    let mut y = Vec::new();
    plan.inverse(&xk, &mut y);
    y.truncate(x.len());
    y
}

pub fn lowpass(x: &[f64], sr: usize, fc: f64, width: f64) -> Vec<f64> {
    fft_filter(x, sr, |f| 0.5 * (1.0 - ((f - fc) / width).tanh()))
}

pub fn fundamental(x: &[f64], sr: usize) -> Vec<f64> {
    let (lo, hi) = (60.0, 300.0);
    fft_filter(x, sr, |f| 0.5 * (1.0 + ((f - lo) / 15.0).tanh()) * 0.5 * (1.0 - ((f - hi) / 40.0).tanh()))
}

pub fn envelope(x: &[f64], sr: usize, fc: f64) -> Vec<f64> {
    let sq: Vec<f64> = x.iter().map(|&v| 2.0 * v * v).collect();
    lowpass(&sq, sr, fc, 10.0).into_iter().map(|v| v.max(0.0).sqrt()).collect()
}

/// np.percentile(a, q) with numpy's default 'linear' method, including its two-sided lerp.
pub fn percentile(a: &[f64], q: f64) -> f64 {
    let mut s = a.to_vec();
    s.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let n = s.len() as f64;
    let qq = q / 100.0;
    let virt = n * qq + (1.0 + qq * (1.0 - 1.0 - 1.0)) - 1.0;
    let virt = virt.clamp(0.0, n - 1.0);
    let lo = virt.floor();
    let t = virt - lo;
    let (i0, i1) = (lo as usize, ((lo as usize) + 1).min(s.len() - 1));
    let (a0, b0) = (s[i0], s[i1]);
    let diff = b0 - a0;
    if t >= 0.5 {
        b0 - diff * (1.0 - t)
    } else {
        a0 + diff * t
    }
}

pub fn voiced_gate(env: &[f64], rel: f64, knee: f64) -> Vec<f64> {
    let mut r = percentile(env, 95.0);
    if r == 0.0 {
        r = 1.0;
    }
    env.iter().map(|&e| ((e / r - rel) / knee).clamp(0.0, 1.0)).collect()
}

/// overlord_dsp.analytic: x + i*H(x) by a full-length FFT.
pub fn analytic(x: &[f64]) -> Vec<C> {
    let n = x.len();
    let xc: Vec<C> = x.iter().map(|&v| C::new(v, 0.0)).collect();
    let mut xk = dft(&xc, false);
    let mut h = vec![0.0f64; n];
    h[0] = 1.0;
    if n % 2 == 0 {
        h[n / 2] = 1.0;
        for v in h.iter_mut().take(n / 2).skip(1) {
            *v = 2.0;
        }
    } else {
        for v in h.iter_mut().take((n + 1) / 2).skip(1) {
            *v = 2.0;
        }
    }
    for (v, g) in xk.iter_mut().zip(h.iter()) {
        *v = v.scale(*g);
    }
    dft(&xk, true)
}

pub fn harmonic_overtones(x: &[f64], sr: usize, orders: &[u32], gains: &[f64]) -> Vec<f64> {
    let xf = fundamental(x, sr);
    let z = analytic(&xf);
    let env = envelope(&xf, sr, 30.0);
    let gate = voiced_gate(&env, 0.08, 0.04);
    let mut out = vec![0.0f64; x.len()];
    let theta: Vec<f64> = z.iter().map(|c| c.im.atan2(c.re)).collect();
    for (&n, &g) in orders.iter().zip(gains.iter()) {
        let nf = n as f64;
        for (o, &t) in out.iter_mut().zip(theta.iter()) {
            *o += g * (nf * t).cos();
        }
    }
    for i in 0..out.len() {
        let mag = z[i].re.hypot(z[i].im);
        out[i] = out[i] * mag * gate[i];
    }
    fft_filter(&out, sr, |f| 0.5 * (1.0 + ((f - 150.0) / 30.0).tanh()))
}

/// The positive-going zero crossings of the fundamental while voiced, every `divide/2`-th (the divider's flips).
pub fn crossings(xf: &[f64], gate: &[f64], divide: usize) -> Vec<i64> {
    let step = std::cmp::max(1, divide / 2);
    let up: Vec<i64> =
        (1..xf.len()).filter(|&i| xf[i - 1] < 0.0 && xf[i] >= 0.0 && gate[i] > 0.5).map(|i| i as i64).collect();
    up.into_iter().step_by(step).collect()
}

pub fn octave_divider(x: &[f64], sr: usize, divide: usize, lowpass_hz: f64) -> Vec<f64> {
    let xf = fundamental(x, sr);
    let env = envelope(&xf, sr, 30.0);
    let gate = voiced_gate(&env, 0.08, 0.04);
    let flips = crossings(&xf, &gate, divide);
    let mut q = vec![0.0f64; x.len()];
    let (mut k, mut parity) = (0usize, 0u64);
    for i in 0..x.len() {
        while k < flips.len() && flips[k] as usize == i {
            parity += 1;
            k += 1;
        }
        let s = if parity % 2 == 0 { 1.0 } else { -1.0 };
        q[i] = s * env[i] * gate[i];
    }
    lowpass(&q, sr, lowpass_hz, 40.0)
}
