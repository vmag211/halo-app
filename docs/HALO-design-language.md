# HALO — Design Language & Brief

**Paste this whole document into Claude Design before designing any HALO screen.**
It is the shared source of truth for how HALO looks and, just as importantly,
what it is *not allowed* to do. When a request conflicts with this brief, this
brief wins — flag the conflict rather than silently breaking a rule.

---

## 1. What HALO is (30 seconds)

HALO shows a family the real environmental-health data for their specific home.
Two independent surfaces, each with its own score that is **never merged**:

- **Today** — daily-changing conditions: air quality, UV, pollen, mold.
- **HomeGuard** — the home's static baseline: drinking-water contaminants (real
  EPA PFAS data), radon zone, and for private wells a testing plan.

The product exists to make one story legible: a family's tap water can sit at
**2× the EPA legal limit** and no one tells them. Every design choice must
protect the legibility — and the honesty — of that story.

---

## 2. The prime directive: honesty (this drives the visuals)

A number the app *guessed* must never look identical to a number it *measured*.
If a user can't tell them apart at a glance, the design has failed. Encode
epistemic status visually, always:

| State | Meaning | Required treatment |
|---|---|---|
| **Measured** | Real lab/sensor data | Solid surface, full opacity |
| **Estimate / proxy** | Derived (mold from humidity, radon from a county map) | **Dashed** border/ring + an "Estimate" label |
| **Unknown / no data** | Not tested / not reported yet | **Grey** (`#6B7280`) — *never green* |
| **Detected, no legal limit** | Real but unregulated (e.g. lithium) | **Neutral grey** — never green (implies safe), never red (implies violation) |

Non-negotiables:

- **`null` is not `0`.** Render missing data as "—", never as 0. "No reading"
  and "a reading of zero" are different claims.
- **Never render an over-limit reading as safe.** A contaminant above its legal
  limit is alarmed (red), full stop. Do not soften it with reassuring copy.
- **Grey ≠ safe.** "No results yet for this utility" is grey and dashed, and must
  look visibly different from a genuine clean result (green).
- **Don't invent data.** No placeholder facility names, no fabricated values. If
  the data doesn't have it, the design doesn't show it.

---

## 3. Foundations

### Type
- **Playfair Display** (500/600/700) — every numeral, score, and page heading.
- **Poppins** (300/400/500/600) — body copy, labels, chips.
- Small **letter-spaced UPPERCASE** for captions and section labels (~9–10px,
  1.3–1.8px tracking).
- The serif-numeral / sans-body contrast is core to the look. Keep it.

### Colour — risk tiers are literal, never decorative
Green/amber/red mean a risk level and nothing else. Never use them as accents.

```
--good      #4ADE9B    within limits / safe
--moderate  #F5A623    watch
--elevated  #E0473F    approaching / over a soft limit
--severe    #C9342D    action needed (over a legal limit)
--unknown   #6B7280    grey — "we don't know", never green
--accent    #5FD3E6    brand cyan (measured & in-range)
--accent-2  #AEEFDF    soft mint highlight
```

### Frame & surfaces
- Phone frame: **390 × 844**, corner radius **42**, `overflow:hidden`.
- **Solid panels** carry almost everything: `#0F2A3C` (default) and `#071C2E`
  (deep). Rounded 14–22.
- **Glass is rationed** — frosted surfaces (`rgba(255,255,255,.14)` +
  `blur(14–18px)` + `1px rgba(255,255,255,.3)` border) are used **only** for the
  hero score disk and the bottom nav. Glass is meaningful because it's rare.

### Per-subject background gradients
Each subject owns a gradient; content carries the screen, not the background.

```
HomeGuard (main)  linear-gradient(165deg,#0d8aa6, #19b4d0 42%, #0e7089)
Water / PFAS      linear-gradient(180deg,#0B2B45, #0F4560 50%, #136072)
Radon             linear-gradient(180deg,#241733, #33224A 50%, #3E2C5E)
Air               linear-gradient(180deg,#123247, #1E5570 50%, #2E7D96)
UV                linear-gradient(200deg,#F5B478, #E9884E 45%, #B85A2E)
Pollen            linear-gradient(180deg,#DDEFD3, #BFDDB0 50%, #9CC58F)
Mold              linear-gradient(180deg,#3B3A2C, #4A4D30 50%, #37402A)
```

### Atmosphere (backgrounds)
- Allowed: a **per-subject atmospheric effect** (water drips, wind lines,
  drifting aurora glow-blobs), plus optional **rippling concentric contours**,
  a soft **vignette**, and subtle **grain**. Layer for depth.
- **BANNED: the "plexus" / constellation network** (dots joined by lines). It
  reads as generic sci-fi and is explicitly out. Do not use it on any screen.

---

## 4. Components

- **Score / gauge** — a circular arc meter with a frosted centre disk. Real tick
  marks at **real thresholds** (AQI 50/100/150/200/300; UV 3/6/8/11; PFAS
  1×/2× the limit), never decorative marks. Arc colour = risk tier. **Dashed
  ring = estimate** (radon zone, mold).
- **Status pill** — solid, plain-language verdict, with a coloured dot **and**
  text (never colour alone — colourblind/screen-reader parity).
- **Data chips** — small solid quick-glance facts (`LABEL` over value).
- **Scorecards** — tappable factor summaries (Water, Radon) that open a subpage;
  severity dot + verdict + chevron.
- **Impact grid** — the closing 2×2 on each subpage: Health / Environment /
  Daily Life / Live Factor, solid cards with accent labels.
- **Bottom nav** — frosted glass, four tabs: **Today · Home · Alerts · Settings**.
  There is **no "Community" tab**.
- **Empty / estimate states** — grey (dashed when provisional). Say what *was*
  tested, so "clean" is falsifiable.
- **Quarterly chart** — hand-rolled bars with a dashed line at the enforceable
  limit; bars over the limit render in the severe tier. It is the *evidence*, and
  often the hero of the water view.
- **Shield ↔ score** — HomeGuard's protection motif fused with the safety score;
  see the "HALO Shield-Score Explorations" doc (options 7a–7g) for the sanctioned
  directions.

---

## 5. Subpage anatomy (Air / UV / Pollen / Mold / Water / Radon)

Every detail subpage follows the same five parts, top to bottom:

1. **Atmospheric effect** tied to the real reading (subtle, on-theme).
2. **Hero gauge** — distinct silhouette per subject, real ticks, frosted centre.
3. **Quick-glance row** — 2–3 solid chips of real values.
4. **Status pill** — solid, plain-language verdict.
5. **2×2 impact grid** — Health / Environment / Daily Life / Live Factor.

---

## 6. Copy voice

Plain, calm, specific. Short sentences. Name the thing and the number. Never
over-reassure, never catastrophise — state what's true and what to do. "Detected
is not the same as safe." "A county zone map, not a measurement of your home."

---

## 7. Hard don'ts (quick reference)

- ✗ The plexus / constellation background.
- ✗ Risk colours used decoratively.
- ✗ An estimate that looks measured (must be dashed + labelled).
- ✗ Grey/unknown shown as green.
- ✗ `null` rendered as `0`.
- ✗ Over-limit readings softened to look safe.
- ✗ Invented data (fake facility names, placeholder values).
- ✗ A "Community" tab.
- ✗ Merging the Today and HomeGuard scores.

---

## 8. Paste-ready one-paragraph brief

> Design a HALO mobile screen (390×844, radius 42). Deep per-subject gradient
> background with a subtle on-theme atmospheric effect — **no plexus/constellation
> network**. Playfair Display for all numerals and headings, Poppins for body;
> small letter-spaced uppercase captions. Solid panels (`#0F2A3C` / `#071C2E`)
> for everything; frosted glass **only** for the hero score disk and bottom nav.
> Risk colours are literal (green safe → red action-needed) and never decorative;
> grey `#6B7280` = unknown and is never green. Measured data is solid; estimates
> and proxies are **dashed and labelled**; `null` shows as "—", never 0. Never
> make an over-limit reading look safe. Bottom nav: Today · Home · Alerts ·
> Settings (no Community). Calm, plain, specific copy.
