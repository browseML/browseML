// SPDX-License-Identifier: MIT
// Receipts banked, in the visitor's browser: bankML's ledger (bankML/ledger.rs) in the same format — amounts exact to 18
// decimals (BigInt of 10⁻¹⁸, never a float), each entry hash-chained by keccak256 (the EVM's), the head committing to
// every entry. The same canonical bytes and the same shared vector as bankML's `the_shared_vector` test, so a browser
// ledger and a server ledger verify each other's entries. Kept in this browser's storage; nothing is sent anywhere.

export const SCALE = 10n ** 18n;
const U128 = (1n << 128n) - 1n;

/** An exact amount: base units of 10⁻¹⁸. */
export type Amount = bigint;
export const units = (n: number | bigint): Amount => BigInt(n) * SCALE;
/** "1.5" → 1500000000000000000n; more than 18 decimals, a sign or an exponent is refused; past a u128, refused. */
export function parseAmount(s: string): Amount {
  const t = s.trim(), m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error(`not an amount: ${JSON.stringify(s)}`);
  const frac = m[2] ?? '';
  if (frac.length > 18) throw new Error(`more than 18 decimals: ${JSON.stringify(s)}`);
  const v = BigInt(m[1]) * SCALE + BigInt((frac + '0'.repeat(18)).slice(0, 18));
  if (v > U128) throw new Error(`too large: ${JSON.stringify(s)}`);
  return v;
}
/** Always 18 decimals: "1.500000000000000000". */
export const formatAmount = (a: Amount): string => `${a / SCALE}.${(a % SCALE).toString().padStart(18, '0')}`;

// ── keccak256 (Keccak-256, 0x01 padding: Solidity's and bankML's) on 64-bit lanes as BigInt ──────────────────────────
const M64 = (1n << 64n) - 1n;
const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14].map(BigInt);
const rotl = (x: bigint, n: bigint) => (n === 0n ? x : ((x << n) | (x >> (64n - n))) & M64);
function keccakF(a: bigint[]) {
  for (const rc of RC) {
    const c = [0, 1, 2, 3, 4].map(x => a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]);
    for (let x = 0; x < 5; x++) { const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1n); for (let y = 0; y < 5; y++) a[x + 5 * y] ^= d; }
    const b = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) a[x + 5 * y] = b[x + 5 * y] ^ (~b[(x + 1) % 5 + 5 * y] & M64 & b[(x + 2) % 5 + 5 * y]);
    a[0] ^= rc;
  }
}
export function keccak256(data: Uint8Array): Uint8Array {
  const RATE = 136, st = new Array<bigint>(25).fill(0n);
  const absorb = (blk: Uint8Array) => {
    const dv = new DataView(blk.buffer, blk.byteOffset, RATE);
    for (let i = 0; i < RATE / 8; i++) st[i] ^= dv.getBigUint64(i * 8, true);
    keccakF(st);
  };
  let off = 0;
  for (; off + RATE <= data.length; off += RATE) absorb(data.subarray(off, off + RATE));
  const last = new Uint8Array(RATE); last.set(data.subarray(off)); last[data.length - off] ^= 0x01; last[RATE - 1] ^= 0x80;
  absorb(last);
  const out = new Uint8Array(32), dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) dv.setBigUint64(i * 8, st[i], true);
  return out;
}
export const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

// ── the ledger ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const GENESIS = '0'.repeat(64);
export interface Entry {
  seq: number; at_ms: number; source: string; model: string; request_sha256: string; response_sha256: string;
  prompt_tokens: number; completion_tokens: number; rate: Amount; prev: string;
}
export interface Banked { entry: Entry; hash: string }

const js = (s: string) => JSON.stringify(s);  // the same escapes as bankML's json_str for the strings a receipt carries
export const tokensOf = (e: Entry): Amount => units(e.prompt_tokens + e.completion_tokens);
export const costOf = (e: Entry): Amount => e.rate * BigInt(e.prompt_tokens + e.completion_tokens);
/** The canonical bytes, exactly as bankML's `Entry::canonical`. */
export const canonical = (e: Entry) =>
  `{"v":1,"seq":${e.seq},"at_ms":${e.at_ms},"source":${js(e.source)},"model":${js(e.model)},"request_sha256":${js(e.request_sha256)},"response_sha256":${js(e.response_sha256)},"prompt_tokens":${e.prompt_tokens},"completion_tokens":${e.completion_tokens},"tokens":"${formatAmount(tokensOf(e))}","rate":"${formatAmount(e.rate)}","cost":"${formatAmount(costOf(e))}","prev":"${e.prev}"}`;
export const hashOf = (e: Entry) => hex(keccak256(new TextEncoder().encode(canonical(e))));
export const lineOf = (b: Banked) => { const c = canonical(b.entry); return `${c.slice(0, -1)},"hash":"${b.hash}"}`; };

export class Ledger {
  entries: Banked[] = [];
  head(): string { return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS; }
  bank(e: Omit<Entry, 'seq' | 'prev'>): Banked {
    const entry: Entry = { ...e, seq: this.entries.length, prev: this.head() };
    const b = { entry, hash: hashOf(entry) };
    this.entries.push(b);
    return b;
  }
  /** null when every entry holds; else where the chain breaks. */
  verify(): string | null {
    let prev = GENESIS;
    for (const [i, b] of this.entries.entries()) {
      if (b.entry.seq !== i) return `entry ${i}: seq ${b.entry.seq} out of order`;
      if (b.entry.prev !== prev) return `entry ${i}: its prev is not entry ${i - 1}'s hash: the chain is broken here`;
      if (hashOf(b.entry) !== b.hash) return `entry ${i}: its contents do not match its hash: changed after banking`;
      prev = b.hash;
    }
    return null;
  }
  totals(): Record<string, { entries: number; prompt_tokens: number; completion_tokens: number; tokens: Amount; cost: Amount }> {
    const t: ReturnType<Ledger['totals']> = {};
    for (const { entry: e } of this.entries) for (const k of [e.source, '*']) {
      const x = (t[k] ??= { entries: 0, prompt_tokens: 0, completion_tokens: 0, tokens: 0n, cost: 0n });
      x.entries++; x.prompt_tokens += e.prompt_tokens; x.completion_tokens += e.completion_tokens; x.tokens += tokensOf(e); x.cost += costOf(e);
    }
    return t;
  }
  toJSONL(): string { return this.entries.map(lineOf).join('\n') + (this.entries.length ? '\n' : ''); }
  static fromJSONL(text: string): Ledger {
    const l = new Ledger();
    for (const line of text.split('\n').filter(x => x.trim())) {
      const d = JSON.parse(line);
      l.entries.push({ entry: { seq: d.seq, at_ms: d.at_ms, source: d.source, model: d.model, request_sha256: d.request_sha256, response_sha256: d.response_sha256,
        prompt_tokens: d.prompt_tokens, completion_tokens: d.completion_tokens, rate: parseAmount(d.rate), prev: d.prev }, hash: d.hash });
    }
    return l;
  }
}

// ── this browser's ledger: kept in its storage, one JSON line per entry (the same lines bankML serve writes) ─────────
const KEY = 'browseml:ledger';
let mine: Ledger | null = null;
const fns = new Set<() => void>();
export function onLedger(f: () => void) { fns.add(f); return () => { fns.delete(f); }; }
export function myLedger(): Ledger {
  if (!mine) { try { mine = Ledger.fromJSONL(localStorage.getItem(KEY) || ''); } catch { mine = new Ledger(); } }
  return mine;
}
/** Bank one verified receipt (answers here are free: rate 0; the tokens are counted to 18 decimals all the same). */
export function bankReceipt(r: { model: string; request_sha256: string; response_sha256: string; prompt_tokens: number; completion_tokens: number; source?: string; rate?: Amount }) {
  const l = myLedger();
  if (l.verify()) return null;  // never append to a broken chain
  const b = l.bank({ at_ms: Date.now(), source: r.source ?? 'bankml', model: r.model, request_sha256: r.request_sha256, response_sha256: r.response_sha256,
    prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens, rate: r.rate ?? 0n });
  try { localStorage.setItem(KEY, l.toJSONL()); } catch { /* storage full or off: kept for this visit */ }
  fns.forEach(f => f());
  return b;
}
