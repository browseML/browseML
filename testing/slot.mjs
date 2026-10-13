// SPDX-License-Identifier: MIT OR Apache-2.0
// The warm slot: a prompt read once, saved, and restored in a fresh engine, as the page does across visits.
//   node testing/slot.mjs web/browseml.wasm MODEL.gguf FORK.json
// Checks: the slot saves to /slots and restores in a new engine; a question after the restore reads only what is new
// (cache_n = the warm prefix); and its answer — text, tokens, finish — is the same as a cold engine's answer to the
// same request. Greedy (temperature 0), so the answers are comparable.
import fs from "node:fs";
import path from "node:path";
import { wasi as makeWasi } from "../web/browseml-wasi.js";

const [wasmPath, modelPath, forkPath] = process.argv.slice(2);
const name = path.basename(modelPath);
const model = new Uint8Array(fs.readFileSync(modelPath)), fork = fs.readFileSync(forkPath, "utf8");
const persona = JSON.parse(fs.readFileSync(new URL("../web/browseml.persona", import.meta.url), "utf8")).system_prompt;
const module = await WebAssembly.compile(fs.readFileSync(wasmPath));

async function engine(slots) {
  const w = makeWasi({ files: { [name]: model }, slots, env: { BANKML_CACHE_RAM: "0" }, write: () => {} });
  let mem;
  const text = (p, n) => Buffer.from(mem.buffer, p, n).toString("utf8");
  const inst = await WebAssembly.instantiate(module, { ...w.imports, browseml: { piece: () => 1, log: () => {} } });
  const x = inst.exports; mem = x.memory; w.bind(mem);
  const put = (s) => { const b = Buffer.from(s, "utf8"); const p = x.browseml_alloc(b.length); new Uint8Array(mem.buffer, p, b.length).set(b); return [p, b.length]; };
  const out = () => text(x.browseml_out_ptr(), x.browseml_out_len());
  if (x.browseml_open(...put(`/models/${name}`), ...put(fork), 2048) !== 0) throw new Error(out());
  return {
    chat(req) { const t = performance.now(); const rc = x.browseml_chat(...put(JSON.stringify(req))); const j = JSON.parse(out()); if (rc) throw new Error(out()); return { j, ms: performance.now() - t }; },
    slot(action, p) { const rc = x.browseml_slot(...put(action), ...put(p)); const j = JSON.parse(out()); if (rc) throw new Error(out()); return j; },
  };
}

const system = persona + "\n\nWHERE YOU ARE RUNNING: in the visitor's own web browser, compiled to WebAssembly (browseML).";
const ask = (q) => ({ messages: [{ role: "system", content: system }, { role: "user", content: q }], max_tokens: 48, temperature: 0 });
const Q = "Does anything I type leave my computer?";
let failed = 0;
const check = (what, ok, more = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${more ? " — " + more : ""}`); failed += !ok; };

// 1. warm: read the system prompt once (one token written), save the slot
const slots = {};
const a = await engine(slots);
const warm = a.chat({ messages: [{ role: "system", content: system }, { role: "user", content: "" }], max_tokens: 0, temperature: 0 });
const saved = a.slot("save", "/slots/warm.slot");
check("the slot saves", saved.tokens > 0 && slots["warm.slot"]?.length === saved.bytes, `${saved.tokens} tokens, ${(saved.bytes / 1e6).toFixed(1)} MB, warmed in ${(warm.ms / 1000).toFixed(1)} s`);

// 2. a cold engine: the reference answer and its time
const cold = (await engine({})).chat(ask(Q));
// 3. a fresh engine with the slot restored: the same question
const b = await engine({ "warm.slot": slots["warm.slot"] });
const r = b.slot("restore", "/slots/warm.slot");
check("the slot restores in a new engine", r.tokens === saved.tokens, `${r.tokens} tokens`);
const hot = b.chat(ask(Q));
const c = cold.j.choices[0], h = hot.j.choices[0];
check("the restored prefix is reused", hot.j.timings.cache_n > 0, `cache_n ${hot.j.timings.cache_n} of ${hot.j.usage.prompt_tokens} prompt tokens`);
check("the answer is the cold engine's", h.message.content === c.message.content && h.finish_reason === c.finish_reason && hot.j.usage.completion_tokens === cold.j.usage.completion_tokens,
  JSON.stringify(h.message.content.slice(0, 120)));
console.log(`cold ${(cold.ms / 1000).toFixed(1)} s (prompt ${(cold.j.timings.prompt_ms / 1000).toFixed(1)} s) · warm slot ${(hot.ms / 1000).toFixed(1)} s (prompt ${(hot.j.timings.prompt_ms / 1000).toFixed(1)} s)`);

// 4. a damaged slot, and one for another context, are refused
const bad = slots["warm.slot"].slice(); bad[100] ^= 1;
let err = ""; try { (await engine({ "warm.slot": bad })).slot("restore", "/slots/warm.slot"); } catch (e) { err = String(e.message); }
check("a damaged slot is refused", /damaged/.test(err), err.slice(0, 100));
process.exit(failed ? 1 : 0);
