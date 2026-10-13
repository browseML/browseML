// SPDX-License-Identifier: MIT OR Apache-2.0
//! overlord-dsp: a scratch proof of concept (2026-10-12) of the OVERLORD v4 DSP layers in zero-dependency Rust,
//! held against mindX's overlord_dsp.py by golden outputs (tools/golden.py writes them from the reference itself).
//! Not wired into browseML, voaice or the render queue; the design is ../docs/RENDER_RUST.md.
pub mod dsp;
pub mod fft;

/// Little-endian f64 / i64 files as tools/golden.py writes them.
pub mod io {
    pub fn f64s(path: &std::path::Path) -> Vec<f64> {
        let b = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e} (run tools/golden.py first)", path.display()));
        b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect()
    }
    pub fn i64s(path: &std::path::Path) -> Vec<i64> {
        let b = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e} (run tools/golden.py first)", path.display()));
        b.chunks_exact(8).map(|c| i64::from_le_bytes(c.try_into().unwrap())).collect()
    }
    pub fn meta_usize(dir: &std::path::Path, key: &str) -> usize {
        let s = std::fs::read_to_string(dir.join("meta.json")).expect("meta.json");
        let i = s.find(&format!("\"{key}\"")).unwrap_or_else(|| panic!("meta.json has no {key}"));
        let rest = &s[i + key.len() + 3..];
        let rest = rest.trim_start_matches([':', ' ']);
        rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap()
    }
}

/// Signal-to-error ratio in dB of `got` against `want` (inf when identical).
pub fn snr_db(want: &[f64], got: &[f64]) -> f64 {
    assert_eq!(want.len(), got.len());
    let s: f64 = want.iter().map(|v| v * v).sum();
    let e: f64 = want.iter().zip(got).map(|(a, b)| (a - b) * (a - b)).sum();
    if e == 0.0 { f64::INFINITY } else { 10.0 * (s / e).log10() }
}

/// How many values differ in bit pattern.
pub fn bits_differ(want: &[f64], got: &[f64]) -> usize {
    assert_eq!(want.len(), got.len());
    want.iter().zip(got).filter(|(a, b)| a.to_bits() != b.to_bits()).count()
}
