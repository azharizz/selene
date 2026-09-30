# UI review — 20 September 2026

Started from the user's clean `d22ed4c` checkout. The current repository is `selene`; the earlier `selene_test` directory no longer exists. Worked solo, preserving the real native provider/relay/agent boundaries.

## Changes

- One question field, three one-click questions, and optional saved preferences. Only preferences persist; questions and dialogue do not enter browser storage.
- Readable playback metadata, three sessions per page, and direct selection-to-question navigation.
- Fire TV charcoal surfaces, white remote focus, large sans-serif type, short focus transitions, reduced-motion support, and an original orange crescent/play mark. References: [Amazon design guidance](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html), [2026 home and Movies screens](https://www.aboutamazon.com/news/devices/new-fire-tv-upgrades-features-2026). Ember is used only if installed; Helvetica Neue/Arial and the native system font are fallbacks.
- Secondary actions under More. Voice requires actual browser/provider capability; phone mirroring is shown only when configured.
- Clarification goes straight to one answer field. Back preserves the draft from preferences and leaves a failed demo WebView. Empty-input Back no longer tries to focus a disabled submit button.
- Confirmed Life Connection shows its question without repeating the explanation. Fixed text/control overlap. Request failures appear above the input instead of below the form.
- Existing model review now rejects a nonempty issue even when paired with supported=true. Invalid diagrams receive the existing single repair opportunity before the text fallback; no additional checker or retry loop.

## Evidence

Typecheck, lint, 29 Node contract/controller/HTTP tests, 2 Jest native fallback checks and release builds passed for this change. Build targets are aarch64, armv7 and x86_64. No dependencies, effect hooks, credentials, fabricated provider integrations or new timeouts were added.

Screenshots live in `artifacts/ui-review/`. The actual web components were inspected at 1920×1080 and 1280×720 for asking/preferences, and at 1080p for answers, Life Connection, clarification, errors, loading and empty states. Pagination was exercised through the final page; Back from empty input and preferences was checked. The native picker preview uses a DOM approximation of React Native, so it does not verify native rendering or D-pad routing.

`node test/ui-preview.mjs` serves this isolated, visibly labelled fixture on loopback port 4518. It substitutes native/network boundaries only, never ships in the app, and supplies no evidence of a real streaming app. Reference JPGs are research artifacts, not product assets.

The real relay/demo was also opened in the browser: the authored video reached readyState=4, played, paused through its control, displayed captions, and opened the new question panel. This confirms the browser path only; microphone capture was not activated and it is not a Vega/device result.

## Unresolved release gates

The final real-provider command `npm run test:live -- --companion` failed both synthetic sports cases at grounding review. Earlier calls also produced undersized SVG labels, an unsupported ball-position detail and a premature personal question. A brief reasoning-enabled review experiment remained unreliable and increased latency; it was removed. The configured model and credentials were not changed. The final checks reject flagged responses, but semantic review is not proof of correctness. Do not claim a production-ready explanation agent from the passing deterministic suites.

`vega device list` found no device during this review. Retail Prime Video participation, automatic licensed scene coverage, actual Vega font/rendering, microphone/audio and app foreground/return behavior remain unverified. SELENE cannot promise an overlay or uninterrupted video from another app.

Two real integration paths remain: **(1) preferred:** a confirmed supported provider plus an authorized time-aligned scene feed; **(2) available fallback:** provider metadata plus a viewer's scene description and one clarification. A visual redesign cannot supply missing provider permissions, dialogue rights or reliable model output. Before release, evaluate the configured model against the saved failures and complete the device/provider checks in `companion.md`.
