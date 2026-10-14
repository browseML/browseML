// SPDX-License-Identifier: MIT OR Apache-2.0
// overlord-dsp-web.js: the zero-dependency loader for overlord_dsp_web.wasm (render/web). UMD: `module.exports`
// under CommonJS; otherwise it sets `globalThis.ODSP` - from a classic <script>, or as a side-effect
// `import './overlord-dsp-web.js'` (an ES module import, as test_node.mjs does under browseML's "type": "module").
//
// DSP only: band-pass, resample, echo, statement fall, soft knee. It carries no voice model. Feed it open voices
// (public-domain / CC0 / CC-BY) or eSpeak only; alan, jenny, lessac (and anything fine-tuned from lessac) never go
// to a browser. docs/RENDER_RUST.md §5.
//
//   await ODSP.load('overlord_dsp_web.wasm')       // a URL (fetched with cache: 'force-cache'), or bytes / a Module
//   const y = ODSP.band(x, 22050, 300, 3000)       // every call: Float32Array in, new Float32Array out
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ODSP = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  let ex = null; // the instance's exports

  function need() {
    if (!ex) throw new Error('ODSP: call ODSP.load(url) first');
    return ex;
  }
  // linear memory can grow on any allocation, which detaches old views: always view after allocating
  function f32(ptr, n) {
    return new Float32Array(ex.memory.buffer, ptr, n);
  }
  function put(x) {
    const a = x instanceof Float32Array ? x : Float32Array.from(x);
    const n = a.length;
    const p = ex.odsp_alloc(n);
    f32(p, n).set(a);
    return [p, n];
  }

  async function load(src) {
    if (ex) return ODSP;
    let inst;
    if (src instanceof WebAssembly.Module) {
      inst = await WebAssembly.instantiate(src, {});
    } else if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
      inst = (await WebAssembly.instantiate(src, {})).instance;
    } else {
      const res = await fetch(src || 'overlord_dsp_web.wasm', { cache: 'force-cache' });
      if (!res.ok) throw new Error('ODSP: ' + res.status + ' fetching ' + src);
      inst = (WebAssembly.instantiateStreaming && /wasm/.test(res.headers.get('content-type') || ''))
        ? (await WebAssembly.instantiateStreaming(res, {})).instance
        : (await WebAssembly.instantiate(await res.arrayBuffer(), {})).instance;
    }
    ex = inst.exports;
    return ODSP;
  }

  // In-place kernels: copy in, run, copy out, free.
  function inplace(x, run) {
    need();
    const [p, n] = put(x);
    try {
      run(p, n);
      return f32(p, n).slice();
    } finally {
      ex.odsp_free(p, n);
    }
  }

  const ODSP = {
    load,
    get loaded() { return !!ex; },
    /** Current wasm linear memory size in bytes (it grows, never shrinks). */
    get memoryBytes() { return ex ? ex.memory.buffer.byteLength : 0; },

    /** Band-pass to [lo, hi] Hz, raised-cosine edges over a third of the band (docspeech Layered._eq's shape). */
    band(x, sr, lo, hi) {
      return inplace(x, (p, n) => ex.odsp_band(p, n, sr >>> 0, lo, hi));
    },

    /** Linear resample to exactly n samples (Layered._fit). */
    fit(x, n) {
      need();
      n = Math.max(0, Math.floor(n));
      const [p, m] = put(x);
      const q = ex.odsp_alloc(n);
      try {
        ex.odsp_fit(p, m, q, n);
        return f32(q, n).slice();
      } finally {
        ex.odsp_free(q, n);
        ex.odsp_free(p, m);
      }
    },

    /** Layered._echo: taps decaying copies at k*ms; defaults as the spec's ms 34, taps 3, decay 0.55, dry 0. */
    echo(x, sr, opts) {
      const o = opts || {};
      const ms = +o.ms || 34.0;                                   // `or`: 0 means the default, as in Python
      const taps = Math.max(1, Math.floor(+o.taps || 3));
      const decay = (o.decay !== undefined && o.decay !== null) ? +o.decay : 0.55;
      const dry = +o.dry || 0.0;
      return inplace(x, (p, n) => ex.odsp_echo(p, n, sr >>> 0, ms, taps, decay, dry));
    },

    /** Layered._fall: the last `seconds` of voice falls `semitones` along a smoothstep; the result is a little longer. */
    fall(x, sr, semitones, seconds) {
      need();
      const [p, n] = put(x);
      let q = 0, m = 0;
      try {
        m = ex.odsp_fall_len(p, n, sr >>> 0, semitones, seconds);
        q = ex.odsp_alloc(m);
        const w = ex.odsp_fall(p, n, sr >>> 0, semitones, seconds, q);
        return f32(q, w).slice();
      } finally {
        if (q) ex.odsp_free(q, m);
        ex.odsp_free(p, n);
      }
    },

    /** tanh(0.9x)/tanh(0.9), then peak-normalised to 0.89 (the finish of Layered.synth). */
    softknee(x) {
      return inplace(x, (p, n) => ex.odsp_softknee(p, n));
    },
  };
  return ODSP;
});
