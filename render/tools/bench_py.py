#!/usr/bin/env python3
"""The same as src/bin/bench.rs in the Python reference (numba when installed): median of N runs, per stage and the
whole v4 sentence exactly as render_overlord.py's loop body runs it.

  python tools/bench_py.py [testdata] [reps] [MINDX_RENDER_DIR]
"""
import json, os, sys, time
from pathlib import Path
import numpy as np
sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else os.environ.get("MINDX_RENDER_DIR", os.path.expanduser("~/mindX/mindx_backend_service/deltaverse/render")))
import overlord_dsp as dsp
td = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "testdata"
reps = int(sys.argv[2]) if len(sys.argv) > 2 else 7
f = lambda n: np.fromfile(td / n, dtype="<f8")
a, j, amap, body, jw = f("a.f64"), f("j.f64"), f("amap.f64"), f("body.f64"), f("wsola.f64")
SR = 22050
def med(fn):
    fn()                                   # warm (numba compile / cache load)
    v = []
    for _ in range(reps):
        t = time.thread_time(); fn(); v.append(time.thread_time() - t)   # CPU time of this thread
    return sorted(v)[reps // 2]
o2, o4 = dsp.octave_divider(body, SR, 2, 180.0), dsp.octave_divider(body, SR, 4, 140.0)
ov = dsp.harmonic_overtones(body, SR, (2, 3, 4), (1.0, .6, .35))
def sentence():                            # render_overlord.py v4, the loop body (manifest bookkeeping aside)
    body = dsp.pitch_shift(a, SR, -1.0)
    mix = dsp.exciter(body, SR)
    jw = dsp.warp(j, dsp.align_map(a, j, SR), SR)
    lag = dsp.residual_lag_ms(a, jw, SR)
    mix = mix + 0.42 * jw
    octave = dsp.octave_divider(body, SR, 2, 180.0)
    double = dsp.octave_divider(body, SR, 4, 140.0)
    over = dsp.harmonic_overtones(body, SR, (2, 3, 4), (1.0, 0.6, 0.35))
    offs = [dsp.offset_samples(body, L, SR) for L in (octave, double, over)]
    mix = mix + 0.44 * octave + 0.16 * double + 0.24 * over
    mix = mix + 0.20 * dsp.lowpass(dsp.pitch_shift(a, SR, -7.0), SR, 1500.0)
    return dsp.low_shelf(mix, SR, 180.0, 5.0)
rows = [("pitch_shift -1 (body)", med(lambda: dsp.pitch_shift(a, SR, -1.0))),
        ("exciter", med(lambda: dsp.exciter(body, SR))),
        ("align_map (logmel x2 + DTW)", med(lambda: dsp.align_map(a, j, SR))),
        ("warp jenny (WSOLA)", med(lambda: dsp.warp(j, amap, SR))),
        ("residual_lag_ms [diag]", med(lambda: dsp.residual_lag_ms(a, jw, SR))),
        ("octave_divider f/2", med(lambda: dsp.octave_divider(body, SR, 2, 180.0))),
        ("octave_divider f/4", med(lambda: dsp.octave_divider(body, SR, 4, 140.0))),
        ("harmonic_overtones", med(lambda: dsp.harmonic_overtones(body, SR, (2, 3, 4), (1.0, .6, .35)))),
        ("offset_samples x3 [diag]", med(lambda: [dsp.offset_samples(body, L, SR) for L in (o2, o4, ov)])),
        ("fifth: pitch_shift -7 + lowpass", med(lambda: dsp.lowpass(dsp.pitch_shift(a, SR, -7.0), SR, 1500.0))),
        ("low_shelf", med(lambda: dsp.low_shelf(body, SR, 180.0, 5.0)))]
audio = len(a) / SR
import numba
print("python numpy %s numba %s  audio %.2fs  reps %d  median thread CPU time" % (np.__version__, numba.__version__ if dsp.njit.__module__.startswith("numba") else "ABSENT", audio, reps))
for k, v in rows:
    print("  %-36s %8.2f ms" % (k, v * 1e3))
print("  %-36s %8.2f ms" % ("sum of stages (reference shape)", sum(r[1] for r in rows) * 1e3))
s = med(sentence)
print("  %-52s %8.2f ms  = %.4f CPU-s per audio-s" % ("sentence: reference (render_overlord v4 loop body)", s * 1e3, s / audio))
