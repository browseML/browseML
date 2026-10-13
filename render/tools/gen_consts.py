#!/usr/bin/env python3
"""The constants of src/xmath.rs, from exact integer arithmetic (no mpmath, no float until the final split).

  python3 tools/gen_consts.py > /dev/stdout   # paste-ready Rust; src/xmath.rs carries the output verbatim

pi by Machin's formula to 400 bits; ln 2 by atanh series; 1/n! exactly. Each constant is split greedily into
doubles hi, mid, lo with hi = nearest double to the value, mid = nearest double to the remainder, and so on, so the
parts are disjoint and their exact sum is the value to ~160 bits.
"""
from fractions import Fraction as F

B = 400
ONE = 1 << B

def arctan_inv(x):           # arctan(1/x) * 2^B, integer series
    s, t, n, sign = 0, ONE // x, 1, 1
    x2 = x * x
    while t:
        s += sign * (t // n)
        t //= x2; n += 2; sign = -sign
    return s

PI = F(4 * (4 * arctan_inv(5) - arctan_inv(239)), ONE)

def atanh_inv(x):            # atanh(1/x) * 2^B
    s, t, n = 0, ONE // x, 1
    x2 = x * x
    while t:
        s += t // n
        t //= x2; n += 2
    return s

LN2 = F(2 * atanh_inv(3), ONE)   # ln 2 = 2 atanh(1/3)

def parts(v, k):
    out = []
    for _ in range(k):
        h = float(v)
        out.append(h)
        v -= F(h)
    return out

def rs(name, v, k):
    ps = parts(v, k)
    return "const %s: [f64; %d] = [%s];" % (name, k, ", ".join("f64::from_bits(0x%016x)" % __import__("struct").unpack("<Q", __import__("struct").pack("<d", p))[0] for p in ps))

print(rs("PIO2", PI / 2, 4) + " // pi/2")
print(rs("LN2", LN2, 3) + " // ln 2")
fact = 1
inv = []
for n in range(0, 32):
    if n: fact *= n
    inv.append(parts(F(1, fact), 2))
import struct
b = lambda d: "f64::from_bits(0x%016x)" % struct.unpack("<Q", struct.pack("<d", d))[0]
print("const INV_FACT: [[f64; 2]; 32] = [ // 1/n! as (hi, lo)")
for n, (h, l) in enumerate(inv):
    print("    [%s, %s], // 1/%d!" % (b(h), b(l), n))
print("];")
