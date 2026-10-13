# SPDX-License-Identifier: MIT OR Apache-2.0
"""ctypes shim over liboverlord_dsp_c.so (the crate's C ABI, capi/src/lib.rs) - the docspeech/libsndfile pattern: no
PyO3, no build step on the Python side, numpy arrays in and out.

STANDALONE. Nothing in mindX imports this; the production renderer keeps calling overlord_dsp.py, which stays the
reference. The function names and arguments mirror overlord_dsp.py's.

    import overlord_dsp_rs as rs
    body = rs.pitch_shift(a, 22050, -1.0)                 # bit-identical to overlord_dsp.pitch_shift
    out = rs.sentence(a, j, 22050, index=0, diagnostics="every")

The library (cargo build --release -p overlord-dsp-capi) is found at $OVERLORD_DSP_LIB, else
../target/release/liboverlord_dsp_c.so beside this file.
"""
import ctypes as C
import os
from pathlib import Path

import numpy as np

_here = Path(__file__).resolve().parent
_path = os.environ.get("OVERLORD_DSP_LIB") or str(_here.parent / "target" / "release" / "liboverlord_dsp_c.so")
_lib = C.CDLL(_path)

_D = C.POINTER(C.c_double)
_L = C.POINTER(C.c_int64)


class Params(C.Structure):
    """src/capi.rs OdspParams: render_overlord.py v4's constants, plus the iteration-2 switches."""
    _fields_ = [("body_semitones", C.c_double), ("over_gain", C.c_double), ("octave_gain", C.c_double),
                ("octave_lowpass_hz", C.c_double), ("double_gain", C.c_double), ("double_lowpass_hz", C.c_double),
                ("overtone_gain", C.c_double), ("overtone_weights", C.c_double * 3), ("fifth_gain", C.c_double),
                ("fifth_lowpass_hz", C.c_double), ("shelf_db", C.c_double), ("diagnostics", C.c_int),
                ("sample_every", C.c_int), ("shared_layers", C.c_int)]


_lib.odsp_version.restype = C.c_char_p
_lib.odsp_params_default.argtypes = [C.POINTER(Params)]
_lib.odsp_pitch_shift.argtypes = [_D, C.c_size_t, C.c_uint32, C.c_double, _D]
_lib.odsp_warp.argtypes = [_D, C.c_size_t, _D, C.c_size_t, C.c_uint32, _D]
_lib.odsp_align_map.argtypes = [_D, C.c_size_t, _D, C.c_size_t, C.c_uint32, _D]
_lib.odsp_layers.argtypes = [_D, C.c_size_t, C.c_uint32, C.POINTER(Params), _D, _D, _D]
_lib.odsp_sentence.argtypes = [_D, C.c_size_t, _D, C.c_size_t, C.c_uint32, C.c_size_t, C.POINTER(Params), _D, _D, _L,
                               C.POINTER(C.c_int)]
for _f in ("odsp_params_default", "odsp_pitch_shift", "odsp_warp", "odsp_align_map", "odsp_layers", "odsp_sentence"):
    getattr(_lib, _f).restype = C.c_int

_ERR = {-1: "null pointer", -2: "length the reference would reject"}


def _check(rc, name):
    if rc != 0:
        raise ValueError("%s: %s (rc=%d)" % (name, _ERR.get(rc, "error"), rc))


def _in(x):
    x = np.ascontiguousarray(x, dtype=np.float64)
    return x, x.ctypes.data_as(_D)


def _out(n):
    y = np.empty(n, dtype=np.float64)
    return y, y.ctypes.data_as(_D)


def version():
    return _lib.odsp_version().decode()


def params(**kw):
    """The v4 defaults, with any field overridden (diagnostics may be 'every' | 'sampled' | 'off')."""
    p = Params()
    _check(_lib.odsp_params_default(C.byref(p)), "params")
    for k, v in kw.items():
        if k == "diagnostics":
            v = {"every": 0, "sampled": 1, "off": 2}[v] if isinstance(v, str) else v
        if k == "overtone_weights":
            v = (C.c_double * 3)(*v)
        setattr(p, k, v)
    return p


def pitch_shift(x, sr, semitones):
    x, px = _in(x)
    y, py = _out(len(x))
    _check(_lib.odsp_pitch_shift(px, len(x), sr, float(semitones), py), "pitch_shift")
    return y


def warp(x, pos, sr):
    x, px = _in(x)
    pos, pp = _in(pos)
    y, py = _out(len(pos))
    _check(_lib.odsp_warp(px, len(x), pp, len(pos), sr, py), "warp")
    return y


def align_map(ref, other, sr):
    ref, pr = _in(ref)
    other, po = _in(other)
    y, py = _out(len(ref))
    _check(_lib.odsp_align_map(pr, len(ref), po, len(other), sr, py), "align_map")
    return y


def layers(body, sr, p=None):
    """(octave f/2, double f/4, overtones) from one fundamental/envelope/gate."""
    body, pb = _in(body)
    p = p or params()
    (o2, p2), (o4, p4), (ov, pv) = _out(len(body)), _out(len(body)), _out(len(body))
    _check(_lib.odsp_layers(pb, len(body), sr, C.byref(p), p2, p4, pv), "layers")
    return o2, o4, ov


def sentence(a, j, sr, index=0, p=None, **kw):
    """One OVERLORD v4 sentence (render_overlord.py's loop body). Returns (mix, residual_lag_ms or None,
    [octave, double, overtones] offsets or None)."""
    a, pa = _in(a)
    j, pj = _in(j)
    p = p or params(**kw)
    mix, pm = _out(len(a))
    lag = C.c_double(0.0)
    offs = np.zeros(3, dtype=np.int64)
    flags = C.c_int(0)
    _check(_lib.odsp_sentence(pa, len(a), pj, len(j), sr, index, C.byref(p), pm, C.byref(lag),
                              offs.ctypes.data_as(_L), C.byref(flags)), "sentence")
    return mix, (lag.value if flags.value & 1 else None), (offs.tolist() if flags.value & 2 else None)
