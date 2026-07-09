# Product

## Register

brand

## Users

People who record their screen and want the result to look finished, not raw:
creators making product walkthroughs, demos, tutorials, and social clips, plus
developers and indie makers drawn to a free, open-source tool. They arrive on
the page from GitHub, social, or word of mouth, usually on desktop, deciding in
seconds whether Quiro is worth downloading over Loom/ScreenStudio/OBS.

## Product Purpose

The landing page for Quiro — a free, open-source desktop screen recorder and
editor (Windows + macOS) with automatic cinematic cursor effects and a built-in
AI transcript. The page exists to **drive downloads**: everything on it serves
the platform-aware download CTA. Success is a visitor understanding what makes
Quiro different (polished cursor motion + AI transcript, zero editing) and
clicking download for their OS. GitHub / open-source proof is supporting
credibility, not the primary conversion.

## Brand Personality

Confident, crafted, modern. The voice is quietly premium: the design shows the
product's polish rather than claiming it. Motion is deliberate (a WebGL shader
hero, text-roll button labels, shared-element media reveals), never gimmicky.
Copy is plain and direct — "Record your screen with cinematic cursor effects and
an AI transcript, built in" — no hype, no jargon. The signature orange
(`#F26522`) against a near-white canvas is the one confident gesture.

## Anti-references

- **Generic SaaS template** — gradient hero, endless identical feature-card
  grids, the big-number hero-metric row. The default AI landing page.
- **Corporate / stock-photo** — smiling-people stock imagery, enterprise navy,
  jargon-filled value props. Quiro shows its own product footage instead.
- **Cluttered / feature-dump** — wall of features and dense specs above the
  fold. Quiro leads with two showcase features, not twenty.

## Design Principles

- **Show the product, not claims.** Real recordings, demos, and cursor footage
  carry the pitch; adjectives don't. (Anti-reference: stock photography.)
- **One idea per fold.** Hero states the promise, About proves the "how," Showcase
  demonstrates two hero features. Deliberate pacing over density.
- **The craft is the argument.** For a tool that makes recordings look polished,
  the site itself must be the proof of taste — motion, spacing, and type quality
  are the credibility.
- **Restraint with one confident gesture.** Neutral canvas + near-black ink, then
  a single saturated orange that carries the brand. Don't hedge it with more
  color; don't add a second accent for its own sake.
- **Download is the through-line.** Every section resolves toward the
  platform-aware download CTA; secondary links (GitHub, releases) never compete
  with it.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text ≥4.5:1 and large text ≥3:1 against their actual
backgrounds (audit the gray-on-tinted text and muted footer/meta copy). Every
motion effect needs a `prefers-reduced-motion: reduce` alternative — the WebGL
shader backdrop, text-roll hovers, mobile-menu slide, and shared-element card
reveals should degrade to a static or crossfade state. Keyboard-navigable nav and
CTAs with visible focus; the shader hero must never trap focus or block the CTA.
