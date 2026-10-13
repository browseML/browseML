// SPDX-License-Identifier: MIT
// The MIT core's only contact with the visitor's credentials: a declared interface on window, provided by the
// separate, GPL-3.0-only module bankml-creds.js (source: src/creds/). The core never imports that module, never holds
// a token and never builds an Authorization header: it asks the module to sign in or out, to describe what it keeps,
// to draw its own "your credentials" panel, and to send one request to huggingface.co with the token attached
// (fetchWithToken refuses every other host). Without the module the page works, and offers no sign-in.

/** What the module reports: never the token itself. */
export interface CredsStatus {
  signedIn: boolean;
  user: string | null;
  /** How the token came: Hugging Face sign-in (OAuth with PKCE), or pasted by the visitor. */
  via: 'oauth' | 'pasted' | null;
  /** Where it is kept: this tab only (memory and sessionStorage), or remembered on this device (localStorage). */
  where: 'session' | 'device' | null;
  expiresAt: string | null;
  scopes: string[];
  /** Hugging Face sign-in works on this page (a Space with hf_oauth); elsewhere a pasted token is offered. */
  oauthAvailable: boolean;
}

export interface BankmlCreds {
  readonly version: string;
  readonly licence: 'GPL-3.0-only';
  status(): CredsStatus;
  /** Go to Hugging Face's sign-in (OAuth, PKCE). Resolves to a note when it cannot (not a Space with OAuth). */
  signIn(opts?: { remember?: boolean }): Promise<string | void>;
  /** Forget every copy of the token: memory, this tab, this device. */
  signOut(): void;
  /** What is stored, where, with which scopes, until when: one line each, for the page to show. */
  describe(): string[];
  /** One request to https://huggingface.co or https://router.huggingface.co with the token attached; any other
   *  host, or no token, rejects without sending anything. */
  fetchWithToken(url: string, init?: RequestInit): Promise<Response>;
  /** Called whenever the status changes (signed in, out, remembered, forgotten). Returns the unsubscribe. */
  onChange(f: () => void): () => void;
  /** Draw the module's own "your credentials" panel into `el` (sign in, create an account, paste a token where
   *  sign-in cannot work, remember, forget, sign out). Returns the function that removes it. */
  mountPanel(el: HTMLElement): () => void;
}

declare global {
  interface Window {
    bankmlCreds?: BankmlCreds;
  }
}

export const CREDS_SCRIPT = 'bankml-creds.js';
export const CREDS_READY = 'bankmlcreds:ready';

/** The module, when the page loaded it. */
export const creds = (): BankmlCreds | null => (typeof window !== 'undefined' && window.bankmlCreds) || null;

/** Load bankml-creds.js beside the page with its own <script type="module"> (once), and resolve when it is ready;
 *  null when it is not there (the page then offers no sign-in). Every caller shares the one load: a second caller
 *  used to find the script already injected and wait out the whole timeout when the file was missing. */
let loading: Promise<BankmlCreds | null> | null = null;
export function loadCreds(src = CREDS_SCRIPT, timeoutMs = 8000): Promise<BankmlCreds | null> {
  if (creds()) return Promise.resolve(creds());
  if (loading) return loading;
  loading = new Promise<BankmlCreds | null>(resolve => {
    const done = () => { clearTimeout(t); window.removeEventListener(CREDS_READY, done); resolve(creds()); };
    const t = setTimeout(done, timeoutMs);
    window.addEventListener(CREDS_READY, done);
    const s = document.createElement('script');
    s.type = 'module';
    s.src = new URL(src, location.href).href;
    s.dataset.bankmlCreds = '';
    s.onerror = done;
    // a module runs before its load event: a file that loaded but declared nothing resolves here, not at the timeout
    s.onload = done;
    document.head.appendChild(s);
  });
  // a page that already has its own <script type="module" src="bankml-creds.js">: a module URL runs once per page
  // (the module map), so this tag only reports load or error for it, and never runs it twice
  return loading;
}

/** The licence line every page shows (README, footer). */
export const LICENCE_LINE = 'Core MIT. The credential module (bankml-creds.js: Hugging Face sign-in, the token, the only code that sends it) is GPL-3.0-only, in its own file the core never imports — bankML\'s rule for code that holds a secret: every build that contains it must publish its source.';
