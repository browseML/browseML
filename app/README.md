# app — the browseML app

`app.html`: browseML behind the ultimate input field, built beside the landing page (`../web/index.html`) into one
folder, `dist/`.

| | |
|---|---|
| **Ask** | The field drops to the bottom left and the answer's window opens above it, joined by a string. |
| **Load with one click** | Not loaded yet, the window says *Click to load the model in your browser* with **Import browseML**; the question is answered once it is ready. Loaded, a new window starts with browseML's state. |
| **FAQ** | Each question is asked of browseML itself, answered on your computer with a receipt (facts in `../web/browseml.persona`). |
| **🛠 Tools** | DreamKnob dials for threads, memory (context), prompt cache and answer length; load, unload, clear, measure; the diagnostics from what actually ran. |
| **Sidebar** | Appears when a button is dragged off the field: a menu, the same dials and diagnostics, button panels. |
| **⧉** | Dock the field in the page, or pop it out. |

```sh
npm install
npm run typecheck && npm test
npm run dev        # http://localhost:5173/app.html, cross-origin isolated (threads)
npm run build      # dist/: index.html (landing) + app.html, the runtime and the .wasm from ../web
```

Serve `dist/` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` for
threads (`npm run preview` does). Hugging Face is only where the model is pulled from.

`src/` is the ultimate input field ([ultimate-input-field](https://github.com/Professor-Codephreak/ultimate-input-field),
MIT, with shelves, the page dock, the tools tray, message widgets, windows above the field and `terminalMode`) and the
browseML page code (`src/clientside/`, `src/bankml/`). DreamKnob 1.1.4 is vendored as its built package (MIT, Dreamodus
Software Inc.). Licence: MIT ([LICENSE](LICENSE)).
