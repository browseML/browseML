#!/usr/bin/env python3
# SPDX-License-Identifier: MIT OR Apache-2.0
"""A small corpus, end to end: every sentence through the LIVE Python reference and through the crate (ctypes),
compared stage by stage, then timed in interleaved rounds (thread CPU time, the gate's unit).

  python python/corpus.py prepare OUT_DIR BODY_DIR OTHER_DIR   # piper --output_dir WAVs (one per line, same order)
  python python/corpus.py check   OUT_DIR                      # exactness, every sentence
  python python/corpus.py bench   OUT_DIR [ROUNDS] [REPS]      # reference vs ctypes, interleaved

OUT_DIR holds NN_a.f64 / NN_j.f64 (body take, overtone take; little-endian float64 at 22050 Hz), the format the
Rust bench reads too (overlord-bench --corpus OUT_DIR). Use open voices only (cori, kristin, bryce...).
"""
import os
import sys
import time
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_ctypes import ref, rs, bits_differ, snr  # noqa: E402  (imports the reference from $MINDX_RENDER_DIR)

SR = 22050


def prepare(out, bdir, odir):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    bs, os_ = sorted(Path(bdir).glob("*.wav")), sorted(Path(odir).glob("*.wav"))
    assert len(bs) == len(os_) and bs, "need matching WAV lists"
    for k, (b, o) in enumerate(zip(bs, os_)):
        for src, tag in ((b, "a"), (o, "j")):
            with wave.open(str(src)) as w:
                assert w.getframerate() == SR and w.getsampwidth() == 2 and w.getnchannels() == 1
                x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
            x.astype("<f8").tofile(out / ("%02d_%s.f64" % (k, tag)))
    print("prepared %d sentence pairs in %s" % (len(bs), out))


def pairs(d):
    d = Path(d)
    for a in sorted(d.glob("*_a.f64")):
        yield a.name[:2], np.fromfile(a, dtype="<f8"), np.fromfile(d / (a.name[:2] + "_j.f64"), dtype="<f8")


def ref_sentence(a, j):
    """render_overlord.py v4's loop body (as test_ctypes.reference_sentence, for any pair)."""
    body = ref.pitch_shift(a, SR, -1.0)
    mix = ref.exciter(body, SR)
    lag = offs = None
    if len(j) >= 2048 and len(a) >= 2048:
        jw = ref.warp(j, ref.align_map(a, j, SR), SR)
        lag = ref.residual_lag_ms(a, jw, SR)
        mix = mix + 0.42 * jw
    if len(a) >= 2048:
        octave = ref.octave_divider(body, SR, 2, 180.0)
        double = ref.octave_divider(body, SR, 4, 140.0)
        over = ref.harmonic_overtones(body, SR, (2, 3, 4), (1.0, 0.6, 0.35))
        offs = [ref.offset_samples(body, L, SR) for L in (octave, double, over)]
        mix = mix + 0.44 * octave + 0.16 * double + 0.24 * over
        mix = mix + 0.20 * ref.lowpass(ref.pitch_shift(a, SR, -7.0), SR, 1500.0)
    return ref.low_shelf(mix, SR, 180.0, 5.0), lag, offs


def check(d):
    ok = True
    for k, a, j in pairs(d):
        e = {"body": bits_differ(ref.pitch_shift(a, SR, -1.0), rs.pitch_shift(a, SR, -1.0)),
             "fifth": bits_differ(ref.pitch_shift(a, SR, -7.0), rs.pitch_shift(a, SR, -7.0)),
             "align_map": bits_differ(ref.align_map(a, j, SR), rs.align_map(a, j, SR))}
        want, lag, offs = ref_sentence(a, j)
        mix, rlag, roffs = rs.sentence(a, j, SR, 0)
        kq = 0.89 * 32767.0 / np.max(np.abs(want))
        dq = np.abs(np.clip(want * kq, -32767, 32767).astype(np.int32) - np.clip(mix * kq, -32767, 32767).astype(np.int32))
        good = all(v == 0 for v in e.values()) and rlag == lag and roffs == offs and snr(want, mix) >= 100 and dq.max() <= 1
        ok &= good
        print("%s %6.2fs  E0 bits differ %s  lag %s/%s  offsets %s/%s  mix %.1f dB  int16 %d differ (max %d)  %s"
              % (k, len(a) / SR, e, rlag, lag, roffs, offs, snr(want, mix), np.count_nonzero(dq), dq.max(),
                 "OK" if good else "FAIL"))
    print("corpus check:", "all sentences pass" if ok else "FAILURES")
    return ok


def bench(d, rounds=5, reps=3):
    ps = list(pairs(d))
    audio = sum(len(a) for _, a, _ in ps) / SR
    for _, a, j in ps:                                   # warm numba and the plan caches
        ref_sentence(a, j); rs.sentence(a, j, SR, 0)
    cases = [("python reference", lambda a, j, i: ref_sentence(a, j)),
             ("rust ctypes, diag every", lambda a, j, i: rs.sentence(a, j, SR, i)),
             ("rust ctypes, diag 1/8", lambda a, j, i: rs.sentence(a, j, SR, i, diagnostics="sampled", sample_every=8)),
             ("rust ctypes, diag off", lambda a, j, i: rs.sentence(a, j, SR, i, diagnostics="off"))]
    res = {n: [] for n, _ in cases}
    for r in range(rounds):                              # interleaved: each round runs every case once
        for name, fn in (cases if r % 2 == 0 else cases[::-1]):
            best = []
            for _ in range(reps):
                t = time.thread_time()
                for i, (_, a, j) in enumerate(ps):
                    fn(a, j, i)
                best.append(time.thread_time() - t)
            res[name].append(sorted(best)[len(best) // 2] / audio)
    print("corpus: %d sentences, %.2f s of audio, %d interleaved rounds x median of %d (thread CPU s per audio s)"
          % (len(ps), audio, rounds, reps))
    base = res["python reference"]
    for name, v in res.items():
        ratio = [x / y for x, y in zip(v, base)]
        print("  %-26s median %.4f  range %.4f-%.4f   vs reference: median %.2fx  range %.2f-%.2fx"
              % (name, np.median(v), min(v), max(v), np.median(ratio), min(ratio), max(ratio)))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "prepare":
        prepare(*sys.argv[2:5])
    elif cmd == "check":
        sys.exit(0 if check(sys.argv[2]) else 1)
    elif cmd == "bench":
        bench(sys.argv[2], *(int(v) for v in sys.argv[3:5]))
