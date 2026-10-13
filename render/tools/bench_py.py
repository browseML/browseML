#!/usr/bin/env python3
"""The same stages as src/bin/bench.rs, timed in the Python reference (numba when installed): median of N runs."""
import json, os, sys, time
from pathlib import Path
import numpy as np
sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else os.environ.get("MINDX_RENDER_DIR", os.path.expanduser("~/mindX/mindx_backend_service/deltaverse/render")))
import overlord_dsp as dsp
td = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "testdata"
reps = int(sys.argv[2]) if len(sys.argv) > 2 else 7
f = lambda n: np.fromfile(td / n, dtype="<f8")
a, j, amap, body, cost = f("a.f64"), f("j.f64"), f("amap.f64"), f("body.f64"), f("cost.f64")
m = json.load(open(td / "meta.json")); cost = cost.reshape(m["cost_shape"])
SR = 22050
def med(fn):
    fn()                                   # warm (numba compile / cache load)
    v = []
    for _ in range(reps):
        t = time.perf_counter(); fn(); v.append(time.perf_counter() - t)
    return sorted(v)[reps // 2]
rows = [("pitch_shift -1 (body)", med(lambda: dsp.pitch_shift(a, SR, -1.0))),
        ("pitch_shift -7 (fifth, before lowpass)", med(lambda: dsp.pitch_shift(a, SR, -7.0))),
        ("warp jenny (WSOLA, given amap)", med(lambda: dsp.warp(j, amap, SR))),
        ("dtw (given cost)", med(lambda: dsp._dtw(cost))),
        ("octave_divider f/2", med(lambda: dsp.octave_divider(body, SR, 2, 180.0))),
        ("octave_divider f/4", med(lambda: dsp.octave_divider(body, SR, 4, 140.0))),
        ("harmonic_overtones", med(lambda: dsp.harmonic_overtones(body, SR, (2, 3, 4), (1.0, .6, .35))))]
tot = sum(r[1] for r in rows); audio = len(a) / SR
print("python  numba=%s  audio %.2fs  reps %d  ported stages total %.1f ms  (%.0fx realtime)"
      % (dsp.njit.__module__.startswith("numba"), audio, reps, tot * 1e3, audio / tot))
for k, v in rows:
    print("  %-40s %8.2f ms" % (k, v * 1e3))
