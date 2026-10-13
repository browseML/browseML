#!/usr/bin/env python3
"""Golden outputs for the Rust OVERLORD DSP proof of concept, written by the Python reference itself.

  python tools/golden.py BODY.raw OTHER.raw [MINDX_RENDER_DIR]

BODY.raw / OTHER.raw: two takes of one sentence, s16le mono 22050 Hz (any open voice; the PoC goldens were made with
piper en_GB-cori-high, public domain, because no restricted voice may leave the server). Writes testdata/*.f64|*.i64
(little-endian) and testdata/meta.json. Run it with the interpreter production uses (numpy + numba): with numba the
DTW and WSOLA loops are compiled, and those are the bits the Rust is held to.
"""
import json, sys, os
from pathlib import Path
import numpy as np

here = Path(__file__).resolve().parents[1]
sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else os.environ.get("MINDX_RENDER_DIR", os.path.expanduser("~/mindX/mindx_backend_service/deltaverse/render")))
import overlord_dsp as dsp

SR = 22050
td = here / "testdata"; td.mkdir(exist_ok=True)
a = np.fromfile(sys.argv[1], dtype="<i2").astype(np.float64) / 32768.0
j = np.fromfile(sys.argv[2], dtype="<i2").astype(np.float64) / 32768.0
w = lambda name, arr: np.ascontiguousarray(arr).astype("<f8" if arr.dtype.kind == "f" else "<i8").tofile(td / name)

body = dsp.pitch_shift(a, SR, -1.0)
w("a.f64", a); w("j.f64", j); w("body.f64", body)

# 1. WSOLA, the compiled loop (exactness target: bit for bit)
amap = dsp.align_map(a, j, SR)
win = int(0.032 * SR) // 2 * 2
hop, tol = win // 4, int(0.008 * SR)
w("amap.f64", amap)
w("wsola.f64", dsp._wsola(np.ascontiguousarray(j), np.ascontiguousarray(amap), win, hop, tol))
w("hann.f64", np.hanning(win))

# 2. DTW on a given cost matrix (exactness target: the path, exactly)
fr, fo = dsp.logmel(a, SR), dsp.logmel(j, SR)
cost = np.ascontiguousarray(1.0 - fr @ fo.T)
pi, pj = dsp._dtw(cost)
w("cost.f64", cost); w("dtw_pi.i64", pi.astype(np.int64)); w("dtw_pj.i64", pj.astype(np.int64))

# 3. The v4 layers from the body's own cycles (target: crossings exactly, samples within the SNR bar)
xf = dsp.fundamental(body, SR)
env = dsp.envelope(xf, SR)
gate = dsp.voiced_gate(env)
w("fundamental.f64", xf); w("envelope.f64", env); w("gate.f64", gate)
for d in (2, 4):
    up = np.where((xf[:-1] < 0) & (xf[1:] >= 0) & (gate[1:] > 0.5))[0] + 1
    w("cross%d.i64" % d, up[::max(1, d // 2)].astype(np.int64))
w("octave2.f64", dsp.octave_divider(body, SR, 2, 180.0))
w("octave4.f64", dsp.octave_divider(body, SR, 4, 140.0))
w("overtones.f64", dsp.harmonic_overtones(body, SR, (2, 3, 4), (1.0, 0.6, 0.35)))

# 4. The rest of one v4 sentence, as render_overlord.py's loop body runs it (constants as there, 2026-10-12 v4)
w("pshift7.f64", dsp.pitch_shift(a, SR, -7.0))
fb = dsp._mel_bank(SR)
mel = lambda f: 2595 * np.log10(1 + f / 700.0)
imel = lambda m: 700 * (10 ** (m / 2595.0) - 1)
w("melbins.i64", np.floor((dsp.NFFT + 1) * imel(np.linspace(mel(60.0), mel(7600.0), 40 + 2)) / SR).astype(np.int64))
w("logmel_a.f64", fr); w("logmel_j.f64", fo)
jw = dsp.warp(j, amap, SR)
lag = dsp.residual_lag_ms(a, jw, SR)
ex = dsp.exciter(body, SR)
w("exciter.f64", ex)
o2, o4 = dsp.octave_divider(body, SR, 2, 180.0), dsp.octave_divider(body, SR, 4, 140.0)
ov = dsp.harmonic_overtones(body, SR, (2, 3, 4), (1.0, 0.6, 0.35))
offs = [dsp.offset_samples(body, L, SR) for L in (o2, o4, ov)]
mix = ex + 0.42 * jw
mix = mix + 0.44 * o2 + 0.16 * o4 + 0.24 * ov
fifth = dsp.lowpass(dsp.pitch_shift(a, SR, -7.0), SR, 1500.0)
w("fifth.f64", fifth)
mix = mix + 0.20 * fifth
mix = dsp.low_shelf(mix, SR, 180.0, 5.0)
w("mix.f64", mix)

import hashlib
json.dump({"reference_sha256": hashlib.sha256(open(dsp.__file__, "rb").read()).hexdigest(), "residual_lag_ms": lag, "residual_lag_ms_unaligned": dsp.residual_lag_ms(a, j, SR), "offsets": offs, "sr": SR, "n_a": len(a), "n_j": len(j), "n_body": len(body), "win": win, "hop": hop, "tol": tol,
           "cost_shape": list(cost.shape), "dtw_len": int(len(pi)),
           "numba": __import__("numba").__version__ if dsp.njit.__module__.startswith("numba") else False,
           "numpy": np.__version__},
          open(td / "meta.json", "w"), indent=1)
print(json.load(open(td / "meta.json")))
