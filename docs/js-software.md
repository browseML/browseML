# JavaScript software — tooling, client-side files, and the historical collections

The JavaScript projects browseML learns from: the UI toolkits its control panel takes its patterns from, the
client-side file and content-addressing projects behind where its model can come from, and the two collections of
historical JavaScript kept under [javascriptit](https://github.com/javascriptit) and
[interplanetaryfilesystem](https://github.com/interplanetaryfilesystem). Licences were read from each repository on
2026-10-13; NOASSERTION means GitHub could not name it (the repository's own licence file decides; helia, ipfs-car, sha.js
and react-mosaic were read from theirs). The rule is the same as for the
[GPU](gpu-software.md) and [CPU](cpu-software.md) catalogues: reference what others built, write our own.

**Contents** · [Tooling UIs](#tooling-uis-the-control-panels-patterns) ·
[Client-side files and content addressing](#client-side-files-and-content-addressing) ·
[javascriptit](#javascriptit--historical-client-side-javascript) ·
[interplanetaryfilesystem](#interplanetaryfilesystem--the-decentralised-web) · [What browseML takes](#what-browseml-takes)

---

## Tooling UIs: the control panel's patterns

| library | licence | the pattern | in browseML's control panel |
|---|---|---|---|
| [Blueprint](https://github.com/palantir/blueprint) (Palantir) | Apache-2.0 | a toolkit for dense desktop apps: Drawer, Collapse, Callout, Toaster, Hotkeys, Tabs | the left drawer, folding sections, callouts by intent, the result line |
| [Tweakpane](https://github.com/cocopon/tweakpane) | MIT | a compact panel of bindings and *monitors* with live graphs | read-only monitors with sparklines (engine memory, writing speed) |
| [lil-gui](https://github.com/georgealways/lil-gui) | MIT | a floating panel of controllers in folders | folders that remember being open |
| [dat.GUI](https://github.com/dataarts/dat.gui) | Apache-2.0 | lil-gui's ancestor | — |
| [Leva](https://github.com/pmndrs/leva) | MIT | React-first parameter panels | DreamKnob dials bound to browseML's settings |
| [stats.js](https://github.com/mrdoob/stats.js) | MIT | the FPS / ms / MB strip | the panel's live strip: state, tok/s, MB held |
| [uPlot](https://github.com/leeoniya/uPlot) | MIT | small, fast time-series charts | the sparklines (a few lines of SVG of our own) |
| [Golden Layout](https://github.com/golden-layout/golden-layout) | MIT | docking, resizable panes | the resizable sidebar and the field's dock |
| [react-mosaic](https://github.com/nomcopter/react-mosaic) | Apache-2.0 | a tiling window manager | the response windows' tile and cascade |
| [DreamKnob](https://git.dreamodus.software/Dreamodus/DreamKnob) (Dreamodus Software) | MIT | studio-grade knobs, faders, meters, gauges, switches | **used**: vendored in `app/vendor/dreamknob` |

## Client-side files and content addressing

| project | licence | what it is | for browseML |
|---|---|---|---|
| [ipfs-car](https://github.com/interplanetaryfilesystem/ipfs-car) | Apache-2.0 / MIT | files and folders to content-addressed archives (CAR) and back, in the browser | a model as a CAR, its CID beside its sha256 pin |
| [helia](https://github.com/interplanetaryfilesystem/helia) | MIT / Apache-2.0 | IPFS implemented in JavaScript | pulling the model by CID from peers as well as from Hugging Face |
| [ipfs-webui](https://github.com/interplanetaryfilesystem/ipfs-webui) | MIT | a browser file manager for an IPFS node | the pattern for showing what browseML keeps in this browser |
| [merkletreejs](https://github.com/interplanetaryfilesystem/merkletreejs) | MIT | Merkle trees and proofs in JavaScript | receipts gathered into a Merkle root, as bankML's Savante does |
| [sha.js](https://github.com/interplanetaryfilesystem/sha.js) | MIT | streamable SHA hashes in pure JavaScript | hashing a model while it streams in (bankML hashes it in WebAssembly today) |
| [wave-share](https://github.com/interplanetaryfilesystem/wave-share) | MIT | serverless, peer-to-peer local file sharing through sound | sharing a small file between two devices with no network |
| [web-llm](https://github.com/interplanetaryfilesystem/web-llm) | Apache-2.0 | LLMs in the browser (fork of mlc-ai/web-llm) | WebGPU inference, not exact: see [gpu-software.md](gpu-software.md) |
| File System Access API (`showDirectoryPicker`, `showOpenFilePicker`) | W3C / WICG | a page reads a file or a whole folder the visitor chooses | **next:** load a `.gguf` from the visitor's own disk; bankML's pin still decides |
| Origin Private File System (`navigator.storage.getDirectory`) | WHATWG | a private, fast file system per origin | a place for the model and warm slots beside Cache Storage |

## javascriptit — historical client-side JavaScript

A collection of 2011–2015 projects that ran money and privacy in the browser, long before WebAssembly. What they share
with browseML: the client does the work, the server is not trusted.

| project | licence | what it was |
|---|---|---|
| [bitaddress.org](https://github.com/javascriptit/bitaddress.org) | not stated | a client-side Bitcoin wallet generator: keys made in the page, offline |
| [OfflineWallet](https://github.com/javascriptit/OfflineWallet) | MIT | a browser cryptocurrency wallet that runs offline |
| [bitcoinjs-lib](https://github.com/javascriptit/bitcoinjs-lib) | MIT | Bitcoin in pure JavaScript |
| [Bitcoin-JavaScript-Miner](https://github.com/javascriptit/Bitcoin-JavaScript-Miner) | not stated | mining in the browser (2011): the first "your CPU, in a page" |
| [javascript-crypto-library](https://github.com/javascriptit/javascript-crypto-library) | BSD-3-Clause | cryptography for web developers |
| [bitcore](https://github.com/javascriptit/bitcore), [bitcore-mnemonic](https://github.com/javascriptit/bitcore-mnemonic), [bip39](https://github.com/javascriptit/bip39) | NOASSERTION / MIT / ISC | wallets, mnemonics |
| [copay](https://github.com/javascriptit/copay) | MIT | a multisignature wallet |
| [trezor.js](https://github.com/javascriptit/trezor.js) | LGPL-3.0 | hardware-wallet API for the browser |
| [cryptocat](https://github.com/javascriptit/cryptocat), [subrosa-client](https://github.com/javascriptit/subrosa-client) | AGPL-3.0 / NOASSERTION | end-to-end encrypted chat in the browser |
| [password-manager](https://github.com/javascriptit/password-manager) (Clipperz) | AGPL-3.0 | a vault that knows nothing about you |
| [JSBrowser](https://github.com/javascriptit/JSBrowser) | MIT | a web browser built with JavaScript |
| [node-torrent](https://github.com/javascriptit/node-torrent) | MIT | torrent reader, writer and hash checker |
| [node-Tor](https://github.com/javascriptit/node-Tor) | NOASSERTION | Tor in JavaScript |
| [github](https://github.com/javascriptit/github) | BSD-3-Clause | a GitHub API wrapper for the browser |

## interplanetaryfilesystem — the decentralised web

| project | licence | what it is |
|---|---|---|
| [ipfs-desktop](https://github.com/interplanetaryfilesystem/ipfs-desktop), [ipfs-companion](https://github.com/interplanetaryfilesystem/ipfs-companion) | MIT / CC0-1.0 | IPFS on the desktop and in the browser |
| [ipfs-webui](https://github.com/interplanetaryfilesystem/ipfs-webui), [ipld-explorer-components](https://github.com/interplanetaryfilesystem/ipld-explorer-components) | MIT / NOASSERTION | file manager and data explorer in the browser |
| [helia](https://github.com/interplanetaryfilesystem/helia), [js-ipld](https://github.com/interplanetaryfilesystem/js-ipld) | MIT / Apache-2.0; MIT | IPFS and IPLD in JavaScript |
| [ipfs-car](https://github.com/interplanetaryfilesystem/ipfs-car), [web3.storage](https://github.com/interplanetaryfilesystem/web3.storage), [nft.storage](https://github.com/interplanetaryfilesystem/nft.storage) | NOASSERTION | content-addressed archives and storage |
| [public-gateway-checker](https://github.com/interplanetaryfilesystem/public-gateway-checker), [ipfs-check](https://github.com/interplanetaryfilesystem/ipfs-check), [checkup](https://github.com/interplanetaryfilesystem/checkup) | NOASSERTION / none | is the data reachable: gateways and peers (a PING for content) |
| [ipfs-deploy](https://github.com/interplanetaryfilesystem/ipfs-deploy), [npm-on-ipfs](https://github.com/interplanetaryfilesystem/npm-on-ipfs) | NOASSERTION / MIT | static sites and packages on IPFS |
| [merkletreejs](https://github.com/interplanetaryfilesystem/merkletreejs), [sha.js](https://github.com/interplanetaryfilesystem/sha.js) | MIT; MIT | Merkle proofs and hashing |
| [wave-share](https://github.com/interplanetaryfilesystem/wave-share) | MIT | file sharing through sound |
| [agregore-browser](https://github.com/interplanetaryfilesystem/agregore-browser) | AGPL-3.0 | a browser for the distributed web |
| [web-llm](https://github.com/interplanetaryfilesystem/web-llm) | Apache-2.0 | LLMs in the browser |
| [deltaverse](https://github.com/interplanetaryfilesystem/deltaverse) | MIT | DeltaVerse platform delivery architecture |
| [awesome-ipfs](https://github.com/interplanetaryfilesystem/awesome-ipfs) | CC0-1.0 | the index of IPFS resources |

## What browseML takes

- **Today:** the control panel's patterns (Blueprint, Tweakpane, lil-gui, stats.js, uPlot), re-made in-house;
  DreamKnob for the dials.
- **Next, client-side files:** a model loaded from the visitor's own disk (a `.gguf` or a folder, through the File
  System Access API) or by CID (helia, ipfs-car), kept in the Origin Private File System; wherever it comes from,
  bankML checks it against its sha256 pin before it answers, as it does the download today.
- **The lineage:** bitaddress.org and the 2011 JavaScript miner showed that the client can do the work and keep the
  secrets; browseML does the same with a language model, and proves each answer with a receipt.
