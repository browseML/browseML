// SPDX-License-Identifier: MIT OR Apache-2.0
//! One whole OVERLORD v4 sentence (render_overlord.py's loop body) against the reference's goldens, stage by stage,
//! with the bar each stage is held to (see ../docs/RENDER_RUST.md §3.2):
//!   E0         bit-exact          pitch_shift -7, align_map given the path, warp, the mel bin edges
//!   E0-events  identical          DTW path on OUR cost, residual_lag_ms, offset_samples x3
//!   E1         >= 100 dB SNR      logmel, exciter, layers, fifth, the sentence mix
//! and the iteration-2 refactors, held to "same bits as the reference-shaped path": shared layers, diagnostics off.
use overlord_dsp::{bits_differ, dsp, io, snr_db};
use std::path::PathBuf;

const SR: usize = 22050;
const SNR_BAR_DB: f64 = 100.0;

fn td() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata")
}
fn meta() -> String {
    std::fs::read_to_string(td().join("meta.json")).unwrap()
}
fn meta_f64(key: &str) -> f64 {
    let s = meta();
    let i = s.find(&format!("\"{key}\"")).unwrap();
    s[i + key.len() + 3..].trim_start_matches([':', ' ']).split([',', '\n']).next().unwrap().trim().parse().unwrap()
}
fn meta_offsets() -> Vec<i64> {
    let s = meta();
    let i = s.find("\"offsets\"").unwrap();
    let a = s[i..].find('[').unwrap() + i;
    let b = s[a..].find(']').unwrap() + a;
    s[a + 1..b].split(',').map(|v| v.trim().parse().unwrap()).collect()
}
fn f(name: &str) -> Vec<f64> {
    io::f64s(&td().join(name))
}

fn e0(name: &str, want: &[f64], got: &[f64]) {
    let d = bits_differ(want, got);
    eprintln!("E0  {name}: {} samples, {d} differ in bits", want.len());
    assert_eq!(d, 0, "{name}");
}
fn e1(name: &str, want: &[f64], got: &[f64]) {
    let s = snr_db(want, got);
    eprintln!("E1  {name}: SNR {s:.1} dB ({} of {} bit-identical)", want.len() - bits_differ(want, got), want.len());
    assert!(s >= SNR_BAR_DB, "{name} SNR {s:.1}");
}

#[test]
fn fifth_pitch_shift_exact() {
    e0("pitch_shift -7", &f("pshift7.f64"), &dsp::pitch_shift(&f("a.f64"), SR, -7.0));
}

#[test]
fn mel_bins_exact_with_margin() {
    let want = io::i64s(&td().join("melbins.i64"));
    assert_eq!(dsp::mel_bins(SR), want, "mel bin edges");
    // no libm's last bit can move an edge: every pre-floor value is far from an integer, at every common rate
    for sr in [8000usize, 16000, 22050, 24000, 32000, 44100, 48000] {
        let margin = dsp::mel_points(sr).iter().map(|v| (v - v.round()).abs()).fold(f64::INFINITY, f64::min);
        eprintln!("E0  mel bins at {sr} Hz: nearest pre-floor value is {margin:.3e} from an integer");
        assert!(margin > 1e-9, "{sr}: {margin}");
    }
}

#[test]
fn alignment_chain() {
    let (a, j) = (f("a.f64"), f("j.f64"));
    let bank = dsp::mel_bank(SR);
    let (fr, nr) = dsp::logmel(&a, &bank);
    let (fo, no) = dsp::logmel(&j, &bank);
    e1("logmel(a)", &f("logmel_a.f64"), &fr);
    e1("logmel(j)", &f("logmel_j.f64"), &fo);
    let (pi, pj) = dsp::dtw(&dsp::cosine_cost(&fr, nr, &fo, no), nr, no);
    let same = pi == io::i64s(&td().join("dtw_pi.i64")) && pj == io::i64s(&td().join("dtw_pj.i64"));
    eprintln!("E0e DTW path on our own cost ({nr} x {no}): {} steps, identical to the reference's: {same}", pi.len());
    assert!(same);
    let amap = dsp::align_map_from_path(a.len(), j.len(), nr, &pi, &pj);
    e0("align_map", &f("amap.f64"), &amap);
    e0("warp(j, our align_map)", &f("wsola.f64"), &dsp::warp(&j, &amap, SR));
}

#[test]
fn diagnostics_exact() {
    let (a, body) = (f("a.f64"), f("body.f64"));
    let lag = dsp::residual_lag_ms(&a, &f("wsola.f64"), SR);
    eprintln!("E0e residual_lag_ms: {lag} (reference {})", meta_f64("residual_lag_ms"));
    assert_eq!(lag.to_bits(), meta_f64("residual_lag_ms").to_bits());
    let raw = dsp::residual_lag_ms(&a, &f("j.f64"), SR); // the takes before alignment: a non-trivial median
    eprintln!("E0e residual_lag_ms (unaligned takes): {raw} (reference {})", meta_f64("residual_lag_ms_unaligned"));
    assert_eq!(raw.to_bits(), meta_f64("residual_lag_ms_unaligned").to_bits());
    let p = dsp::Params::default();
    let (o2, o4, ov) = dsp::layers(&body, SR, &p);
    let er = dsp::envelope(&body, SR, 60.0);
    let got: Vec<i64> = [&o2, &o4, &ov].iter().map(|l| dsp::offset_samples_env(&er, l, SR)).collect();
    eprintln!("E0e offset_samples (octave, double, overtones): {got:?} (reference {:?})", meta_offsets());
    assert_eq!(got, meta_offsets());
    assert_eq!(got[0], dsp::offset_samples(&body, &o2, SR));
}

#[test]
fn layers_shared_same_bits_and_snr() {
    let body = f("body.f64");
    let p = dsp::Params::default();
    let (o2, o4, ov) = dsp::layers(&body, SR, &p);
    assert_eq!(bits_differ(&o2, &dsp::octave_divider(&body, SR, 2, 180.0)), 0);
    assert_eq!(bits_differ(&o4, &dsp::octave_divider(&body, SR, 4, 140.0)), 0);
    assert_eq!(bits_differ(&ov, &dsp::harmonic_overtones(&body, SR, &[2, 3, 4], &[1.0, 0.6, 0.35])), 0);
    eprintln!("    layers(): fundamental/envelope/gate once = the same bits as three separate layer calls");
    e1("octave2 (shared)", &f("octave2.f64"), &o2);
    e1("octave4 (shared)", &f("octave4.f64"), &o4);
    e1("overtones (shared)", &f("overtones.f64"), &ov);
    e1("exciter", &f("exciter.f64"), &dsp::exciter(&body, SR));
    e1("fifth", &f("fifth.f64"), &dsp::lowpass(&dsp::pitch_shift(&f("a.f64"), SR, -7.0), SR, 1500.0, 250.0));
}

#[test]
fn whole_sentence() {
    let (a, j) = (f("a.f64"), f("j.f64"));
    let want = f("mix.f64");
    let p = dsp::Params::default();
    let s = dsp::sentence(&a, &j, SR, 0, &p);
    e1("sentence mix", &want, &s.mix);
    assert_eq!(s.residual_lag_ms.map(f64::to_bits), Some(meta_f64("residual_lag_ms").to_bits()));
    assert_eq!(s.offsets.map(|o| o.to_vec()), Some(meta_offsets()));
    // int16 as the finish would quantise it (peak-normalised to 0.89 of full scale; the hall and compressor are not
    // ported yet, so this is the sentence's own quantisation, not the document's)
    let peak = want.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    let k = 0.89 * 32767.0 / peak;
    let q = |v: f64| (v * k).clamp(-32767.0, 32767.0) as i32;
    let (mut d1, mut dmax) = (0usize, 0i32);
    for (x, y) in want.iter().zip(s.mix.iter()) {
        let d = (q(*x) - q(*y)).abs();
        if d > 0 {
            d1 += 1;
        }
        dmax = dmax.max(d);
    }
    eprintln!("    sentence as int16: {d1} of {} samples differ, max {dmax} LSB", want.len());
    assert!(dmax <= 1 && (d1 as f64) <= 0.001 * want.len() as f64);
    // the iteration-2 switches change no bit of the mix
    let off = dsp::sentence(&a, &j, SR, 0, &dsp::Params { diagnostics: dsp::Diagnostics::Off, ..p.clone() });
    let unshared = dsp::sentence(&a, &j, SR, 0, &dsp::Params { shared_layers: false, ..p.clone() });
    let sampled = dsp::sentence(&a, &j, SR, 3, &dsp::Params { diagnostics: dsp::Diagnostics::Sampled(8), ..p.clone() });
    assert_eq!(bits_differ(&s.mix, &off.mix), 0);
    assert_eq!(bits_differ(&s.mix, &unshared.mix), 0);
    assert_eq!(bits_differ(&s.mix, &sampled.mix), 0);
    assert!(off.offsets.is_none() && off.residual_lag_ms.is_none() && sampled.offsets.is_none());
    eprintln!("    diagnostics Off / Sampled(8) and unshared layers: mix bit-identical to the reference-shaped run");
}
