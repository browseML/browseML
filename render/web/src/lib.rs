// SPDX-License-Identifier: MIT OR Apache-2.0
//! overlord-dsp-web: the browser module. Plain `extern "C"` exports over wasm linear memory (no wasm-bindgen, no
//! crates), loaded by `overlord-dsp-web.js`. It carries DSP only: no voice model, no phonemiser. In a browser it may
//! be fed only open voices (public-domain / CC0 / CC-BY piper voices such as kristin, bryce, john, norman, cori) or
//! eSpeak; alan, jenny, lessac and anything fine-tuned from lessac never go to a browser (docs/RENDER_RUST.md §3.1).
//!
//! Each function is a port of mindX `utils/docspeech/engines.py` `Layered` (2026-10-13):
//!
//! | export          | reference                                                              |
//! |-----------------|------------------------------------------------------------------------|
//! | `odsp_band`     | `Layered._eq`'s raised-cosine band shape, as a band-pass (gain 1 inside, 0 outside), through overlord-dsp's `fft_filter` |
//! | `odsp_fit`      | `Layered._fit` (np.interp over np.linspace)                            |
//! | `odsp_echo`     | `Layered._echo`                                                        |
//! | `odsp_fall*`    | `Layered._fall`                                                        |
//! | `odsp_softknee` | the end of `Layered.synth`: tanh(0.9x)/tanh(0.9), peak to 0.89          |
//!
//! Buffers are f32 in linear memory (what Web Audio uses); the work is f64 inside, as the crate and numpy work.
//! wasm32's usize is 32 bits: no product here can pass 2^32 for any buffer that fits in linear memory.
//! The build is panic = "abort": every slice is checked for null / length before it is formed.

use overlord_dsp::dsp::{fft_filter, interp_arange, linspace};

// ── the f64 core (what the tests hold) ───────────────────────────────────────────────────────────────

/// The `_eq` band weight at frequency `f` for [lo, hi]: 0 outside, raised-cosine up over [lo, lo+edge], 1 in the
/// core, raised-cosine down over [hi-edge, hi]; edge = max(1, (hi - lo) / 3). Comparisons in `_eq`'s order (the
/// core is tested first, so where the two ramps would overlap the core wins, then the up ramp, then the down).
pub fn band_weight(f: f64, lo: f64, hi: f64) -> f64 {
    let edge = (1.0f64).max((hi - lo) / 3.0);
    let pi = std::f64::consts::PI;
    // _eq assigns core, then up, then dn: a later mask overwrites an earlier one
    let mut w = 0.0;
    if f >= lo + edge && f <= hi - edge {
        w = 1.0;
    }
    if f >= lo && f < lo + edge {
        w = 0.5 - 0.5 * (pi * (f - lo) / edge).cos();
    }
    if f > hi - edge && f <= hi {
        w = 0.5 - 0.5 * (pi * (hi - f) / edge).cos();
    }
    w
}

/// Band-pass `x` to [lo, hi] Hz with `_eq`'s raised-cosine edges, zero-phase, through `fft_filter`
/// (n = next pow2 >= len+1). Shorter than 64 samples, or hi <= lo: returned unchanged (as `_eq`).
pub fn band(x: &[f64], sr: usize, lo: f64, hi: f64) -> Vec<f64> {
    if x.len() < 64 || !(hi > lo) || sr == 0 {
        return x.to_vec();
    }
    fft_filter(x, sr, |f| band_weight(f, lo, hi))
}

/// `Layered._fit`: resample `y` to exactly `n` samples by linear interpolation.
pub fn fit(y: &[f64], n: usize) -> Vec<f64> {
    if y.len() == n {
        return y.to_vec();
    }
    if y.len() < 2 {
        // np.resize repeats the input; an empty input resizes to zeros
        return (0..n).map(|i| if y.is_empty() { 0.0 } else { y[i % y.len()] }).collect();
    }
    interp_arange(&linspace(0.0, (y.len() - 1) as f64, n), y)
}

/// Python's round(): half to even.
fn round_half_even(v: f64) -> f64 {
    let r = v.round();
    if (v - v.trunc()).abs() == 0.5 {
        2.0 * (v / 2.0).round()
    } else {
        r
    }
}

/// `Layered._echo` with its arguments already resolved (the JS loader applies the spec defaults: ms 34, taps 3,
/// decay 0.55, dry 0). out = y*dry + sum_k decay^k * y delayed by k*d0, d0 = max(1, round(sr*ms/1000)).
pub fn echo(y: &[f64], sr: usize, ms: f64, taps: u32, decay: f64, dry: f64) -> Vec<f64> {
    let taps = taps.max(1);
    let mut out: Vec<f64> = y.iter().map(|v| v * dry).collect();
    let d0 = (round_half_even(sr as f64 * ms / 1000.0) as i64).max(1) as usize;
    let mut g = 1.0;
    for k in 1..=taps as usize {
        g *= decay;
        let d = d0.saturating_mul(k);
        if d >= y.len() {
            break;
        }
        for i in d..y.len() {
            out[i] += y[i - d] * g;
        }
    }
    out
}

/// What `_fall` decides before it writes: None = return `y` unchanged.
struct FallPlan {
    start: usize,
    end: usize,
    pos: Vec<f64>,
    hop: usize,
}

fn fall_plan(y: &[f64], sr: usize, semitones: f64, seconds: f64) -> Option<FallPlan> {
    let n = y.len();
    if sr == 0 || n < sr / 10 || !(semitones > 0.0) || n == 0 {
        return None;
    }
    let hop = (sr / 100).max(1);
    // np.convolve(y*y, ones(hop)/hop, mode="same"): same[i] = full[i + (hop-1)//2], full[j] = sum_k y2[j-k]/hop
    // (k in 0..hop, in range). A running sum: not numpy's summation order, so only an rms sitting exactly on the
    // floor could decide differently.
    let y2: Vec<f64> = y.iter().map(|v| v * v).collect();
    let off = (hop - 1) / 2;
    let mut pre = vec![0.0f64; n + 1];
    for i in 0..n {
        pre[i + 1] = pre[i] + y2[i];
    }
    let inv = 1.0 / hop as f64;
    let rms: Vec<f64> = (0..n)
        .map(|i| {
            let j = i + off; // full index
            let hi = j.min(n - 1);
            let lo = (j + 1).saturating_sub(hop);
            let s = if lo <= hi { pre[hi + 1] - pre[lo] } else { 0.0 };
            (s.max(0.0) * inv).sqrt()
        })
        .collect();
    let mx = rms.iter().cloned().fold(0.0f64, f64::max);
    let floor = 0.03 * if mx != 0.0 { mx } else { 1.0 };
    let last = rms.iter().rposition(|&r| r > floor)?;
    let end = last + 1;
    let seg = (hop * 4).max((seconds * sr as f64) as usize);
    let start = end.saturating_sub(seg);
    let l = end - start;
    let r = 2f64.powf(-semitones / 12.0);
    let mut pos = Vec::with_capacity(l + l / 8 + 16);
    let mut p = 0.0f64;
    let lf = l as f64;
    while p < lf - 1.0 {
        let u = p / lf;
        let st = u * u * (3.0 - 2.0 * u);
        pos.push(p);
        p += r.powf(st);
    }
    Some(FallPlan { start, end, pos, hop })
}

/// The exact length `fall` returns for this input.
pub fn fall_len(y: &[f64], sr: usize, semitones: f64, seconds: f64) -> usize {
    match fall_plan(y, sr, semitones, seconds) {
        None => y.len(),
        Some(p) => p.start + p.pos.len() + (y.len() - p.end),
    }
}

/// `Layered._fall`: lower the pitch of the last `seconds` of voice in `y`, a smoothstep ramp from 0 to -semitones,
/// read progressively slower (so the tail lengthens a little: phrase-final lengthening), the seam crossfaded over
/// two hops.
pub fn fall(y: &[f64], sr: usize, semitones: f64, seconds: f64) -> Vec<f64> {
    let Some(p) = fall_plan(y, sr, semitones, seconds) else { return y.to_vec() };
    let tail = &y[p.start..p.end];
    let l = tail.len();
    let mut bent = interp_arange(&p.pos, tail);
    let k = (p.hop * 2).min(bent.len()).min(l);
    if k > 1 {
        let w = linspace(0.0, 1.0, k);
        for i in 0..k {
            bent[i] = tail[i] * (1.0 - w[i]) + bent[i] * w[i];
        }
    }
    let mut out = Vec::with_capacity(p.start + bent.len() + y.len() - p.end);
    out.extend_from_slice(&y[..p.start]);
    out.extend_from_slice(&bent);
    out.extend_from_slice(&y[p.end..]);
    out
}

/// The finish of `Layered.synth` before int16: tanh(0.9x)/tanh(0.9), then peak-normalised to 0.89.
pub fn softknee(x: &[f64]) -> Vec<f64> {
    let t9 = (0.9f64).tanh();
    let m: Vec<f64> = x.iter().map(|v| (v * 0.9).tanh() / t9).collect();
    let pk = m.iter().fold(0.0f64, |a, v| a.max(v.abs()));
    let pk = if pk != 0.0 { pk } else { 1.0 };
    m.iter().map(|v| v / pk * 0.89).collect()
}

// ── the ABI: f32 buffers in linear memory ────────────────────────────────────────────────────────────

unsafe fn read(p: *const f32, n: usize) -> Vec<f64> {
    std::slice::from_raw_parts(p, n).iter().map(|&v| v as f64).collect()
}
unsafe fn write(p: *mut f32, v: &[f64]) {
    let d = std::slice::from_raw_parts_mut(p, v.len());
    for (o, &x) in d.iter_mut().zip(v) {
        *o = x as f32;
    }
}

/// Allocate `n_f32` zeroed f32s; free with `odsp_free(ptr, n_f32)` (the same count).
#[no_mangle]
pub extern "C" fn odsp_alloc(n_f32: usize) -> *mut f32 {
    let b: Box<[f32]> = vec![0.0f32; n_f32.max(1)].into_boxed_slice();
    Box::into_raw(b) as *mut f32
}

#[no_mangle]
pub unsafe extern "C" fn odsp_free(ptr: *mut f32, n_f32: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, n_f32.max(1))));
}

/// In place: band-pass to [lo_hz, hi_hz]. Unchanged when len < 64 or hi <= lo.
#[no_mangle]
pub unsafe extern "C" fn odsp_band(ptr: *mut f32, len: usize, sr: u32, lo_hz: f32, hi_hz: f32) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let y = band(&read(ptr, len), sr as usize, lo_hz as f64, hi_hz as f64);
    write(ptr, &y);
}

/// Linear resample src[src_len] onto dst[dst_len].
#[no_mangle]
pub unsafe extern "C" fn odsp_fit(src: *const f32, src_len: usize, dst: *mut f32, dst_len: usize) {
    if dst.is_null() || dst_len == 0 || (src.is_null() && src_len > 0) {
        return;
    }
    let x = if src_len == 0 { Vec::new() } else { read(src, src_len) };
    write(dst, &fit(&x, dst_len));
}

/// In place: `Layered._echo` (taps >= 1; pass the resolved spec values).
#[no_mangle]
pub unsafe extern "C" fn odsp_echo(ptr: *mut f32, len: usize, sr: u32, ms: f32, taps: u32, decay: f32, dry: f32) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let y = echo(&read(ptr, len), sr as usize, ms as f64, taps, decay as f64, dry as f64);
    write(ptr, &y);
}

/// The exact length `odsp_fall` writes for this src (it depends on where the voice ends, so it reads src).
#[no_mangle]
pub unsafe extern "C" fn odsp_fall_len(src: *const f32, len: usize, sr: u32, semitones: f32, seconds: f32) -> usize {
    if src.is_null() || len == 0 {
        return len;
    }
    fall_len(&read(src, len), sr as usize, semitones as f64, seconds as f64)
}

/// `Layered._fall` of src[len] into dst, which must hold `odsp_fall_len(src, len, ...)` f32s. Returns the count
/// written.
#[no_mangle]
pub unsafe extern "C" fn odsp_fall(src: *const f32, len: usize, sr: u32, semitones: f32, seconds: f32, dst: *mut f32) -> usize {
    if src.is_null() || dst.is_null() || len == 0 {
        return 0;
    }
    let y = fall(&read(src, len), sr as usize, semitones as f64, seconds as f64);
    write(dst, &y);
    y.len()
}

/// In place: the soft knee and the 0.89 peak.
#[no_mangle]
pub unsafe extern "C" fn odsp_softknee(ptr: *mut f32, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let y = softknee(&read(ptr, len));
    write(ptr, &y);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    const SR: usize = 22050;

    /// A harmonic statement at f0 (5 harmonics, 1/h), a gentle attack/decay, then silence.
    fn statement(f0: f64, secs: f64, silence: f64) -> Vec<f64> {
        let n = (secs * SR as f64) as usize;
        let mut v: Vec<f64> = (0..n)
            .map(|i| {
                let t = i as f64 / SR as f64;
                let env = (t / 0.02).min(1.0) * ((secs - t) / 0.02).min(1.0);
                (1..=5).map(|h| (2.0 * PI * f0 * h as f64 * t).sin() / h as f64).sum::<f64>() * 0.3 * env
            })
            .collect();
        v.extend(std::iter::repeat(0.0).take((silence * SR as f64) as usize));
        v
    }

    /// The f0 of `x` by autocorrelation over 60..400 Hz with parabolic refinement.
    fn f0_of(x: &[f64]) -> f64 {
        let (lo, hi) = (SR / 400, SR / 60);
        let mut best = (0usize, f64::MIN);
        let ac = |k: usize| x.iter().zip(&x[k..]).map(|(a, b)| a * b).sum::<f64>();
        for k in lo..=hi {
            let r = ac(k);
            if r > best.1 {
                best = (k, r);
            }
        }
        let k = best.0;
        let (a, b, c) = (ac(k - 1), ac(k), ac(k + 1));
        let d = 0.5 * (a - c) / (a - 2.0 * b + c);
        SR as f64 / (k as f64 + d)
    }

    #[test]
    fn fall_drops_the_last_40ms_about_0_9_semitone_and_lengthens() {
        let f0 = 130.0;
        let mut total_growth = 0.0;
        let mut drops = vec![];
        for _ in 0..3 {
            let x = statement(f0, 1.2, 0.3);
            let voiced_end = (1.2 * SR as f64) as usize;
            let y = fall(&x, SR, 1.0, 0.3);
            assert_eq!(y.len(), fall_len(&x, SR, 1.0, 0.3));
            let grow = y.len() as f64 - x.len() as f64;
            total_growth += grow;
            // the fall's own end: the voice end moved by the growth; measure the 40 ms before it
            let ye = voiced_end + grow as usize;
            let w = (0.040 * SR as f64) as usize;
            let seg = &y[ye - w - 400..ye - 400]; // stay off the 20 ms decay ramp's very end
            let before = f0_of(&x[voiced_end - w - 400..voiced_end - 400]);
            let after = f0_of(seg);
            drops.push(12.0 * (before / after).log2());
            // the head before the 0.3 s tail is untouched
            let start = voiced_end - (0.3 * SR as f64) as usize - 10;
            assert_eq!(&y[..start], &x[..start]);
        }
        let ms_per = total_growth / 3.0 / SR as f64 * 1000.0;
        eprintln!("drop over the last 40 ms: {drops:?} st; tail growth {ms_per:.2} ms per statement");
        for d in &drops {
            assert!((0.7..=1.0).contains(d), "drop {d} st");
        }
        assert!((7.0..=11.0).contains(&ms_per), "growth {ms_per} ms");
    }

    #[test]
    fn fall_noop_cases() {
        let x = statement(130.0, 0.05, 0.0); // shorter than sr/10
        assert_eq!(fall(&x, SR, 1.0, 0.3), x);
        let x = statement(130.0, 0.5, 0.1);
        assert_eq!(fall(&x, SR, 0.0, 0.3), x);
        let z = vec![0.0; SR];
        assert_eq!(fall(&z, SR, 1.0, 0.3), z); // no voice: rms never above the floor of 0.03*1.0
        assert_eq!(fall_len(&z, SR, 1.0, 0.3), SR);
    }

    #[test]
    fn band_is_unity_inside_and_kills_outside() {
        let n = 8192;
        let tone = |f: f64| (0..n).map(|i| (2.0 * PI * f * i as f64 / SR as f64).sin()).collect::<Vec<f64>>();
        let rms = |v: &[f64]| (v[1000..n - 1000].iter().map(|a| a * a).sum::<f64>() / (n - 2000) as f64).sqrt();
        let inside = band(&tone(1800.0), SR, 300.0, 3000.0);
        let outside = band(&tone(6000.0), SR, 300.0, 3000.0);
        assert!((rms(&inside) / rms(&tone(1800.0)) - 1.0).abs() < 0.01);
        assert!(rms(&outside) < 0.01);
        assert_eq!(band_weight(1800.0, 300.0, 3000.0), 1.0);
        assert_eq!(band_weight(299.0, 300.0, 3000.0), 0.0);
        assert!((band_weight(300.0 + 450.0, 300.0, 3000.0) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn echo_and_fit_and_knee() {
        let mut x = vec![0.0; 2000];
        x[0] = 1.0;
        let e = echo(&x, 22050, 34.0, 3, 0.55, 0.0);
        let d0 = 750; // round(22050*0.034) = 749.7
        assert_eq!(e[0], 0.0);
        assert!((e[d0] - 0.55).abs() < 1e-15 && (e[2 * d0] - 0.3025).abs() < 1e-15);
        assert_eq!(fit(&[0.0, 1.0], 5), vec![0.0, 0.25, 0.5, 0.75, 1.0]);
        assert_eq!(fit(&[2.0], 3), vec![2.0; 3]);
        let k = softknee(&[0.5, -2.0, 1.0]);
        assert!((k.iter().fold(0.0f64, |a, v| a.max(v.abs())) - 0.89).abs() < 1e-15);
    }
}
