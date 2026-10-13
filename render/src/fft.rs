// SPDX-License-Identifier: MIT OR Apache-2.0
//! The FFT, in-crate: an iterative radix-2 complex transform with every twiddle computed directly (cos/sin of
//! 2*pi*k/n, never by recurrence, so the error does not grow along the table), the real transform as a half-size
//! complex one, and Bluestein's chirp-z for the lengths that are not powers of two (numpy's `fft` on an arbitrary
//! length, which `analytic` needs).
//!
//! Exactness: numpy uses pocketfft, whose butterfly order is not this one, so no FFT here is bit-exact against numpy.
//! What is held instead is a stated SNR against the numpy output (see tests/golden.rs); the stages that do not go
//! through an FFT (WSOLA, DTW, the interpolation) are held bit for bit.

use std::f64::consts::PI;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

thread_local! {
    // Plans are pure functions of n (the same twiddles, computed the same way), so caching them cannot change a bit.
    // Iteration 1 rebuilt a plan, i.e. ~n cos+sin calls, on every fft_filter: ~10 per sentence.
    static REAL_PLANS: RefCell<HashMap<usize, Rc<RealPlan>>> = RefCell::new(HashMap::new());
    static PLANS: RefCell<HashMap<usize, Rc<Plan>>> = RefCell::new(HashMap::new());
    // Bluestein's two work buffers, reused across calls (fresh 4 MiB vectors cost page faults on every sentence)
    static SCRATCH: RefCell<(Vec<C>, Vec<C>)> = RefCell::new((Vec::new(), Vec::new()));
}
const PLAN_CACHE_MAX: usize = 16;

/// The cached real plan of length n (n a power of two >= 2).
pub fn real_plan(n: usize) -> Rc<RealPlan> {
    REAL_PLANS.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= PLAN_CACHE_MAX && !c.contains_key(&n) {
            c.clear();
        }
        c.entry(n).or_insert_with(|| Rc::new(RealPlan::new(n))).clone()
    })
}

/// The cached complex plan of length n (a power of two).
pub fn plan(n: usize) -> Rc<Plan> {
    PLANS.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= PLAN_CACHE_MAX && !c.contains_key(&n) {
            c.clear();
        }
        c.entry(n).or_insert_with(|| Rc::new(Plan::new(n))).clone()
    })
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[repr(C)]
pub struct C {
    pub re: f64,
    pub im: f64,
}

impl C {
    #[inline]
    pub fn new(re: f64, im: f64) -> C {
        C { re, im }
    }
    #[inline]
    pub fn mul(self, o: C) -> C {
        C::new(self.re * o.re - self.im * o.im, self.re * o.im + self.im * o.re)
    }
    #[inline]
    pub fn add(self, o: C) -> C {
        C::new(self.re + o.re, self.im + o.im)
    }
    #[inline]
    pub fn sub(self, o: C) -> C {
        C::new(self.re - o.re, self.im - o.im)
    }
    #[inline]
    pub fn conj(self) -> C {
        C::new(self.re, -self.im)
    }
    #[inline]
    pub fn scale(self, s: f64) -> C {
        C::new(self.re * s, self.im * s)
    }
}

/// A planned power-of-two complex FFT of length n: bit-reversal table and the n/2 forward twiddles, plus the same
/// twiddles laid out per stage (forward and conjugated), so each stage reads them contiguously.
pub struct Plan {
    pub n: usize,
    rev: Vec<u32>,
    tw: Vec<C>,  // e^{-2 pi i k / n}, k < n/2
    stw: Vec<C>, // per stage of half-size h: tw[k * n/(2h)], k < h, at offset h-1 (stage tables, n-1 entries)
    stc: Vec<C>, // the same, conjugated (inverse)
}

impl Plan {
    pub fn new(n: usize) -> Plan {
        assert!(n.is_power_of_two() && n >= 1);
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| if bits == 0 { 0 } else { i.reverse_bits() >> (32 - bits) }).collect();
        let tw: Vec<C> = (0..n / 2)
            .map(|k| {
                let a = -2.0 * PI * (k as f64) / (n as f64);
                C::new(a.cos(), a.sin())
            })
            .collect();
        let mut stw = Vec::with_capacity(n.saturating_sub(1));
        let mut half = 1;
        while half < n {
            let step = n / (2 * half);
            for k in 0..half {
                stw.push(tw[k * step]);
            }
            half <<= 1;
        }
        let stc = stw.iter().map(|w| w.conj()).collect();
        Plan { n, rev, tw, stw, stc }
    }

    /// In place. `inverse` conjugates the twiddles and does NOT divide by n. Same bits as `run_scalar` on every
    /// target: the SIMD paths compute each butterfly with the same multiplies, adds and subtracts (two butterflies
    /// per AVX register, one per simd128 register), never fused, never reassociated (tests/fft_exact.rs).
    pub fn run(&self, x: &mut [C], inverse: bool) {
        let n = self.n;
        assert_eq!(x.len(), n);
        bit_reverse(x, &self.rev);
        let tabs = if inverse { &self.stc } else { &self.stw };
        // Cache blocking: the stages whose butterflies stay inside BLOCK points are run block by block (each block
        // stays in L2), the rest as whole passes. A butterfly reads only the previous stage's outputs in its own
        // group, so the order of independent butterflies cannot change a value.
        let block = n.min(BLOCK);
        for blk in x.chunks_exact_mut(block) {
            let mut half = 1;
            while half < block {
                if 2 * half < block {
                    stage2(blk, &tabs[half - 1..2 * half - 1], &tabs[2 * half - 1..4 * half - 1], half);
                    half <<= 2;
                } else {
                    stage(blk, &tabs[half - 1..2 * half - 1], half);
                    half <<= 1;
                }
            }
        }
        // the stages beyond the block, two per pass over memory (stage h then 2h on each 4-point set, see stage2)
        let mut half = block;
        while half < n {
            if 2 * half < n {
                stage2(x, &tabs[half - 1..2 * half - 1], &tabs[2 * half - 1..4 * half - 1], half);
                half <<= 2;
            } else {
                stage(x, &tabs[half - 1..2 * half - 1], half);
                half <<= 1;
            }
        }
    }

    /// Iteration 1's loop, kept verbatim as the reference the fast paths are held to.
    pub fn run_scalar(&self, x: &mut [C], inverse: bool) {
        let n = self.n;
        debug_assert_eq!(x.len(), n);
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                x.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let half = len / 2;
            let step = n / len;
            for s in (0..n).step_by(len) {
                for k in 0..half {
                    let mut w = self.tw[k * step];
                    if inverse {
                        w = w.conj();
                    }
                    let a = x[s + k];
                    let b = x[s + k + half].mul(w);
                    x[s + k] = a.add(b);
                    x[s + k + half] = a.sub(b);
                }
            }
            len <<= 1;
        }
    }
}

/// The bit-reversal permutation, moved tile by tile: index bits = (a: TB high, m: middle, c: TB low), and
/// rev(a, m, c) = (rev c, rev m, rev a), so the 16 x 16 tile at middle m swaps with the tile at rev m, each read and
/// written as 16 runs of 16 contiguous points. Iteration 1 swapped point by point through the table: on 2^18 points
/// that is a random walk over 4 MiB and took most of the FFT. A permutation moves values, it computes none: same bits.
fn bit_reverse(x: &mut [C], rev: &[u32]) {
    let n = x.len();
    let lg = n.trailing_zeros();
    const TB: u32 = 4;
    const T: usize = 1 << TB;
    if lg < 2 * TB + 2 {
        for i in 0..n {
            let j = rev[i] as usize;
            if j > i {
                x.swap(i, j);
            }
        }
        return;
    }
    let mid = lg - 2 * TB;
    let hi = lg - TB; // shift of the high field
    let r4 = |v: usize| ((v as u32).reverse_bits() >> (32 - TB)) as usize;
    let (mut ta, mut tb) = ([C::default(); T * T], [C::default(); T * T]);
    for m in 0..1usize << mid {
        let mr = ((m as u32).reverse_bits() >> (32 - mid)) as usize;
        if mr < m {
            continue;
        }
        for a in 0..T {
            let base = (a << hi) | (m << TB);
            ta[a * T..(a + 1) * T].copy_from_slice(&x[base..base + T]);
            let base = (a << hi) | (mr << TB);
            tb[a * T..(a + 1) * T].copy_from_slice(&x[base..base + T]);
        }
        // x[a', mr, c'] = old x[rev c', m, rev a'] and x[a', m, c'] = old x[rev c', mr, rev a']
        for a2 in 0..T {
            let (ra2, b_mr, b_m) = (r4(a2), (a2 << hi) | (mr << TB), (a2 << hi) | (m << TB));
            for c2 in 0..T {
                let src = r4(c2) * T + ra2;
                x[b_mr + c2] = ta[src];
                x[b_m + c2] = tb[src];
            }
        }
    }
}

const BLOCK: usize = 1 << 14; // complex points: 256 KiB, inside a 512 KiB L2

#[inline(always)]
fn stage(x: &mut [C], w: &[C], half: usize) {
    #[cfg(target_arch = "x86_64")]
    {
        if half >= 2 && std::arch::is_x86_feature_detected!("avx") {
            unsafe { stage_avx(x, w, half) };
            return;
        }
    }
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        stage_simd128(x, w, half);
        return;
    }
    #[allow(unreachable_code)]
    stage_scalar(x, w, half)
}

/// Stages h and 2h in one pass: for each group of 4h points and k < h, the four points k, k+h, k+2h, k+3h go through
/// stage h ((0,1) and (2,3), twiddle w1[k]) and then stage 2h ((0,2) with w2[k], (1,3) with w2[k+h]) - exactly the
/// butterflies the two separate passes perform on them, with the same inputs, so the same bits.
fn stage2(x: &mut [C], w1: &[C], w2: &[C], h: usize) {
    #[cfg(target_arch = "x86_64")]
    {
        if h >= 2 && std::arch::is_x86_feature_detected!("avx") {
            unsafe { stage2_avx(x, w1, w2, h) };
            return;
        }
    }
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        stage2_simd128(x, w1, w2, h);
        return;
    }
    #[allow(unreachable_code)]
    for g in x.chunks_exact_mut(4 * h) {
        let (q01, q23) = g.split_at_mut(2 * h);
        let (q0, q1) = q01.split_at_mut(h);
        let (q2, q3) = q23.split_at_mut(h);
        for k in 0..h {
            let (mut e0, mut e1, mut e2, mut e3) = (q0[k], q1[k], q2[k], q3[k]);
            let b = e1.mul(w1[k]);
            (e0, e1) = (e0.add(b), e0.sub(b));
            let b = e3.mul(w1[k]);
            (e2, e3) = (e2.add(b), e2.sub(b));
            let b = e2.mul(w2[k]);
            (q0[k], q2[k]) = (e0.add(b), e0.sub(b));
            let b = e3.mul(w2[k + h]);
            (q1[k], q3[k]) = (e1.add(b), e1.sub(b));
        }
    }
}

/// stage2 with one butterfly per simd128 register (the same operations as stage_simd128's).
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline(always)]
fn stage2_simd128(x: &mut [C], w1: &[C], w2: &[C], h: usize) {
    use core::arch::wasm32::*;
    #[inline(always)]
    fn cmul(b: v128, w: C) -> v128 {
        let neg = f64x2(-1.0, 1.0);
        let bsw = i64x2_shuffle::<1, 0>(b, b);
        f64x2_add(f64x2_mul(b, f64x2_splat(w.re)), f64x2_mul(f64x2_mul(bsw, f64x2_splat(w.im)), neg))
    }
    for g in x.chunks_exact_mut(4 * h) {
        let p = g.as_mut_ptr() as *mut v128;
        for k in 0..h {
            unsafe {
                let (a0, a1, a2, a3) = (p.add(k), p.add(k + h), p.add(k + 2 * h), p.add(k + 3 * h));
                let (e0, e1, e2, e3) = (v128_load(a0), v128_load(a1), v128_load(a2), v128_load(a3));
                let b = cmul(e1, w1[k]);
                let (e0, e1) = (f64x2_add(e0, b), f64x2_sub(e0, b));
                let b = cmul(e3, w1[k]);
                let (e2, e3) = (f64x2_add(e2, b), f64x2_sub(e2, b));
                let b = cmul(e2, w2[k]);
                v128_store(a0, f64x2_add(e0, b));
                v128_store(a2, f64x2_sub(e0, b));
                let b = cmul(e3, w2[k + h]);
                v128_store(a1, f64x2_add(e1, b));
                v128_store(a3, f64x2_sub(e1, b));
            }
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx")]
unsafe fn stage2_avx(x: &mut [C], w1: &[C], w2: &[C], h: usize) {
    use std::arch::x86_64::*;
    #[inline(always)]
    unsafe fn cmul(b: __m256d, ww: __m256d) -> __m256d {
        let wre = _mm256_movedup_pd(ww);
        let wim = _mm256_permute_pd(ww, 0b1111);
        let bsw = _mm256_permute_pd(b, 0b0101);
        _mm256_addsub_pd(_mm256_mul_pd(b, wre), _mm256_mul_pd(bsw, wim))
    }
    let n = x.len();
    let p = x.as_mut_ptr() as *mut f64;
    let (p1, p2) = (w1.as_ptr() as *const f64, w2.as_ptr() as *const f64);
    let mut s = 0;
    while s < n {
        let mut k = 0;
        while k < h {
            let (a0, a1, a2, a3) = (p.add(2 * (s + k)), p.add(2 * (s + k + h)), p.add(2 * (s + k + 2 * h)), p.add(2 * (s + k + 3 * h)));
            let (e0, e1, e2, e3) = (_mm256_loadu_pd(a0), _mm256_loadu_pd(a1), _mm256_loadu_pd(a2), _mm256_loadu_pd(a3));
            let wa = _mm256_loadu_pd(p1.add(2 * k));
            let b = cmul(e1, wa);
            let (e0, e1) = (_mm256_add_pd(e0, b), _mm256_sub_pd(e0, b));
            let b = cmul(e3, wa);
            let (e2, e3) = (_mm256_add_pd(e2, b), _mm256_sub_pd(e2, b));
            let b = cmul(e2, _mm256_loadu_pd(p2.add(2 * k)));
            _mm256_storeu_pd(a0, _mm256_add_pd(e0, b));
            _mm256_storeu_pd(a2, _mm256_sub_pd(e0, b));
            let b = cmul(e3, _mm256_loadu_pd(p2.add(2 * (k + h))));
            _mm256_storeu_pd(a1, _mm256_add_pd(e1, b));
            _mm256_storeu_pd(a3, _mm256_sub_pd(e1, b));
            k += 2;
        }
        s += 4 * h;
    }
}

#[inline(always)]
fn stage_scalar(x: &mut [C], w: &[C], half: usize) {
    for blk in x.chunks_exact_mut(2 * half) {
        let (lo, hi) = blk.split_at_mut(half);
        for k in 0..half {
            let a = lo[k];
            let b = hi[k].mul(w[k]);
            lo[k] = a.add(b);
            hi[k] = a.sub(b);
        }
    }
}

/// Two butterflies per 256-bit register. b*w: t1 = [b.re*w.re, b.im*w.re], t2 = [b.im*w.im, b.re*w.im], and
/// addsub(t1, t2) = [b.re*w.re - b.im*w.im, b.im*w.re + b.re*w.im] - C::mul's operations (an IEEE add commutes).
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx")]
unsafe fn stage_avx(x: &mut [C], w: &[C], half: usize) {
    use std::arch::x86_64::*;
    let n = x.len();
    let p = x.as_mut_ptr() as *mut f64;
    let wp = w.as_ptr() as *const f64;
    let mut s = 0;
    while s < n {
        let mut k = 0;
        while k < half {
            let pa = p.add(2 * (s + k));
            let pb = p.add(2 * (s + k + half));
            let a = _mm256_loadu_pd(pa);
            let b = _mm256_loadu_pd(pb);
            let ww = _mm256_loadu_pd(wp.add(2 * k));
            let wre = _mm256_movedup_pd(ww);
            let wim = _mm256_permute_pd(ww, 0b1111);
            let bsw = _mm256_permute_pd(b, 0b0101);
            let prod = _mm256_addsub_pd(_mm256_mul_pd(b, wre), _mm256_mul_pd(bsw, wim));
            _mm256_storeu_pd(pa, _mm256_add_pd(a, prod));
            _mm256_storeu_pd(pb, _mm256_sub_pd(a, prod));
            k += 2;
        }
        s += 2 * half;
    }
}

/// One butterfly per 128-bit register; x + (-y) is x - y exactly in IEEE, so the sign flip by multiplication with
/// [-1, 1] (exact) gives C::mul's real part.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline(always)]
fn stage_simd128(x: &mut [C], w: &[C], half: usize) {
    use core::arch::wasm32::*;
    let neg = f64x2(-1.0, 1.0);
    for blk in x.chunks_exact_mut(2 * half) {
        let (lo, hi) = blk.split_at_mut(half);
        for k in 0..half {
            unsafe {
                let pa = lo.as_mut_ptr().add(k) as *mut v128;
                let pb = hi.as_mut_ptr().add(k) as *mut v128;
                let a = v128_load(pa);
                let b = v128_load(pb);
                let ww = w[k];
                let bsw = i64x2_shuffle::<1, 0>(b, b);
                let t1 = f64x2_mul(b, f64x2_splat(ww.re));
                let t2 = f64x2_mul(f64x2_mul(bsw, f64x2_splat(ww.im)), neg);
                let prod = f64x2_add(t1, t2);
                v128_store(pa, f64x2_add(a, prod));
                v128_store(pb, f64x2_sub(a, prod));
            }
        }
    }
}

/// A planned real FFT of even power-of-two length n, as an n/2 complex FFT plus a post-pass.
pub struct RealPlan {
    pub n: usize,
    half: Plan,
    w: Vec<C>, // e^{-2 pi i k / n}, k <= n/2
}

impl RealPlan {
    pub fn new(n: usize) -> RealPlan {
        assert!(n.is_power_of_two() && n >= 2);
        let w = (0..=n / 2)
            .map(|k| {
                let a = -2.0 * PI * (k as f64) / (n as f64);
                C::new(a.cos(), a.sin())
            })
            .collect();
        RealPlan { n, half: Plan::new(n / 2), w }
    }

    /// rfft of `x` zero-padded (or truncated) to n: n/2 + 1 bins, as numpy's `np.fft.rfft(x, n)`.
    pub fn forward(&self, x: &[f64], out: &mut Vec<C>) {
        let (n, h) = (self.n, self.n / 2);
        let mut z: Vec<C> = (0..h)
            .map(|m| {
                let e = if 2 * m < x.len() { x[2 * m] } else { 0.0 };
                let o = if 2 * m + 1 < x.len() { x[2 * m + 1] } else { 0.0 };
                C::new(e, o)
            })
            .collect();
        self.half.run(&mut z, false);
        out.clear();
        out.resize(h + 1, C::default());
        for k in 0..=h {
            // z[k % h], z[(h - k) % h] without the integer divisions (iteration 1 spent ~2/3 of a 1024-point rfft there)
            let zk = if k == h { z[0] } else { z[k] };
            let zc = if k == 0 { z[0] } else { z[h - k] }.conj();
            let e = zk.add(zc).scale(0.5);
            // (zk - zc) / (2i) = (zk - zc) * (-i/2)
            let d = zk.sub(zc);
            let o = C::new(d.im * 0.5, -d.re * 0.5);
            out[k] = e.add(self.w[k].mul(o));
        }
        let _ = n;
    }

    /// irfft to n real samples (divided by n), as numpy's `np.fft.irfft(X, n)`: the imaginary parts of the DC
    /// and Nyquist bins are ignored, as pocketfft's c2r ignores them.
    pub fn inverse(&self, xk: &[C], out: &mut Vec<f64>) {
        let (n, h) = (self.n, self.n / 2);
        let mut x = xk.to_vec();
        x[0].im = 0.0;
        x[h].im = 0.0;
        let mut z: Vec<C> = (0..h)
            .map(|k| {
                let a = x[k];
                let b = x[h - k].conj();
                let e = a.add(b).scale(0.5);
                let o = a.sub(b).scale(0.5).mul(self.w[k].conj());
                // Z = E + i O
                C::new(e.re - o.im, e.im + o.re)
            })
            .collect();
        self.half.run(&mut z, true);
        let s = 1.0 / (h as f64);
        out.clear();
        out.resize(n, 0.0);
        for m in 0..h {
            out[2 * m] = z[m].re * s;
            out[2 * m + 1] = z[m].im * s;
        }
    }
}

/// The full complex DFT of any length (Bluestein for non-powers of two). `inverse` divides by n (numpy's ifft).
pub fn dft(x: &[C], inverse: bool) -> Vec<C> {
    let n = x.len();
    if n == 0 {
        return vec![];
    }
    let mut out = if n.is_power_of_two() {
        let mut out = x.to_vec();
        plan(n).run(&mut out, inverse);
        out
    } else {
        let m = (2 * n - 1).next_power_of_two();
        let plan = plan(m);
        let sign = if inverse { 1.0 } else { -1.0 };
        // chirp w[k] = e^{sign * i pi k^2 / n}, k^2 reduced mod 2n so the angle stays small and exact. For even n,
        // (n-k)^2 = k^2 (mod 2n), so w[n-k] is the same angle: computed once, the same bits.
        let chirp = |k: usize| {
            let kk = ((k as u64 * k as u64) % (2 * n as u64)) as f64; // k < 2^32: exact in u64
            let a = sign * PI * kk / (n as f64);
            C::new(a.cos(), a.sin())
        };
        let mut w = vec![C::default(); n];
        if n % 2 == 0 {
            for k in 0..=n / 2 {
                w[k] = chirp(k);
            }
            for k in n / 2 + 1..n {
                w[k] = w[n - k];
            }
        } else {
            for (k, v) in w.iter_mut().enumerate() {
                *v = chirp(k);
            }
        }
        SCRATCH.with(|sc| {
        let mut sc = sc.borrow_mut();
        let (a, b) = &mut *sc;
        a.clear();
        a.resize(m, C::default());
        b.clear();
        b.resize(m, C::default());
        for k in 0..n {
            a[k] = x[k].mul(w[k]);
        }
        b[0] = w[0].conj();
        for k in 1..n {
            b[k] = w[k].conj();
            b[m - k] = w[k].conj();
        }
        plan.run(a, false);
        plan.run(b, false);
        for k in 0..m {
            a[k] = a[k].mul(b[k]);
        }
        plan.run(a, true);
        let s = 1.0 / (m as f64);
        (0..n).map(|k| a[k].scale(s).mul(w[k])).collect::<Vec<C>>()
        })
    };
    if inverse {
        let s = 1.0 / (n as f64);
        for v in out.iter_mut() {
            *v = v.scale(s);
        }
    }
    out
}
