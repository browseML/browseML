// SPDX-License-Identifier: MIT OR Apache-2.0
// Node 24: load the built overlord_dsp_web.wasm through overlord-dsp-web.js and hold every export against the
// references ref_engines.py computes with mindX's own engines.py (Layered._eq/_fit/_echo/_fall + the synth knee).
//
//   (cd .. && cargo build -p overlord-dsp-web --profile wasm --target wasm32-unknown-unknown)
//   ~/mindX/.mindx_env/bin/python ref_engines.py /tmp/odsp_ref
//   node test_node.mjs /tmp/odsp_ref [path/to/overlord_dsp_web.wasm]
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './overlord-dsp-web.js';                  // UMD: under "type": "module" it sets globalThis.ODSP
const ODSP = globalThis.ODSP;

const here = dirname(fileURLToPath(import.meta.url));
const ref = process.argv[2] || process.env.ODSP_REF_DIR || '/tmp/odsp_ref';
const cands = [process.argv[3], join(here, '../target/wasm32-unknown-unknown/wasm/overlord_dsp_web.wasm'),
  join(here, '../target/wasm32-unknown-unknown/release/overlord_dsp_web.wasm')].filter(Boolean);
const wasm = cands.find(existsSync);
if (!wasm) { console.error('no .wasm built; tried', cands); process.exit(2); }

const f32 = (name) => { const b = readFileSync(join(ref, name + '.f32')); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const meta = JSON.parse(readFileSync(join(ref, 'meta.json'), 'utf8'));

await ODSP.load(readFileSync(wasm));          // bytes; a URL works the same in a browser (fetch, force-cache)

let failed = 0;
function check(name, want, got, maxAbs, minSnr) {
  if (want.length !== got.length) { console.log(`FAIL ${name}: length ${got.length} != ${want.length}`); failed++; return; }
  let e = 0, s = 0, m = 0;
  for (let i = 0; i < want.length; i++) { const d = got[i] - want[i]; e += d * d; s += want[i] * want[i]; m = Math.max(m, Math.abs(d)); }
  const snr = e === 0 ? Infinity : 10 * Math.log10(s / e);
  const ok = m <= maxAbs && snr >= minSnr;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} n=${String(got.length).padEnd(6)} max|err|=${m.toExponential(2)}  SNR=${snr === Infinity ? 'inf' : snr.toFixed(1)} dB  (bar: <=${maxAbs.toExponential(0)}, >=${minSnr} dB)`);
}

const x = f32('x'), sr = meta.sr;
console.log(`wasm ${wasm} (${readFileSync(wasm).length} B); reference ${ref} (numpy ${meta.numpy}), n=${x.length} @ ${sr} Hz`);
const t0 = performance.now();
const band = ODSP.band(x, sr, meta.lo, meta.hi);
const t1 = performance.now();
check('band/_eq', f32('band'), band, 1e-6, 120);
check('band/np', f32('band_np'), band, 1e-6, 120);
check('fit', f32('fit'), ODSP.fit(x, meta.fit_n), 1e-7, 130);
check('echo', f32('echo'), ODSP.echo(x, sr, meta.echo), 1e-7, 130);
check('echo2', f32('echo2'), ODSP.echo(x, sr, meta.echo2), 1e-7, 130);
const t2 = performance.now();
const fall = ODSP.fall(x, sr, meta.fall_st, meta.fall_s);
const t3 = performance.now();
check('fall', f32('fall'), fall, 1e-7, 130);
check('softknee', f32('softknee'), ODSP.softknee(x), 1e-7, 130);
console.log(`fall length ${fall.length} (reference ${meta.fall_len}, +${((fall.length - x.length) / sr * 1000).toFixed(2)} ms); ` +
  `band ${(t1 - t0).toFixed(1)} ms, fall ${(t3 - t2).toFixed(1)} ms for ${(x.length / sr).toFixed(2)} s of audio`);
// memory hygiene: many calls must not grow linear memory without bound
const mem0 = ODSP.memoryBytes;
for (let i = 0; i < 50; i++) { ODSP.band(x, sr, meta.lo, meta.hi); ODSP.fall(x, sr, 1, 0.3); }
const mem1 = ODSP.memoryBytes;
console.log(`linear memory ${mem0 / 65536} -> ${mem1 / 65536} pages after 100 more calls`);
if (mem1 > mem0) { console.log('FAIL memory grew across repeated calls'); failed++; }
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
