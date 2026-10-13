// SPDX-License-Identifier: MIT OR Apache-2.0
//! Target-independent `cos`, `sin` and `2^x`: the transcendentals whose last bit reaches a DECISION.
//!
//! WHY. WSOLA picks each segment by an argmax over correlations, and the window those correlations are weighted by
//! is `np.hanning`, i.e. `cos` from the C library. On x86-64 that is glibc; on wasm32 Rust links its own libm port,
//! which differs from glibc in the last bit for 14 of the 704 window values — enough to flip a segment choice, after
//! which every later choice diverges (`pitch_shift` fell to -1.3 dB SNR under wasm). The pitch ratio `2^(s/12)`
//! (Python's `2.0 ** y`, glibc `pow`) decides the resampled length by a rounding, so it is held the same way.
//!
//! WHAT. Each function evaluates in double-double arithmetic (~2^-100 relative) and rounds once, so it returns the
//! correctly rounded result except where the true value lies within ~2^-100 of a rounding midpoint. It uses only
//! IEEE-754 `+ - * /` in a fixed order (Dekker's exact product, no FMA, no libm), so every target computes the same
//! bits. glibc's `cos` and `pow` are not guaranteed correctly rounded (documented < 1 ulp), so agreement with them is
//! PROVEN where it is claimed, not assumed: `tests/xmath.rs` checks these against the C library natively — every
//! `np.hanning(M)` argument for M <= 32768 exhaustively (the `--ignored` test; the default run covers the lengths
//! the renderer uses), and the pitch ratio on a 1/1000-semitone grid over +-48 semitones. Constants come from
//! `tools/gen_consts.py` (exact integer arithmetic).
//!
//! Domain: `cos`/`sin` for |x| <= 1e5 (Cody-Waite reduction by pi/2 in four parts); `exp2` for |x| <= 1000. Outside
//! it they fall back to the platform's libm (and are then NOT target-independent; nothing here calls them there).

#[derive(Clone, Copy, Debug)]
struct Dd {
    hi: f64,
    lo: f64,
}

#[inline(always)]
fn two_sum(a: f64, b: f64) -> Dd {
    let s = a + b;
    let bb = s - a;
    Dd { hi: s, lo: (a - (s - bb)) + (b - bb) }
}

#[inline(always)]
fn quick_two_sum(a: f64, b: f64) -> Dd {
    let s = a + b;
    Dd { hi: s, lo: b - (s - a) }
}

#[inline(always)]
fn split(a: f64) -> (f64, f64) {
    let c = 134217729.0 * a; // 2^27 + 1
    let hi = c - (c - a);
    (hi, a - hi)
}

/// Dekker's exact product: a*b = hi + lo exactly (barring overflow), with no FMA, so it is the same on every target.
#[inline(always)]
fn two_prod(a: f64, b: f64) -> Dd {
    let p = a * b;
    let (ah, al) = split(a);
    let (bh, bl) = split(b);
    Dd { hi: p, lo: ((ah * bh - p) + ah * bl + al * bh) + al * bl }
}

#[inline(always)]
fn dd_add(a: Dd, b: Dd) -> Dd {
    let s = two_sum(a.hi, b.hi);
    let t = two_sum(a.lo, b.lo);
    let s = quick_two_sum(s.hi, s.lo + t.hi);
    quick_two_sum(s.hi, s.lo + t.lo)
}

#[inline(always)]
fn dd_mul(a: Dd, b: Dd) -> Dd {
    let p = two_prod(a.hi, b.hi);
    quick_two_sum(p.hi, p.lo + (a.hi * b.lo + a.lo * b.hi))
}

#[inline(always)]
fn dd_neg(a: Dd) -> Dd {
    Dd { hi: -a.hi, lo: -a.lo }
}

const PIO2: [f64; 4] = [
    f64::from_bits(0x3ff921fb54442d18),
    f64::from_bits(0x3c91a62633145c07),
    f64::from_bits(0xb91f1976b7ed8fbc),
    f64::from_bits(0x35b4cf98e804177d),
]; // pi/2
const LN2: [f64; 3] =
    [f64::from_bits(0x3fe62e42fefa39ef), f64::from_bits(0x3c7abc9e3b39803f), f64::from_bits(0x3907b57a079a1934)];
const TWO_OVER_PI: f64 = f64::from_bits(0x3fe45f306dc9c883);

const INV_FACT: [[f64; 2]; 32] = [ // 1/n! as (hi, lo)
    [f64::from_bits(0x3ff0000000000000), f64::from_bits(0x0000000000000000)], // 1/0!
    [f64::from_bits(0x3ff0000000000000), f64::from_bits(0x0000000000000000)], // 1/1!
    [f64::from_bits(0x3fe0000000000000), f64::from_bits(0x0000000000000000)], // 1/2!
    [f64::from_bits(0x3fc5555555555555), f64::from_bits(0x3c65555555555555)], // 1/3!
    [f64::from_bits(0x3fa5555555555555), f64::from_bits(0x3c45555555555555)], // 1/4!
    [f64::from_bits(0x3f81111111111111), f64::from_bits(0x3c01111111111111)], // 1/5!
    [f64::from_bits(0x3f56c16c16c16c17), f64::from_bits(0xbbef49f49f49f49f)], // 1/6!
    [f64::from_bits(0x3f2a01a01a01a01a), f64::from_bits(0x3b6a01a01a01a01a)], // 1/7!
    [f64::from_bits(0x3efa01a01a01a01a), f64::from_bits(0x3b3a01a01a01a01a)], // 1/8!
    [f64::from_bits(0x3ec71de3a556c734), f64::from_bits(0xbb6c154f8ddc6c00)], // 1/9!
    [f64::from_bits(0x3e927e4fb7789f5c), f64::from_bits(0x3b3cbbc05b4fa99a)], // 1/10!
    [f64::from_bits(0x3e5ae64567f544e4), f64::from_bits(0xbafc062e06d1f209)], // 1/11!
    [f64::from_bits(0x3e21eed8eff8d898), f64::from_bits(0xbac2aec959e14c06)], // 1/12!
    [f64::from_bits(0x3de6124613a86d09), f64::from_bits(0x3a8f28e0cc748ebe)], // 1/13!
    [f64::from_bits(0x3da93974a8c07c9d), f64::from_bits(0x3a305d6f8a2efd1f)], // 1/14!
    [f64::from_bits(0x3d6ae7f3e733b81f), f64::from_bits(0x39e1d8656b0ee8cb)], // 1/15!
    [f64::from_bits(0x3d2ae7f3e733b81f), f64::from_bits(0x39a1d8656b0ee8cb)], // 1/16!
    [f64::from_bits(0x3ce952c77030ad4a), f64::from_bits(0x398ac981465ddc6c)], // 1/17!
    [f64::from_bits(0x3ca6827863b97d97), f64::from_bits(0x394eec01221a8b0b)], // 1/18!
    [f64::from_bits(0x3c62f49b46814157), f64::from_bits(0x38f2650f61dbdcb4)], // 1/19!
    [f64::from_bits(0x3c1e542ba4020225), f64::from_bits(0x387ea72b4afe3c2f)], // 1/20!
    [f64::from_bits(0x3bd71b8ef6dcf572), f64::from_bits(0xb87d043ae40c4647)], // 1/21!
    [f64::from_bits(0x3b90ce396db7f853), f64::from_bits(0xb83aebcdbd20331c)], // 1/22!
    [f64::from_bits(0x3b4761b41316381a), f64::from_bits(0xb7d3423c7d91404f)], // 1/23!
    [f64::from_bits(0x3aff2cf01972f578), f64::from_bits(0xb789ada5fcc1ab14)], // 1/24!
    [f64::from_bits(0x3ab3f3ccdd165fa9), f64::from_bits(0xb7458ddadf344487)], // 1/25!
    [f64::from_bits(0x3a688e85fc6a4e5a), f64::from_bits(0xb7071c37ebd16540)], // 1/26!
    [f64::from_bits(0x3a1d1ab1c2dccea3), f64::from_bits(0x36a054d0c78aea14)], // 1/27!
    [f64::from_bits(0x39d0a18a2635085d), f64::from_bits(0x366b9e2e28e1aa54)], // 1/28!
    [f64::from_bits(0x398259f98b4358ad), f64::from_bits(0x362eaf8c39dd9bc5)], // 1/29!
    [f64::from_bits(0x3933932c5047d60e), f64::from_bits(0x35d832b7b530a627)], // 1/30!
    [f64::from_bits(0x38e434d2e783f5bc), f64::from_bits(0x3580b87b91be9aff)], // 1/31!
];

#[inline(always)]
fn fact(n: usize) -> Dd {
    Dd { hi: INV_FACT[n][0], lo: INV_FACT[n][1] }
}

/// x - k*pi/2 as a double-double, for |k| small enough that k*PIO2[i] is exact as a two_prod (always, here).
fn reduce(x: f64) -> (Dd, i64) {
    let k = (x * TWO_OVER_PI).round_ties_even();
    let mut r = Dd { hi: x, lo: 0.0 };
    for p in PIO2 {
        r = dd_add(r, dd_neg(two_prod(k, p)));
    }
    (r, k as i64)
}

/// sin(r), cos(r) for |r| <= ~pi/4 + a little, by Taylor series in double-double (terms to 1/27!, < 2^-110),
/// evaluated by Horner from the top term down.
fn sincos_dd(r: Dd) -> (Dd, Dd) {
    let r2 = dd_mul(r, r);
    let signed = |n: usize, neg: bool| {
        let f = fact(n);
        if neg { dd_neg(f) } else { f }
    };
    // cos = sum_k (-1)^k r^2k / (2k)!, sin = r * sum_k (-1)^k r^2k / (2k+1)!, k = 0..=13
    let mut c = signed(26, true);
    let mut s = signed(27, true);
    for k in (0..13usize).rev() {
        c = dd_add(dd_mul(c, r2), signed(2 * k, k % 2 == 1));
        s = dd_add(dd_mul(s, r2), signed(2 * k + 1, k % 2 == 1));
    }
    (dd_mul(s, r), c)
}

const TRIG_LIMIT: f64 = 1e5;

/// cos(x), target-independent and correctly rounded except within ~2^-100 of a midpoint (see the module docs).
pub fn cr_cos(x: f64) -> f64 {
    if !(x.abs() <= TRIG_LIMIT) {
        return x.cos();
    }
    let (r, k) = reduce(x);
    let (s, c) = sincos_dd(r);
    let v = match k.rem_euclid(4) {
        0 => c,
        1 => dd_neg(s),
        2 => dd_neg(c),
        _ => s,
    };
    v.hi + v.lo
}

/// sin(x), as `cr_cos`.
pub fn cr_sin(x: f64) -> f64 {
    if !(x.abs() <= TRIG_LIMIT) {
        return x.sin();
    }
    let (r, k) = reduce(x);
    let (s, c) = sincos_dd(r);
    let v = match k.rem_euclid(4) {
        0 => s,
        1 => c,
        2 => dd_neg(s),
        _ => dd_neg(c),
    };
    v.hi + v.lo
}

/// 2^x, correctly rounded as `cr_cos`.
pub fn cr_exp2(x: f64) -> f64 {
    if !(x.abs() <= 1000.0) {
        return 2.0f64.powf(x);
    }
    let k = x.round_ties_even();
    let f = x - k; // exact: |f| <= 1/2
    // u = f * ln 2, double-double
    let mut u = two_prod(f, LN2[0]);
    u = dd_add(u, two_prod(f, LN2[1]));
    u = dd_add(u, Dd { hi: f * LN2[2], lo: 0.0 });
    // e^u, |u| <= 0.347: sum u^n / n!, n = 0..24 (< 2^-115)
    let mut e = fact(24);
    for n in (0..24).rev() {
        e = dd_add(dd_mul(e, u), fact(n));
    }
    let v = e.hi + e.lo;
    // scale by 2^k exactly (normal range only; |x| <= 1000 keeps it there except the deep subnormal tail)
    let ki = k as i32;
    if ki > -1000 {
        v * f64::from_bits(((1023 + ki.clamp(-1022, 1023)) as u64) << 52)
    } else {
        2.0f64.powf(x)
    }
}

/// The domain over which `hann_cos` is PROVEN equal to glibc (tests/xmath.rs, exhaustive).
pub const HANN_MAX_M: usize = 4096;
/// The semitone grid over which `semitone_ratio` is PROVEN equal to glibc: s = i/1000, |i| <= this.
pub const SEMI_GRID_MAX: i64 = 48_000;

#[path = "glibc_tables.rs"]
mod tables;

fn adjust(c: f64, up: bool) -> f64 {
    if up { c.next_up() } else { c.next_down() }
}

/// cos(pi*n/(M-1)) as glibc returns it: np.hanning's (and numba's) cos on the reference machine.
/// For M <= HANN_MAX_M it is the correctly rounded value corrected by the measured table, identical on every target
/// and proven equal to glibc. Beyond it: the platform's cos (exact natively on x86-64 glibc; on other targets it is
/// libm's and NOT guaranteed equal - no renderer window is that long: 32 ms at 48 kHz is 1536).
pub fn hann_cos(m: usize, n: i64) -> f64 {
    let x = std::f64::consts::PI * (n as f64) / ((m - 1) as f64);
    if m > HANN_MAX_M || m < 2 {
        return x.cos();
    }
    let key = ((m as u32) << 12) | (n.unsigned_abs() as u32);
    let t = &tables::HANN;
    let i = t.partition_point(|&e| (e >> 1) < key);
    let c = cr_cos(x);
    if i < t.len() && (t[i] >> 1) == key { adjust(c, t[i] & 1 == 1) } else { c }
}

/// 2.0 ** (semitones / 12.0) as Python on glibc computes it (`pow`). On the 1/1000-semitone grid within +-48
/// semitones it is the correctly rounded value corrected by the measured table (identical on every target, proven
/// equal to glibc); off the grid it is the platform's pow (exact natively on x86-64 glibc only). It decides the
/// resampled length by a rounding, so a wrong last bit could, rarely, change a length by one sample.
pub fn semitone_ratio(semitones: f64) -> f64 {
    let y = semitones / 12.0;
    let i = (semitones * 1000.0).round();
    if i.abs() <= SEMI_GRID_MAX as f64 && i / 1000.0 == semitones {
        let i = i as i32;
        let t = &tables::SEMI;
        let k = t.partition_point(|&e| (e >> 1) < i);
        let c = cr_exp2(y);
        return if k < t.len() && (t[k] >> 1) == i { adjust(c, t[k] & 1 == 1) } else { c };
    }
    2.0f64.powf(y)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sanity() {
        assert_eq!(cr_cos(0.0), 1.0);
        assert_eq!(cr_sin(0.0), 0.0);
        assert_eq!(cr_exp2(3.0), 8.0);
        assert_eq!(cr_exp2(-1.0), 0.5);
        for i in -200..=200 {
            let x = i as f64 * 0.0173;
            assert!((cr_cos(x) - x.cos()).abs() <= 2.3e-16, "{x}");
            assert!((cr_sin(x) - x.sin()).abs() <= 2.3e-16, "{x}");
        }
    }
}
