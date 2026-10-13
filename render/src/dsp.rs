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

use crate::fft::{dft, real_plan, C};


/// numpy's hanning (and numba's np_hanning_impl): 0.5 + 0.5*cos(pi*n/(M-1)), n = 1-M, 3-M, ..., M-1.
pub fn hanning(m: usize) -> Vec<f64> {
    if m == 0 {
        return vec![];
    }
    if m == 1 {
        return vec![1.0];
    }
    // cos from xmath: glibc's bits on every target (the window reaches WSOLA's argmax; see xmath.rs)
    (0..m).map(|i| 0.5 + 0.5 * crate::xmath::hann_cos(m, 1 - m as i64 + 2 * i as i64)).collect()
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
    let mut corr = vec![0.0f64; 2 * tol as usize + 1];
    while t < n_out {
        let target = (pos[t] as i64) - wi / 2; // int() truncates toward zero; pos >= 0
        let mut best = target;
        if prev >= 0 {
            let nat = prev + hop as i64;
            if nat >= 0 && nat + wi <= lx {
                // the candidates that pass the reference's bounds test form one run of d
                let dlo = (-tol).max(-target);
                let dhi = tol.min(lx - wi - target);
                if dlo <= dhi {
                    let nc = (dhi - dlo + 1) as usize;
                    corr[..nc].iter_mut().for_each(|c| *c = 0.0);
                    let base = (target + dlo) as usize;
                    correlations(x, base, nat as usize, win, &mut corr[..nc]);
                    // argmax in the reference's order: ascending d, strictly greater, from -1e18
                    let mut bestc = -1e18f64;
                    for (k, &c) in corr[..nc].iter().enumerate() {
                        if c > bestc {
                            bestc = c;
                            best = target + dlo + k as i64;
                        }
                    }
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

/// corr[k] = sum over q = 0, 4, 8, .. < win of x[base + k + q] * x[nat + q], each sum in the reference's order
/// (q ascending, from 0.0, multiply then add). The candidates run in SIMD lanes - lane k is candidate k - so no
/// sum is ever split or reassociated: every lane performs exactly the scalar loop's operations, and the result is
/// the same bits (tests/golden.rs: WSOLA and pitch_shift bit-exact on x86-64 SSE2/AVX and wasm32 +-simd128).
#[inline(always)]
fn correlations_body(x: &[f64], base: usize, nat: usize, win: usize, corr: &mut [f64]) {
    let nc = corr.len();
    let mut q = 0;
    while q < win {
        let xn = x[nat + q];
        let xs = &x[base + q..base + q + nc];
        for (c, &v) in corr.iter_mut().zip(xs) {
            *c += v * xn;
        }
        q += 4;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx")]
unsafe fn correlations_avx(x: &[f64], base: usize, nat: usize, win: usize, corr: &mut [f64]) {
    correlations_body(x, base, nat, win, corr)
}

fn correlations(x: &[f64], base: usize, nat: usize, win: usize, corr: &mut [f64]) {
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx") {
            return unsafe { correlations_avx(x, base, nat, win, corr) };
        }
    }
    correlations_body(x, base, nat, win, corr)
}

/// Iteration 1's WSOLA loop, scalar, kept as the reference the lane-parallel search is held to.
pub fn wsola_scalar(x: &[f64], pos: &[f64], w: &[f64], hop: usize, tol: usize) -> Vec<f64> {
    let win = w.len();
    let n_out = pos.len();
    let lx = x.len() as i64;
    let mut out = vec![0.0f64; n_out + win];
    let mut norm = vec![0.0f64; n_out + win];
    let (wi, tol) = (win as i64, tol as i64);
    let mut prev: i64 = -1;
    let mut t = 0usize;
    while t < n_out {
        let target = (pos[t] as i64) - wi / 2;
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
        for q in 0..win {
            out[t + q] += x[b + q] * w[q];
            norm[t + q] += w[q];
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
    let r = crate::xmath::semitone_ratio(semitones); // 2.0 ** (semitones / 12.0), glibc's bits on every target
    let n = round_half_even(x.len() as f64 / r) as usize;
    let y = interp_arange(&linspace(0.0, (x.len() - 1) as f64, n), x);
    let den = std::cmp::max(1, x.len() - 1) as f64;
    // np.arange(len(x)) * (n - 1) is int64: i * (n - 1) reaches ~1e10 per sentence, past a 32-bit usize (wasm32),
    // so the product is taken in u64 on every target (iteration 1 wrapped it on wasm32 - half its pitch_shift miss)
    let pos: Vec<f64> = (0..x.len() as u64).map(|i| ((i * (n as u64 - 1)) as f64) / den).collect();
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
    let plan = real_plan(n);
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
    let env = envelope(&xf, sr, 30.0);
    let gate = voiced_gate(&env, 0.08, 0.04);
    harmonic_overtones_from(&xf, &gate, sr, orders, gains)
}

/// harmonic_overtones given the body's fundamental and voiced gate (the envelope enters only through the gate).
pub fn harmonic_overtones_from(xf: &[f64], gate: &[f64], sr: usize, orders: &[u32], gains: &[f64]) -> Vec<f64> {
    let z = analytic(xf);
    let mut out = vec![0.0f64; xf.len()];
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
    octave_divider_from(&xf, &env, &gate, sr, divide, lowpass_hz)
}

/// octave_divider given the body's fundamental, its envelope and the voiced gate.
pub fn octave_divider_from(xf: &[f64], env: &[f64], gate: &[f64], sr: usize, divide: usize, lowpass_hz: f64) -> Vec<f64> {
    let flips = crossings(xf, gate, divide);
    let mut q = vec![0.0f64; xf.len()];
    let (mut k, mut parity) = (0usize, 0u64);
    for i in 0..xf.len() {
        while k < flips.len() && flips[k] as usize == i {
            parity += 1;
            k += 1;
        }
        let s = if parity % 2 == 0 { 1.0 } else { -1.0 };
        q[i] = s * env[i] * gate[i];
    }
    lowpass(&q, sr, lowpass_hz, 40.0)
}

/// The three v4 layers of one body - octave f/2, double octave f/4, overtones - from ONE fundamental, envelope and
/// gate. The reference computes those three times (once inside each layer); the results are the same bits, since
/// each layer only reads them. Returns (octave, double, overtones).
pub fn layers(body: &[f64], sr: usize, p: &Params) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let xf = fundamental(body, sr);
    let env = envelope(&xf, sr, 30.0);
    let gate = voiced_gate(&env, 0.08, 0.04);
    (
        octave_divider_from(&xf, &env, &gate, sr, 2, p.octave_lowpass_hz),
        octave_divider_from(&xf, &env, &gate, sr, 4, p.double_lowpass_hz),
        harmonic_overtones_from(&xf, &gate, sr, &p.overtone_orders, &p.overtone_weights),
    )
}

// ── the rest of the v4 sentence (render_overlord.py's loop body) ─────────────────────────────────────────────

pub const HOP: usize = 220; // overlord_dsp.HOP: 10 ms at 22 050 Hz
pub const NFFT: usize = 1024; // overlord_dsp.NFFT

/// overlord_dsp.low_shelf.
pub fn low_shelf(x: &[f64], sr: usize, fc: f64, db: f64) -> Vec<f64> {
    let g = 10.0f64.powf(db / 20.0);
    fft_filter(x, sr, |f| 1.0 + (g - 1.0) / (1.0 + (f / fc).powf(4.0)))
}

/// overlord_dsp.exciter with its defaults (lo 2500, hi 6000, drive 3, mix 0.14).
pub fn exciter(x: &[f64], sr: usize) -> Vec<f64> {
    let (lo, hi, drive, mix) = (2500.0f64, 6000.0f64, 3.0f64, 0.14f64);
    let band = fft_filter(x, sr, |f| 0.5 * (1.0 + ((f - lo) / 300.0).tanh()) * 0.5 * (1.0 - ((f - hi) / 800.0).tanh()));
    let td = drive.tanh();
    let sat: Vec<f64> = band.iter().map(|&b| (b * drive).tanh() / td).collect();
    let hp = fft_filter(&sat, sr, |f| 0.5 * (1.0 + ((f - lo) / 300.0).tanh()));
    x.iter().zip(hp.iter()).map(|(&a, &h)| a + mix * h).collect()
}

/// numpy's pairwise summation of a contiguous float64 run (add.reduce's inner loop), from 0.0.
pub fn pairwise_sum(a: &[f64]) -> f64 {
    let n = a.len();
    if n < 8 {
        let mut r = 0.0;
        for &v in a {
            r += v;
        }
        r
    } else if n <= 128 {
        let mut r = [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]];
        let mut i = 8;
        while i < n - (n % 8) {
            for k in 0..8 {
                r[k] += a[i + k];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        pairwise_sum(&a[..n2]) + pairwise_sum(&a[n2..])
    }
}

/// The mel filterbank's bin edges, floor((nfft+1) * imel(linspace(mel(60), mel(7600), 42)) / sr). These integers
/// decide the bank, and they come from log10 and pow: tests/sentence.rs checks them against numpy's and checks
/// that each lies far (> 1e-9) from an integer boundary, so no last-bit difference in a libm can move one.
pub fn mel_bins(sr: usize) -> Vec<i64> {
    mel_points(sr).iter().map(|v| v.floor() as i64).collect()
}

/// (nfft+1) * pts / sr before the floor (exposed for the margin test).
pub fn mel_points(sr: usize) -> Vec<f64> {
    let mel = |f: f64| 2595.0 * (1.0 + f / 700.0).log10();
    let imel = |m: f64| 700.0 * (10.0f64.powf(m / 2595.0) - 1.0);
    linspace(mel(60.0), mel(7600.0), 42).into_iter().map(|m| ((NFFT + 1) as f64) * imel(m) / sr as f64).collect()
}

/// The 40 triangular filters as (first bin, weights), exactly overlord_dsp._mel_bank's nonzero entries.
pub fn mel_bank(sr: usize) -> Vec<(usize, Vec<f64>)> {
    let bins = mel_bins(sr);
    (0..40)
        .map(|i| {
            let (a, b, c) = (bins[i], bins[i + 1], bins[i + 2]);
            let mut wts = vec![];
            if b > a {
                for k in a..b {
                    wts.push(((k - a) as f64) / ((b - a) as f64));
                }
            } else {
                // the bank row starts at b when the rising edge is empty
            }
            let start = if b > a { a } else { b };
            if c > b {
                for k in b..c {
                    wts.push(((c - k) as f64) / ((c - b) as f64));
                }
            }
            (start as usize, wts)
        })
        .collect()
}

/// overlord_dsp.logmel: frames x 40, row-major. Cepstral-mean normalised, rows unit-norm.
pub fn logmel(x: &[f64], bank: &[(usize, Vec<f64>)]) -> (Vec<f64>, usize) {
    let nf = 1 + (x.len().saturating_sub(NFFT)) / HOP;
    let w = hanning(NFFT);
    let plan = real_plan(NFFT);
    let mut f = vec![0.0f64; nf * 40];
    let (mut buf, mut xk) = (vec![0.0f64; NFFT], Vec::with_capacity(NFFT / 2 + 1));
    let mut spec = vec![0.0f64; NFFT / 2 + 1];
    for i in 0..nf {
        let s = i * HOP;
        for q in 0..NFFT {
            buf[q] = if s + q < x.len() { x[s + q] * w[q] } else { 0.0 * w[q] };
        }
        plan.forward(&buf, &mut xk);
        for k in 0..spec.len() {
            let a = xk[k].re.hypot(xk[k].im); // np.abs(complex) is hypot; ** 2 is a square
            spec[k] = a * a;
        }
        let row = &mut f[i * 40..(i + 1) * 40];
        for (m, (start, wts)) in bank.iter().enumerate() {
            let mut acc = 0.0f64;
            for (t, &wt) in wts.iter().enumerate() {
                acc += spec[start + t] * wt;
            }
            row[m] = (acc + 1e-8).ln();
        }
    }
    // f -= f.mean(axis=0): numpy reduces axis 0 row by row (sequential per column), then divides by nf
    let mut mean = [0.0f64; 40];
    for i in 0..nf {
        for m in 0..40 {
            mean[m] += f[i * 40 + m];
        }
    }
    for m in 0..40 {
        mean[m] /= nf as f64;
    }
    let mut sq = [0.0f64; 40];
    for i in 0..nf {
        let row = &mut f[i * 40..(i + 1) * 40];
        for m in 0..40 {
            row[m] -= mean[m];
            sq[m] = row[m] * row[m];
        }
        let nrm = pairwise_sum(&sq).sqrt() + 1e-8;
        for v in row.iter_mut() {
            *v /= nrm;
        }
    }
    (f, nf)
}

/// 1 - fr @ fo.T (row-major nr x no). Each entry is summed over the 40 mel bands in order (numpy's matmul goes to
/// BLAS, whose order is its own: this is an E1 stage, judged by the DTW path it yields). Columns run in SIMD lanes
/// (fo is transposed so lane j reads band m of frame j contiguously); no sum is split.
pub fn cosine_cost(fr: &[f64], nr: usize, fo: &[f64], no: usize) -> Vec<f64> {
    let mut ft = vec![0.0f64; 40 * no];
    for j in 0..no {
        for m in 0..40 {
            ft[m * no + j] = fo[j * 40 + m];
        }
    }
    let mut c = vec![0.0f64; nr * no];
    for i in 0..nr {
        cost_row(&fr[i * 40..(i + 1) * 40], &ft, &mut c[i * no..(i + 1) * no]);
    }
    c
}

#[inline(always)]
fn cost_row_body(a: &[f64], ft: &[f64], row: &mut [f64]) {
    let no = row.len();
    row.iter_mut().for_each(|v| *v = 0.0);
    for m in 0..40 {
        let am = a[m];
        for (r, &b) in row.iter_mut().zip(&ft[m * no..(m + 1) * no]) {
            *r += am * b;
        }
    }
    row.iter_mut().for_each(|v| *v = 1.0 - *v);
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx")]
unsafe fn cost_row_avx(a: &[f64], ft: &[f64], row: &mut [f64]) {
    cost_row_body(a, ft, row)
}

fn cost_row(a: &[f64], ft: &[f64], row: &mut [f64]) {
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("avx") {
            return unsafe { cost_row_avx(a, ft, row) };
        }
    }
    cost_row_body(a, ft, row)
}

/// np.interp(x, xp, fp, left, right) for increasing xp: numpy's arr_interp (slopes, exact-hit and NaN rules).
pub fn interp(xs: &[f64], xp: &[f64], fp: &[f64], left: f64, right: f64) -> Vec<f64> {
    let n = xp.len();
    let slopes: Vec<f64> = (0..n.saturating_sub(1)).map(|i| (fp[i + 1] - fp[i]) / (xp[i + 1] - xp[i])).collect();
    xs.iter()
        .map(|&x| {
            if x.is_nan() {
                return x;
            }
            if x < xp[0] {
                return left;
            }
            if x > xp[n - 1] {
                return right;
            }
            // j: xp[j] <= x < xp[j+1], or n-1 when x == xp[n-1]
            let j = xp.partition_point(|&v| v <= x) - 1;
            if j == n - 1 || xp[j] == x {
                return fp[j];
            }
            let r = slopes[j] * (x - xp[j]) + fp[j];
            if r.is_nan() {
                let r2 = slopes[j] * (x - xp[j + 1]) + fp[j + 1];
                if r2.is_nan() && fp[j] == fp[j + 1] { fp[j] } else { r2 }
            } else {
                r
            }
        })
        .collect()
}

/// How the 7-tap smoothing in align_map sums (np.convolve -> a dot product per output: numpy hands contiguous
/// runs to BLAS ddot, whose kernel may contract into FMA). Chosen by tests/sentence.rs against the reference.
pub const SMOOTH_FMA: bool = false;

fn dot7(a: &[f64], k: &[f64; 7]) -> f64 {
    let mut d = 0.0f64;
    for t in 0..7 {
        d = if SMOOTH_FMA { a[t].mul_add(k[t], d) } else { d + a[t] * k[t] };
    }
    0.0 + d
}

/// overlord_dsp.align_map (smooth = 7) given the DTW path of the two takes' log-mel frames.
pub fn align_map_from_path(n_ref: usize, n_other: usize, nfr: usize, pi: &[i64], pj: &[i64]) -> Vec<f64> {
    let mut jm = vec![0.0f64; nfr];
    let mut cnt = vec![0.0f64; nfr];
    for (&i, &j) in pi.iter().zip(pj.iter()) {
        jm[i as usize] += j as f64;
        cnt[i as usize] += 1.0;
    }
    for i in 0..nfr {
        jm[i] /= cnt[i].max(1.0);
    }
    let smooth = 7usize;
    let mut k = [0.0f64; 7];
    k.copy_from_slice(&hanning(smooth));
    let mut ks = 0.0;
    for &v in &k {
        ks += v;
    }
    for v in k.iter_mut() {
        *v /= ks;
    }
    let mut kr = k;
    kr.reverse(); // np.convolve(a, v) = correlate(a, v[::-1])
    let mut padded = Vec::with_capacity(nfr + 2 * smooth);
    padded.extend(std::iter::repeat(jm[0]).take(smooth));
    padded.extend_from_slice(&jm);
    padded.extend(std::iter::repeat(jm[nfr - 1]).take(smooth));
    // mode "same" on len L+14 with 7 taps: output i is centred (offset 3); keep outputs smooth..smooth+L
    let mut sm = vec![0.0f64; nfr];
    for i in 0..nfr {
        let c = i + smooth;
        sm[i] = dot7(&padded[c - 3..c + 4], &kr);
    }
    let mut run = f64::NEG_INFINITY;
    for v in sm.iter_mut() {
        if *v > run || run.is_nan() {
            run = *v;
        }
        *v = run;
    }
    let t_ref: Vec<f64> = (0..nfr).map(|i| (i * HOP) as f64 + (NFFT / 2) as f64).collect();
    let t_other: Vec<f64> = sm.iter().map(|&v| v * HOP as f64 + (NFFT / 2) as f64).collect();
    let xs: Vec<f64> = (0..n_ref).map(|i| i as f64).collect();
    interp(&xs, &t_ref, &t_other, 0.0, (n_other - 1) as f64)
}

/// The log-mel DTW path of two takes: (pi, pj, frames of ref, frames of other).
pub fn mel_path(r: &[f64], o: &[f64], bank: &[(usize, Vec<f64>)]) -> (Vec<i64>, Vec<i64>, usize, usize) {
    let (fr, nr) = logmel(r, bank);
    mel_path_from(&fr, nr, o, bank)
}

/// mel_path given the reference's log-mel frames (align_map and residual_lag_ms both analyse the same body take:
/// the reference computes its frames twice per sentence; they are the same bits).
pub fn mel_path_from(fr: &[f64], nr: usize, o: &[f64], bank: &[(usize, Vec<f64>)]) -> (Vec<i64>, Vec<i64>, usize, usize) {
    let (fo, no) = logmel(o, bank);
    let (pi, pj) = dtw(&cosine_cost(fr, nr, &fo, no), nr, no);
    (pi, pj, nr, no)
}

fn lag_from_path(pi: &[i64], pj: &[i64], nr: usize, no: usize, sr: usize) -> f64 {
    let scale = ((no - 1) as f64) / (std::cmp::max(1, nr as i64 - 1) as f64);
    let mut d: Vec<f64> = pi.iter().zip(pj.iter()).map(|(&i, &j)| (j as f64 - i as f64 * scale).abs()).collect();
    d.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = d.len();
    let med = if n % 2 == 1 { d[n / 2] } else { (d[n / 2 - 1] + d[n / 2]) / 2.0 };
    med * HOP as f64 / sr as f64 * 1000.0
}

/// overlord_dsp.align_map.
pub fn align_map(r: &[f64], o: &[f64], sr: usize) -> Vec<f64> {
    let bank = mel_bank(sr);
    let (pi, pj, nr, _) = mel_path(r, o, &bank);
    align_map_from_path(r.len(), o.len(), nr, &pi, &pj)
}

/// overlord_dsp.residual_lag_ms (a manifest diagnostic).
pub fn residual_lag_ms(r: &[f64], o: &[f64], sr: usize) -> f64 {
    let bank = mel_bank(sr);
    let (pi, pj, nr, no) = mel_path(r, o, &bank);
    lag_from_path(&pi, &pj, nr, no, sr)
}

/// overlord_dsp.offset_samples (a manifest diagnostic): where `layer`'s envelope best lines up with `ref`'s.
pub fn offset_samples(r: &[f64], layer: &[f64], sr: usize) -> i64 {
    offset_samples_env(&envelope(r, sr, 60.0), layer, sr)
}

/// offset_samples given the reference's 60 Hz envelope.
pub fn offset_samples_env(env_ref: &[f64], layer: &[f64], sr: usize) -> i64 {
    offsets_env(env_ref, &[layer], sr)[0]
}

/// offset_samples of several layers against one reference: its envelope, mean and spectrum are computed once (the
/// reference recomputes them per layer; same bits, since each is a pure function of the body).
pub fn offsets_env(env_ref: &[f64], layers: &[&[f64]], sr: usize) -> Vec<i64> {
    let mut a = env_ref.to_vec();
    let ma = pairwise_sum(&a) / a.len() as f64;
    a.iter_mut().for_each(|v| *v -= ma);
    let m = (sr as f64 * 20.0 / 1000.0) as usize;
    let mut fa = Vec::new();
    let mut plan_n = 0;
    let mut out = vec![];
    for layer in layers {
        let mut b = envelope(layer, sr, 60.0);
        let mb = pairwise_sum(&b) / b.len() as f64;
        b.iter_mut().for_each(|v| *v -= mb);
        let n = (a.len() + b.len()).next_power_of_two();
        let plan = real_plan(n);
        if plan_n != n {
            plan.forward(&a, &mut fa);
            plan_n = n;
        }
        let mut fb = Vec::new();
        plan.forward(&b, &mut fb);
        let prod: Vec<C> = fb.iter().zip(fa.iter()).map(|(x, y)| x.mul(y.conj())).collect();
        let mut c = Vec::new();
        plan.inverse(&prod, &mut c);
        let mut best = (f64::NEG_INFINITY, 0usize);
        for (i, &v) in c[n - m..].iter().chain(c[..m + 1].iter()).enumerate() {
            if v > best.0 {
                best = (v, i);
            }
        }
        out.push(best.1 as i64 - m as i64);
    }
    out
}

/// When the manifest-only diagnostics (residual_lag_ms, offset_samples x3; ~23% of the reference's DSP) run.
/// `Every` is the reference's behaviour and the default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Diagnostics {
    Every,
    /// Only sentence indices divisible by n (n >= 1).
    Sampled(usize),
    Off,
}

impl Diagnostics {
    pub fn runs_at(self, index: usize) -> bool {
        match self {
            Diagnostics::Every => true,
            Diagnostics::Sampled(n) => index % n.max(1) == 0,
            Diagnostics::Off => false,
        }
    }
}

/// render_overlord.py v4's constants (2026-10-12).
#[derive(Clone, Debug)]
pub struct Params {
    pub body_semitones: f64,
    pub over_gain: f64,
    pub octave_gain: f64,
    pub octave_lowpass_hz: f64,
    pub double_gain: f64,
    pub double_lowpass_hz: f64,
    pub overtone_gain: f64,
    pub overtone_orders: Vec<u32>,
    pub overtone_weights: Vec<f64>,
    pub fifth_gain: f64,
    pub fifth_lowpass_hz: f64,
    pub shelf_db: f64,
    pub diagnostics: Diagnostics,
    /// Compute fundamental/envelope/gate once for the three layers (same bits; false = the reference's 3x).
    pub shared_layers: bool,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            body_semitones: -1.0,
            over_gain: 0.42,
            octave_gain: 0.44,
            octave_lowpass_hz: 180.0,
            double_gain: 0.16,
            double_lowpass_hz: 140.0,
            overtone_gain: 0.24,
            overtone_orders: vec![2, 3, 4],
            overtone_weights: vec![1.0, 0.6, 0.35],
            fifth_gain: 0.20,
            fifth_lowpass_hz: 1500.0,
            shelf_db: 5.0,
            diagnostics: Diagnostics::Every,
            shared_layers: true,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Sentence {
    pub mix: Vec<f64>,
    pub residual_lag_ms: Option<f64>,
    /// offset_samples of (octave, double, overtones) against the body.
    pub offsets: Option<[i64; 3]>,
}

/// One OVERLORD v4 sentence, as render_overlord.py's loop body: `a` the body take, `j` the overtone take (both at
/// `sr`), `index` the sentence's position (for sampled diagnostics). Returns the mix before the document finish.
pub fn sentence(a: &[f64], j: &[f64], sr: usize, index: usize, p: &Params) -> Sentence {
    let body = pitch_shift(a, sr, p.body_semitones);
    let mut mix = exciter(&body, sr);
    let mut out = Sentence::default();
    let diag = p.diagnostics.runs_at(index);
    if j.len() >= 2048 && a.len() >= 2048 {
        let bank = mel_bank(sr);
        let (fr, nr) = logmel(a, &bank); // shared by align_map and residual_lag_ms (same take, same bits)
        let (pi, pj, _, _) = mel_path_from(&fr, nr, j, &bank);
        let jw = warp(j, &align_map_from_path(a.len(), j.len(), nr, &pi, &pj), sr);
        if diag {
            let (pi, pj, nr, no) = mel_path_from(&fr, nr, &jw, &bank);
            out.residual_lag_ms = Some(lag_from_path(&pi, &pj, nr, no, sr));
        }
        for (m, &v) in mix.iter_mut().zip(jw.iter()) {
            *m += p.over_gain * v;
        }
    }
    if a.len() >= 2048 {
        let (o2, o4, ov) = if p.shared_layers {
            layers(&body, sr, p)
        } else {
            (
                octave_divider(&body, sr, 2, p.octave_lowpass_hz),
                octave_divider(&body, sr, 4, p.double_lowpass_hz),
                harmonic_overtones(&body, sr, &p.overtone_orders, &p.overtone_weights),
            )
        };
        if diag {
            let er = envelope(&body, sr, 60.0);
            let o = offsets_env(&er, &[&o2, &o4, &ov], sr);
            out.offsets = Some([o[0], o[1], o[2]]);
        }
        // mix = mix + OCTAVE_GAIN*octave + DOUBLE_GAIN*double + OVERTONE_GAIN*over: numpy evaluates left to right
        for i in 0..mix.len() {
            mix[i] = ((mix[i] + p.octave_gain * o2[i]) + p.double_gain * o4[i]) + p.overtone_gain * ov[i];
        }
        let fifth = lowpass(&pitch_shift(a, sr, -7.0), sr, p.fifth_lowpass_hz, 250.0);
        for (m, &v) in mix.iter_mut().zip(fifth.iter()) {
            *m += p.fifth_gain * v;
        }
    }
    out.mix = low_shelf(&mix, sr, 180.0, p.shelf_db);
    out
}
