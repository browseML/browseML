// SPDX-License-Identifier: MIT
// What this browser and this device can do, read here and never sent: for browseML (WebAssembly SIMD, threads,
// storage, memory), for voice input, and for the "Install bankML on this machine" steps. Everything comes from the
// browser's own APIs (navigator.userAgentData, navigator.platform, hardwareConcurrency, deviceMemory,
// crossOriginIsolated, navigator.storage); no request is made and no IP address is read (a page cannot know it and
// does not need it). The decisions are pure functions of what was read, so they are tested.

// ── WebAssembly features ─────────────────────────────────────────────────────────────────────────────────────────
/** The smallest module that uses a v128 instruction (i8x16.splat): valid only where WebAssembly SIMD is. */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 8, 1, 6, 0, 65, 1, 253, 15, 11]);
/** The same with a relaxed SIMD instruction (f32x4.relaxed_madd): validates where relaxed SIMD is compiled. Whether
 *  it is fused (exact) here is checked by bankML itself when the engine opens; it falls back to plain SIMD if not. */
const RELAXED_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 1, 253, 15, 65, 1, 253, 15, 253, 133, 2, 11]);

const validates = (bytes: Uint8Array<ArrayBuffer>) => {
  try { return typeof WebAssembly === 'object' && WebAssembly.validate(bytes); } catch { return false; }
};

export interface Caps {
  wasm: boolean;
  simd: boolean;
  relaxedSimd: boolean;
  /** crossOriginIsolated and SharedArrayBuffer: threads possible. */
  isolated: boolean;
  cores: number | null;
  /** GB, as the browser rounds it (at most 8); null where it is not reported (Firefox, Safari). */
  memoryGB: number | null;
  speech: 'webkit' | 'standard' | null;
  storage: boolean;
  persist: boolean;
}

export function readCaps(g: typeof globalThis = globalThis): Caps {
  const n = (g as { navigator?: Navigator }).navigator as (Navigator & { deviceMemory?: number }) | undefined;
  const w = g as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown; crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
  return {
    wasm: typeof WebAssembly === 'object',
    simd: validates(SIMD_PROBE),
    relaxedSimd: validates(RELAXED_PROBE),
    isolated: !!w.crossOriginIsolated && typeof w.SharedArrayBuffer !== 'undefined',
    cores: n?.hardwareConcurrency || null,
    memoryGB: n?.deviceMemory || null,
    speech: w.SpeechRecognition ? 'standard' : w.webkitSpeechRecognition ? 'webkit' : null,
    storage: !!n?.storage?.estimate,
    persist: !!n?.storage?.persist,
  };
}

/** The model, and what browseML needs besides it, in bytes. */
export const MODEL_BYTES = 248_302_272;
/** Bonsai-1.7B (Qwen3-1.7B's shape): 28 layers, 8 KV heads of 128, f16 keys and values. */
export const KV_BYTES_PER_TOKEN = 2 * 28 * 8 * 128 * 2;
/** Scratch the engine holds besides the weights and the KV cache: an estimate from its WebAssembly memory. */
export const ENGINE_OVERHEAD = 96e6;
/** RAM browseML needs for a context of `ctx` tokens and a prompt cache of `cacheMiB`: an estimate, the most it can
 *  take (weights + a full KV cache + scratch + the cache); the diagnostics measure what it does take. */
export const ramEstimate = (ctx: number, cacheMiB = 0) => MODEL_BYTES + ctx * KV_BYTES_PER_TOKEN + ENGINE_OVERHEAD + cacheMiB * 1048576;

export interface Verdict { level: 'ok' | 'warn' | 'bad'; text: string }

/** Whether browseML can run here, and how, in plain words: one line each, the worst first. */
export function browseVerdicts(c: Caps, opts: { phone?: boolean; available?: number | null; ctx?: number } = {}): Verdict[] {
  const out: Verdict[] = [];
  if (!c.wasm || !c.simd) {
    out.push({ level: 'bad', text: 'browseML is unavailable in this browser: it needs WebAssembly SIMD, which this browser does not have. The free CPU tab answers without it.' });
    return out;
  }
  out.push(c.isolated
    ? { level: 'ok', text: `threads: yes — this page is cross-origin isolated, so bankML can use up to ${Math.min(8, c.cores ?? 1)} of ${c.cores ?? '?'} cores` }
    : { level: 'warn', text: 'threads: one — this page is not cross-origin isolated (no SharedArrayBuffer), so bankML runs on one thread: slower, same answer' });
  out.push(c.relaxedSimd
    ? { level: 'ok', text: 'relaxed SIMD: compiled here; bankML uses it only where it is exact (it checks when it opens), else plain SIMD' }
    : { level: 'ok', text: 'relaxed SIMD: not in this browser; bankML uses plain SIMD (exact, a little slower)' });
  const need = MODEL_BYTES;
  if (opts.available != null) {
    out.push(opts.available >= need * 1.1
      ? { level: 'ok', text: `storage: ${mb(opts.available)} available here for the ${mb(need)} model` }
      : { level: 'bad', text: `storage: only ${mb(opts.available)} available here; the model needs ${mb(need)}` });
  } else if (!c.storage) out.push({ level: 'warn', text: 'storage: this browser does not say how much room there is; the download may fail if it is full' });
  const ctx = opts.ctx ?? 4096, cap = ctxCapFor(c.memoryGB), ram = ramEstimate(ctx);
  if (cap !== null && ctx > cap) {
    out.push({ level: 'warn', text: `memory: this ${opts.phone ? 'phone' : 'device'} reports ${c.memoryGB} GB; keep the context at ${cap} tokens or less (now ${ctx}, about ${mb(ram)}, an estimate), or the browser may close the tab. Or use the free CPU tab.` });
  } else if (c.memoryGB !== null && c.memoryGB * 1e9 < ram * 2.5) {
    out.push({ level: 'warn', text: `memory: this ${opts.phone ? 'phone' : 'device'} reports ${c.memoryGB} GB; browseML needs about ${mb(ram)} (an estimate) — the tab may be closed by the browser. A smaller context helps, or use the free CPU tab.` });
  }
  return out;
}

/** Bytes as MB (or KB under 0.1 MB, so a 6.8 KB file is not "0.0 MB"). */
export const mb = (n: number) => (n > 0 && n < 1e5 ? `${(n / 1e3).toFixed(1)} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);

/** The largest context to advise on a device that reports little memory (navigator.deviceMemory, rounded by the
 *  browser and capped at 8): one rule for the consent card, the controls and the default. null: no limit to advise. */
export function ctxCapFor(memoryGB: number | null | undefined): number | null {
  if (memoryGB == null) return null;
  return memoryGB <= 2 ? 1024 : memoryGB <= 4 ? 2048 : null;
}

// ── this device, for the install steps ────────────────────────────────────────────────────────────────────────────
export type Platform = 'linux-x64' | 'linux-arm' | 'windows' | 'mac' | 'chromeos' | 'phone' | 'tablet' | 'unknown';

export interface DeviceHints {
  /** navigator.userAgentData.platform ("Linux", "Windows", "macOS", "Android", "Chrome OS"), where reported. */
  uaPlatform?: string;
  /** navigator.userAgentData.mobile. */
  mobile?: boolean;
  /** getHighEntropyValues: "x86" | "arm", and "64" | "32" (read locally; nothing is sent). */
  architecture?: string;
  bitness?: string;
  /** navigator.platform ("Linux x86_64", "Linux aarch64", "Win32", "MacIntel", "iPhone", "iPad"). */
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
}

/** What kind of machine this is, from the hints the browser gives; nothing is guessed from the network. */
export function recognise(h: DeviceHints): Platform {
  const p = (h.uaPlatform || '').toLowerCase(), np = (h.platform || '').toLowerCase(), ua = (h.userAgent || '').toLowerCase();
  if (/ipad/.test(np) || /ipad/.test(ua) || (np === 'macintel' && (h.maxTouchPoints ?? 0) > 1)) return 'tablet';
  if (/iphone|ipod/.test(np) || /iphone|ipod/.test(ua)) return 'phone';
  if (p === 'android' || /android/.test(ua)) return h.mobile === false || (!/mobile/.test(ua) && h.mobile !== true) ? 'tablet' : 'phone';
  if (h.mobile) return 'phone';
  if (p === 'chrome os' || p === 'chromeos' || /cros/.test(ua)) return 'chromeos';
  if (p === 'windows' || /^win/.test(np) || /windows/.test(ua)) return 'windows';
  if (p === 'macos' || /^mac/.test(np) || /mac os x/.test(ua)) return 'mac';
  if (p === 'linux' || /linux/.test(np) || /linux|x11/.test(ua)) {
    const arm = h.architecture ? h.architecture === 'arm' : /aarch64|arm/.test(np) || /aarch64|armv/.test(ua);
    return arm ? 'linux-arm' : 'linux-x64';
  }
  return 'unknown';
}

/** The hints, read here (the high-entropy values are asked of this browser, locally; nothing is sent). */
export async function readHints(nav: Navigator = navigator): Promise<DeviceHints> {
  const ud = (nav as Navigator & { userAgentData?: { platform?: string; mobile?: boolean; getHighEntropyValues?(h: string[]): Promise<Record<string, string>> } }).userAgentData;
  let hi: Record<string, string> = {};
  try { hi = (await ud?.getHighEntropyValues?.(['architecture', 'bitness'])) ?? {}; } catch { /* not offered */ }
  return {
    uaPlatform: ud?.platform, mobile: ud?.mobile, architecture: hi.architecture, bitness: hi.bitness,
    platform: nav.platform, userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints,
  };
}

export const PLATFORM_NAME: Record<Platform, string> = {
  'linux-x64': 'Linux on x86-64', 'linux-arm': 'Linux on ARM', windows: 'Windows', mac: 'macOS', chromeos: 'ChromeOS',
  phone: 'a phone', tablet: 'a tablet', unknown: 'this computer',
};

/** bankML's two Hugging Face pages, which `./install.sh start --space` lets in (install.sh SPACE_ORIGIN). */
export const SPACE_ORIGINS = ['https://pythai-bankml.static.hf.space', 'https://pythai-ultimate-bankml-ui.static.hf.space'];

export interface InstallPlan {
  platform: Platform;
  /** Can it run bankML here, and how well. */
  verdict: 'fast' | 'slow' | 'no';
  lede: string;
  /** Commands, in order: shown in a code block, each line copyable. */
  commands: string[];
  notes: string[];
  /** Suggest browseML or the free CPU tab instead. */
  suggest: ('browse' | 'space')[];
}

/** The exact commands (docs/usage.md §1 and §6a): clone and install, then serve the verified model natively for
 *  this page's origin. The installer starts serve for this computer only; it is stopped first. */
export function serveLines(origin: string): string[] {
  if (SPACE_ORIGINS.includes(origin)) return ['./install.sh start --space    # lets bankML\'s Hugging Face pages reach your serve'];
  return [
    './install.sh stop    # the installer started serve for this computer only',
    'target/release/bankml serve .models/Bonsai-8B-Q1_0.gguf \\',
    '  --fork ~/.local/share/bankml/forks/Bonsai-8B-Q1_0.gguf.FORK.json \\',
    `  --native --listen 127.0.0.1:18093 --allow-origin ${origin}`,
  ];
}
const CLONE = 'git clone https://github.com/cryptoAGI/bankml && cd bankml && ./install.sh';
/** Off Linux x86-64 (macOS, ARM Linux) install.sh stops: its check step needs `ss` (macOS has none) and its engine step
 *  downloads a Linux x86-64 llama.cpp. So: build, import and pin the model, and serve with bankML's own engine
 *  (docs/usage.md §5 and §6), which needs no llama.cpp. */
export function nativeLines(origin: string): string[] {
  return [
    'git clone https://github.com/cryptoAGI/bankml && cd bankml',
    'cargo build --release    # Rust 1.99 (rustup fetches it); bankML has no crates',
    'python3 sAGI/models.py import bonsai-8b    # 1.16 GB, its sha256 checked, the FORK.json pin written',
    'target/release/bankml serve .models/Bonsai-8B-Q1_0.gguf \\',
    '  --fork ~/.local/share/bankml/forks/Bonsai-8B-Q1_0.gguf.FORK.json \\',
    `  --native --listen 127.0.0.1:18093 --allow-origin ${origin}`,
  ];
}

export function installPlan(p: Platform, origin: string): InstallPlan {
  const unix = [CLONE, ...serveLines(origin)];
  switch (p) {
    case 'linux-x64':
      return { platform: p, verdict: 'fast', lede: 'Linux on x86-64: bankML builds and runs here with its fast kernels (AVX2).', commands: unix,
        notes: ['The installer needs Rust 1.99+, Python 3.10+, git and curl, and no sudo. It downloads and verifies Bonsai-8B (1.16 GB).'], suggest: [] };
    case 'windows':
      return { platform: p, verdict: 'fast', lede: 'Windows: bankML runs in WSL2 (Linux inside Windows), with its fast kernels.',
        commands: ['wsl --install -d Ubuntu    # in PowerShell, once; then open Ubuntu', ...unix],
        notes: ['WSL2 forwards 127.0.0.1 to Windows, so this page reaches serve at 127.0.0.1:18093.', 'Run the commands inside the Ubuntu window, not in PowerShell.'], suggest: [] };
    case 'mac':
    case 'linux-arm':
      return { platform: p, verdict: 'slow', lede: `${PLATFORM_NAME[p]}: bankML builds and runs, but without its fast kernels yet (NEON is on the 0.5.0 road): answers are slow. browseML in this browser is the easier way for now.`,
        commands: nativeLines(origin),
        notes: ['./install.sh is for Linux on x86-64 (and WSL2) only: here it stops at its checks. These steps build bankML and serve with its own engine (--native), no llama.cpp needed.',
                'You need Rust (https://rustup.rs), Python 3.10+, git and about 3 GB of disk.'], suggest: ['browse', 'space'] };
    case 'chromeos':
      return { platform: p, verdict: 'slow', lede: 'ChromeOS: bankML runs in the Linux development environment (Crostini) when it is on; on x86-64 with its fast kernels.',
        commands: unix, notes: ['Settings → Advanced → Developers → Linux development environment, then these commands in its Terminal.'], suggest: ['browse'] };
    case 'phone':
    case 'tablet':
      return { platform: p, verdict: 'no', lede: `On ${PLATFORM_NAME[p]}: not yet. Use browseML (bankML in this browser) or the free CPU tab.`, commands: [], notes: [], suggest: ['browse', 'space'] };
    default:
      return { platform: p, verdict: 'slow', lede: 'This browser does not say what machine it is on. On Linux x86-64 (or Windows with WSL2):', commands: unix, notes: [], suggest: ['browse'] };
  }
}

/** Why an installed bankML may not answer this page: the usual causes, in order. */
export function unreachableReasons(origin: string, endpoint: string): string[] {
  return [
    `Is it running? ${endpoint.replace(/^https?:\/\//, '')} must answer: ./install.sh status`,
    'The browser asks once whether this page may reach "apps and services on this device" (local network access): allow it. If you blocked it, allow it in the site settings (the icon left of the address).',
    `Was serve started with --allow-origin ${origin}? Without it the browser hides the answers from this page.`,
    'Safari keeps an https page from reaching http://127.0.0.1 (mixed content): use Chrome, Edge or Firefox for your own bankML, or browseML here.',
  ];
}
