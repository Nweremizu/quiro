---
name: Quiro
description: The landing page for a free, open-source screen recorder with cinematic cursor effects and a built-in AI transcript.
colors:
  director-orange: "#F26522"
  director-orange-hover: "#E05A1A"
  ember-glow: "#FF5F03"
  starburst-coral: "#E8704E"
  ink: "#111827"
  muted: "#4B5563"
  subtle: "#6B7280"
  canvas: "#EFEFEF"
  surface-white: "#FFFFFF"
  surface-gray: "#F5F5F5"
  border: "#E5E7EB"
  border-strong: "#D1D5DB"
  media-void: "#101010"
typography:
  display:
    fontFamily: "Satoshi Variable, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4.2rem)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Satoshi Variable, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.5rem, 4vw, 3.2rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Satoshi Variable, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Satoshi Variable, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Satoshi Variable, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  xs: "4px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  full: "9999px"
spacing:
  gutter-sm: "20px"
  gutter-md: "32px"
  gutter-lg: "48px"
components:
  button-primary:
    backgroundColor: "{colors.director-orange}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.full}"
    padding: "8px 8px 8px 24px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.director-orange-hover}"
    textColor: "{colors.surface-white}"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.full}"
    padding: "8px 8px 8px 20px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "10px 16px"
    typography: "{typography.label}"
  badge:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "6px 16px"
    typography: "{typography.label}"
  media-card:
    backgroundColor: "{colors.media-void}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0"
---

# Design System: Quiro

## 1. Overview

**Creative North Star: "Cinematic Minimalism"**

Quiro's landing page is a neutral stage lit by a single cinematic ember. The
canvas is a near-white grey (`#EFEFEF`), the sections alternate white and a
paler grey, and the ink is a deep near-black. Into that calm stage, one warm
orange — **Director's Orange** — carries every moment that asks for action. The
product footage is the star: real recordings, cursor demos, and an animated
WebGL shader hero do the persuading, while the interface stays a quiet frame
around them. Nothing shouts except the one thing that should.

The system is deliberately restrained but never timid. It rejects the **generic
SaaS template** (gradient hero, endless identical feature-card grids, the
big-number hero-metric row), the **corporate stock-photo** look (smiling-people
imagery, enterprise navy, jargon), and the **cluttered feature-dump** (a wall of
specs above the fold). Quiro leads with two showcase features shown in motion,
not twenty listed in text. The confidence is in the whitespace and the pacing:
one dominant idea per fold, generous separations between sections, tight
groupings within them.

Density is low and typographic. A single variable typeface (Satoshi, 300–900)
carries the whole hierarchy through weight and size, tightened tracking on the
big headings giving them a crafted, magazine-quiet authority. Motion is
refined and tactile — spring-eased pill buttons, a text-roll on hover, a
shared-element expand on the media cards — always in service of the product,
never decoration for its own sake.

**Key Characteristics:**
- Near-white tonal stage; one saturated orange as the only heat.
- Product footage and the shader hero are the imagery; the UI is the frame.
- Single variable typeface, hierarchy by weight and tightened tracking.
- Flat by default; depth from tonal layering, not shadows.
- One idea per fold, download as the through-line.

## 2. Colors

A near-monochrome greyscale stage carrying a single, decisive orange accent.

### Primary
- **Director's Orange** (`#F26522`): The one confident gesture. Reserved for the
  primary download CTA (the pill button), the mobile-menu CTA, and the orange
  "More about Quiro" buttons. It is the color of *action* — wherever it appears,
  it means "do this."
- **Director's Orange — Pressed** (`#E05A1A`): The hover/active deepening of the
  primary. Never used at rest, only as the response to interaction.

### Secondary
- **Ember Glow** (`#FF5F03`): The hotter, more saturated orange that animates
  inside the WebGL shader hero (ChromaFlow wash over a white/grey swirl). It
  exists only in motion, in the backdrop — never as a static fill or a second
  button color.
- **Starburst Coral** (`#E8704E`): A single decorative accent on the "Free &
  open source" starburst mark beside the hero CTA. One appearance; not a system
  color.

### Neutral
- **Ink** (`#111827`): Primary text, dark pill buttons, section badge dots.
  The near-black that carries all headings and body copy.
- **Muted** (`#4B5563`, gray-600): Secondary copy — nav meta, card descriptions,
  the "Free for Windows & macOS" line.
- **Subtle** (`#6B7280`, gray-500): Tertiary/footer copy only. The lightest text
  allowed, and only on light-grey surfaces where it still clears AA.
- **Canvas** (`#EFEFEF`): The hero body background — the base stage.
- **Surface White** (`#FFFFFF`): The About section and the floating nav bar; the
  brightest tonal step.
- **Surface Grey** (`#F5F5F5`): The Showcase and Footer sections; a half-step
  down from white for gentle tonal separation.
- **Border** (`#E5E7EB`) / **Border Strong** (`#D1D5DB`): 1px hairlines on badges
  and section dividers. Never used thicker than 1px, never as a colored stripe.
- **Media Void** (`#101010`): The full-bleed background behind an expanded media
  card, where product footage plays against near-black.

### Named Rules
**The One Ember Rule.** Orange is the only chromatic color in the system, and it
appears on ≤10% of any screen. Its rarity is what makes it read as "action." Never
introduce a second accent hue to "balance" it — the imbalance is the design.

**The Tonal Ladder Rule.** Depth comes from three greys stacked — `#F5F5F5` →
`#EFEFEF` → `#FFFFFF` — not from borders or shadows. Sections separate by tone,
not by lines.

## 3. Typography

**Display Font:** Satoshi Variable (with system-ui, -apple-system, sans-serif)
**Body Font:** Satoshi Variable (same family, lighter weight)
**Label Font:** Satoshi Variable (same family, 13px medium)

**Character:** One geometric-humanist variable sans doing all the work across its
300–900 axis. The voice is crafted and quietly modern: medium weight (500) for
headings kept from feeling heavy, tightened tracking giving the big type a
magazine-cover composure. No serif, no mono, no second family — the discipline is
the point.

### Hierarchy
- **Display** (500, `clamp(2.5rem, 5vw, 4.2rem)`, line-height 1.08, tracking
  -0.03em): Hero H1 and the Showcase "What you get" heading. The largest voice on
  the page; ceiling held at ~4.2rem so it composes, not shouts.
- **Headline** (500, `clamp(1.5rem, 4vw, 3.2rem)`, line-height 1.12, tracking
  -0.02em): Section H2s ("Studio-quality recordings…"). One step quieter than
  Display, slightly looser tracking.
- **Title** (600, 14–15px, line-height 1.3): Media-card titles and the expanded
  overlay heading. The only place semibold appears.
- **Body** (500, 15–18px, line-height 1.6): The About paragraph and lead copy.
  Kept at medium weight for presence on light surfaces; cap measure at 65–75ch.
- **Label** (500, 11–14px): Pill buttons, nav links, section badges, meta rows,
  version chips. The connective tissue of the interface.

### Named Rules
**The One Family Rule.** Satoshi carries the entire hierarchy. Never introduce a
second typeface for "contrast" — contrast comes from the weight axis (500 vs 600)
and size, never from a new family.

**The Tight-Crown Rule.** Display and Headline type is tracked in (-0.03em /
-0.02em); everything at body size and below stays at normal tracking. Tightening
is reserved for the big crowns.

## 4. Elevation

The system is **flat by default**. Depth is conveyed almost entirely through the
tonal ladder of greys (`#F5F5F5` / `#EFEFEF` / `#FFFFFF`) and through the animated
shader hero, not through shadows. The one exception is a single softly-lifted
floating element; shadows are a rare, functional response, never ambient
decoration.

### Shadow Vocabulary
- **Hairline ring** (`box-shadow: 0 0 0 1px rgba(0,0,0,0.05)` + `shadow-sm`): The
  nav logo chip only — a whisper of separation from the white bar.
- **Lifted card — rest** (`box-shadow: 0 2px 8px rgba(0,0,0,0.08)`): The "Free &
  open source" button, the one element that floats above the hero.
- **Lifted card — hover** (`box-shadow: 0 4px 16px rgba(0,0,0,0.12)`): Its hover
  deepening — the shadow grows as a response to intent.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow appears only as
a response to state (a hover, a floating affordance), never to make a static
panel look "elevated." If a section needs separation, drop it one step on the
tonal ladder instead of adding a shadow.

## 5. Components

### Buttons
- **Shape:** Fully rounded pills (`9999px`) for all primary actions; the lone
  "Free & open source" button uses a near-square `4px` radius to read as a
  distinct, secondary affordance.
- **Primary (Director's Orange):** `#F26522` fill, white text, asymmetric padding
  (`pl-24 / pr-8`) housing a text label plus a white circular arrow chip. Label
  uses a **text-roll**: a duplicated label inside a 20px mask that rolls up -50%
  on hover; the arrow rotates -45° in tandem.
- **Dark (nav download):** `#111827` fill, white text, same text-roll + arrow-chip
  anatomy at a smaller scale. The download CTA in the floating nav.
- **Hover / Focus:** Primary deepens to `#E05A1A`; transitions run 500ms on the
  house easing `cubic-bezier(0.25, 0.1, 0.25, 1)`. Every button needs a visible
  `:focus-visible` ring (see Do's).
- **Ghost (open-source):** White fill, ink text, the `4px` radius, lifted shadow
  at rest that deepens on hover; carries the starburst mark and a version chip.

### Badges
- **Style:** A hairline-bordered pill (`#E5E7EB` / `#D1D5DB`, 1px) with ink text,
  paired with a small filled `#111827` circle holding a section number.
- **Note:** Numbers here index only two real showcase sections — a genuine short
  sequence, not scaffolding. Do not extend numbered badges to every section.

### Cards / Containers (Media Cards)
- **Corner Style:** `16px` (trigger/collapsed) expanding to `24px` (content) via
  a shared-element transition.
- **Background:** A per-card tinted backdrop (`#1a1d2e`, `#6b6b6b`) behind the
  media; `#101010` (Media Void) when expanded full-bleed.
- **Shadow Strategy:** None — flat, per the Flat-By-Default Rule. Separation comes
  from the media's own dark backdrop against the grey section.
- **Border:** None.
- **Hover:** A pill in the bottom-left corner expands from a 36px dot to reveal a
  "Learn more" / "Watch the demo" label; its icon rotates from -45° to 0°.
- **Caption:** Description (muted) then title (ink, semibold) sit *below* the
  media, not overlaid — the footage stays uncovered.

### Navigation
- **Style:** A floating white pill bar (`9999px`) inset from the viewport edge,
  logo chip at left, text links, a live "London time" clock, and the dark
  download CTA at right.
- **Links:** 14px ink, hover to gray-500 over 300ms.
- **Mobile:** Collapses to a "Menu" button opening a bottom-sheet — a white
  rounded panel sliding up over a `black/60` scrim on
  `cubic-bezier(0.32, 0.72, 0, 1)`, with oversized 28–32px nav links and the
  orange CTA.

### Shader Hero (Signature)
- A full-bleed WebGL backdrop layering (inside-out) a white/grey Swirl → a
  ChromaFlow **Ember Glow** (`#FF5F03`) wash → FlutedGlass refraction → a 0.05
  FilmGrain finish. It sits behind the hero content at low z, `pointer-events:
  none`, and must never block or trap the CTA. It requires a static fallback under
  reduced motion.

## 6. Do's and Don'ts

### Do:
- **Do** keep Director's Orange (`#F26522`) for actions only — the download CTA
  and its siblings. Deepen to `#E05A1A` on hover, never at rest.
- **Do** build depth with the tonal ladder (`#F5F5F5` → `#EFEFEF` → `#FFFFFF`);
  separate sections by tone, not by borders or shadows.
- **Do** carry the whole type hierarchy in Satoshi; get contrast from weight
  (500 vs 600) and size, and tighten tracking only on Display/Headline crowns.
- **Do** lead with product footage and the shader hero. Real recordings are the
  argument; the UI is the frame around them.
- **Do** give every interactive control a visible `:focus-visible` ring and a
  `prefers-reduced-motion` alternative — the shader, text-roll, bottom-sheet
  slide, and shared-element card expand all need a static or crossfade fallback.
- **Do** hold body copy to ≥4.5:1 and large text to ≥3:1; keep the lightest grey
  (`#6B7280`) for footer/meta only, on light surfaces where it still clears AA.

### Don't:
- **Don't** ship the **generic SaaS template**: no gradient hero, no endless
  identical feature-card grid, no big-number hero-metric row.
- **Don't** drift **corporate / stock-photo**: no smiling-people stock imagery,
  no enterprise navy, no jargon. Show Quiro's own footage instead.
- **Don't** **feature-dump**: no wall of specs above the fold. Two showcase
  features in motion beats twenty in text.
- **Don't** introduce a second accent hue, gradient text, or `background-clip:
  text` — orange is the only chromatic voice, applied as a solid fill.
- **Don't** add ambient shadows to make panels look "elevated," or borders
  thicker than 1px (and never a colored side-stripe).
- **Don't** extend numbered section badges beyond the two real showcase steps —
  numbers on every section is AI scaffolding, not voice.
