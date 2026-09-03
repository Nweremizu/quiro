# Shotbase — editor architecture, static/motion model, and canvas

Competitive research note. Subject: **Shotbase** (macOS screenshot + screen recording + editing app, [shotbase.com](https://shotbase.com/)). Accessed **2026-09-02**; latest shipping version observed **1.3.3** (2026-09-02).

**Confidence:** *High* on product surface, pricing, distribution, macOS floor, and the shape of the editor UI (read directly off first-party product screenshots and first-party release notes). *Medium* on the static↔motion interoperation model (inferred from a first-party screenshot showing the same editor chrome in both modes on both media types, plus feature-list wording — no maker prose spells it out). *Low* on export pipeline specifics (codecs, containers, fps, resolution, transparency — **nothing** first-party found) and on internal frameworks (pure inference; the app ships no public source and its cloud stack is the only part documented).

**Name-collision warning:** "ShotBase"/"Shotbase" is ambiguous. The subject here is the macOS capture app at shotbase.com by [@dudufolio](https://x.com/dudufolio) (GitHub org `notnotDudu`). An **unrelated** open-source project of the same name exists — [github.com/taruma/shotbase](https://github.com/taruma/shotbase), an AI-filmmaking asset manager. Search engines conflate them. Everything below refers exclusively to the macOS app.

---

## 1. Product surface

| Fact | Evidence |
|---|---|
| macOS only; "capture, edit, organize, share" workspace | [shotbase.com](https://shotbase.com/) |
| Captures: area, window, full screen, **scrolling screenshots**, screen recordings, and webpage captures (full-page or viewport) at custom breakpoints in light or dark mode | [shotbase.com FAQ, "What can I capture with Shotbase?"](https://shotbase.com/) |
| **Minimum macOS 14.0** (Sonoma), every release from 0.9.0 to 1.3.3 | [`sparkle:minimumSystemVersion` in appcast.xml](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/appcast.xml) |
| Local AI (naming, tagging, summaries) is **Apple silicon only**; model is downloaded, not bundled | [shotbase.com](https://shotbase.com/); ["Continue downloading the AI model in the background during onboarding" — release 1.1.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.1.0) |
| Direct distribution: DMG from GitHub Releases, auto-update via **Sparkle** on `updates.shotbase.com` | [download page](https://shotbase.com/download) → [releases](https://github.com/notnotDudu/shotbase-releases/releases); ["secure automatic updates through Sparkle" — 1.0.0 notes](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.0.0); [CNAME](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/CNAME) |
| Not on the Mac App Store or Setapp (no listing found) | Searched apps.apple.com and setapp.com, 2026-09-02 — **Unverified negative**, absence of evidence |
| App payload ≈ **300 MB** per release (Shotbase.dmg 304 MB at 1.3.3) | [release assets](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.3) |
| Pricing: Pro Yearly $13→**$9.75**/mo billed yearly; Pro Monthly $25→**$18.75**/mo (25% launch discount). 7-day trial, no card. | [shotbase.com pricing](https://shotbase.com/) |
| Trial expiry restricts **exports**, new sharing, and public-link access | [Terms](https://shotbase.com/terms) |
| Up to **three connected devices** per account | [release 1.3.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.0) |
| Timeline: X account created Nov 2025; v0.9.0 rehearsal build 2026-08-05; v1.0.0 stable 2026-08-05; 1.3.3 by 2026-09-02 — **~1 month from launch to 1.3.3**, ten releases | [fxtwitter profile JSON for @shotbaseapp](https://api.fxtwitter.com/shotbaseapp); [releases list](https://github.com/notnotDudu/shotbase-releases/releases) |
| Makers: @dudufolio (also ships Macfolio) and @ricoberan | [Preston Badeer's post cited on shotbase.com](https://x.com/prestonb_xyz/status/2086856575864697259) |

Feature chips listed on the pricing section (all "Full access to every feature" under Pro): Instant capture, Text extraction, AI summaries, Smart tags, **Animated screenshots**, Capture reminders, Studio recording, Capture tray history, AI naming, **Custom backgrounds**, **3D Transforms**, Webpage capture, Visual library, Local AI, **Perfect padding**, Quick annotations, Scrolling capture, Smart search, AI labelling, **Social presets**, Instant sharing ([shotbase.com](https://shotbase.com/)).

---

## 2. The editor: one editor, two modes

The site's editor section headline is explicit: static or motion, one editor, no starting over ([shotbase.com](https://shotbase.com/), Editor section). Its four sub-claims are: backgrounds/frames/shadows/borders/watermarks; arrows/text/highlights/shapes/callouts; automatic zooms plus your on-camera presence; and depth/movement/perspective in 3D.

### 2.1 Editor chrome (read off first-party screenshots)

Two product images on shotbase.com show the same editor window, one in each mode.

**Window header, identical in both modes** — traffic lights · sidebar toggle · breadcrumb `Base / <project name>` · delete · **`Static | Motion` segmented control (centre)** · a settings/appearance button · **Crop** · **Export ▾** (split button with a menu chevron) · blue **Done**.
Sources: [Motion state](https://framerusercontent.com/images/xZNBHbEnLtwVvcIQ32JO0ur4.png) (project "Waitlist demo", Motion selected); [Static state](https://framerusercontent.com/images/OCAgObmdj1HcgGBXtq5SoSRL1k.png) (project "Shotbase Website Screen…", Static selected, right panel titled "Zoom").

That second image is the load-bearing one: **a screenshot project shows the same `Static | Motion` toggle, with Motion available.** Combined with the "Animated screenshots" Pro feature chip, the toggle is a per-project mode switch, not a per-media-type router.

**Right inspector** — a narrow icon rail (4 tabs observed: image/background, effects, a stroke/line tab, and a layout/frame tab) beside a collapsible titled panel. In the Motion screenshot the panel is **"Presets"** showing six animation tiles: **None, Typewriter, Slide from left, Slide from right, Slide top, Slide bottom** — i.e. entrance animations applied to the *selected annotation*. In the Static screenshot the panel is titled **"Zoom"**.

**Floating inline toolbar over the canvas** for the selected text annotation: `Aa ▾` (typeface) · `Large ▾` (size) · colour swatch ▾ · a fill/style control ▾ · alignment ▾ ([Motion screenshot](https://framerusercontent.com/images/xZNBHbEnLtwVvcIQ32JO0ur4.png)).

**Timeline strip (Motion only, visible below the canvas)**
- Tool row: pointer/select · **scissors (split)** · **text tool** · current time `0:02.0` · step-back-frame · play · step-forward-frame · total `0:05.0` · a clock control reading **`5s ▾`** · undo · redo · zoom-out / zoom slider / zoom-in.
- Ruler `0:00 … 0:05`, playhead with a draggable head.
- **Three lanes**, top to bottom:
  1. a **purple clip labelled `A 5s`** with trim handles at both ends, starting ~0:02 — the "Introducing…" text annotation, i.e. **an annotation is a timed clip**;
  2. a lane labelled **`Effects`** holding an orange bar spanning a sub-range — zoom/effect segments;
  3. a full-width **blue clip with an audio waveform**, badged `🎥 5.0s` and **`⏱ 1x`** — the source recording with its duration and a **speed multiplier**.

### 2.2 The canvas

Direct evidence for canvas properties:

- **Padding as a percentage** — a slider reading `Padding 10%`, next to a background picker showing wallpaper thumbnails (one selected with a blue ring) and a second stack implying more background sources ([editor "Make it unmistakably yours" image](https://framerusercontent.com/images/3GS3VrcuWw21UShWSelyOyIdY.png)). The framed capture in that image carries a rounded-corner inset inside a light outer frame with a drop shadow.
- **Backgrounds, frames, shadows, borders, watermarks** are named as canvas-level decorations ([shotbase.com](https://shotbase.com/)). A user post independently lists "shadow overlays, browser chrome, animations" ([@prestonb_xyz](https://x.com/prestonb_xyz/status/2086856575864697259)) — "browser chrome" implies **device/browser frame mockups**.
- **3D / perspective transforms** are a first-class canvas feature ("3D Transforms" Pro chip; "Turn flat recordings into cinematic 3D"; "Add depth, movement, and perspective"). The Motion screenshot's canvas shows the capture composited on a wallpaper background with corner radius and shadow.
- **"Social presets"** (Pro chip) — strongly implies aspect-ratio presets for social platforms, but the UI for it was not observed. *Partially unverified.*
- The word **canvas** appears in first-party release notes as a cross-workflow concept: "Standardized **canvas size limits** across capture workflows" ([1.3.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.0)) — the canvas is a shared object with its own constraints, applied across screenshot / recording / web-capture paths, not a per-editor local notion.

**Unverified canvas details:** gradient vs solid vs image background taxonomy, exact corner-radius/border/inset controls, whether the desktop wallpaper is auto-sampled, aspect-ratio preset list, watermark configuration.

### 2.3 Static mode

Confirmed: **arrows, text, highlights, shapes, callouts** ([shotbase.com](https://shotbase.com/)), plus **Crop** (header button, both modes) and a **Cropper/scroll-capture** path.

The arrow tool is **vector and re-editable**: the "Make your point" image shows a drawn arrow with two blue square control handles on its path, a variant picker (straight line / curved arrow / double-headed arrow) and a style bar (colour ▾, arrowhead style ▾, stroke weight ▾) ([image](https://framerusercontent.com/images/OqUjvrJXFPSSmoYtSw1NTNdDk88.png)). Text annotations are likewise re-selectable objects carrying font/size/colour/alignment (§2.1) and can be re-styled after placement.

**Unverified in static mode:** blur/pixelate/redaction, spotlight, step numbers, a visible layer list/z-order panel, image export formats (PNG/JPEG/WebP/HEIC), copy-to-clipboard fidelity, retina scale factors. None of these appear in any first-party asset I could reach. Note "Text extraction" (OCR) is a listed Pro feature, so text selection over a static capture exists.

### 2.4 Motion mode

Confirmed from first-party sources:

- **Automatic zooms** that follow the action ("Record once, Shotbase follows the action", "Automatic zooms bring important moments closer") — [shotbase.com](https://shotbase.com/).
- The auto-zoom is a **virtual camera with smoothing and containment**, not discrete keyframes only: "Improved automatic **camera follow** with smoother **centered movement** and **soft containment**" ([1.2.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.2.0)).
- **Effects lane** on the timeline holding time-ranged effect segments (§2.1) — the plausible home of manual zoom regions.
- **Trimming and splitting** — trim handles on clips, a scissors tool.
- **Speed** — the source clip badge reads `1x`.
- **Camera/webcam overlay** — a rounded-rectangle camera tile, shown both in the recording HUD (docked bottom-left, with stop / pause / elapsed `0:03` / restart / delete controls) and as an editor element ([recording HUD](https://framerusercontent.com/images/qahXvKV2PRO1c2sejCO8IZMiMI0.png); [camera element](https://framerusercontent.com/images/jpUgs2T4K6EgYT9afMWlrvk2Rc.png)). Marketing frames it as "your presence gives the story somewhere to land".
- **Audio** — the source clip renders a waveform; release notes group "recording, audio, camera, and export reliability" ([1.3.3](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.3)). Mic vs system-audio routing is **unverified**.
- **Cursor treatment** — the recording HUD image shows a **stylised replacement cursor** (thick black arrow with a white outline) rather than the system pointer, and release notes twice touch cursor behaviour ("Fixed video crop persistence, **cursor capture**, and edited media alignment", [1.3.3](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.3); "Improved **cursor** and slider behavior", [1.2.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.2.0)). So the cursor is captured as data and re-rendered. **Cursor smoothing, size, and click effects are unverified** as named features.
- **Text animation presets** — None / Typewriter / Slide from left / right / top / bottom (§2.1).

**Unverified in motion mode:** multi-clip assembly (only one source clip was ever shown), silence removal, speed ramping, background music, captions/subtitles, transition library, per-clip audio ducking, GIF output.

### 2.5 How the two modes link — the core finding

Evidence, strongest first:

1. **Same window, same chrome, both modes, both media types.** A *screenshot* project and a *recording* project show byte-for-byte the same header layout with the `Static | Motion` toggle, `Crop`, `Export ▾`, `Done` ([static/screenshot](https://framerusercontent.com/images/OCAgObmdj1HcgGBXtq5SoSRL1k.png), [motion/recording](https://framerusercontent.com/images/xZNBHbEnLtwVvcIQ32JO0ur4.png)). Switching modes does not swap applications, documents, or windows — it swaps the lower half of the same window (timeline in, timeline out) and re-tabs the inspector.
2. **Annotations survive into motion as timed objects.** In the Motion screenshot the red "Introducing…" text callout — a static-mode annotation type — is live on the canvas *and* present on the timeline as a purple 5-second clip with trim handles, with an inspector offering entrance-animation presets. That is one annotation model with an optional `(start, duration, animation)` triple layered on top, not two annotation systems.
3. **"Animated screenshots"** is a paid feature ([shotbase.com](https://shotbase.com/)); combined with (1), the natural reading is: take a still capture, switch it to Motion, give its annotations timing and entrance animations, export a video. **Inference, not stated by the maker.**
4. **One canvas object across capture workflows** — "Standardized canvas size limits across capture workflows" ([1.3.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.0)) implies the background/frame/padding container is shared infrastructure, not duplicated per editor.
5. **One project on disk** — a desktop folder named "Shotbase Projectfiles" is visible in a first-party recording screenshot ([image](https://framerusercontent.com/images/qahXvKV2PRO1c2sejCO8IZMiMI0.png)), and the header breadcrumb reads `Base / <project name>` — a library ("Base") containing named projects.

**What is genuinely unverified here:** whether a *recording* can be switched to Static and exported as a still frame (the reverse direction); whether static and motion states persist side by side in one project file or one overwrites the other; whether the export pipeline is literally one renderer with a frame-count of 1 in static mode. No maker statement addressing any of this was found — I searched shotbase.com, the FAQ, the terms and privacy pages, all ten GitHub release notes, and attempted the @shotbaseapp X timeline (blocked, see §6).

---

## 3. Rendering & export

This is the weakest-evidenced area of the report.

**Verified:** an `Export` split button with a dropdown menu (so more than one export target/preset exists); export is gated behind an active subscription ([Terms](https://shotbase.com/terms)); "Refined **motion export** behavior" as a distinct concern from static export ([1.2.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.2.0)); export reliability is grouped with recording/audio/camera in maintenance work ([1.3.3](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.3.3)); web capture accepts an explicit viewport size (`1920 x 1080` shown), a **Scroll** (full-page) toggle and a **Config** panel ([web-capture toolbar](https://framerusercontent.com/images/1nmWcUHJ7qNmVuYxFubFsp1g.png)).

**Unverified — no first-party statement found anywhere:** container and codec choices (MP4/MOV/H.264/HEVC/ProRes/WebM), GIF export, transparent-background export, output resolution and fps options, export-speed claims, whether export is GPU-accelerated, and whether preview is real-time. Do not assume any of these.

---

## 4. Inferred technical architecture

Everything in this section is **inference, not verified**. The evidence supporting each inference is named.

- **Capture: ScreenCaptureKit.** *Inference.* The macOS floor is exactly **14.0** ([appcast](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/appcast.xml)), which is precisely where [`SCScreenshotManager`](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager) (macOS 14.0) and [`SCContentSharingPicker`](https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker) (macOS 14.0) land, while [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) itself is macOS 12.3+. A 14.0 floor for a 2026 app that does both stills and streams with per-window targeting is most cheaply explained by depending on those two 14.0 APIs. The window-picker overlay showing an app name and pixel size ("Arc — 1539 x 920", [image](https://framerusercontent.com/images/OCAgObmdj1HcgGBXtq5SoSRL1k.png)) is consistent with `SCShareableContent` window enumeration. ScreenCaptureKit also supplies system audio and, critically, **cursor metadata separable from the frame** — which matches the observed stylised cursor and the "cursor capture" bug fix.
- **Video timeline: AVFoundation.** *Inference.* Trim/split/speed on a single source with a waveform is the natural shape of `AVMutableComposition` + [`AVVideoComposition`](https://developer.apple.com/documentation/avfoundation/avvideocomposition) (macOS 10.7+), written out with [`AVAssetWriter`](https://developer.apple.com/documentation/avfoundation/avassetwriter). No direct evidence.
- **Canvas compositing & effects: Core Image and/or a Metal renderer.** *Inference.* Background + padding + corner radius + shadow + border + **3D perspective transform** + zoom/pan, previewed live at edit time, is what [Core Image](https://developer.apple.com/documentation/coreimage) ("process still and video images") and [Metal](https://developer.apple.com/documentation/metal) exist for; a custom Metal pass is the usual answer once perspective transforms and per-frame camera motion are in play. The `Effects` timeline lane suggests effect segments are evaluated per-frame against the composition clock rather than baked.
- **UI: SwiftUI/AppKit.** *Inference.* The chrome (segmented control, split button, inspector rail, inline floating toolbar, haptic-feedback switches praised by users on the site's testimonial wall) is idiomatic native macOS, not web-in-a-shell. The ~300 MB payload is *not* evidence of Electron here — it is consistent with a bundled ML runtime and asset library, and the AI **model** is downloaded separately on top of that ([1.1.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.1.0)). **Unverified either way.**
- **Local AI: a downloaded on-device vision-language model, not Apple Foundation Models.** *Inference.* It requires Apple silicon, is downloaded during onboarding rather than shipped, and runs on a macOS 14 floor — which rules out Apple Intelligence's Foundation Models (macOS 26 + Apple Intelligence). An MLX or Core ML VLM is the likely shape. [Vision](https://developer.apple.com/documentation/vision) plausibly covers the OCR ("Text extraction") separately. Naming/tagging/summarising happens asynchronously — share links can be created "without waiting for AI annotations to finish" ([1.1.0](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.1.0)) — so it is a background enrichment queue, not on the capture critical path.
- **Cloud stack: fully documented, and mostly bought.** *Verified*, from the [privacy policy](https://shotbase.com/privacy): **Clerk** (auth/sessions), **Convex** (account records + app config), **Stripe** (billing), **Cloudflare R2** (uploaded media + thumbnails), **Resend** (transactional email), **PostHog** (product analytics, EU region), and — notably — **ScreenshotOne** for web-page capture. The account/share web app at `app.shotbase.com` is **Next.js on Vercel**. Captures, projects and editor state stay local by default; only share links, support attachments and web capture leave the machine.
  - The ScreenshotOne dependency is a real architectural tell: **"Web capture" is a hosted API call, not an embedded browser.** It explains breakpoint/light-dark/full-page support arriving cheaply, and it means that feature carries per-capture marginal cost and requires network.
- **Updates: Sparkle** with EdDSA-signed appcast on a dedicated `updates.shotbase.com` host backed by GitHub Pages. *Verified* ([appcast](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/appcast.xml), [1.0.0 notes](https://github.com/notnotDudu/shotbase-releases/releases/tag/v1.0.0)).

---

## 5. What this means for Quiro

Quiro today ships **two separate editors**: `apps/desktop/src/routes/screenshot-editor/` (AnnotationLayer, AnnotationTools, LayersPanel, StylePanel, Cropper, arrow.ts, dof.ts) and `apps/desktop/src/routes/editor/` (Timeline/, ClipsSidebar, ConfigSidebar, CanvasElementsOverlay, TextOverlay, Player, ExportDialog). Shotbase ships one editor with a mode toggle. That is the single most consequential difference, and everything below follows from it.

1. **The mode toggle is a product claim, not just a refactor.** "Static or motion. One editor. No starting over." is Shotbase's editor headline — the promise is that a user never re-learns a UI or re-does composition work. Quiro already has the two halves; what it lacks is the *shared* half. The cheapest version of parity is not merging the two routes, it is **extracting one canvas model** (background, padding %, corner radius, shadow, border, 3D transform, aspect preset) that both routes render from and both persist into one project file. Do that before merging UI, or the merge will be a rewrite.

2. **Make annotations timed objects, not a second system.** Shotbase's win is that a text callout is *one* object; Motion mode adds `(start, duration, entranceAnimation)` and drops it on the timeline as a clip. Quiro has `TextOverlay.tsx`/`CanvasElementsOverlay.tsx` on the video side and `AnnotationLayer.tsx` on the screenshot side — two vocabularies for the same thing. Unifying the annotation schema (vector geometry + style + optional timing) is the highest-leverage structural change, and it unlocks "animated screenshots" for free.

3. **"Animated screenshots" is a genuinely cheap differentiator once the canvas is shared.** A still capture + timed annotations + entrance presets + the existing export path = a short MP4 from a screenshot. Shotbase charges for it as a Pro chip. If Quiro shares the canvas, this is a one-week feature rather than a project.

4. **Six named animation presets beat a keyframe editor for this audience.** None / Typewriter / Slide from left / right / top / bottom is the whole list. Resist building a general animation system; ship a preset enum.

5. **The auto-zoom is a smoothed virtual camera, not keyframes.** Their release notes describe "camera follow with smoother centered movement and soft containment" — a spring/damped follow of the cursor with a soft boundary, tuned over releases. If Quiro's zoom is keyframe-first, the perceived quality gap will be in the tuning of that follow, not in feature count. Budget iteration time for the damping constants, and keep the manual zoom segments (their `Effects` lane) as an override on top of the automatic camera.

6. **Cursor is captured as data and re-rendered.** They ship a stylised replacement pointer. Quiro should treat the cursor as a separate compositing layer from the very start — retrofitting that after baking the pointer into frames is expensive, and it is what gates cursor size, smoothing and click effects later.

7. **Where Shotbase is beatable.** (a) **Platform** — macOS 14+ only, Apple silicon for AI; Quiro's Tauri stack can be cross-platform, which is a category Shotbase has conceded. (b) **Web capture is outsourced** to ScreenshotOne, so it needs network and costs them per capture; an in-process capture path is both cheaper and offline-capable. (c) **Export is opaque** — no published codec/format/fps/transparency options anywhere in their materials, which reads as a thin export surface; a real export dialog (ProRes, transparent WebM, GIF, fps and resolution control) is a concrete, checkable advantage. (d) **~300 MB download and a cloud account requirement** (Clerk sign-in gates the app) are friction Quiro can undercut.

8. **Where their moat actually is** — and it is not the editor. It is the **library plus local AI**: auto-naming, auto-tagging, summaries and semantic search over every capture, running on-device, with a "Base" that all three capture types (screenshot, recording, web) land in and that the editor opens *from*. The editor is downstream of the library. A competitor that ships a great editor and a folder of `Screen Shot 2026-09-02 at 10.31.14.png` files loses on the workflow, not on the pixels. Note also their execution cadence: ten releases in four weeks, with onboarding polish (not features) driving most of the testimonial wall on their own site.

---

## 6. What remained unverified

| Gap | Where I looked |
|---|---|
| Export codecs, containers, GIF, transparent background, fps, resolution, GPU acceleration, export speed | shotbase.com (all sections + FAQ), /terms, /privacy, /download, all 10 GitHub release notes, appcast, app.shotbase.com |
| Whether a recording can be switched **back** to Static and exported as a still | Same; no first-party statement |
| Whether one project file holds both static and motion state simultaneously | Same |
| Static-mode blur / pixelate / redaction / spotlight / step numbers | Site copy names only "arrows, text, highlights, shapes, callouts"; no screenshot of the full tool palette exists on the marketing site |
| Explicit layer list / z-order panel | Not visible in any published screenshot |
| Aspect-ratio preset list behind "Social presets" | Chip name only |
| Background taxonomy (gradient / solid / image / wallpaper / blur-of-capture) | One background picker thumbnail row observed; no labels |
| Multi-clip timelines, silence removal, speed ramping, captions, background music, transitions | Every published timeline screenshot shows exactly one source clip |
| Mic vs system-audio routing | Waveform observed; no routing UI seen |
| Cursor smoothing / size / click-effect controls | Cursor is clearly re-rendered, but no control surface published |
| Maker statements explaining the static/motion architecture | @shotbaseapp and @dudufolio X timelines returned **HTTP 402** via WebFetch; xcancel is shut down by X Corp legal notice; nitter.net offline; r.jina.ai blocks x.com. Profile metadata only, via api.fxtwitter.com. **No Product Hunt launch, Indie Hackers post, blog, changelog page, or help centre exists** — I probed `help.`, `docs.`, `support.`, `blog.`, `status.` subdomains (all dead) and the sitemap (two URLs total: `/` and `/download`) |
| FAQ answers other than the first | Framer accordions render client-side on click; the browser pane reported a zero-height viewport and could not expand them |
| UI framework (SwiftUI vs AppKit vs hybrid), renderer (Core Image vs Metal), timeline engine | No public source; I deliberately did **not** download and inspect the 304 MB DMG |

---

## Sources

**First-party — Shotbase**
- [shotbase.com](https://shotbase.com/) — product surface, editor headline ("Static or motion. One editor."), four editor claims, pricing, Pro feature chips, first FAQ answer, testimonial wall. *Accessed 2026-09-02.*
- [shotbase.com/download](https://shotbase.com/download) — DMG served from GitHub Releases.
- [shotbase.com/privacy](https://shotbase.com/privacy) — local-vs-cloud boundary and the full named third-party stack (Clerk, Convex, Stripe, Cloudflare R2, Resend, ScreenshotOne, PostHog).
- [shotbase.com/terms](https://shotbase.com/terms) — subscription model, refund windows, export gated on subscription, macOS-only.
- [github.com/notnotDudu/shotbase-releases/releases](https://github.com/notnotDudu/shotbase-releases/releases) — all ten releases 0.9.0 → 1.3.3, dates, asset sizes, and the release notes quoted throughout (canvas size limits, camera follow, motion export, cursor capture, AI model download, three-device limit).
- [appcast.xml](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/appcast.xml) — Sparkle feed: `minimumSystemVersion 14.0` on every build, EdDSA signatures, build numbers 1–11.
- [CNAME](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/CNAME) / [index.html](https://raw.githubusercontent.com/notnotDudu/shotbase-releases/main/index.html) — `updates.shotbase.com` is the signed-update host.
- [app.shotbase.com](https://app.shotbase.com/) — Next.js/Vercel account + share web app behind Clerk sign-in.
- Product screenshots (first-party marketing assets, served from Framer's CDN):
  [editor in **Motion** mode](https://framerusercontent.com/images/xZNBHbEnLtwVvcIQ32JO0ur4.png) — the single richest artefact: mode toggle, Presets panel, three-lane timeline, annotation-as-clip;
  [editor in **Static** mode on a screenshot project](https://framerusercontent.com/images/OCAgObmdj1HcgGBXtq5SoSRL1k.png) — proves the toggle exists on stills, plus the window-picker overlay;
  [canvas padding + background picker](https://framerusercontent.com/images/3GS3VrcuWw21UShWSelyOyIdY.png);
  [vector arrow with editable handles and style bar](https://framerusercontent.com/images/OqUjvrJXFPSSmoYtSw1NTNdDk88.png);
  [camera element](https://framerusercontent.com/images/jpUgs2T4K6EgYT9afMWlrvk2Rc.png);
  [recording HUD, stylised cursor, "Shotbase Projectfiles" folder](https://framerusercontent.com/images/qahXvKV2PRO1c2sejCO8IZMiMI0.png);
  [web-capture toolbar with viewport size, Scroll and Config](https://framerusercontent.com/images/1nmWcUHJ7qNmVuYxFubFsp1g.png).
- [api.fxtwitter.com/shotbaseapp](https://api.fxtwitter.com/shotbaseapp) — @shotbaseapp profile metadata (created 2025-11-11, bio, 274 posts) as a proxy for the blocked X timeline.
- [@prestonb_xyz post quoted on shotbase.com](https://x.com/prestonb_xyz/status/2086856575864697259) — third-party user, but cited *by* Shotbase; names the makers (@dudufolio, @ricoberan) and "shadow overlays, browser chrome, animations".

**First-party — Apple** (framework capability claims backing §4)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) — macOS 12.3+, "stream screen content and audio… with fine-grained control".
- [SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager) — **macOS 14.0**, single-frame capture.
- [SCContentSharingPicker](https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker) — **macOS 14.0**, system picker for frame-capture streams.
- [AVVideoComposition](https://developer.apple.com/documentation/avfoundation/avvideocomposition) — macOS 10.7+, composing video frames at points in time.
- [AVAssetWriter](https://developer.apple.com/documentation/avfoundation/avassetwriter) — macOS 10.7+, writes media to a container file.
- [Core Image](https://developer.apple.com/documentation/coreimage) — macOS 10.11+, filters over still *and video* images.
- [Metal](https://developer.apple.com/documentation/metal) — macOS 10.11+, GPU rendering and compute.
- [Vision](https://developer.apple.com/documentation/vision) — on-device text recognition and image analysis.

**Explicitly rejected as sources:** "best screenshot tool" listicles and AI-generated review sites surfaced by search were used only to locate shotbase.com and are cited nowhere above.
