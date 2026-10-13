# app — ultimate-clientside

browseML behind the ultimate input field, with this computer's controls: the page `clientside.html`, built beside
the landing page (`../web/index.html`) into one folder, `dist/`.

- **🛠 in the field** (where T sits on other pages; this one has no terminal mode) opens a tray with the
  [DreamKnob](vendor/dreamknob/README.md) controls — CPU threads, RAM (the context), the prompt cache, the answer
  length, a gauge of the memory the engine holds, load/apply, unload, clear cache, measure — and the diagnostics from
  what actually ran (`src/bankml/usage.ts`: every load and answer recorded in this browser; advice from those records
  only).
- **The sidebar** is absent until a button is dragged off the field; then it appears with a menu (drop strip), the
  same controls and diagnostics, and any button panels (+ panel). Shelved buttons run on a press and drag back to the
  bar, to another shelf, or anywhere (`src/core/shelves.ts`, `src/components/Shelves.tsx`).
- **Docked in the page or popped out**: ⧉, or drag the field's grip; popped out it moves, resizes and docks to an edge.
- Slash commands: `/client` (`threads|ram|cache|answer <n>`, `apply`, `unload`, `clear yes`, `measure`), `/usage`,
  `/receipt`, `/shelf`.

```sh
npm install
npm run typecheck && npm test
npm run dev        # http://localhost:5173/clientside.html, cross-origin isolated (threads)
npm run build      # dist/: index.html (landing) + clientside.html, the runtime and the .wasm from ../web
```

Serve `dist/` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` for
threads (`npm run preview` does).

## Where the code comes from

`src/` is the ultimate input field (from [ultimate-input-field](https://github.com/Professor-Codephreak/ultimate-input-field),
MIT, with the shelves, the page dock, the tools tray and `terminalMode` added) and the bankML page code it needs
(answerers, the delivery pattern, browseML's settings, download and consent card), as in the bankML UIF working tree
at `cc56466` (2026-10-12). Left out: the GPL-3.0-only credential module (this page offers no sign-in; it loads none),
THOT and iNFT, and the other pages (bankML UIF, mindx.pythai.net/bankml, the Space mount). DreamKnob 1.1.4 is
vendored as its built package (MIT, Dreamodus Software Inc.). Licence: MIT ([LICENSE](LICENSE)).
