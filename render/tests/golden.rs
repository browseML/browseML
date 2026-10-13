// SPDX-License-Identifier: MIT OR Apache-2.0
//! The Rust against the Python reference's own outputs (tools/golden.py). Two bars:
//!   EXACT  - every f64 identical by bit pattern (stages with no FFT inside), or every event index identical;
//!   SNR    - >= 100 dB against numpy (stages through an FFT; pocketfft's butterfly order is not ours). 100 dB is far
//!            below what a 24 kbps Opus encode or int16 output can carry (int16 is ~96 dB), so it cannot be heard and
//!            cannot move a sample of the int16 the renderer writes by more than one LSB in rare cases.
use overlord_dsp::{bits_differ, dsp, io, snr_db};
use std::path::PathBuf;

const SNR_BAR_DB: f64 = 100.0;

fn td() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata")
}

#[test]
fn hanning_exact() {
    let win = io::meta_usize(&td(), "win");
    let want = io::f64s(&td().join("hann.f64"));
    let d = bits_differ(&want, &dsp::hanning(win));
    eprintln!("hanning({win}): {d} of {} differ in bits", want.len());
    assert_eq!(d, 0);
}

#[test]
fn wsola_exact() {
    let t = td();
    let (j, amap) = (io::f64s(&t.join("j.f64")), io::f64s(&t.join("amap.f64")));
    let (win, hop, tol) = (io::meta_usize(&t, "win"), io::meta_usize(&t, "hop"), io::meta_usize(&t, "tol"));
    let got = dsp::wsola(&j, &amap, win, hop, tol);
    let want = io::f64s(&t.join("wsola.f64"));
    let d = bits_differ(&want, &got);
    eprintln!("wsola: {} samples, {} differ in bits, SNR {:.1} dB", want.len(), d, snr_db(&want, &got));
    assert_eq!(d, 0);
}

#[test]
fn dtw_path_exact() {
    let t = td();
    let s = std::fs::read_to_string(t.join("meta.json")).unwrap();
    let i = s.find("\"cost_shape\"").unwrap();
    let nums: Vec<usize> = s[i..].split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).take(2)
        .map(|x| x.parse().unwrap()).collect();
    let (pi, pj) = dsp::dtw(&io::f64s(&t.join("cost.f64")), nums[0], nums[1]);
    assert_eq!(pi, io::i64s(&t.join("dtw_pi.i64")));
    assert_eq!(pj, io::i64s(&t.join("dtw_pj.i64")));
}

#[test]
fn pitch_shift_exact() {
    let t = td();
    let got = dsp::pitch_shift(&io::f64s(&t.join("a.f64")), 22050, -1.0);
    let want = io::f64s(&t.join("body.f64"));
    let d = bits_differ(&want, &got);
    eprintln!("pitch_shift -1: {} samples, {} differ in bits, SNR {:.1} dB", want.len(), d, snr_db(&want, &got));
    assert_eq!(d, 0);
}

#[test]
fn fundamental_envelope_gate_snr() {
    let t = td();
    let body = io::f64s(&t.join("body.f64"));
    let xf = dsp::fundamental(&body, 22050);
    let env = dsp::envelope(&xf, 22050, 30.0);
    let gate = dsp::voiced_gate(&env, 0.08, 0.04);
    for (name, got) in [("fundamental", &xf), ("envelope", &env), ("gate", &gate)] {
        let want = io::f64s(&t.join(format!("{name}.f64")));
        let s = snr_db(&want, got);
        eprintln!("{name}: SNR {s:.1} dB, {} of {} bit-identical", want.len() - bits_differ(&want, got), want.len());
        assert!(s >= SNR_BAR_DB, "{name} SNR {s:.1} dB");
    }
}

#[test]
fn divider_crossings_exact_and_layers_snr() {
    let t = td();
    let body = io::f64s(&t.join("body.f64"));
    let xf = dsp::fundamental(&body, 22050);
    let env = dsp::envelope(&xf, 22050, 30.0);
    let gate = dsp::voiced_gate(&env, 0.08, 0.04);
    for d in [2usize, 4] {
        let want = io::i64s(&t.join(format!("cross{d}.i64")));
        let got = dsp::crossings(&xf, &gate, d);
        eprintln!("crossings f/{d}: {} events, identical: {}", want.len(), want == got);
        assert_eq!(got, want);
    }
    for (name, got) in [
        ("octave2", dsp::octave_divider(&body, 22050, 2, 180.0)),
        ("octave4", dsp::octave_divider(&body, 22050, 4, 140.0)),
        ("overtones", dsp::harmonic_overtones(&body, 22050, &[2, 3, 4], &[1.0, 0.6, 0.35])),
    ] {
        let want = io::f64s(&t.join(format!("{name}.f64")));
        let s = snr_db(&want, &got);
        eprintln!("{name}: SNR {s:.1} dB");
        assert!(s >= SNR_BAR_DB, "{name} SNR {s:.1} dB");
    }
}

#[test]
fn wsola_exact_with_reference_window() {
    // the target-independent form: the window's bits come from the reference (as a build-time table would)
    let t = td();
    let (j, amap, w) = (io::f64s(&t.join("j.f64")), io::f64s(&t.join("amap.f64")), io::f64s(&t.join("hann.f64")));
    let (hop, tol) = (io::meta_usize(&t, "hop"), io::meta_usize(&t, "tol"));
    let got = dsp::wsola_with_window(&j, &amap, &w, hop, tol);
    let want = io::f64s(&t.join("wsola.f64"));
    let d = bits_differ(&want, &got);
    eprintln!("wsola (reference window): {} samples, {} differ in bits", want.len(), d);
    assert_eq!(d, 0);
}
