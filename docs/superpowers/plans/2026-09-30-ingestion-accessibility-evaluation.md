# Ingestion, native accessibility and collaborative evaluation Implementation Plan

> Executed solo in the existing workspace, as explicitly requested. Checked items describe completed software work; external device and household gates are listed separately below.

**Goal:** Import a new permitted captioned video into the existing player, respect native accessibility, and measure Selene alongside existing assistance.

**Architecture:** A local preprocessing CLI creates the existing story format from captions and individually sampled frames. Native Vega settings are read and forwarded to the WebView; explicit local caption choices override the system baseline. Evaluation uses anonymous paired observations and a runnable summary tool, with ordinary assistance available in both conditions.

**Tech Stack:** Existing Node/React/WebView stack, installed FFmpeg, official Vega accessibility package. No new database or general agent framework.

**Spec:** `../../../../SELENE_DEEP_RESEARCH_AND_RECOMMENDATION.md`, sections 5.1, 7, 11 and 13; the user's September 30 implementation authorization and correction that Selene collaborates with existing assistance.

## Global Constraints

- Implement solo in this session, as requested; execute without another approval handoff.
- Preserve existing playback, consent, cancellation and renderer security.
- New content requires recorded source, license, attribution and permission acknowledgment.
- Each visual observation receives its frame time; the visual model sees no later footage or plot summary.
- Preserve uncertainty; machine observations are not human-verified or durable general graph facts.
- Read native preferences; never request system-only accessibility write privileges.
- Family help, captions and rewind remain available in evaluation; native feature availability is recorded.
- No fabricated household results or untested device claims.

### Task 1: Caption and visual ingestion

**Files:** create `scripts/ingest-video.mjs`, `test/ingestion.test.mjs`; update `server/context.mjs`, `server/agent.mjs`, `package.json`; create a permitted third content package and attribution.

- [x] Implement and check SRT/WebVTT parsing, excerpt offsets, bounded frame observation validation and spoiler boundaries.
- [x] Use `execFile` arguments for FFmpeg, explicit model/time limits, and a temporary output directory; refuse overwrites.
- [x] Run a real import of another permitted video, then request its package through the existing relay/player.

```sh
node --test test/ingestion.test.mjs
npm run ingest -- --help
```

### Task 2: Native accessibility collaboration

**Files:** create `src/Accessibility.ts`, `web/accessibility.ts`, `test/accessibility.test.mjs`; update native/WebView hosts, captions, speech settings, contract and relevant docs.

- [x] Read actual package signatures; add settings listeners with cleanup and late-response protection.
- [x] Forward caption enablement/style, screen reader, high contrast and UI scale; preserve manual overrides and stop duplicate read-aloud.
- [x] Rename “Easy to hear” to “Slower answer voice”, migrate saved preferences, and carry the setting to the mirror.
- [x] Keep native program audio unmodified and document available native assistance accurately.

```sh
npm run typecheck
node --test test/accessibility.test.mjs test/companion-web.test.mjs
```

### Task 3: Collaborative evaluation and release checks

**Files:** create `scripts/evaluate.mjs`, `test/evaluation.test.mjs`, `docs/improvement-verification.md`, anonymous trial template; update README and workflow docs.

- [x] Validate paired baseline/baseline-plus-Selene observations and summarize comprehension, interruptions and observed voluntary reuse.
- [x] Document counterbalanced clips/order; retain family help and record native availability in both conditions.
- [x] Run invalid-record checks, all existing tests, typecheck, lint, web build and native build when the local SDK is usable.
- [x] Record actual ingestion/build results and the household/device checks that require external participation.

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

### External verification gates

- [ ] Physical Vega Fire TV: settings subscriptions, VoiceView, captions, D-pad/Back, speech/audio and recovery. No device was connected.
- [ ] Real paired household sessions and observed voluntary reuse. The trial template remains empty.

Actual results and commands are in [the implementation record](../../improvement-verification.md).
