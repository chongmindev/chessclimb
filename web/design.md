# Design: Minimalist Monochrome, one indigo accent

An analysis tool should read like a printed analysis: black ink, white paper, serif type, ruled lines.
Threat Scan is styled as an editorial chess page with a single pastel-indigo accent. The accent is
where the eye should go: the board, the move you played, the scan chips you switch on, the reply that
punishes you, and progress. Everything else is black and white, and every state is also said in words
or shape, never by color alone.

Words were cut in favor of interface (2026-10-15): the prompt is a move chip and a five-word question,
the scan steps are chips that light the board, and feedback is move cards plus an eval bar.

Replaced Industrial Skeuomorphism on 2026-10-15: monochrome suits analysis, and it frees enough
space for the whole app to fit one screen.

## Files

| File | Holds |
|---|---|
| `styles/tokens.css` | colors, line weights, type, timing, layout constants. The only place raw values live. |
| `styles/app.css` | components, from tokens only |
| `index.html` | markup and the icon sprite |
| `src/app.js`, `src/trainer.js` | behavior; they set `body[data-view]`, `data-state`, `hidden`, and progress widths only |

## One screen

On a desktop (1024px wide and 700px tall or more) the whole app fits the window with no page scroll:

```
+-- bar: wordmark ............................ export  import  [] status --+  4px rule
|                                 |  username ______________  from the last _  |
|                                 |  [RAPID][blitz][bullet][daily]  [SCAN ->]  |
|   stage: hero type,             |  [] status text ............               |
|   then the board                |  ---------------- progress rule            |
|   (square, sized to             |  ######## counters + review boxes ######## |  inverted band
|    the window height)           |  ========================================= |  4px rule
|                                 |  meta / meta / meta                        |
|                                 |  Prompt in Playfair                        |
|                                 |  01 02 03 steps  or  feedback              |
|                                 |  [actions]  or  [NEXT ->]                  |
|                                 |  footer line                               |
+---------------------------------+--------------------------------------------+
```

- The stage is a square whose side is the window height minus the bar, capped at 58% of the width.
- Views on `body[data-view]`: `intro` shows the hero and "How it works"; `waiting` shows the hero and
  a waiting line; `drill` swaps the hero for the board and shows counters and the drill.
- Once a deck exists, the form collapses to one summary line ("Dudacio · rapid · 2 mo  CHANGE").
- When an answer is shown, the three scan steps hide to make room for the feedback.
- The drill area scrolls internally as a last resort; nothing overlaps at any height.
- Checked at 1470×745: intro, drill and answered states all measure exactly the window height.
- Below 1024px wide the page stacks (board first) and scrolls normally.

## Color

| Token | Value | Use |
|---|---|---|
| `--white` | `#ffffff` | paper |
| `--black` | `#000000` | ink, borders, fills, the inverted band, focus |
| `--ink-muted` | `#525252` | labels and secondary text (7.8:1) |
| `--hairline-color` | `#e5e5e5` | hairline dividers, the empty progress track |
| `--accent-wash` | `#eef0fd` | light squares, the played-move chip, chip hover |
| `--accent-soft` | `#c5c9f4` | dark squares, the eval bar's swing |
| `--accent-mid` | `#9aa0ec` | last-move tint |
| `--accent` | `#5a5fd6` | active chips, the punishing-reply card, progress, step numbers, highlights (5.2:1) |

The accent never carries meaning alone: active chips also show their count, the key card is labelled,
and right/wrong is a word plus inversion/frame and a solid/dashed arrow.

## Lines

| Token | Weight | Used for |
|---|---|---|
| `--hairline` | 1px `#e5e5e5` | dividers in "How it works", footer rule |
| `--thin` | 1px black | toggles, links |
| `--medium` | 2px black | buttons, input underlines, board frame, miss feedback, status mark |
| `--thick` | 4px black | the bar's rule, the rule above the drill, hint outlines, the hero rule |
| `--ultra` | 8px black | the left edge of a missed answer |

## Type

- **Playfair Display** for display: wordmark (italic), hero, prompt, counters, feedback headings
  (italic), step numbers in "How it works".
- **Source Serif 4** for prose.
- **JetBrains Mono** for labels, moves, inputs, buttons and status: 12–13px, uppercase, 0.1em tracking.
- The hero scales with both width and height (`min(8vw, 11vh)`, up to 8rem) so it always fits its square;
  *before* is set larger, in italic, as the graphic word.
- Moves (`.mv`) are mono with a 2px underline, so notation reads as data inside serif prose.

## The board

| Thing | Look |
|---|---|
| squares | solid `--accent-wash` and `--accent-soft` (no hatching: it made pieces hard to read) |
| pieces | the cburnett set (Colin M.L. Burnett, GPLv2+/BSD/GFDL), extracted from `chessground@9.2.1` at build time into `pieces/*.svg` |
| last move | `--accent-mid` tint on both squares |
| selected piece | 4px black inset frame |
| legal targets | dimmed black square (empty) or black ring (capture) |
| Checks / Captures chip on | 4px accent inset frame on each move's from and to squares |
| Loose chip on | accent hatch and 2px accent frame on each of my pieces that is attacked and undefended |
| answer arrow | solid when you found it, dashed when you missed |

## Components

| Component | Class | Notes |
|---|---|---|
| Bar | `.bar` | 56px, wordmark left, links and status right, 4px rule below |
| Status mark | `.mark` | 10px square: hollow idle, filled ready, blinking (steps, not fades) while working |
| Input | `.input` | 2px underline only; 4px on focus; italic serif placeholder |
| Toggle | `.toggle` | joined 1px boxes; checked inverts to black |
| Button | `.btn`, `.btn.primary`, `.btn.ghost` | 2px border, mono caps; hover inverts instantly |
| Progress | `.meter` | 4px track filling with `--accent` |
| Counters | `.counters` | inverted band; review boxes as white bars in the last column |
| Played move | `.played-move` | 36px mono on `--accent-wash` with a 4px accent underline: the focal point of the drill |
| Question | `.question` | Playfair italic, one line ("Can White punish it?") |
| Scan chip | `.chip[data-kind]` | Checks / Captures / Loose; shows `?` until pressed, then the count, accent fill, and lights the board |
| Answer row | `.answer` | an accent square + "Move their piece on the board", *or*, "Nothing works" |
| Feedback | `.fb.ok`, `.fb.no` | verdict (Playfair italic) and game link; move cards; eval bar or "Mate in N". Found = inverted; missed = framed with an 8px left edge |
| Move card | `.card`, `.card.key`, `.card.struck`, `.card.miss` | their best reply in accent; what you played struck through; your wrong try struck and grayed |
| Eval bar | `.evalbar` | −6 to +6 pawns, zero tick, hollow square before your move, filled after, accent span between |
| How it works | `.how` | three columns: accent number, one word, one mono line |

## Texture

Two global layers at very low opacity so white reads as paper: horizontal print lines (4px period,
1.5%) and fractal noise (2%). The inverted band has its own vertical lines (3%).

## Motion

Instant. Button and toggle inversions take 100ms at most; the status mark blinks with `steps(1)`;
nothing eases, floats or bounces. `prefers-reduced-motion: reduce` turns all of it off.

## Accessibility

- Black on white is 21:1; secondary gray is 7.8:1; white on the band is 21:1, its labels about 15:1.
- Focus: 3px black outline with 3px offset on buttons and links; inputs thicken their underline to 4px.
- A skip link ("Skip to the controls") appears on focus.
- States are words first: "Found it." / "Not the one.", "Standby" / "Scanning" / "Ready" / "Fault".
- Toggles are real checkboxes; touch targets are at least 44px.

## Departures from the source design system

| Source | Here | Why |
|---|---|---|
| React, Tailwind, lucide-react | CSS custom properties, one inline lucide icon | no framework or build step in this app |
| `py-24`+ section padding, 8xl–9xl type everywhere | tight panel spacing, oversized type only in the hero | the brief is one screen with every main feature visible |
| Pricing tiers, testimonials, blog images, drop cap | not used | this is an app, not a marketing page; the bold choices that apply are kept (oversized hero, rule with square, inverted band, 4px rules, zero radius, instant inversions, textures) |
