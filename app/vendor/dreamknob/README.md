# dreamknob

Studio-grade React knobs & faders. Rotary, linear, 2D, 3D, digital and analog — with a
headless core, any number range, any decimal precision, and colors you fully control.
Zero runtime dependencies.

```
pnpm add https://git.dreamodus.software/Dreamodus/DreamKnob/releases/download/v1.1.4/dreamknob-1.1.4.tgz
```

(Latest release tarballs: https://git.dreamodus.software/Dreamodus/DreamKnob/releases)

## Quick start

```tsx
import { FlatKnob } from 'dreamknob'

function Volume() {
  const [value, setValue] = useState(64)
  return (
    <FlatKnob
      size={90}
      value={value}
      onChange={setValue}
      min={0}
      max={100}
      step={0.5}
      label="Volume"
      unit="%"
      aria-label="Volume"
    />
  )
}
```

Uncontrolled works too: pass `defaultValue` instead of `value`/`onChange`
(it also becomes the double-click reset target).

## Interaction model

Every component shares one core:

| Gesture | Behaviour |
| --- | --- |
| Drag | `rotary` (grab & turn, follows the pointer angle), `vertical`, `horizontal`, `both`, or absolute `track-*` (faders) |
| Scroll wheel | one `step` per notch (else 1% of range); `Shift` = fine on continuous values — snapped controls always move whole steps |
| `↑ → / ↓ ←` | ± one step (`Shift` = 10×) |
| `PageUp/PageDown` | ± 10 % of range |
| `Home/End` | min / max |
| Double-click | reset to `defaultValue` — or open the type-in editor with `editable` |
| `Escape` | cancel an in-flight drag, restoring the start value |
| Touch / pen | pointer capture, `touch-action: none` |

All knobs render `role="slider"` with `aria-valuemin/max/now` (and `aria-valuetext`
when you provide `getAriaValueText`).

## Value handling

- `min` / `max` — any numbers (negative, fractional, huge).
- `step` — decimal snap increments (`0.5`, `0.001`, `1e-7`…) with float-drift-safe
  rounding; display precision inferred automatically, overridable via `decimals`.
- `values={[0.25, 0.5, 1, 2, 4]}` — discrete allowed values.
- `steps={5}` — evenly spaced detents (selector knobs).
- `taper` — `linearTaper` (default), `logTaper` (frequencies), `powTaper(n)` (gain),
  or your own `{ toNormalized, fromNormalized }`.
- `origin={0}` — bipolar anchor: arcs/fader fills draw from this value (pan, gain trim).
- `detents={[0]}` + `detentSize` — magnetic snap points while dragging.
- `editable` — double-click (knobs) or click the readout (faders) to type an exact
  value; `parseValue` customizes parsing (`"1.2k"` → 1200 out of the box).
- `rotaryMode` — `'absolute'` (rc-knob feel), `'relative'` (no grab jump), or
  `'pickup'` (MIDI-style: engages when the pointer sweeps past the value).
- `dragAcceleration` — velocity gain for relative drags; `hideCursorOnDrag` hides
  the cursor mid-gesture.
- `wheelStep` / `wheelRequiresFocus` — tune wheel notches, or keep hover-scroll free.
- `onChange` / `onChangeStart` / `onChangeEnd` — gesture-aware callbacks with
  `meta.source` (`'drag' | 'wheel' | 'keyboard' | 'reset' | 'edit' | 'api'`).
- `wrap` — endless encoder mode: values roll around min↔max (pair with
  `angleOffset={0} angleRange={360}`).
- `animateChanges` — tween the pointer on programmatic changes (preset loads);
  gestures never animate and `prefers-reduced-motion` is honored.
- `valueBubble` — floating readout above the control while dragging.
- `name` — hidden form input for plain `<form>` posts on every knob, fader and
  `PushButton` (`XYPad` uses `nameX`/`nameY`). Interactive components forward a ref
  to their root element, and primitive-drawn SVG parts carry `data-part` attributes
  for CSS styling.

## Prebuilt skins

```tsx
import {
  FlatKnob,     // clean 2D arc knob (arcFrom="center" for pan knobs)
  MetalKnob,    // 3D brushed aluminum, knurled rim (tone="silver" | "dark")
  RubberKnob,   // 3D soft-touch synth knob with glow halo
  VintageKnob,  // chicken-head bakelite over a printed scale
  LEDKnob,      // segmented LED ring + true seven-segment readout
  NeonKnob,     // glowing arc for dark UIs
  SteppedKnob,  // detented selector (positions={['LP','BP','HP']})
  PanKnob,      // bipolar stereo pan — center detent, L<n>/C/R<n> readout
  Fader,        // linear channel fader, vertical or horizontal
  LEDFader,     // segmented LED meter-fader with color zones
  ImageKnob,    // film-strip sprite knob (KnobMan-style PNG strips)
  Meter,        // LED level meter — multi-channel, PPM ballistics, dBFS scale, loudness
  MeterBridge,  // labeled multi-strip meter block with per-channel peak text
  Gauge,        // read-only radial arc meter (round sibling of Meter) for CPU/RAM/load
  XYPad,        // two-parameter pad (cutoff/resonance, vector mixing)
  PushButton,   // latch/hold panel button — LED strip or corner dot (toggle/momentary)
  Button,         // click-to-fire command button (no LED by default; led="dot" opt-in)
  IndicatorLamp,  // pressable LED lamp — the hardware checkbox (blink, momentary)
  LampRow,        // row of indicator lamps with console-print captions
  ToggleSwitch,   // rocker/slider boolean — the knob slides OFF↔ON
  SegmentSwitch,  // segmented option selector (radiogroup, LED tick)
  TransportButton,// play/stop/record/pause/panic family (record blinks)
  ScrubField,     // AE-style numeric field: drag the label to scrub, click to type
  SegmentDisplay, // seven-segment numeric display (weight, gap, value-color zones)
  AlphaDisplay,   // fourteen-segment alphanumeric display (now incl. : $ %)
  LabeledField,   // label · control · unit in one aligned inspector row
  Rack,           // channel-strip / rack container (panel chrome + spacing)
} from 'dreamknob'
```

Knob skins also take `sublabel` (a second caption line) and `labelSize` (caption
size independent of the dial); `Meter` and `Fader` take `fill` to stretch to their
container. `Meter` adds `ballistics` (PPM attack/decay), `peakDecay`, `scale="db"`
(feed amplitude, show dBFS) and `integrated` (windowed loudness) — all opt-in.
`PushButton`/`Button` forward native button props and compose handlers, so a
`Button` works as a Radix `asChild` trigger.

## Theming

```tsx
import { DreamknobProvider } from 'dreamknob'

<DreamknobProvider base="dark" theme={{ accent: '#ff4d6b' }}>
  {/* every control below inherits the tokens; instance props still win */}
</DreamknobProvider>
```

`base="light"` swaps in light-background defaults. Tokens: `accent`, `track`, `face`,
`text`, `label`, `ticks`, `focusRing`, `zoneGood`/`zoneWarn`/`zoneHot` (meter zones),
`ledGreen`/`ledAmber` (display defaults), `panel` (rack chrome), `ledWell` (LED display
well — transparent on the light base), `fontMono`, `fontUI`. `scheme` (`'dark'|'light'`)
is set by `base` and drives the panel-button/switch chrome; you rarely set it directly.

Every knob skin and fader takes the core props plus `size`, `label`, `showValue`,
`unit`, `format`, and per-part color props (`color`, `trackColor`, `faceColor`,
`bodyColor`, …). `VintageKnob` has no readout, so it omits `showValue`/`unit`/`format`;
the display components (`Meter`, `SegmentDisplay`, `AlphaDisplay`) have their own
smaller prop sets.

Also exported for custom builds: primitives (`Arc`, `Pointer`, `Ticks`, `TickLabels`,
`Face`, `KnobValue`, `KnobLabel`, `GlowFilter`), theming (`useKnobTheme`, `darkTheme`,
`lightTheme`), editing (`ValueInput`, `defaultParseValue`), colors (`mixColors`,
`sampleGradient`), and the math kit (`clamp`, `roundTo`, `snapToStep`,
`decimalsFromStep`, `findClosest`, `applyDetents`, tapers, angle/arc helpers).

## Compose your own

```tsx
import { Knob, Arc, Pointer, Ticks, KnobValue } from 'dreamknob'

<Knob size={96} min={-24} max={24} step={0.5} defaultValue={0} aria-label="Trim">
  <Ticks count={25} activeColor="#ffd23e" />
  <Arc radius={36} thickness={3} color="#ffd23e" from="center" />
  <Pointer type="triangle" radius={33} length={9} width={8} color="#ffd23e" />
  <KnobValue unit=" dB" />
</Knob>
```

`<Knob>` also accepts a render function: `{(ctx) => <YourSVG angle={ctx.angle} />}`.

## Fully headless

```tsx
import { useKnob } from 'dreamknob'

const { value, normalized, angle, isDragging, bind, setValue } = useKnob({
  min: 0, max: 11, step: 0.1, defaultValue: 11, 'aria-label': 'Volume',
})
return <div {...bind}>…your own rendering…</div>
```

## License

MIT © Dreamodus Software Inc.
