// SPDX-License-Identifier: MIT OR Apache-2.0
//! The C ABI for the server path: overlord-dsp as a cdylib (`liboverlord_dsp_c.so`), called from Python through ctypes
//! (python/overlord_dsp_rs.py) the way docspeech calls libsndfile - no PyO3, no crates. Standalone: nothing in
//! mindX loads it.
//!
//! Conventions: every array is contiguous little-endian f64 (i64 for indices) owned by the caller; outputs are
//! written into caller-allocated buffers whose lengths the doc of each function states. Returns 0 on success,
//! ODSP_ENULL for a null pointer, ODSP_ELEN for a length the reference itself would reject. The library is built
//! with panic = "abort", so every precondition a panic could hit is checked here first.
use overlord_dsp::dsp::{self, Diagnostics, Params};
use std::os::raw::{c_char, c_int};

pub const ODSP_OK: c_int = 0;
pub const ODSP_ENULL: c_int = -1;
pub const ODSP_ELEN: c_int = -2;

/// The v4 constants as a C struct (render_overlord.py, 2026-10-12). `diagnostics`: 0 every sentence (the
/// reference), 1 every `sample_every`-th sentence, 2 never. `shared_layers`: 1 compute fundamental/envelope/gate
/// once (same bits), 0 three times as the reference does.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct OdspParams {
    pub body_semitones: f64,
    pub over_gain: f64,
    pub octave_gain: f64,
    pub octave_lowpass_hz: f64,
    pub double_gain: f64,
    pub double_lowpass_hz: f64,
    pub overtone_gain: f64,
    pub overtone_weights: [f64; 3], // orders 2, 3, 4
    pub fifth_gain: f64,
    pub fifth_lowpass_hz: f64,
    pub shelf_db: f64,
    pub diagnostics: c_int,
    pub sample_every: c_int,
    pub shared_layers: c_int,
}

impl OdspParams {
    fn from(p: &Params) -> Self {
        OdspParams {
            body_semitones: p.body_semitones,
            over_gain: p.over_gain,
            octave_gain: p.octave_gain,
            octave_lowpass_hz: p.octave_lowpass_hz,
            double_gain: p.double_gain,
            double_lowpass_hz: p.double_lowpass_hz,
            overtone_gain: p.overtone_gain,
            overtone_weights: [p.overtone_weights[0], p.overtone_weights[1], p.overtone_weights[2]],
            fifth_gain: p.fifth_gain,
            fifth_lowpass_hz: p.fifth_lowpass_hz,
            shelf_db: p.shelf_db,
            diagnostics: 0,
            sample_every: 8,
            shared_layers: 1,
        }
    }
    fn to(&self) -> Params {
        Params {
            body_semitones: self.body_semitones,
            over_gain: self.over_gain,
            octave_gain: self.octave_gain,
            octave_lowpass_hz: self.octave_lowpass_hz,
            double_gain: self.double_gain,
            double_lowpass_hz: self.double_lowpass_hz,
            overtone_gain: self.overtone_gain,
            overtone_orders: vec![2, 3, 4],
            overtone_weights: self.overtone_weights.to_vec(),
            fifth_gain: self.fifth_gain,
            fifth_lowpass_hz: self.fifth_lowpass_hz,
            shelf_db: self.shelf_db,
            diagnostics: match self.diagnostics {
                1 => Diagnostics::Sampled(self.sample_every.max(1) as usize),
                2 => Diagnostics::Off,
                _ => Diagnostics::Every,
            },
            shared_layers: self.shared_layers != 0,
        }
    }
}

unsafe fn slice<'a>(p: *const f64, n: usize) -> Option<&'a [f64]> {
    if p.is_null() { None } else { Some(std::slice::from_raw_parts(p, n)) }
}
unsafe fn put(dst: *mut f64, src: &[f64]) {
    std::ptr::copy_nonoverlapping(src.as_ptr(), dst, src.len());
}

/// NUL-terminated "overlord-dsp <version>".
#[no_mangle]
pub extern "C" fn odsp_version() -> *const c_char {
    concat!("overlord-dsp ", env!("CARGO_PKG_VERSION"), "\0").as_ptr() as *const c_char
}

/// Fill `out` with the v4 defaults.
#[no_mangle]
pub unsafe extern "C" fn odsp_params_default(out: *mut OdspParams) -> c_int {
    if out.is_null() {
        return ODSP_ENULL;
    }
    *out = OdspParams::from(&Params::default());
    ODSP_OK
}

/// overlord_dsp.pitch_shift(x, sr, semitones) -> out[n]. n >= 2.
#[no_mangle]
pub unsafe extern "C" fn odsp_pitch_shift(x: *const f64, n: usize, sr: u32, semitones: f64, out: *mut f64) -> c_int {
    let Some(x) = slice(x, n) else { return ODSP_ENULL };
    if out.is_null() {
        return ODSP_ENULL;
    }
    let win = ((0.032 * sr as f64) as usize) / 2 * 2;
    if n < 2 || sr == 0 || win == 0 || !semitones.is_finite() || ((n as f64) / overlord_dsp::xmath::semitone_ratio(semitones)).round() < (win as f64) {
        return ODSP_ELEN;
    }
    put(out, &dsp::pitch_shift(x, sr as usize, semitones));
    ODSP_OK
}

/// overlord_dsp.warp(x, pos, sr) -> out[npos]. nx >= the 32 ms window; pos >= 0.
#[no_mangle]
pub unsafe extern "C" fn odsp_warp(x: *const f64, nx: usize, pos: *const f64, npos: usize, sr: u32, out: *mut f64) -> c_int {
    let (Some(x), Some(pos)) = (slice(x, nx), slice(pos, npos)) else { return ODSP_ENULL };
    if out.is_null() {
        return ODSP_ENULL;
    }
    let win = ((0.032 * sr as f64) as usize) / 2 * 2;
    if sr == 0 || win == 0 || nx < win || npos == 0 || pos.iter().any(|p| !(*p >= 0.0) || !p.is_finite()) {
        return ODSP_ELEN;
    }
    put(out, &dsp::warp(x, pos, sr as usize));
    ODSP_OK
}

/// overlord_dsp.align_map(ref, other, sr) -> out[nref]. Both >= 2048 samples (the renderer's own condition).
#[no_mangle]
pub unsafe extern "C" fn odsp_align_map(r: *const f64, nr: usize, o: *const f64, no: usize, sr: u32, out: *mut f64) -> c_int {
    let (Some(r), Some(o)) = (slice(r, nr), slice(o, no)) else { return ODSP_ENULL };
    if out.is_null() {
        return ODSP_ENULL;
    }
    if nr < 2048 || no < 2048 || sr == 0 {
        return ODSP_ELEN;
    }
    put(out, &dsp::align_map(r, o, sr as usize));
    ODSP_OK
}

/// The three v4 layers of a body: octave f/2, double f/4, overtones -> three outputs of n each. n >= 2048.
#[no_mangle]
pub unsafe extern "C" fn odsp_layers(body: *const f64, n: usize, sr: u32, p: *const OdspParams, octave: *mut f64,
                                     double: *mut f64, overtones: *mut f64) -> c_int {
    let Some(body) = slice(body, n) else { return ODSP_ENULL };
    if p.is_null() || octave.is_null() || double.is_null() || overtones.is_null() {
        return ODSP_ENULL;
    }
    if n < 2048 || sr == 0 {
        return ODSP_ELEN;
    }
    let (o2, o4, ov) = dsp::layers(body, sr as usize, &(*p).to());
    put(octave, &o2);
    put(double, &o4);
    put(overtones, &ov);
    ODSP_OK
}

/// One v4 sentence -> mix[na] (before the document finish). `index` is the sentence's position (for sampled
/// diagnostics). On return `*flags` has bit 0 set if `*lag_ms` was written and bit 1 if `offsets[0..3]` were
/// (octave, double, overtones). na >= 8 (the renderer skips shorter bodies); the layers need na >= 2048 and the
/// overtone voice nj >= 2048, as in render_overlord.py.
#[no_mangle]
pub unsafe extern "C" fn odsp_sentence(a: *const f64, na: usize, j: *const f64, nj: usize, sr: u32, index: usize,
                                       p: *const OdspParams, mix: *mut f64, lag_ms: *mut f64, offsets: *mut i64,
                                       flags: *mut c_int) -> c_int {
    let (Some(a), Some(j)) = (slice(a, na), slice(j, nj)) else { return ODSP_ENULL };
    if p.is_null() || mix.is_null() || lag_ms.is_null() || offsets.is_null() || flags.is_null() {
        return ODSP_ENULL;
    }
    let win = ((0.032 * sr as f64) as usize) / 2 * 2;
    // pitch_shift's WSOLA needs the resampled body to hold one window
    if na < 8 || sr == 0 || na < win + 2 {
        return ODSP_ELEN;
    }
    let s = dsp::sentence(a, j, sr as usize, index, &(*p).to());
    put(mix, &s.mix);
    let mut f = 0;
    if let Some(l) = s.residual_lag_ms {
        *lag_ms = l;
        f |= 1;
    }
    if let Some(o) = s.offsets {
        std::ptr::copy_nonoverlapping(o.as_ptr(), offsets, 3);
        f |= 2;
    }
    *flags = f;
    ODSP_OK
}
