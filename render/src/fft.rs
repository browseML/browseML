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

#[derive(Clone, Copy, Debug, Default, PartialEq)]
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

/// A planned power-of-two complex FFT of length n: bit-reversal table and the n/2 forward twiddles.
pub struct Plan {
    pub n: usize,
    rev: Vec<u32>,
    tw: Vec<C>, // e^{-2 pi i k / n}, k < n/2
}

impl Plan {
    pub fn new(n: usize) -> Plan {
        assert!(n.is_power_of_two() && n >= 1);
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| if bits == 0 { 0 } else { i.reverse_bits() >> (32 - bits) }).collect();
        let tw = (0..n / 2)
            .map(|k| {
                let a = -2.0 * PI * (k as f64) / (n as f64);
                C::new(a.cos(), a.sin())
            })
            .collect();
        Plan { n, rev, tw }
    }

    /// In place. `inverse` conjugates the twiddles and does NOT divide by n.
    pub fn run(&self, x: &mut [C], inverse: bool) {
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
            let zk = z[k % h];
            let zc = z[(h - k) % h].conj();
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
    let mut out;
    if n.is_power_of_two() {
        out = x.to_vec();
        Plan::new(n).run(&mut out, inverse);
    } else {
        let m = (2 * n - 1).next_power_of_two();
        let plan = Plan::new(m);
        let sign = if inverse { 1.0 } else { -1.0 };
        // chirp w[k] = e^{sign * i pi k^2 / n}, k^2 reduced mod 2n so the angle stays small and exact
        let w: Vec<C> = (0..n)
            .map(|k| {
                let kk = ((k as u128 * k as u128) % (2 * n as u128)) as f64;
                let a = sign * PI * kk / (n as f64);
                C::new(a.cos(), a.sin())
            })
            .collect();
        let mut a = vec![C::default(); m];
        for k in 0..n {
            a[k] = x[k].mul(w[k]);
        }
        let mut b = vec![C::default(); m];
        b[0] = w[0].conj();
        for k in 1..n {
            b[k] = w[k].conj();
            b[m - k] = w[k].conj();
        }
        plan.run(&mut a, false);
        plan.run(&mut b, false);
        for k in 0..m {
            a[k] = a[k].mul(b[k]);
        }
        plan.run(&mut a, true);
        let s = 1.0 / (m as f64);
        out = (0..n).map(|k| a[k].scale(s).mul(w[k])).collect();
    }
    if inverse {
        let s = 1.0 / (n as f64);
        for v in out.iter_mut() {
            *v = v.scale(s);
        }
    }
    out
}
