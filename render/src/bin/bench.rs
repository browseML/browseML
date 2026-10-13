// SPDX-License-Identifier: MIT OR Apache-2.0
//! The DSP of one OVERLORD v4 sentence timed on the golden take: per stage and whole (median of N, one thread).
//! Compare with tools/bench_py.py, which times the Python reference the same way.
//!
//!   overlord-bench [testdata] [reps]
use overlord_dsp::{dsp, io};
use std::path::PathBuf;
#[cfg(not(target_os = "linux"))]
use std::time::Instant;

/// This thread's CPU time in seconds (the gate's unit: CPU-s per audio-s), so time spent preempted on a loaded box
/// is not counted. wasm32 has no CPU clock under Node's WASI: there it is wall time (stated in the output).
#[cfg(target_os = "linux")]
fn cpu_now() -> f64 {
    #[repr(C)]
    struct Ts {
        s: i64,
        ns: i64,
    }
    extern "C" {
        fn clock_gettime(clk: i32, ts: *mut Ts) -> i32;
    }
    let mut t = Ts { s: 0, ns: 0 };
    unsafe { clock_gettime(3, &mut t) }; // CLOCK_THREAD_CPUTIME_ID
    t.s as f64 + t.ns as f64 * 1e-9
}
#[cfg(not(target_os = "linux"))]
fn cpu_now() -> f64 {
    thread_local!(static T0: Instant = Instant::now());
    T0.with(|t| t.elapsed().as_secs_f64())
}
const CLOCK: &str = if cfg!(target_os = "linux") { "thread CPU time" } else { "wall time" };

fn med<F: FnMut() -> usize>(reps: usize, mut f: F) -> f64 {
    std::hint::black_box(f()); // warm (plan caches), as the Python side warms numba
    let mut v: Vec<f64> = (0..reps)
        .map(|_| {
            let t = cpu_now();
            std::hint::black_box(f());
            cpu_now() - t
        })
        .collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[reps / 2]
}

/// `--corpus DIR [reps]`: every NN_a.f64 / NN_j.f64 pair (python/corpus.py prepare) as one document, per config.
fn corpus(dir: &std::path::Path, reps: usize) {
    let mut names: Vec<_> = std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().into_string().unwrap())
        .filter(|n| n.ends_with("_a.f64")).collect();
    names.sort();
    let pairs: Vec<(Vec<f64>, Vec<f64>)> = names.iter()
        .map(|n| (io::f64s(&dir.join(n)), io::f64s(&dir.join(n.replace("_a.f64", "_j.f64"))))).collect();
    let audio: f64 = pairs.iter().map(|p| p.0.len() as f64).sum::<f64>() / 22050.0;
    println!("rust {} corpus: {} sentences, {audio:.2} s of audio, median of {reps} ({CLOCK} per audio s)", std::env::consts::ARCH, pairs.len());
    for (name, d) in [("diag every", dsp::Diagnostics::Every), ("diag 1/8", dsp::Diagnostics::Sampled(8)), ("diag off", dsp::Diagnostics::Off)] {
        let p = dsp::Params { diagnostics: d, ..dsp::Params::default() };
        let t = med(reps, || pairs.iter().enumerate().map(|(i, (a, j))| dsp::sentence(a, j, 22050, i, &p).mix.len()).sum());
        println!("  {name:<12} {:.4}", t / audio);
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--corpus") {
        let d = PathBuf::from(std::env::args().nth(2).expect("--corpus DIR"));
        return corpus(&d, std::env::args().nth(3).and_then(|s| s.parse().ok()).unwrap_or(3));
    }
    let t = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata"));
    let reps: usize = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(7);
    let (a, j, amap, body) = (io::f64s(&t.join("a.f64")), io::f64s(&t.join("j.f64")), io::f64s(&t.join("amap.f64")), io::f64s(&t.join("body.f64")));
    let jw = io::f64s(&t.join("wsola.f64"));
    let sr = 22050;
    let p = dsp::Params::default();
    let audio = a.len() as f64 / sr as f64;
    let er = dsp::envelope(&body, sr, 60.0);
    let (o2, o4, ov) = dsp::layers(&body, sr, &p);
    let rows: Vec<(&str, f64)> = vec![
        ("pitch_shift -1 (body)", med(reps, || dsp::pitch_shift(&a, sr, -1.0).len())),
        ("exciter", med(reps, || dsp::exciter(&body, sr).len())),
        ("align_map (logmel x2 + DTW)", med(reps, || dsp::align_map(&a, &j, sr).len())),
        ("warp jenny (WSOLA)", med(reps, || dsp::warp(&j, &amap, sr).len())),
        ("residual_lag_ms [diag]", med(reps, || dsp::residual_lag_ms(&a, &jw, sr) as usize)),
        ("octave_divider f/2", med(reps, || dsp::octave_divider(&body, sr, 2, 180.0).len())),
        ("octave_divider f/4", med(reps, || dsp::octave_divider(&body, sr, 4, 140.0).len())),
        ("harmonic_overtones", med(reps, || dsp::harmonic_overtones(&body, sr, &[2, 3, 4], &[1.0, 0.6, 0.35]).len())),
        ("offset_samples x3 [diag]", med(reps, || {
            [&o2, &o4, &ov].iter().map(|l| dsp::offset_samples(&body, l, sr)).sum::<i64>() as usize
        })),
        ("fifth: pitch_shift -7 + lowpass", med(reps, || dsp::lowpass(&dsp::pitch_shift(&a, sr, -7.0), sr, 1500.0, 250.0).len())),
        ("low_shelf", med(reps, || dsp::low_shelf(&body, sr, 180.0, 5.0).len())),
    ];
    let tot: f64 = rows.iter().map(|r| r.1).sum();
    println!("rust {}  audio {audio:.2}s  reps {reps}  median {CLOCK}", std::env::consts::ARCH);
    for (k, v) in &rows {
        println!("  {k:<36} {:8.2} ms", v * 1e3);
    }
    println!("  {:<36} {:8.2} ms", "sum of stages (reference shape)", tot * 1e3);
    let _ = er;
    let full = |d: dsp::Diagnostics, shared: bool| {
        let q = dsp::Params { diagnostics: d, shared_layers: shared, ..p.clone() };
        med(reps, || dsp::sentence(&a, &j, sr, 1, &q).mix.len())
    };
    for (name, d, sh) in [
        ("sentence: reference shape (3x fund., diag every)", dsp::Diagnostics::Every, false),
        ("sentence: shared layers, diag every (default)", dsp::Diagnostics::Every, true),
        ("sentence: shared layers, diag sampled 1/8", dsp::Diagnostics::Sampled(8), true),
        ("sentence: shared layers, diag off", dsp::Diagnostics::Off, true),
    ] {
        let s = full(d, sh);
        println!("  {name:<52} {:8.2} ms  = {:.4} s per audio-s ({CLOCK})", s * 1e3, s / audio);
    }
}
