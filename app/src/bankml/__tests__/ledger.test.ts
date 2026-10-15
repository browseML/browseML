// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { Ledger, formatAmount, hex, keccak256, parseAmount } from '../ledger';

const enc = (s: string) => new TextEncoder().encode(s);
const e = (source: string, p: number, c: number, rate: string) => ({ at_ms: 1760400000000, source, model: '3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3',
  request_sha256: 'aa'.repeat(32), response_sha256: 'bb'.repeat(32), prompt_tokens: p, completion_tokens: c, rate: parseAmount(rate) });

describe('receipts banked in the browser, as bankML banks them', () => {
  it('keccak256 is the EVM\'s (and bankML\'s)', () => {
    expect(hex(keccak256(enc('')))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(hex(keccak256(enc('a'.repeat(200))))).toBe('96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d');
    expect(hex(keccak256(enc('transfer(address,uint256)'))).slice(0, 8)).toBe('a9059cbb');
  });
  it('amounts are exact to 18 decimals', () => {
    expect(formatAmount(parseAmount('0.1') + parseAmount('0.2'))).toBe('0.300000000000000000');
    expect(() => parseAmount('0.0000000000000000001')).toThrow();
    expect(() => parseAmount('-1')).toThrow();
  });
  it('reproduces bankML\'s shared vector byte for byte, and finds a change', () => {
    const l = new Ledger();
    l.bank(e('bankml', 53, 64, '0'));
    l.bank(e('external:openai', 1000, 250, '0.000002'));
    expect(l.entries[0].hash).toBe('783acbe6f272321c0653a29fb1e310d4c251651c217405bb9783a9bf296d4f30');
    expect(l.head()).toBe('7b6663da1634f8da5559fec8b8675c5c798d135d49261b6edfeb44cb4cc40a65');
    expect(l.verify()).toBeNull();
    expect(formatAmount(l.totals()['*'].tokens)).toBe('1367.000000000000000000');
    expect(formatAmount(l.totals()['external:openai'].cost)).toBe('0.002500000000000000');
    const bad = Ledger.fromJSONL(l.toJSONL().replace('"completion_tokens":250', '"completion_tokens":25'));
    expect(bad.verify()).toMatch(/^entry 1:/);
  });
});
