// SPDX-License-Identifier: MIT
// This tab's memory, measured by the browser itself where it can: performance.measureUserAgentSpecificMemory() on a
// cross-origin-isolated page (Chromium; it may wait for a garbage collection, so it takes seconds), else the JS heap
// Chromium reports (performance.memory, which leaves out WebAssembly memory), else nothing. Never an estimate.
export interface TabMemory { bytes: number | null; wasm: number | null; how: string }

type Breakdown = { bytes: number; types: string[] }[];

export async function measureTab(): Promise<TabMemory> {
  const p = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: Breakdown }>;
    memory?: { usedJSHeapSize: number };
  };
  if (typeof p.measureUserAgentSpecificMemory === 'function' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated) {
    try {
      const m = await p.measureUserAgentSpecificMemory();
      const wasm = m.breakdown.filter(b => b.types.includes('WebAssembly')).reduce((n, b) => n + b.bytes, 0);
      return { bytes: m.bytes, wasm: wasm || null, how: 'measured by the browser (this page, its workers and their WebAssembly)' };
    } catch (e) {
      return { bytes: null, wasm: null, how: `the browser refused to measure: ${String((e as Error).message || e)}` };
    }
  }
  if (p.memory?.usedJSHeapSize) return { bytes: p.memory.usedJSHeapSize, wasm: null, how: "the page's JavaScript heap only (no workers, no WebAssembly): this browser offers no fuller measure here" };
  return { bytes: null, wasm: null, how: 'this browser offers no measure of a page\'s memory' };
}
