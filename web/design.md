# Design: Industrial Skeuomorphism

The trainer looks and behaves like a piece of test equipment: a matte plastic chassis with bolted
modules, recessed data slots, physical keys that press in, LED status lights, and a dark display. The
chess board sits inside a carbon-bezel device, because the board is the instrument and everything else
is its control panel.

References: a 1980s Braun control panel, Teenage Engineering's OP-1. Functional first, ornament only
where it explains state.

## Files

| File | Holds |
|---|---|
| `styles/tokens.css` | every color, shadow, radius, easing and layout constant. Nothing else defines raw values. |
| `styles/app.css` | components, built only from tokens |
| `index.html` | markup and the inline icon sprite |
| `src/trainer.js`, `src/app.js` | behavior. They set classes and `data-state`; they never set styles except progress widths. |

Change a look by changing a token. If a component needs a value no token has, add the token first.

## The physics (rules every component follows)

1. **One light source, top-left at 45°.** Highlights go top/left (`--highlight`), shadows bottom/right
   (`--shade`). Never reverse this, except to show something pressed in.
2. **Four elevation levels.**

   | Level | What | Token |
   |---|---|---|
   | −1 recessed | inputs, wells, meters, chips | `--shadow-recessed` |
   | 0 chassis | the page | `--chassis` background |
   | +1 module | panels, the form, the control module | `--shadow-card` |
   | +2 floating | keys, the device | `--shadow-key`, `--shadow-floating` |

3. **Pressing inverts the shadow.** Keys move down 2px and swap to `--shadow-pressed` on `:active`
   (150 ms). A latched toggle stays pressed and lights its LED.
4. **Things don't appear from nowhere.** Feedback slides in from the panel edge; meters fill;
   LEDs switch on. Motion uses `--ease-spring` (slight overshoot) and only `transform`/`opacity`.

## Color

| Token | Value | Use |
|---|---|---|
| `--chassis` | `#e0e5ec` | page and module surface |
| `--panel` | `#f0f2f5` | rare raised highlight surface |
| `--recessed` | `#d1d9e6` | wells, chips, grooves |
| `--ink` | `#2d3436` | text |
| `--ink-muted` | `#4a5568` | labels and secondary text (6.8:1 on chassis) |
| `--shade` / `--highlight` | `#babecc` / `#ffffff` | the neumorphic shadow pair |
| `--display` | `#2d3436` | dark technical panels, device bezel |

### The accent is split by job

The design system's safety orange `#ff4757` fails WCAG AA as text: 3.3:1 under white and 2.6:1 on the
chassis. So one hue has three tokens:

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--accent` | `#ff4757` | LEDs, glows, meter fill, focus rings, board selection | not used for small text |
| `--accent-face` | `#d92b3a` | primary key surface under white text | 4.8:1 |
| `--accent-ink` | `#b8222f` | accent text and links on the chassis | 5.0:1 |

The accent stays rare: the primary key, the knob, active LEDs, focus, the scan meter. Anything else in
red reads as an alarm.

### Status LEDs

| State | Color | Where |
|---|---|---|
| idle | unlit grey | nameplate |
| fetching, scanning | amber, pulsing | nameplate, scan display |
| ready | green, glowing | nameplate, scan display |
| error / wrong answer | red, glowing | nameplate, feedback |

An LED always sits next to a monospace label saying what it means. Color is never the only signal.

## Type

- **Inter** (400–800) for headings, prose and key labels.
- **JetBrains Mono** (400–800) for everything machine-like: labels, moves, counters, inputs, status.
- Labels: 11–12px mono, 700, uppercase, `0.08em` tracking, like stamped legends.
- Headline: 800 weight, `-0.03em` tracking, with a 1px white emboss (`--emboss`).
- Moves (`.mv`) are mono in a small recessed chip, so notation reads as data, not prose.
- Body copy stays at 16px or above and under about 65 characters per line.

## Components

| Component | Class | Built from |
|---|---|---|
| Module (bolted panel) | `.module` | `--shadow-card`, four corner screws (radial gradients 12px from each corner), `.vents` |
| Data slot (input/select) | `.slot` | `--shadow-recessed`, mono 17px, 56px tall, accent ring on focus |
| Toggle key (checkbox) | `.toggle` | key shadow; checked = pressed shadow plus a lit accent LED |
| Key (button) | `.key`, `.key.primary`, `.key.ghost` | `--shadow-key`; press inverts; primary on `--accent-face` |
| Display | `.display` | dark surface, inner shadow, 4px scanlines |
| Meter | `.meter` | recessed groove; segmented accent fill with glow |
| Device (board bezel) | `.device` | carbon weave from two repeating gradients, floating shadow, side buttons |
| Feedback readout | `.fb.ok`, `.fb.no` | recessed well with a status LED in its heading |
| Review meter | `.vu` | recessed well; bars grow with spring easing |
| Step housing | `.steps li::before` | numbered circle with `--shadow-sharp` |

### Signature details (keep them)

Corner screws on every module, vent slots top-right, the red knob in the nameplate, LEDs with
labels, scanlines on displays, the carbon bezel's side buttons. They are what make this look
manufactured instead of templated. Put them in the same positions everywhere.

## The board inside the device

Squares are cool greys (`--sq-light`, `--sq-dark`) so the accent and amber highlights stay legible:
- last move: amber wash (`--sq-last`)
- selected piece and its targets: accent ring and dots
- "show checks & captures": amber inset outline, the same color as the "scanning" LED

## Layout and responsiveness

- Container 72rem; side gutter 16px on phones, 48px from 768px (`--gutter`).
- Hero: headline and form side by side from 1024px (6:5), stacked below.
- Trainer bench: device and controls side by side from 900px, stacked below.
- Every interactive element is at least 48px tall (`--touch`); keys go full width under 560px.
- Checked at 390px wide: no horizontal scroll.

## Accessibility

- Text contrast meets WCAG AA everywhere (see the accent split above).
- Focus is always visible: a 2px accent outline offset 3px, or an accent ring on slots.
- LEDs pair with text; the feedback heading says "Found it." / "Not the one." as well as lighting.
- Checkboxes stay real checkboxes, only visually hidden, so keyboard and screen readers work.
- `prefers-reduced-motion: reduce` turns off all animation and transitions.

## Departures from the source design system, and why

| Source says | Here | Why |
|---|---|---|
| React, Tailwind, lucide-react, Framer Motion | plain CSS custom properties, inline lucide SVG sprite, CSS transitions | the app has no build step or framework; adding one for styling isn't worth it |
| `#ff4757` for buttons and links | three accent tokens | AA contrast |
| External textures (transparenttextures.com) | inline SVG noise, CSS carbon weave | no third-party requests, works offline, nothing to fail |
| Hover lifts cards | modules don't lift | they aren't clickable; lifting would suggest they are. Keys still react. |
