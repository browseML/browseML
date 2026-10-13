#!/usr/bin/env python3
# SPDX-License-Identifier: MIT OR Apache-2.0
"""The ctypes path against the Python reference itself, on the golden input (testdata/a.f64, j.f64 - regenerate
with tools/golden.py). The reference is imported from $MINDX_RENDER_DIR (default ~/mindX/.../render) and RUN here,
so this compares live outputs, not stored ones. Bars as tests/*.rs:
  E0  bit-exact: pitch_shift -1 and -7, align_map, warp, and the sentence's diagnostics (lag, offsets)
  E1  >= 100 dB SNR: the three layers, the sentence mix
Run with the interpreter production uses (numpy + numba):  python python/test_ctypes.py   (or pytest)
"""
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, os.environ.get("MINDX_RENDER_DIR",
                                  os.path.expanduser("~/mindX/mindx_backend_service/deltaverse/render")))
import overlord_dsp as ref  # noqa: E402
import overlord_dsp_rs as rs  # noqa: E402

TD = Path(os.environ.get("OVERLORD_DSP_TESTDATA", HERE.parent / "testdata"))
SR = 22050
a = np.fromfile(TD / "a.f64", dtype="<f8")
j = np.fromfile(TD / "j.f64", dtype="<f8")


def bits_differ(x, y):
    return int(np.count_nonzero(np.asarray(x).view(np.uint64) != np.asarray(y).view(np.uint64)))


def snr(want, got):
    e = float(np.sum((want - got) ** 2))
    return float("inf") if e == 0 else 10 * np.log10(float(np.sum(want ** 2)) / e)


def e0(name, want, got):
    d = bits_differ(want, got)
    print("E0  %-28s %d samples, %d differ in bits" % (name, len(want), d))
    assert d == 0, name


def e1(name, want, got):
    s = snr(want, got)
    print("E1  %-28s SNR %.1f dB" % (name, s))
    assert s >= 100.0, name


def test_pitch_shift():
    e0("pitch_shift -1", ref.pitch_shift(a, SR, -1.0), rs.pitch_shift(a, SR, -1.0))
    e0("pitch_shift -7", ref.pitch_shift(a, SR, -7.0), rs.pitch_shift(a, SR, -7.0))


def test_align_and_warp():
    amap = ref.align_map(a, j, SR)
    e0("align_map", amap, rs.align_map(a, j, SR))
    e0("warp", ref.warp(j, amap, SR), rs.warp(j, amap, SR))


def test_layers():
    body = ref.pitch_shift(a, SR, -1.0)
    o2, o4, ov = rs.layers(body, SR)
    e1("octave f/2", ref.octave_divider(body, SR, 2, 180.0), o2)
    e1("double f/4", ref.octave_divider(body, SR, 4, 140.0), o4)
    e1("overtones", ref.harmonic_overtones(body, SR, (2, 3, 4), (1.0, 0.6, 0.35)), ov)


def reference_sentence():
    """render_overlord.py v4's loop body, verbatim in its DSP (the manifest bookkeeping aside)."""
    body = ref.pitch_shift(a, SR, -1.0)
    mix = ref.exciter(body, SR)
    jw = ref.warp(j, ref.align_map(a, j, SR), SR)
    lag = ref.residual_lag_ms(a, jw, SR)
    mix = mix + 0.42 * jw
    octave = ref.octave_divider(body, SR, 2, 180.0)
    double = ref.octave_divider(body, SR, 4, 140.0)
    over = ref.harmonic_overtones(body, SR, (2, 3, 4), (1.0, 0.6, 0.35))
    offs = [ref.offset_samples(body, L, SR) for L in (octave, double, over)]
    mix = mix + 0.44 * octave + 0.16 * double + 0.24 * over
    mix = mix + 0.20 * ref.lowpass(ref.pitch_shift(a, SR, -7.0), SR, 1500.0)
    return ref.low_shelf(mix, SR, 180.0, 5.0), lag, offs


def test_sentence():
    want, lag, offs = reference_sentence()
    mix, rlag, roffs = rs.sentence(a, j, SR, 0)
    e1("sentence mix", want, mix)
    print("E0  %-28s %r vs reference %r" % ("residual_lag_ms", rlag, lag))
    print("E0  %-28s %r vs reference %r" % ("offset_samples x3", roffs, offs))
    assert rlag == lag and roffs == offs
    k = 0.89 * 32767.0 / np.max(np.abs(want))
    q = lambda v: np.clip(v * k, -32767, 32767).astype(np.int32)
    d = np.abs(q(want) - q(mix))
    print("    sentence as int16: %d of %d samples differ, max %d LSB" % (np.count_nonzero(d), len(d), d.max()))
    assert d.max() <= 1 and np.count_nonzero(d) <= 0.001 * len(d)
    off, olag, ooffs = rs.sentence(a, j, SR, 0, diagnostics="off")
    assert bits_differ(off, mix) == 0 and olag is None and ooffs is None
    print("    diagnostics off: mix bit-identical, no lag/offsets computed")


if __name__ == "__main__":
    print(rs.version(), "| numpy", np.__version__, "| numba", "yes" if ref.njit.__module__.startswith("numba") else "NO")
    for t in (test_pitch_shift, test_align_and_warp, test_layers, test_sentence):
        t()
    print("ctypes path: all checks passed")
