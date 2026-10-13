// SPDX-License-Identifier: MIT OR Apache-2.0
//! The fast FFT paths (stage tables; AVX on x86-64, simd128 on wasm32) against iteration 1's scalar loop, kept as
//! `Plan::run_scalar`: identical bits for every power of two up to 2^18, forward and inverse, on random input with
//! a wide exponent range and signed zeros.
use overlord_dsp::fft::{Plan, C};

fn rng(seed: &mut u64) -> f64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    let m = (*seed >> 11) as f64 / (1u64 << 53) as f64 - 0.5;
    let e = ((*seed >> 3) % 40) as i32 - 20;
    if *seed % 97 == 0 { -0.0 } else { m * 2f64.powi(e) }
}

#[test]
fn fft_fast_equals_scalar() {
    let mut seed = 0x9e3779b97f4a7c15u64;
    for lg in 0..=18 {
        let n = 1usize << lg;
        let plan = Plan::new(n);
        for inverse in [false, true] {
            let x: Vec<C> = (0..n).map(|_| C::new(rng(&mut seed), rng(&mut seed))).collect();
            let (mut f, mut s) = (x.clone(), x.clone());
            plan.run(&mut f, inverse);
            plan.run_scalar(&mut s, inverse);
            let d = f.iter().zip(&s).filter(|(a, b)| a.re.to_bits() != b.re.to_bits() || a.im.to_bits() != b.im.to_bits()).count();
            assert_eq!(d, 0, "n = {n} inverse = {inverse}: {d} differ");
        }
    }
    eprintln!("fft: fast path == scalar path, bit for bit, n = 1 .. 2^18, both directions");
}

/// The lane-parallel WSOLA search against iteration 1's scalar loop, on random signals and position maps that
/// exercise the edges (candidates clipped at both ends, the natural continuation out of range, very short input).
#[test]
fn wsola_lanes_equal_scalar() {
    let mut seed = 0x243f6a8885a308d3u64;
    let mut cases = 0;
    for &(lx, n_out, win, tol) in &[(5000usize, 6000usize, 704usize, 176usize), (900, 1200, 704, 176), (705, 2000, 704, 176),
                                     (20000, 15000, 64, 31), (3000, 3000, 16, 7), (100000, 113722, 768, 192)] {
        for kind in 0..4 {
            let x: Vec<f64> = (0..lx).map(|_| rng(&mut seed)).collect();
            let pos: Vec<f64> = (0..n_out)
                .map(|i| {
                    let t = i as f64 * lx as f64 / n_out as f64;
                    match kind {
                        0 => t,
                        1 => (t + 300.0 * (i as f64 * 0.001).sin()).max(0.0),
                        2 => (lx as f64 - 1.0) * (i as f64 / n_out as f64).powi(2),
                        _ => (t * 1.7).min(lx as f64 - 1.0),
                    }
                })
                .collect();
            let w = overlord_dsp::dsp::hanning(win);
            let a = overlord_dsp::dsp::wsola_with_window(&x, &pos, &w, win / 4, tol);
            let b = overlord_dsp::dsp::wsola_scalar(&x, &pos, &w, win / 4, tol);
            assert_eq!(overlord_dsp::bits_differ(&a, &b), 0, "lx {lx} n_out {n_out} win {win} kind {kind}");
            cases += 1;
        }
    }
    eprintln!("wsola: lane-parallel search == scalar loop, bit for bit, {cases} cases");
}

/// Iteration 1's Bluestein, verbatim but for the plan: u128 index arithmetic, every chirp value computed, fresh
/// buffers, the scalar FFT loop.
fn dft_iteration1(x: &[C], inverse: bool) -> Vec<C> {
    use std::f64::consts::PI;
    let n = x.len();
    let m = (2 * n - 1).next_power_of_two();
    let plan = Plan::new(m);
    let sign = if inverse { 1.0 } else { -1.0 };
    let w: Vec<C> = (0..n)
        .map(|k| {
            let kk = ((k as u128 * k as u128) % (2 * n as u128)) as f64;
            let a = sign * PI * kk / (n as f64);
            C::new(a.cos(), a.sin())
        })
        .collect();
    let mut a = vec![C::default(); m];
    for k in 0..n {
        a[k] = x[k].mul(w[k]);
    }
    let mut b = vec![C::default(); m];
    b[0] = w[0].conj();
    for k in 1..n {
        b[k] = w[k].conj();
        b[m - k] = w[k].conj();
    }
    plan.run_scalar(&mut a, false);
    plan.run_scalar(&mut b, false);
    for k in 0..m {
        a[k] = a[k].mul(b[k]);
    }
    plan.run_scalar(&mut a, true);
    let s = 1.0 / (m as f64);
    let mut out: Vec<C> = (0..n).map(|k| a[k].scale(s).mul(w[k])).collect();
    if inverse {
        let s = 1.0 / (n as f64);
        for v in out.iter_mut() {
            *v = v.scale(s);
        }
    }
    out
}

#[test]
fn bluestein_equals_iteration1() {
    let mut seed = 0x13198a2e03707344u64;
    for &n in &[3usize, 5, 6, 7, 12, 100, 101, 1000, 4097, 11025, 22050, 22051, 113722] {
        for inverse in [false, true] {
            let x: Vec<C> = (0..n).map(|_| C::new(rng(&mut seed), rng(&mut seed))).collect();
            let a = overlord_dsp::fft::dft(&x, inverse);
            let b = dft_iteration1(&x, inverse);
            let d = a.iter().zip(&b).filter(|(p, q)| p.re.to_bits() != q.re.to_bits() || p.im.to_bits() != q.im.to_bits()).count();
            assert_eq!(d, 0, "n = {n} inverse = {inverse}");
        }
    }
    eprintln!("dft (Bluestein): iteration 2 == iteration 1, bit for bit, 13 lengths (odd and even), both directions");
}
