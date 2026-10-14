# Changelog

## Version numbers: the patch rolls over after 9

From here the third number rolls over after 9 (0.6.9 → 0.7.0). The releases published as **v0.6.10–v0.6.15 are
0.7.0–0.7.5** in this numbering; their tags keep the names they were published under. The next release is 0.7.6.

| published | in the numbering |
|---|---|
| v0.6.10 | 0.7.0 |
| v0.6.11 | 0.7.1 |
| v0.6.12 | 0.7.2 |
| v0.6.13 | 0.7.3 |
| v0.6.14 | 0.7.4 |
| v0.6.15 | 0.7.5 |

## 0.8.0 — 2026-10-14 — the fire knows your record; two ideas measured before building

- **The fire's reference is this browser's record**: at load, the best writing speed recorded here before (its own
  answers, the same thread count) becomes the reference the flames are scaled against, so they read right from the
  first answer of a visit, and a speed-record surge now means a record across visits, not the first fast stretch of
  this one. The seed itself raises no surge (unit-tested).
- **Exact speculative decoding, simulated before building** (`testing/spec_sim.py`): prompt-lookup drafts (3-token
  match, 4 drafted) replayed on the 9 recorded oracle turns and on a browseML answer from its own 500-token prompt, at
  this laptop's measured costs (a token written ≈ 1/3 s, read in a batch ≈ 1/7 s): 50 of 427 tokens accepted, ×1.04
  overall, ×1.13 on the browseML answer. Not built: too little for the risk; worth it with a draft model or where
  reading is far cheaper than writing. In the [TODO](docs/TODO.md) with its numbers.
- **The Origin Private File System, measured**: inconclusive on this full disk (the first 248 MB read 26 s from Cache
  Storage against 5.8 s from OPFS, later reads 1.4–3.3 s either way); in the TODO.
- The TODO brought up to date with the GPU work of 0.7.0–0.7.4 and what was tried and not kept.

## 0.7.9 — 2026-10-14 — usage.md: the fire's cost under its switch

- [usage.md](docs/usage.md): LIMITERS' row says what 0.7.7 put under the fire's switch — its cost now, or that it
  sleeps. The last release in the 0.7 line; the next is 0.8.0.

## 0.7.8 — 2026-10-14 — the explanation brought up to date

- [explanation.md](docs/explanation.md): the GPU as it is now (its time to 100%, EXACT on the kernels the engine runs,
  DIAGNOSTICS showing what the card did, and why GPU comparisons hold its share fixed), and a section on the
  processor's fire — what it shows, what it costs, and how it sleeps, slows and switches off.

## 0.7.7 — 2026-10-14 — the fire's cost under its switch

- **LIMITERS shows what the fire costs now**, right under its switch, from its own measure: frames a second,
  milliseconds each, its share of the page's main thread — or "asleep" (no frames while the engine rests) or "off".
  The browser's compositing costs more than the drawing (efficiency.md); switching it off frees both.
- Browser test: the line is there under the switch.

## 0.7.6 — 2026-10-14 — the fire at 10 frames a second while the engine computes

- **While bankML reads, writes, warms or verifies, the fire draws 10 frames a second instead of 15** (30 otherwise,
  and none when it sleeps): the CPU is the engine's then. Measured in headless Brave, two alternating rounds, the
  flames hot without arcs: 26–27% of a core at 15 fps, 20–21% at 10. Surges still draw at full rate for their instant.

## 0.6.15 — 2026-10-14 — the fire for less, and the night's measurements written down

- **The fire costs a quarter less again**: its canvas covers the lower 45% of the window instead of 60% (at least the
  flames' height and room for embers). Its cost follows its area: in headless Brave, the flames hot without arcs took
  39–47% of a core at 60% and 27% at 40%; at 45%, 26–27% (42–47% with an arc every 2 s, from 56–66% in 0.6.12 and
  99–106% in 0.6.10). The flames look the same; the embers rise through the lower half.
- **Tried and not kept**: embers over the whole window as 28 CSS-animated elements (no canvas, moved by the compositor)
  — 125–138% of a core hot against 53–56% without them: any running CSS animation makes the browser composite the whole
  window at 60 frames a second.
- [efficiency.md](docs/efficiency.md): 0.6.10–0.6.15 — the GPU's calibration noise and the comparisons made with the
  share held fixed; the page's own cost, idle and with the fire, version by version.

## 0.6.14 — 2026-10-14 — what the card did, from the engine

- **DIAGNOSTICS · GPU shows what the card did in the engine**, from bankML's own limiter after each answer (the
  worker reads `browseml_gpu_status` once the answer is taken): the share of each 1-bit matrix's rows it computes,
  how busy it was against its limit, the memory it holds; the products it computed and those the CPU took while it
  rested or because a matrix was over its memory limit; and the matrix shapes decided for the card, for the CPU
  (measured faster there) or still being measured. Without a verified card it says why (GPU off, or no verified
  card — a software adapter is never used). These are the numbers that explained the GPU's speed in 0.6.10–0.6.12;
  until now only `testing/bench.mjs` printed them.
- Browser test: the row is there and says what it found.
- Found by the browser checks before release: the worker's new status read first named its result `text`, which
  shadowed the decoder the engine's log calls during open — the engine could not open ("Cannot access 'text' before
  initialization"). Renamed; the Node gate cannot see this (it never runs the page's worker), the browser checks did.

## 0.6.13 — 2026-10-14 — EXACT checks the kernels the engine runs

- **EXACT checks the engine's own kernels**: until now it proved bankML's simple kernel on the visitor's GPU; the
  forward pass runs two others — the fast one (eight lanes per row, writing) and the tiled one (four tokens per
  invocation, reading a prompt). EXACT (TOOL SUITE) and `web/gpu-exact.html` now run both on five tokens (a partial
  tile) and check every result against bankML's reference for its token: in headless Brave (SwiftShader) 1280/1280,
  320/320 and 2560/2560 for each, at the three shapes. The verdict in DIAGNOSTICS counts all three. The same in
  [browseML/webgpu](https://github.com/browseML/webgpu)'s page.
- **The GPU verdict's words brought up to date**: it no longer says "browseML answers on the CPU today" or "ready for
  an exact kernel when browseML has one" — the card has computed its verified share of each answer since 0.6.7.
- bankML `262a27a`: a card run that fails during the share's calibration now gives no share (before, its quick
  failure timed as a very fast card); a test that measures the calibration's spread; the 0.4.0 milestone gate ticked
  in its TODO (it passed on 2026-10-07).

## 0.6.12 — 2026-10-14 — measured again, with the noise taken out

- **A correction to 0.6.11**: its "+8% reading at 100% of the GPU's time" does not hold. That measurement let bankML
  calibrate the card's share afresh in every run, and the calibration itself moves 38–56% from run to run on the
  AMD Radeon Vega 3 (Dawn, 3 threads), more than the effect measured. With the share fixed (0.42), three alternating
  rounds, 27 of 27 answers identical: reading 6.23 tok/s at 80% (the default), 6.17 at 100%, 6.28 at 100% with a
  smaller share in place of the rests; writing 2.36, 2.32, 2.46 — the same within the noise. The slider stays (the
  card's time is the visitor's to give); its text no longer claims a speed-up.
- **Tried in bankML and not kept**: a second share for prompt reading, calibrated on a 16-token product (bit-exact,
  tested on the card). With the writing share fixed: reading 5.56 against 5.75 tok/s, writing 2.28 against 2.20,
  18 of 18 identical — no gain, recorded in bankML's TODO under "Rejected, with reasons".
- **The fire, half the cost, behind the page.** Measured in headless Brave (all of its processes, /proc; the fire
  driven hot through a test hook, `__browsemlPulse`): Brave took 99–106% of a core with the fire hot against 7% with
  it asleep — the fire's own drawing only 1.1 ms a frame, the rest the browser compositing a window-sized canvas in a
  blend mode. Now the flames and embers sit on a canvas over the lower 60% of the window, **behind the page** (the text
  stays readable, the fire shows between it), in plain alpha, never opaque, and at 15 frames a second while the engine
  computes; the arcs have a page-wide canvas of their own, drawn only while one is alive, their glow a wide faint
  stroke instead of a shadow blur. Hot: 56–66% of a core (42–44% without arcs), from 99–106% (≈ 50%); idle unchanged
  (7%). Software compositing in headless Brave overstates what a GPU-composited page pays; the shape of the saving
  holds. The first screenshots also showed the flames hiding the FAQ and a hard edge at the side glows: both fixed
  (the glows are now in the lower corners, fading every way).
- **The fire measures itself**: frames a second, milliseconds of the page's main thread per frame (and per part:
  automaton, blit, glow, embers, arcs), and that time as a share of the main thread, over the last second it drew;
  DIAGNOSTICS (CPU) shows it, or "asleep: no frames" when the engine is idle. The browser test samples it while the
  engine answers.
- **HARD DRIVE no longer reports less in use than the model it keeps**: the browser's storage estimate can lag its
  own writes (0.0 MB just after the model was stored); the figure is now at least the model's size, said so ("its
  estimate lags; REFRESH"), and the room left follows it. Found by the 0.6.12 browser checks.
- `testing/bench.mjs` passes every `BANKML_GPU_*` variable (`BANKML_GPU_SHARE`, `BANKML_GPU_LIMIT`, …) to the engine,
  so a comparison can hold the share fixed.

## 0.6.11 — 2026-10-14 — the GPU's time, to 100%

- **The GPU's time, a slider to 100%** (CPU · RAM · GPU · CACHE, under the GPU's OFF · LOW · HIGH): the share of the
  card's time bankML may take, 25% to 100%, passed to the engine's limiter (`BANKML_GPU_LIMIT`: after a dispatch of d
  the card rests d·(1−L)/L). 80% stays the default, room for the screen and other tabs; at 100% it never rests. APPLY
  restarts the engine with it. Answers are the same at any setting (18 of 18 identical to the record at 80% and
  100%). Speed: see 0.6.12 — a first measurement here read +8% for 100%, but it let the card's share be calibrated
  afresh each run; with the share fixed the difference is within the noise.
- `testing/bench.mjs` passes `BANKML_GPU_LIMIT` to the engine.
- Browser test: the slider, at 80% by default.

## 0.6.10 — 2026-10-14 — the processor's fire; prompts read on the GPU four tokens at a time

- **The processor's fire, across the page**: flames along the bottom of the window whose height and colour follow
  what the engine is doing — the live writing speed (tokens counted over the last three seconds) against the best this
  visit, the prompt being read or warmed, the download and verification, a diagnostic running — embers drifting up
  over everything, and the edges glowing when it runs hot. **Electrical surges** on the engine's own events: branching
  arcs with a flash, blue-white for the GPU's verdict (and EXACT passing), green for a receipt or a new speed record,
  red for an error or STOP, orange for a question or a load. Cheap by design: a low-resolution fire automaton at most
  30 frames a second, no frames at all when the engine is idle, paused in a background tab, a still glow with reduced
  motion; LIMITERS switches it off. The signals come from `app/src/bankml/pulse.ts` (unit-tested).
- **Prompts read on the visitor's GPU four tokens per invocation** (bankML `8f5e930`, `Q1_0_MM4`): each weight word
  decoded once for four tokens, every token's arithmetic unchanged, so the same bits (`testing/gpu.mjs`: partial tiles
  included). The kernel, interleaved medians on the AMD Radeon Vega 3: 1.14–1.18× at 64–512 tokens; tiles of 8 and 16
  measured and not kept; micro-batches under four tokens stay on the CPU. The engine's whole reading speed did not
  move beyond the noise: 0.6.9's engine against 0.6.10's, GPU on, 3 threads, three alternating rounds (load ≈ 4 from
  another build): reading 4.75–7.26 tok/s (mean 5.77) against 4.78–6.31 (mean 5.54), writing 1.92–2.58 against
  2.00–2.51, the card's verified share 39–49% in both; 18 of 18 answers identical to the record. The kernel is faster;
  on this integrated card the CPU's share of the rows, not the kernel, sets the reading speed.
- bankML's kernel treatise, [KERNELS.md](https://github.com/cryptoAGI/bankml/blob/browseml/docs/KERNELS.md), and
  usage.md brought to 0.6.9 (the control panel section by section).

## 0.6.9 — 2026-10-13 — SAMPLING, deeper: three advanced tools, sliders you can read and reach

- **Three advanced sampling tools**, each switched ON and OFF as a whole, from llama-server's own chain as bankML
  reproduces it (its sampler oracle, token for token), so the receipt still says exactly what ran:
  **DRY** (strength, growth, allowed length: repeated sequences penalised, single words left alone), **XTC** (how
  often, threshold: the most obvious words set aside now and then) and **dynamic temperature** (range, curve: cooler
  where the model is sure, warmer where it is not). Checked on the browser engine (`browseml-mt-relaxed.wasm`, Node):
  each is accepted, and XTC and dynamic temperature change the answer at the same seed (`EXTRA=` in `testing/bench.mjs`).
- **What the next question sends**, at the top of SAMPLING: max tokens and every field you set, as chips; ✕ removes one
  (back to the engine's default). **COPY AS JSON** copies them.
- **Sliders you can read**: semi-transparent glass tracks whose filled part shows the value, a translucent thumb, the
  value riding above it while you drag or use the arrow keys. An unset dial rests, dimmed, on the engine's own
  default (llama.cpp's, named: "default 0.80"); double-click goes back to it; click the value to type one.
- **Depth on borders**: each dial a card with a lit top edge and a shadow beneath; a dial you set carries an orange edge,
  a tool switched on a green one.
- Browser test: a preset and XTC switched on, listed for the next question; a chip removed and XTC off.

## 0.6.8 — 2026-10-13 — the GPU measured on a quiet machine; the server's card learns the same lessons

- **Measured on a quiet machine** (load 2–5, no browser open): through Dawn on the AMD Radeon Vega 3, 3 threads,
  two rounds alternating with the GPU off, the GPU on: prompt reading 6.70–7.53 → 7.30–7.74 tok/s, writing
  2.88–3.34 → 3.14–3.41 tok/s, 12 of 12 answers identical to llama-server b11192's record.
- **bankML `f618309`** (branch `browseml`): what browseML learned on WebGPU, now on the server's Vulkan card too —
  the token dimension in SPIR-V (`q1_0_mat_mul8`, prompts read on the card) and grouped submissions (up to four in
  flight, one wait). Bit-exact in `bankml gpu --verify` and the new `gpu_submissions_in_flight` test; native answers
  byte-identical. The engine in the page is unchanged in behaviour (the worker's group bound is checked).

## 0.6.7 — 2026-10-13 — the visitor's GPU in bankML's forward pass, exactly

- **The GPU computes answers in the page** (bankML `a32f81c`, branch `browseml`): a GPU worker
  (`web/browseml-gpu-worker.js`) holds the WebGPU device and serves the engine's `bankml_gpu_*` imports
  (`web/browseml-gpu-host.js`) while the engine's thread waits on `Atomics`. bankML gives the card rows only after its
  kernel reproduced the CPU kernel's bits on it, and keeps each matrix shape on the card only where it measured the
  card faster. It needs threads (cross-origin isolation); the CPU computes everything otherwise.
- **The GPU switch** (CPU · RAM · GPU · CACHE): OFF · LOW · HIGH now chooses the engine's GPU too; APPLY restarts
  bankML with it, and the panel says what the card does (verified, its share) or why the CPU does everything.
- **Found and fixed in bankML:** the GPU limiter read the available RAM from `/proc`, which a browser does not have,
  so a browser's integrated card was never given a matrix. Now the heap's limit alone applies there.
- **Prompt reading on the GPU** (`begin_many` / `finish_many`): the kernel's token dimension takes a share of every
  micro-batch's rows; **grouped submissions** (`begin_group` / `finish_group`): Q/K/V and gate/up on the card at
  once, one wait. Through Dawn on an AMD Radeon Vega 3 (3 compute units), 3 threads, two rounds alternating with the
  GPU off: reading 5.05 → 5.41 and 5.10 → 5.60 tok/s, writing unchanged (~2.2), 12 of 12 answers identical to
  llama-server b11192's record.
- **bankML owns the kernel** (`gpu/wgsl.rs`): the engine hands the GPU worker the shader's text and the vendor's
  workgroup size (AMD 64, NVIDIA 32); `testing/gpu.mjs` checks that `browseml-gpu.js`'s copy is the same text.
- **bankML knows browseML** (`host.rs`, `bankml hosts`): browseML is a client host — the visitor's own machine,
  nothing leaves it — and `bankml serve` a server host. The engine names itself at open and the engine log shows
  the host and the side.
- Every host of the engine (the page's worker and threads, the oracle, the slot test, the GPU test, EXACT's
  reference) is given the GPU imports; `testing/bench.mjs` prints the GPU limiter's state with `GPU=`.

## 0.6.6 — 2026-10-13 — speed, measured to the kernel; WebGPU exact on real AMD

- **Cheaper sign lanes** (bankML `1c3c16c`): the relaxed WebAssembly kernels make each block's 0/1 lanes in three
  operations instead of five. A/B, 4 threads, alternating runs: prompt reading 6.72 → 7.13 tok/s (+6%); writing
  unchanged; every answer identical. The WASM test now also holds the per-token kernel to the reference.
- **Where a token's time goes**, profiled: the per-token kernel 55%, the prefill tile 21%, attention 6.5%; writing is
  bound by arithmetic, not memory. Recorded in `docs/TODO.md` with the next steps (the GPU in the forward pass, exact
  speculative decoding, attention).
- **WebGPU exact on a real AMD GPU** (`web/browseml-gpu.js`): Mesa's compiler simplified TwoSum's `(a + b) − a` and
  lost its error term (WGSL cannot mark operations exact, as SPIR-V's NoContraction does), so the kernels were not
  exact on AMD under Chrome or Dawn — the EXACT tool would have said so and the GPU would never have joined. Each
  intermediate now passes through an OR with a zero the compiler only learns at run time. Checked on an AMD Radeon Vega
  3 through Dawn (`testing/gpu.mjs`): every result bit-exact, both kernels, every shape.
- **A fast exact kernel** (`Q1_MM_WGSL`): bankML's `q1_0_mat_vec8` in WGSL — eight invocations per row, one per lane of
  the CPU kernel — with a second dimension for a prompt's tokens and the workgroup size for the vendor (64 AMD, 32
  NVIDIA; 32/64/128 give the same bits). On the Vega 3: 2048×2048 in 2.3 ms for one token (the simple kernel 15 ms),
  64 tokens in 18.7 ms (14.4 GMAC/s).
- **Measured and not kept:** a 2-row tile for writing on WebAssembly, bit-exact but no faster (2.97 → 2.88 tok/s),
  as bankML had found on x86.

## 0.6.5 — 2026-10-13 — faster prompt reading, the processor measured, prompts kept per persona

- **Prompt reading +34% in the browser** (bankML `1781a17`, branch `browseml`): WebAssembly now has bankML's prefill
  tile — one weight row's sign bits decoded once for four prompt tokens (relaxed SIMD, and plain SIMD for any value),
  each result the per-token kernel's bits. Measured A/B on a Ryzen 3 3200U, `browseml-mt-relaxed.wasm`, 4 threads,
  alternating runs: 5.08 → 6.82 tok/s reading; writing unchanged; every answer identical to llama.cpp's record. New
  test `wasm_act_tile_bit_exact` (600 random tiles with and without −128, and whole matrices) passes on both builds.
- **The processor, measured:** at the first interaction browseML measures how many threads are free right now (bursts
  of 1, 2, 3 … workers; a thread counts when it adds real throughput), past the cores the browser reports, and claims
  them with room: one left for the unexpected from four. The engine waits for the measure, so it starts with it. The
  CPU slider shows it (free, reported, the claim), with AUTO and RE-MEASURE; a count you choose wins. Robust to a
  busy moment: every count from 1 to 8 measured twice (about 2.6 s, once a visit), the fewest workers reaching 90% of
  the best total taken, and measured again when that is under half of what the browser reports.
- **The control panel comes out with every new response window**, whatever opened it (a question, the FAQ, the
  windows menu, a reply), on a desktop.
- **Closed, the panel keeps a tab on the left edge** (hover peeks, a press opens it): no input field needed.
- Fixed: switching persona now reads and keeps the new persona's prompt (it used the context from before the switch).
  Found by the browser checks.
- **Prompts kept per persona:** each prompt (a persona, a `.prompt`, a context size) keeps its own read slot, up to a
  number you set (1–8, default 4), the least recently used removed first; switching back is a restore in a moment,
  not minutes of reading. CACHE lists them by name (tokens, size, context, last used), forgets any one, READ NOW,
  CLEAR CACHE, the RAM cache with what the last answer reused. A slot kept by 0.6.4 is removed on the next save.
- Fixed: the browser test left a headless Brave running after its last check (a download in progress); it now
  always closes it.
- Browser test: the processor measured; CACHE naming its prompt; a new persona keeping its own beside it, and its
  opening message.

## 0.6.4 — 2026-10-13 — out of the input field; the panel arranged by you; tok/s you can read

- **Out of the input field:** a new response window grows out of the field, and so does the control panel when it
  opens (none of it when the system asks for reduced motion).
- **Reply fields only when chosen:** response windows have no input of their own; the input field asks. A window's
  **⋯** menu adds a reply field to it, or to every window (also in the field's responses menu).
- **NOW**, the panel's top as a section: tiles for the engine (ON/OFF, threads, context), writing and reading tok/s,
  memory held and its peak, the prompt cache's size and tokens, the last prompt's reading time; a **speed chart** (each
  answer's writing speed as a bar, its reading speed as a line, the average dashed, the scale and last values
  labelled, every bar's numbers on hover); the engine's memory over the last minute with now / min / max.
- **Every section arranged by you:** drag a section by its grip ⠿ (mouse, pen or finger; ↑ ↓ on the grip), hide it
  with –, bring it back with SHOW, RESET LAYOUT. Kept in this browser.
- Browser test: the reply field opt-in, the speed chart, dragging a section to the top, hiding and showing it.

## 0.6.3 — 2026-10-13 — the control panel takes charge: ON · OFF · CLEAR, sliders to 100%, the engine log, personas and a builder

- **ON · OFF · CLEAR** at the top of the panel. OFF stops an answer (with its receipt) and frees the engine's memory;
  the model stays, so ON starts it again in seconds.
- **The load, said as it happens**, after the PYTHAI/browseML Space: the progress bar, MB of MB, MB/s, time left,
  elapsed, the source host, pieces asked for again, PAUSE · RESUME · CANCEL; a clock while bankML verifies; "ready in"
  with the download and open times; errors with what to do. The device's environment line beneath.
- **The strip:** ON/OFF, threads and context, writing speed (and reading), memory held, and the prompt cache's size.
- **CPU · RAM · GPU · CACHE**, sliders that go to 100%, each with what is measured now: threads 1–8 (past the cores the
  browser reports, since Brave reports fewer; that is why the browser was slower than Node), the context against the
  device's memory, the GPU off · low · high, the prompt cache's size and CLEAR CACHE. APPLY restarts the engine.
- **ENGINE LOG** in the panel: bankML's own lines and the page's steps (download, verify, prompt cache, each receipt).
- **PERSONA:** switch between browseML's own and personas made here (name, opening message, prompt); import and
  export `.persona` files. browseML's own is read from `browseml.persona` every visit, so its facts stay current; it
  now carries the real links and an opening message.
- **BUILDER:** `.persona` — browseML fills the name, the opening message and the prompt from a description, on this
  computer (checked on the engine: the three lines came back, 3.6 tok/s on 4 threads); `.prompt` — browseML writes a
  system prompt for a task; `.memory` — a note kept for every question.
- **SAMPLING**, Savante's dials: answer length from 1 (the single-token proof) to 2048, temperature, top-p, and top-k,
  min-p, repeat penalty, seed — sent only when set (unset is the engine's default).
- **HARD DRIVE, tighter**, and **SAVE FOR bankML**: the model and its FORK.json, ready for `bankml serve`.
- **Links in answers are links** (http(s), and bare github.com / huggingface.co addresses; nothing else).
- The field reads **"browseML knows best"**. The logo is the favicon.
- Fixed: the first click on the page was lost (the panel opened on the press and moved the page); it opens after it.
- The browser test (`app/tests/browser.mjs`): ON · OFF · CLEAR, the new sections, SAVE FOR bankML; the gpu-exact check
  read "256/256" correctly.
- The engine is unchanged (bankML `0346076`); `browseml.js` lets a visitor ask for up to 8 threads.

Not released on its own: **0.6.2** below (its browser checks found the lost first click).

## 0.6.2 — 2026-10-13 — the page just loads; the panel opens on the first interaction; HARD DRIVE; a release gate

- **The page just loads.** Nothing starts until the visitor's first interaction (a press or a key anywhere): then the
  control panel pops out on the left and browseML starts from a model already on this computer (kept in the browser,
  or a remembered folder; nothing is downloaded by this). Shelved by the visitor, the panel stays shelved for the
  visit; on a phone it is not opened for them (T opens it). A download starting also brings it out.
- **START, STOP, CLEAR** in the panel's TOOLS: START starts browseML from what is here, else imports it (pulled once,
  checked against its pin).
- **The panel opening moves the field and windows clear of it**: a dropped field and the windows on its side shift
  right of the panel instead of lying over it.
- **HARD DRIVE** in the control panel: the browser's storage (used of what the site may use), whether the browser
  keeps it under pressure (KEEP STORAGE asks), the model kept here, CLEAR (with a confirm), "remove the model after
  the session", and **keep a copy of the model on this computer's disk**: written into a folder the visitor chooses
  (File System Access, its size checked; with persistent access on, the folder is remembered and the next visit
  starts from that copy) or, where the browser cannot write folders, saved to the downloads.
- **The response window does not ask:** a question loads the model straight away, the window showing its progress;
  the "Import browseML" button appears only with the *ask before downloading* limiter, now off by default (it used to
  follow the browser's data-saver hint). A remembered folder's model is tried before any download.
- **The control panel opens with the response window** (each new one, on a desktop), the field dropping beside it.
  Each visit starts with the page alone, whatever the panel was last time.
- **Room before the download:** the browser's quota for the site is checked before 248 MB are pulled, with what is
  left and what to do, instead of failing after the download.
- **HARD DRIVE knows the disk:** the room left for the site; when the model is on the disk twice (a remembered folder's
  copy and the browser's), FREE THE BROWSER'S COPY.
- **Measured** (`docs/efficiency.md`, `testing/results/measure-v0.6.2.txt`): 1, 2 and 4 threads, relaxed against
  plain SIMD, peak memory, the prompt cache, and the usage diagnostics run on those records. Relaxed SIMD: +51%
  reading, +33% writing at 4 threads; 2 threads: 83% of 4 threads' speed for 35% less CPU time on a 2-core machine.
- **Usage diagnostics:** new advice when half the threads give most of the speed (≥ 80%) — cores that share in pairs.
- Fixed: a folder read through the folder input showed its name twice (`my-models/my-models/…`).
- Fixed: the response window's card crashed (React #300) when browseML became ready while it was showing.
- **The release gate** (`testing/release.sh <version>`): every check that needs no browser, in order — the three
  engines built and their sha256, the kernels under Node's WASI (SIMD, relaxed SIMD), the download (pieces, cuts, two
  sources), the oracle's 9 conversations on `browseml.wasm` and on `browseml-mt-relaxed.wasm` with 2 threads, the
  prompt cache (save, restore, the cold engine's answer), the app's typecheck, unit tests and build, the model copy
  against its pin — kept as the release's record in `testing/results/v<version>.txt`.
- **The browser checks** (`app/tests/browser.mjs`, run by `testing/browser.sh`, appended to the same record): headless
  Brave on a throwaway profile, the built page served cross-origin isolated — the page and FAQ, T opening the control
  panel with its sections, the tool suite (MEMORY, CPU, STORAGE, SENSORS, EXACT), a model found in a folder and used
  with no download, a FAQ answer with its receipt a closed accordion, kept in `.history` and `.memory`, the RECEIPTS
  fold and its toggle, the prompt cache restored on the next visit, `gpu-exact.html`, and a question with no model
  going straight to loading it. `playwright-core` is a dev dependency (it drives the installed browser; no download).
- `testing/bench.mjs`: with an oracle record, an answer that differs now fails the run.
- Versions aligned: the crate and the app are 0.6.2 (the crate said 0.1.0). Each release from here: +0.0.1.

## 0.6.1 — 2026-10-13 — receipts in closed accordions, kept in .history and .memory

- **Each answer's receipt is a closed accordion** (`Receipt.tsx`): one line — ✓ receipt, prompt → completion tokens,
  tok/s — that opens to the delivery in full and the receipt's fields (bankML's version, the model's, the request's and
  the answer's sha256, the counts) and the receipt as bankML wrote it. The "browseML ready" card folds the same way.
- **RECEIPTS in the control panel:** the *view receipts* toggle (off: receipts are kept, not shown under answers) and
  the last 30 receipts kept, each an accordion.
- **Kept twice:** with each exchange in `.history` (as before), and now as a **delivery record** in `.memory` — the
  question, the verdict, the receipt, the counts, the model — which `.memory` keeps but never sends to the model, so
  the prompt (and its warm slot) is unchanged.

## 0.6.0 — 2026-10-13 — models already on this computer, folder control, persistent access

- **Folders on this computer** (`app/src/bankml/folders.ts`): the visitor grants a folder (read-only, File System
  Access API); browseML finds the models in it — `*.gguf` anywhere (bankML's `.models`, LM Studio, llama.cpp), and blobs
  named by their sha256 (Ollama's `blobs/sha256-…`, the Hugging Face cache's `blobs/…`), recognised by name at once —
  and uses its own with no download (bankML still checks the sha256 as it opens). Where the API is missing or off
  (Firefox, Safari; Brave until `brave://flags/#file-system-access-api` is on), a folder input reads a folder for that
  visit. 5 tests: what a file is, which one browseML runs, a nested scan with its skips and limits.
- **Persistent access, a toggle** (off by default): granted folders kept in IndexedDB; the next visit starts the model
  from its folder with no prompt when the browser kept the grant, or offers RECONNECT. Turning it off forgets them.
- **Keep a copy, a toggle:** off, the model is read from its folder each visit — nothing kept in the browser (248 MB
  saved).
- **Folder control** in the control panel (MODELS ON THIS COMPUTER): add, rescan, reconnect, remove; every model found
  with its verdict and USE. **Look in a folder** in the response window's card.
- `docs/TODO.md`: the sources' limits, measured (Git LFS metered at 10 GiB a month for a free organisation; GitHub
  Release assets send no CORS header); self-hosting as the third source.

## 0.5.0 — 2026-10-13 — the GPU, exactly; two verified sources; a model you already have

- **bankML's Q1_0 kernel on WebGPU, bit-exact** (`web/browseml-gpu.js`): the dot product in WGSL as `vec_dot_ref`
  does it, f16 decoded with integer operations, the outer multiply-add as bankML's `fma_exact` (TwoSum and
  round-to-odd: WGSL's `fma()` may round twice). `exact()` holds it to bankML's own reference (the new export
  `browseml_q1_dot_ref`). In Brave (SwiftShader): 832/832 rows bit-exact over three shapes; the controls — plain
  multiply-add and WGSL's `fma()` — 110/256: the test is sharp. `web/gpu-exact.html` runs it in any WebGPU browser;
  the control panel's **EXACT** tool runs it on the visitor's GPU and the GPU verdict uses it.
- **Two verified sources:** Hugging Face and [browseML/models](https://github.com/browseML/models) (the model at a
  pinned commit, checked against Hugging Face's own LFS sha256 and Git blob ids by its `verify.mjs --source`). Each
  piece is asked of the source that answered last; a retry moves to the other. `testing/download.mjs`: one source
  down, the other serves the file whole (one request wasted).
- **A model you already have:** pick a `.gguf` on this computer; recognised by size, then sha256 against the pin
  (`recognise()`, tested), and used with no download. **Overwrite with a fresh copy** when the kept model cannot be
  used. (Unit-tested; the in-browser check waits for the operator's browser to be free.)
- `docs/TODO.md`: sources (IPFS, peer to peer, folders, OPFS), the GPU forward pass, the organisation's repositories.

## 0.4.0 — 2026-10-13 — the control panel, the prompt cache, the GPU recognised, the software catalogues

- **The prompt cache, across visits.** The engine's slot (the prompt already read) is saved after the first reading
  and kept in Cache Storage; the next visit restores it. `src/lib.rs` `browseml_slot(save|restore)` over bankML's own
  slot save/restore; a writable `/slots` in the WASI shim; `browseml.js` `warm(system)`, keyed by the sha256 of the
  model, the context and the prompt. Measured: `testing/slot.mjs` — the answer after a restore is the cold engine's,
  word for word; prompt reading 211.8 s → 12.9 s (one thread, Node). In Brave: visit 1 reads 464 tokens once (91 s)
  then answers from 5.7 s; visit 2 restores them in 0.6 s. The thread count left the prompt (Brave varies the cores it
  reports), so the key stays the same.
- **Asking is the go-ahead.** A question starts the model's download in the background, its progress in the window
  ("Loading the model in your browser…"), then answers; the *ask before downloading* limiter (on when the browser
  saves data) brings back the button.
- **STOP that stops.** Where the page is cross-origin isolated, a shared flag ends the answer at its next piece, with
  its receipt; elsewhere the engine is ended and the next question loads it again. The field's Stop uses it.
- **The control panel** (the left sidebar; **T** in the field opens it): a live strip (state, tok/s, MB held, with
  sparklines), TOOLS (STOP, CLEAR), the DreamKnob DIALS with the WARM stage (orange with red flares while the prompt is
  read), DIAGNOSTICS (network, CPU, RAM, GPU), the TOOL SUITE (PING, SPEED, CPU, MEMORY, STORAGE, GPU, SENSORS — each
  with its dial and RUN), LIMITERS (spare a core, low memory, ask before downloading, warm in background, GPU probe),
  ADVICE AND RECORDS. It shelves to a tab with the switch in its top-right corner (hover peeks, a press pins it),
  resizes by its right edge, folds its sections and remembers them; buttons dragged onto it reorder.
- **The GPU, recognised and measured** (`app/src/bankml/gpu.ts`): WebGPU's adapter, features and limits, WebGL's
  renderer; compute probes for fma exactness, GFLOP/s and GB/s. browseML answers on the CPU; a GPU kernel joins only
  when exact.
- **The software catalogues:** [graphics cards](docs/gpu-software.md), [CPU, memory and network](docs/cpu-software.md),
  [JavaScript tooling, client-side files and the historical collections](docs/js-software.md), licences read from
  each repository. bankML (the engine) and browseML (the client) explained side by side.

## 0.3.0 — 2026-10-13 — the browseML app: ask, load with one click, a FAQ browseML answers

- **One click to load.** Asked before the model is in the browser, the answer's window says *Click to load the model in
  your browser* with **Import browseML**; the model is pulled once in the background, checked against its sha256 pin,
  and the question is answered. Loaded, a new window starts with browseML's state (what was verified, threads,
  context, memory held, the last answer's speed). Checked in Brave: import, then the held question answered, ✓.
- **Ask, and find it anywhere.** An inquiry drops the field to the bottom left; its window opens above it, joined by a
  string (the field's tethers, on by default).
- **A FAQ answered by browseML**, from `web/browseml.persona` (a short factual persona, in place of bankML's 10 KB one).
- **browseML only.** Hugging Face is where the model comes from, nothing more: the free-CPU and provider answerers,
  the credential bridge, the answerer tabs and the install guide are gone from `app/`.
- **The page** is `app.html`, titled *browseML — machine learning in your browser*, with the logo.
- The field (`app/src`): message widgets (`widgets`), windows above the field (`outputPlace: 'above'`).

## 0.2.0 — 2026-10-12 — public; ultimate-clientside; the docs

- **Public**, with the organization's profile (browseML/.github).
- **`app/` — ultimate-clientside**: the ultimate input field with this computer's controls (DreamKnob dials for
  threads, memory, prompt cache and answer length; load, unload, clear, measure) and diagnostics from actual usage,
  behind 🛠 in the field and in a sidebar that appears when a button is dragged off the field. Built beside the
  landing page into one folder (`npm run build` → `dist/`: `index.html`, `clientside.html`). From the bankML UIF
  working tree at `cc56466`, without the GPL credential module, THOT, iNFT or the other pages.
- **The docs**: the README explains the project; the detail is in [docs/usage.md](docs/usage.md),
  [docs/explanation.md](docs/explanation.md) and [docs/technical.md](docs/technical.md).
- **The runtime**: `load()` and `chat()` take optional callbacks; `bankml.persona` served beside the pages.

## 0.1.0 — 2026-10-12 — browseML on its own

- **Its own repository**, out of bankML: the WebAssembly exports (`src/lib.rs`), the browser runtime (`web/browseml.js`,
  worker, thread, WASI shim, the model's pin), the landing page from PYTHAI/browseML (`web/index.html`, `app.js`,
  `style.css`), the tests (`testing/`: oracle, bench, download, the WASI runner) and the build (`tools/build.sh`).
  The engine is bankML itself, the submodule `bankml/` pinned at `0346076`. The first public experiments are mapped
  in [HISTORY.md](HISTORY.md).
- **The download in pieces**: 16 MB HTTP Range requests, each retried from the byte where the connection cut it;
  a 4xx stops at once; a server that ignores Range is read as one stream. Brave on Linux cut the single 248 MB
  response mid-body; `testing/download.mjs` checks the fix against a server that cuts. The landing page says when it
  asks for a piece again.
- **The model held once** in the engine's memory (bankML `0346076`, `gguf::Mmap` without mmap): 531 → 317 MB after
  open for Bonsai-1.7B, measured.
- **The page sets the prompt cache** (`load(…, { cacheRam })` → `BANKML_CACHE_RAM`), and **`loadStats`** measures
  every load (where the model came from, bytes, retried pieces, download and open times, memory).
