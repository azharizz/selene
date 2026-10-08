# SELENE on Fire TV

The user selected Fire TV's familiar interface on 20 September 2026. This replaces the previous green cinema theme. Product truth: [PRODUCT.md](PRODUCT.md), with the original full contract in the parent folder.

## Visual reference

Amazon's 2026 Fire TV home and Movies screenshots: dark charcoal canvas, bright white focus, horizontal selections, rounded controls, generous space, one primary action. Apply that grammar to a viewing companion; don't copy the content catalogue, ads, or Amazon identity.

Sources: [Fire TV design guidance](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html), [current home and Movies UI](https://www.aboutamazon.com/news/devices/new-fire-tv-upgrades-features-2026). Reference images are kept in artifacts/ui-review.

## System

- Background #101114; response surface #202228; controls #303238; text #f1f1f1; secondary #b9bdc6. Orange is reserved for SELENE's own crescent mark and diagram emphasis.
- Font: installed Amazon Ember where available, Helvetica Neue, then Arial/system sans. Native Vega uses its system font. No unlicensed font binaries or remote font requests.
- Watching surfaces use 18px answer/input text and 16px secondary controls; native text scaling remains supported. Larger type is reserved for the start screen. 5% safe area, visible focus, no color-only state. Buttons turn white with dark text and a separated outline when focused.
- An original orange crescent beside the lowercase selene wordmark identifies the viewing assistant. The logo contains no play triangle; playback controls retain their separate play icons. It is not an Amazon logo or affiliation claim.
- The Vega package registers the 512×512 crescent PNG at `assets/image/selene-icon.png` through `package.icon = "@image/selene-icon.png"`. Rasterize the SVG at high density before downsampling; center it within a 224×224 area on the square canvas so the launcher’s wide center crop preserves the entire moon. The website tab uses `assets/selene-mark.svg`; keep both moon-only and preserve the SELENE title.
- Short control transitions (140ms). Compact SVGs use finite WAAPI motions that demonstrate the explanation and settle. Legacy connectors reveal their strokes once. No whole-diagram pulse. Reduced motion disables animation.

## Navigation

A real playback tile opens the question directly. Page through three sessions at a time. Readable metadata is used when supplied; package identity is a fallback, never guessed branding. No automatic transport action on discovery or selection.

One question field accepts the question and scene detail together. Quick questions submit directly to the real model. Preferences are optional. Clarification goes directly back to the same single field, with the original request and playback boundary retained. An empty question never invokes a model.

The response is a small top-right toast: a 160 by 90px SVG beside the answer, with icon-only dismiss and More controls. No brand header, timestamp, playback badge or expansion. Ordinary answers resume playback before appearing. Other actions live under More. Unsupported voice and unconfigured phone mirroring are absent. Back closes the current panel first; it never implicitly resumes playback.

The original player inherits these controls and styles but remains explicitly labelled as a demo. UI preview fixtures are test-only and never part of the production bundle.

During own-player watching, the launcher contains only Ask Selene, Selene tools and dismiss. Tools holds pairing, Hold our place / Bring us back, and answer preferences. The question box is at most 480px wide with one input row and two explanation shortcuts. Demo-only playback controls remain under preferences.

## Phone explainer, 2 October 2026

The optional phone inherits SELENE's charcoal palette, orange schematic emphasis and system font. It is a scrolling column capped at 480px with 20px side padding, 16px inputs, 18px answers, readable secondary text and 44px touch targets. The small wordmark and film title are centered above the sampled TV clock. The clock follows TV updates without extrapolating film time; tapping it reveals one native range input and Follow TV. A chosen earlier moment is visibly distinguished from the latest TV sample.

One question row is immediately available, with Send and capability-gated voice dictation. Audience and explanation style are communicated through the question. There are no age, role, language or style selectors, no phone video and no replay/speed controls. Voice transcripts stay editable before submission. Speech is silent by default, with one explicit Read aloud action when supported.

The SVG takes the width of the answer at a 16:9 ratio. Short labels remain visible, with a minimum rendered text size of 16px; the generation prompt targets at most three short 60–64-unit labels. Existing validated SVG geometry, finite WAAPI motion and reduced-motion behavior are reused. The short text and its explanation timestamp sit below the SVG. An ordinary live TV sample never changes the answer's source boundary. Opting into Follow thread permits a new, reviewed explanation with its own visible timestamp; the saved catch-up marker stays unchanged. Missing or unreadable diagrams keep a text explanation available.

A short original-caption quotation, when available, appears separately from the explanation with its source timestamp. A compact Follow thread toggle sits beside the answer actions, with an accessible pressed state. Its updates are silent and wait while the viewer types, dictates or listens. A displayed catch-up card pauses following and labels the same toggle Thread paused.

Catch me up appears only when there is a saved or selected earlier point. The first Send saves the current confirmed TV sample even when the question concerns an earlier scene. Catch-up ends at the sample captured on tap and closes the interval on success; failure preserves retry. It states the starting point; the resulting answer states the sampled interval. Follow TV closes the personal branch and resets the selection without controlling the TV. Connection loss, stale samples, title changes and TV seeks prevent stale private requests or answers. Film attribution remains a quiet footer.

TV tools, shared returns and pairing retain their existing presentation. Preview fixtures are explicitly labeled and never establish live model or physical-device results.

## Compact TV revision, 2 October 2026

Native entry uses a 32px heading, 18px body and two actions, with Demo preferred when no playback app is available. Expected discovery unavailability is informational. Only the SDK's specific deprecated-getter warning is excluded from LogBox; other warnings remain visible.

The demo picker has one Watch action, a short horizontal film selector and an optional credits icon. Film attribution remains reachable under Film credits. Quiet playback uses the crescent mark only; its accessible name identifies Selene or Bring us back. Loading is one animated mark with an accessible Cancel answer action. Back cancels it too.

Audience, language and answer-style selectors are removed on TV as on phone. Questions communicate those needs. Only explicit slower read-aloud is retained across sessions. Own-player transport and captions are under Playback, with native accessibility settings still applied. A recap at the end of a film appears without restarting playback.

## Motion landing, 8 October 2026

The user asked for an expressive motion landing in the same palette. Only the native entry screen changes; watching surfaces keep their short, restrained transitions. Composition is tuned for the 640×360 dp TV layout: left text column (eyebrow, one-line 34px heading, orange rule, 16px tagline, 14px status line with a dot), and a lunar stage on the right.

Motion in `src/Motion.tsx` animates only transform and opacity on the native driver, from four shared drivers: a one-shot 2.6s intro, a 9s ambient loop, a 14s orbit loop, and a scan loop that exists only while discovery is busy. The intro goes from a new-moon eclipse ring to the waxing crescent, then halo, tilted orbits and staggered text. The ambient loops cover twinkling star groups, a breathing halo, orbiting satellites that pass in front of and behind the moon, a gentle float and one meteor per cycle. Stars stay out of the text column. Focused buttons spring-lift and get one warm light sweep, and keep the white focus treatment. When the platform reports reduce motion, every element renders in its settled state.
