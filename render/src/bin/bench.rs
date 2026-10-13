// SPDX-License-Identifier: MIT OR Apache-2.0
//! The ported stages, timed on the golden sentence: median of N runs, one thread. Compare with tools/bench_py.py.
use overlord_dsp::{dsp, io};
use std::path::PathBuf;
use std::time::Instant;

fn med<F: FnMut() -> usize>(reps: usize, mut f: F) -> f64 {
    let mut v: Vec<f64> = (0..reps)
        .map(|_| {
            let t = Instant::now();
            std::hint::black_box(f());
            t.elapsed().as_secs_f64()
        })
        .collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[reps / 2]
}

fn main() {
    let t = std::env::args().nth(1).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata"));
    let reps: usize = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(7);
    let (a, j, amap, body) = (io::f64s(&t.join("a.f64")), io::f64s(&t.join("j.f64")),
                              io::f64s(&t.join("amap.f64")), io::f64s(&t.join("body.f64")));
    let cost = io::f64s(&t.join("cost.f64"));
    let s = std::fs::read_to_string(t.join("meta.json")).unwrap();
    let i = s.find("\"cost_shape\"").unwrap();
    let nm: Vec<usize> = s[i..].split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).take(2)
        .map(|x| x.parse().unwrap()).collect();
    let audio = a.len() as f64 / 22050.0;
    let rows: Vec<(&str, f64)> = vec![
        ("pitch_shift -1 (body)", med(reps, || dsp::pitch_shift(&a, 22050, -1.0).len())),
        ("pitch_shift -7 (fifth, before lowpass)", med(reps, || dsp::pitch_shift(&a, 22050, -7.0).len())),
        ("warp jenny (WSOLA, given amap)", med(reps, || dsp::warp(&j, &amap, 22050).len())),
        ("dtw (given cost)", med(reps, || dsp::dtw(&cost, nm[0], nm[1]).0.len())),
        ("octave_divider f/2", med(reps, || dsp::octave_divider(&body, 22050, 2, 180.0).len())),
        ("octave_divider f/4", med(reps, || dsp::octave_divider(&body, 22050, 4, 140.0).len())),
        ("harmonic_overtones", med(reps, || dsp::harmonic_overtones(&body, 22050, &[2, 3, 4], &[1.0, 0.6, 0.35]).len())),
    ];
    let tot: f64 = rows.iter().map(|r| r.1).sum();
    println!("rust  audio {audio:.2}s  reps {reps}  ported stages total {:.1} ms  ({:.0}x realtime)", tot * 1e3, audio / tot);
    for (k, v) in rows {
        println!("  {k:<40} {:8.2} ms", v * 1e3);
    }
}
