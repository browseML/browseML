# SPDX-License-Identifier: MIT OR Apache-2.0
"""Reference outputs for test_node.mjs, computed by mindX utils/docspeech/engines.py's own `Layered` functions.

    MINDX=~/mindX ~/mindX/.mindx_env/bin/python ref_engines.py OUT_DIR

Writes OUT_DIR/{x,band,band_np,fit,echo,fall,softknee}.f32 (little-endian float32) and meta.json. The input is
deterministic (three harmonic statements with silences and a little seeded noise, 22050 Hz), saved as float32 and
every reference is computed in float64 from exactly those float32 values, as the wasm module does.

band: engines has no band-pass of this shape (_band is two one-pole IIRs, a different filter). Two references:
  band    = x - Layered._eq(x, [[lo, hi, -inf dB]])  (the _eq band cut to nothing is a band-STOP; x minus it is the
            band-pass with _eq's own raised-cosine curve; equal FFT size to fft_filter because len is not 2^k - 1)
  band_np = a plain numpy FFT of the same curve at fft_filter's n = next pow2 >= len + 1
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.expanduser(os.environ.get("MINDX", "~/mindX")))
from utils.docspeech.engines import Layered  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ODSP_REF_DIR", "/tmp/odsp_ref")
os.makedirs(out, exist_ok=True)
SR = 22050
LO, HI = 300.0, 3000.0
FIT_N = 50000
ECHO = {"ms": 34.0, "taps": 3, "decay": 0.55, "dry": 0.0}
ECHO2 = {"ms": 21.0, "taps": 4, "decay": 0.6, "dry": 0.7}
FALL_ST, FALL_S = 1.0, 0.3


def statement(f0, secs, silence):
    t = np.arange(int(secs * SR)) / SR
    env = np.minimum(t / 0.02, 1.0) * np.minimum((secs - t) / 0.02, 1.0)
    v = sum(np.sin(2 * np.pi * f0 * h * t) / h for h in range(1, 6)) * 0.3 * env
    return np.concatenate([v, np.zeros(int(silence * SR))])


rng = np.random.RandomState(20261013)
x = np.concatenate([statement(130.0, 1.1, 0.25), statement(118.0, 0.8, 0.3), statement(142.0, 0.9, 0.35)])
x = x + rng.standard_normal(len(x)) * 0.002
x = x.astype(np.float32)
n = len(x)
assert (n + 1) & n != 0, "len must not be 2^k - 1 (fft_filter pads to pow2 >= n+1, _eq to pow2 >= n)"
xd = x.astype(np.float64)

band_eq = xd - Layered._eq(xd, [[LO, HI, float("-inf")]], SR)


def weight(f, lo, hi):
    edge = max(1.0, (hi - lo) / 3.0)
    w = np.zeros_like(f)
    w[(f >= lo + edge) & (f <= hi - edge)] = 1.0
    up = (f >= lo) & (f < lo + edge)
    w[up] = 0.5 - 0.5 * np.cos(np.pi * (f[up] - lo) / edge)
    dn = (f > hi - edge) & (f <= hi)
    w[dn] = 0.5 - 0.5 * np.cos(np.pi * (hi - f[dn]) / edge)
    return w


m = 1 << int(np.ceil(np.log2(n + 1)))
band_np = np.fft.irfft(np.fft.rfft(xd, m) * weight(np.fft.rfftfreq(m, 1.0 / SR), LO, HI), m)[:n]

fit = Layered._fit(xd, FIT_N)
echo = Layered._echo(xd.copy(), SR, ECHO)
echo2 = Layered._echo(xd.copy(), SR, ECHO2)
fall = Layered._fall(xd, SR, FALL_ST, FALL_S)
mix = np.tanh(xd * 0.9) / np.tanh(0.9)               # the end of Layered.synth, before int16
peak = float(np.abs(mix).max()) or 1.0
knee = mix / peak * 0.89

for name, v in [("x", x), ("band", band_eq), ("band_np", band_np), ("fit", fit), ("echo", echo),
                ("echo2", echo2), ("fall", fall), ("softknee", knee)]:
    np.asarray(v, dtype="<f4").tofile(os.path.join(out, name + ".f32"))
json.dump({"sr": SR, "n": n, "lo": LO, "hi": HI, "fit_n": FIT_N, "echo": ECHO, "echo2": ECHO2,
           "fall_st": FALL_ST, "fall_s": FALL_S, "fall_len": len(fall), "numpy": np.__version__,
           "band_eq_vs_np_max_abs": float(np.abs(band_eq - band_np).max())},
          open(os.path.join(out, "meta.json"), "w"), indent=1)
print(json.dumps(json.load(open(os.path.join(out, "meta.json")))))
