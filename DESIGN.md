# SELENE on Fire TV

The user selected Fire TV's familiar interface on 20 September 2026. This replaces the previous green cinema theme. Product truth: [PRODUCT.md](PRODUCT.md), with the original full contract in the parent folder.

## Visual reference

Amazon's 2026 Fire TV home and Movies screenshots: dark charcoal canvas, bright white focus, horizontal selections, rounded controls, generous space, one primary action. Apply that grammar to a viewing companion; don't copy the content catalogue, ads, or Amazon identity.

Sources: [Fire TV design guidance](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html), [current home and Movies UI](https://www.aboutamazon.com/news/devices/new-fire-tv-upgrades-features-2026). Reference images are kept in artifacts/ui-review.

## System

- Background #101114; response surface #202228; controls #303238; text #f1f1f1; secondary #b9bdc6. Orange is reserved for SELENE's own crescent mark and diagram emphasis.
- Font: installed Amazon Ember where available, Helvetica Neue, then Arial/system sans. Native Vega uses its system font. No unlicensed font binaries or remote font requests.
- Watching surfaces use 18px answer/input text and 16px secondary controls; native text scaling remains supported. Larger type is reserved for the start screen. 5% safe area, visible focus, no color-only state. Buttons turn white with dark text and a separated outline when focused.
- An original crescent and play shape beside the lowercase selene wordmark ties the viewing role to the name. It is not an Amazon logo or affiliation claim.
- Short control transitions (140ms). Compact SVGs use finite WAAPI motions that demonstrate the explanation and settle. Legacy connectors reveal their strokes once. No whole-diagram pulse. Reduced motion disables animation.

## Navigation

A real playback tile opens the question directly. Page through three sessions at a time. Readable metadata is used when supplied; package identity is a fallback, never guessed branding. No automatic transport action on discovery or selection.

One question field accepts the question and scene detail together. Quick questions submit directly to the real model. Preferences are optional. Clarification goes directly back to the same single field, with the original request and playback boundary retained. An empty question never invokes a model.

The response is a small top-right toast: a 76 by 56px SVG beside the answer, with icon-only dismiss and More controls. No brand header, timestamp, playback badge or expansion. Ordinary answers resume playback before appearing; explicit Life Connection remains a separate confirmed flow. Other actions live under More. Unsupported voice and unconfigured phone mirroring are absent. Back closes the current panel first; it never implicitly resumes playback. Every Life Connection conversation requires confirmation.

The original player inherits these controls and styles but remains explicitly labelled as a demo. UI preview fixtures are test-only and never part of the production bundle.

During own-player watching, the launcher contains only Ask Selene, Selene tools and dismiss. Tools holds pairing, Hold our place / Bring us back, and answer preferences. The question box is at most 480px wide with one input row and two explanation shortcuts. Demo-only playback controls remain under preferences.

## Personal playback, code phase 30 September 2026

The phone surface preserves the charcoal palette and system font. It is a scrolling column capped at 520px, with 16px body text, 22px headings, 14px secondary text and 44px touch targets. Its personal video uses browser controls and an original caption track. It starts held and muted. A short original line, a single question row and Bring me back are the main tasks; speed and answer preferences use one native disclosure.

The phone answer pairs a compact 56 by 48px schematic with text. Existing finite WAAPI geometry and reduced-motion behavior are reused. A return replaces the question area with its sampled time boundary and Back to TV / Replay from here. Source details are optional; no answer expansion is required. Further TV progress is shown without an automatic recap loop.

TV pairing uses a small existing sheet with an HTTPS address and a six-digit code. Shared returns use the existing compact toast and retain a deliberately paused TV state. These source changes have not been rendered or device-tested yet, at the user's request.
