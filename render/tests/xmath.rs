// SPDX-License-Identifier: MIT OR Apache-2.0
//! xmath against the C library it stands in for (glibc 2.35 x86-64, which numpy and numba call on the reference
//! machine and in production). Native-only: wasm32 has no glibc to compare with; there, tests/golden.rs shows the
//! consequence (window and pitch_shift bit-exact). Every argument the renderer can produce is checked:
//!   hann_cos       - every argument np.hanning(M) evaluates, pi*n/(M-1), n = 1-M, 3-M, ..., M-1 (both signs);
//!   semitone_ratio - Python's 2.0 ** (s / 12.0) for s = i/1000, |s| <= 48.
//! It also reports how often glibc is NOT correctly rounded on those arguments (why a table is needed at all).
#![cfg(all(target_os = "linux", target_env = "gnu", target_arch = "x86_64"))]
use overlord_dsp::xmath::{self, HANN_MAX_M, SEMI_GRID_MAX};
use std::f64::consts::PI;

extern "C" {
    fn cos(x: f64) -> f64;
    fn pow(x: f64, y: f64) -> f64;
}

/// (arguments, hann_cos != glibc, correctly-rounded != glibc, first mismatches)
fn hann_check(lo: usize, hi: usize) -> (u64, u64, u64, Vec<(usize, i64)>) {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(4);
    std::thread::scope(|sc| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                sc.spawn(move || {
                    let (mut ne, mut nb, mut ncr, mut ex) = (0u64, 0u64, 0u64, vec![]);
                    for m in (lo.max(2)..=hi).skip(t).step_by(threads) {
                        let d = (m - 1) as f64;
                        let mut n = 1 - m as i64;
                        while n <= m as i64 - 1 {
                            let x = PI * (n as f64) / d;
                            let g = unsafe { cos(x) }.to_bits();
                            ne += 1;
                            if xmath::hann_cos(m, n).to_bits() != g {
                                nb += 1;
                                if ex.len() < 8 {
                                    ex.push((m, n));
                                }
                            }
                            if xmath::cr_cos(x).to_bits() != g {
                                ncr += 1;
                            }
                            n += 2;
                        }
                    }
                    (ne, nb, ncr, ex)
                })
            })
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).fold((0, 0, 0, vec![]), |mut a, r| {
            a.0 += r.0;
            a.1 += r.1;
            a.2 += r.2;
            a.3.extend(r.3);
            a
        })
    })
}

#[test]
fn hann_cos_equals_glibc_renderer_lengths() {
    // the windows the renderer builds: WSOLA 32 ms at 16/22.05/24/44.1/48 kHz, logmel 1024, smoothers 7 and 9
    for m in [7usize, 9, 512, 704, 768, 1024, 1410, 1536] {
        let (n, bad, ncr, ex) = hann_check(m, m);
        eprintln!("hann_cos({m}): {n} args, {bad} differ from glibc (correctly rounded would differ at {ncr}) {ex:?}");
        assert_eq!(bad, 0);
    }
}

#[test]
#[ignore = "exhaustive over the table's domain, ~1-2 min: cargo test --release --test xmath -- --ignored"]
fn hann_cos_equals_glibc_exhaustive() {
    let (n, bad, ncr, ex) = hann_check(2, HANN_MAX_M);
    eprintln!("hann_cos, every np.hanning(M) argument for 2 <= M <= {HANN_MAX_M}, both signs: {n} args, {bad} differ from glibc; \
               correctly rounded cos differs from glibc at {ncr} ({:.3}%) {ex:?}", 100.0 * ncr as f64 / n as f64);
    assert_eq!(bad, 0);
}

#[test]
fn semitone_ratio_equals_glibc_pow_on_grid() {
    let (mut n, mut bad, mut ncr, mut ex) = (0u64, 0u64, 0u64, vec![]);
    for i in -SEMI_GRID_MAX..=SEMI_GRID_MAX {
        let s = i as f64 / 1000.0;
        let g = unsafe { pow(2.0, s / 12.0) }.to_bits();
        n += 1;
        if xmath::semitone_ratio(s).to_bits() != g {
            bad += 1;
            if ex.len() < 8 {
                ex.push(i);
            }
        }
        if xmath::cr_exp2(s / 12.0).to_bits() != g {
            ncr += 1;
        }
    }
    eprintln!("semitone_ratio vs glibc pow(2, s/12), s = i/1000, |s| <= 48: {n} values, {bad} differ; correctly rounded differs at {ncr} {ex:?}");
    assert_eq!(bad, 0);
}
