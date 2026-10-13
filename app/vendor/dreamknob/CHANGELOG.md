# Changelog

## 1.1.4 — 2026-07-14

Light-theme support — the controls whose chrome was hardcoded dark now adapt.

### Themeable LED well
- **`ledWell` theme token** — the recessed "screen" fill behind the LED
  segments of `LEDKnob`, `LEDFader`, `Meter`, and the default well of
  `SegmentDisplay` / `AlphaDisplay`, now comes from the theme instead of a
  hardcoded near-black. Dark base keeps the classic dark well (`#0b0d0e`); the
  **light base is `transparent`**, so LED controls and readouts render as clean
  flat segment rings / bar meters / digits on the light panel (still clearly
  "LED" from the lit segments) instead of dark blobs. The `faceColor` /
  `background` props still override per-instance.

### Light-theme panel chrome
- **`scheme` theme token** (`'dark' | 'light'`, set by the `base`) drives the
  raised gradient/border/shadow of `PushButton` (and `Button`),
  `TransportButton` and `SegmentSwitch`. On a light base they render as light
  raised buttons instead of dark chips; unlit LED pips flip to a faint dark so
  they still read. New `panelButtonChrome(scheme, pressed)` helper.
- Fixes the whole panel-button/switch family looking like dark chips on light
  themes; the flat knobs and faders already adapted (their face is the `face`
  token).

## 1.1.3 — 2026-07-14

Fourth integration-feedback release — a composability fix for buttons, a much
smarter meter, and the pan control the mixer was missing.

### Buttons
- **Action buttons no longer show an LED by default.** `Button` (and
  `PushButton mode="action"`) are plain by default — an action has no state to
  indicate. `led` defaults to `'strip'` for `toggle`/`momentary` (which do have
  a state) and to `false` for `action`; pass `led="dot"` / `led="strip"` to opt
  a command button back in.

### Buttons compose as Radix triggers
- `PushButton` / `Button` now forward unknown props (`...rest`) to the
  underlying `<button>` and **compose** their own event handlers with any the
  consumer (or a Radix `asChild` slot) injects. A `Button` can now be a
  dropdown / tooltip / popover trigger: `onPointerDown`, `onKeyDown`,
  `data-state`, `aria-expanded` etc. all reach the DOM and fire alongside the
  button's own press behavior. The prop types now extend the native button
  attributes.

### Meter — ballistics, dBFS, loudness
- **`ballistics`** — PPM-style attack/decay smoothing of the displayed level
  (`true` ≈ 5 ms attack / 350 ms decay, or `{ attack, decay }` in ms).
- **`peakDecay`** — the peak-hold marker falls with a decay tail (normalized
  units/second) after `peakHold` instead of snapping back.
- **`scale="db"`** — feed linear amplitude (0..1) and the meter displays dBFS;
  `min`/`max` default to -60 / 0 dB and faint reference gridlines are drawn
  (`showScale` / `referenceTicks` to tune). New `ampToDb` / `dbToAmp` helpers.
- **`integrated`** — a time-windowed loudness estimate (LUFS-ish on the dB
  scale — a windowed mean of channel power, not a full BS.1770 measurement),
  shown as a secondary readout and a marker line (`integrationWindow`,
  `loudnessColor`).
- All of the above are opt-in; the default meter behaves exactly as before.

### New component
- **`PanKnob`** — a bipolar stereo-pan knob: fills from center, snaps to a
  center detent, reads out `L<n>` / `C` / `R<n>`. Defaults to a −50…50 range
  centered at 0.

## 1.1.2 — 2026-07-14

Third integration-feedback release — a general action button, responsive
faders everywhere, and the label-scaling gap, all surfaced building a
resizable streaming studio.

### New components
- `Button` — a normal **click-to-fire** command button in the panel style
  (Regenerate, Add, Apply, Refresh), the non-latching sibling of `PushButton`.
  It's `PushButton` locked to the new `mode="action"`: never latches, shows a
  press-down + a brief LED flash, calls `onClick`. `led="dot"` (default) gives
  the corner-dot look; `led={false}` a plain button.

### Buttons
- `PushButton` gains **`mode="action"`** (alongside `toggle`/`momentary`) and
  an `onClick` prop — the stateless command-button behavior `Button` wraps.

### Responsive faders
- **`fill`** on `LEDFader` (matching `Fader`) — the fader stretches along its
  travel axis to fill the container instead of a fixed `length`, so faders in
  resizable dock panels size themselves with no wrapper measurement.

### Label scaling
- **`labelSize`** on `IndicatorLamp` — the caption otherwise tracks `size` but
  is floored at 10px; set this to shrink it with a small lamp (e.g. matching a
  dense header row). Also on `LampRow` for parity.

### Docs
- A dedicated **Buttons & switches** section with a "which do I use?" guide
  (Button = action · PushButton = latch · TransportButton = transport ·
  ToggleSwitch = boolean · SegmentSwitch = mode) and a live demo of each.

## 1.1.1 — 2026-07-13

Second integration-feedback release — the friction that showed up once the
displays and switches went into dense, resizable, themed product panels.

### Readout legibility
- Seven-segment decimal point and colon now render as **bold cells with their
  own width** (not hairlines between digits), so `17.5` and `1:23:45` stay
  readable at status-bar sizes
- `weight` prop on `SegmentDisplay`/`AlphaDisplay` thickens the segments (a font
  weight); `gap` controls inter-cell spacing for crowded readouts like `18.1/24`

### Displays: theme + value colors
- `SegmentDisplay` defaults to `theme.ledGreen`, `AlphaDisplay` to
  `theme.ledAmber` — theme your readouts once instead of prop-drilling `color`
- `valueColor: (v) => string` and value-space `zones` on `SegmentDisplay` — a
  resource readout colors itself green/amber/red without app-side math
- Charset: `:` colon (both displays), `$` and `%` (14-seg)
- `disabled` + `data-disabled` on displays (uniform dimming like the controls)

### Knob captions
- `sublabel` — a second caption line (`SEED` over `world #7`)
- `labelSize` — caption size independent of the dial diameter

### New components
- `ToggleSwitch` — rocker/slider boolean (`role="switch"`), the knob slides
  OFF↔ON; `showStateLabel`, ←/→ keys
- `Gauge` — read-only radial arc meter (the round sibling of `Meter`) for
  CPU/RAM/load; zones or `valueColor`, needle, center readout
- `TransportButton` — play/pause/stop/record/rewind/forward/panic family styled
  to match the controls beside it; `record` blinks (reduced-motion aware)
- `LampRow` — a row of indicator lamps with console-print captions
- `LabeledField` — label · control · unit in one aligned row (share `labelWidth`)
- `Rack` — channel-strip / rack container owning panel chrome + spacing

### Responsiveness & niceties
- `fill` on `Meter` and `Fader` — stretch to the container instead of fixed px
- `led="dot"` corner behavior plus a `leadingIcon` slot on `PushButton`
- Theme gains `ledGreen`, `ledAmber`, `panel` tokens

## 1.1.0 — 2026-07-13

Integration-feedback release — everything in here came from wiring dreamknob into a
real product.

### New components
- `IndicatorLamp` — pressable LED lamp (`role="switch"`), toggle/momentary, `blink`
  (reduced-motion aware), `readOnly` status-light mode
- `SegmentSwitch` — hardware-styled segmented selector (radiogroup, roving focus,
  arrow/Home/End keys, LED tick)
- `ScrubField` — After-Effects-style numeric field: label scrubbing (Shift = fine),
  draft typing (Enter commits, Esc reverts), arrow steps, wheel; `role="spinbutton"`
- `MeterBridge` — labeled multi-strip meter block with per-channel peak-hold text
- `PushButton` gains `led="dot"` — corner-dot LED that scales down for small
  icon-only toggles (`led` now `boolean | 'strip' | 'dot'`)

### New capabilities
- `commitMode="release"` — drags preview visually but emit a single `onChange` on
  pointer-up; Esc discards the preview (expensive parameters)
- `Meter` accepts `value={[l, r, ...]}` for multi-channel bars with a shared clip LED
- Theme gains `zoneGood` / `zoneWarn` / `zoneHot`; `Meter`, `MeterBridge` and
  `LEDFader` default their zones from the theme
- `XYPad` axes accept `invert` and per-axis `detents`; arrow keys follow the visual
  direction on inverted axes
- `Fader` gains `valuePosition: 'top' | 'end' | 'none'` — `'end'` renders one-line
  inspector rows with a stable readout width
- `LEDKnob` / `LEDFader` / `Meter` gain `unit`; `displayDecimals` is no longer capped
- Skins without visible readouts now default `aria-valuetext` from `format`/`unit`
  (`SteppedKnob` announces position names)

### Fixes
- `Meter` clamps geometry below `breadth` 14 — no negative-dimension SVG rects on
  thin strips
- `mixColors` falls back to CSS `color-mix()` for non-hex inputs, so theme tokens can
  be `var(--x)` / `oklch()` without breaking gradients and glows
- Type-in editing now fires a proper edit gesture: `onChangeStart` → `onChange` →
  `onChangeEnd` with `source: 'edit'` (was a bare `'api'` set with no gesture events)
- The `ChangeMeta.source` contract is documented (docs + `types.ts`): every user
  gesture brackets exactly one Start/End pair; `'api'` fires neither
- Disabled controls set `data-disabled` on the wrapper (including labels/readouts)
  and dim uniformly

## 1.0.0 — 2026-07-12

Initial release.

### Controls
- Rotary knob skins: `FlatKnob`, `MetalKnob`, `RubberKnob`, `VintageKnob`, `LEDKnob`,
  `NeonKnob`, `SteppedKnob`, `ImageKnob` (film-strip sprites)
- Linear: `Fader` (custom cap color/length), `LEDFader` (meter-zone segments)
- Displays: `Meter` (peak hold + latching clip LED with `clipValue` peak detection),
  `SegmentDisplay` (7-seg incl. letters/hex), `AlphaDisplay` (14-seg alphanumeric)
- `XYPad` (two-parameter pad), `PushButton` (toggle/momentary with LED)
- Composable `<Knob>` + primitives (`Arc` with gradients, `Pointer`, `Ticks`,
  `TickLabels`, `Face`, `KnobValue`, `KnobLabel`, `GlowFilter`) and fully headless
  `useKnob`

### Interaction core
- Rotary (absolute / relative / pickup), relative vertical/horizontal, absolute track
  modes; drag acceleration; cursor hiding; magnetic detents; endless `wrap` mode
- Wheel with trackpad delta accumulation, `wheelStep`, focus-gated capture
- Full keyboard support, Escape drag-cancel, double-click reset, type-in editing
  (`editable`, `"1.2k"` parsing), Shift fine control
- Value model: any range, decimal steps with float-safe rounding, discrete `values`,
  detent `steps`, linear/log/pow/custom tapers, bipolar `origin`
- `onChange`/`onChangeStart`/`onChangeEnd` with gesture `meta.source`; gesture-scoped
  undo friendly
- `animateChanges` tween for programmatic changes (reduced-motion aware), `valueBubble`

### Integration
- Theming via `DreamknobProvider` (dark/light bases, per-instance override)
- Keyboard-only focus rings, `role="slider"`/`role="meter"` semantics,
  `aria-orientation`, `data-*` state attributes, `data-part` CSS hooks
- `forwardRef` on all interactive components, hidden form inputs via `name`,
  touch via pointer capture (mobile verified), SSR-safe rendering
