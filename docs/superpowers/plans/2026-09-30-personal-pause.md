# Personal Pause and Guided Return Implementation Plan

**Goal:** let one paired viewer hold and replay Selene's permitted film independently, then request a source-grounded return to a sampled TV position.

**Architecture:** extend the existing relay, private pairing and own player. The TV publishes ordered playback snapshots; one paired phone owns a separate question/return request lane. Both personal and family returns use the same time-bounded source context and existing reviewed SVG response pipeline.

**Tech stack:** existing React, HTML video/captions, fetch, EventSource, Node HTTP, Ajv and the existing model adapter. No added dependencies.

**Spec:** [approved option A](../../../../SELENE_BREAKTHROUGH_OPTIONS.md).

## Constraints

- Work solo in the existing checkout. No commit, deployment, tests, builds, emulator or browser run in this phase, as explicitly requested.
- Keep exactly two additions: independent personal playback and Guided Return. Family recovery is a use of the same return operation.
- Phone starts muted, captions on. Original audio and reading aloud require an explicit action.
- A phone action never changes TV transport. Shared pause remains a deliberate existing player action.
- One paired viewer initially. Pairing replacement revokes the old token and cancels its requests.
- Reject expired TV snapshots, different content versions, stale branch IDs and TV seeks. Never extrapolate unseen future evidence.
- Return text labels its exact endpoint. No automatic repeated recap or claim of verified understanding.
- Reuse the compact SVG renderer, including finite WAAPI and reduced motion. No full-screen answer panels or em dashes.
- 36/42 is a conditional research target. No device or household benefit is claimed from code alone.

## Implementation

1. `server/personal.mjs`: catalog identity, ordered TV snapshots, strict branch boundaries, original caption serialization and one return operation. Source-only context excludes generated graph memories.
2. `server/index.mjs`: existing pairing plus expiring six-digit entry, independent phone endpoints, playback streaming and shared return. Preserve companion answer mirroring where media access is unavailable. End/revoke aborts requests and clears ephemeral state.
3. `server/agent.mjs`, `server/context.mjs`: reuse reviewed responses with explicit private/return instructions, interval citations and no persistent generated memory for these requests.
4. `web/PrivateMirror.tsx`, `web/personal.ts`, `web/App.tsx`, `web/style.css`: code entry, compact phone hold/replay/question/return flow, fresh TV status and compact TV tools. Native phone video controls and captions supply normal transport/access controls.
5. `test/personal.test.mjs`, `test/relay.test.mjs`, `test/companion-web.test.mjs`: leave runnable checks for time boundaries, version/seek invalidation, original captions, revocation and route isolation; update the existing timer boundary and toolbar expectation. Do not execute them in this phase.
6. `docs/personal-pause.md`, `DESIGN.md`, `PRODUCT.md`: implementation scope, research decisions, limitations and deferred TV-plus-phone verification.

## Later verification, deliberately not run now

Run `npm run typecheck`, `npm run lint`, `npm test`, then `npm run build:web`. Exercise the own player on the Vega simulator/device and a real phone on the configured HTTPS relay. Confirm independent pause, original audio opt-in, captions, delayed returns, shared pause, TV seek/title change, disconnection, cancellation and token replacement. Compare understanding and newly missed events against ordinary captions/rewind/family help before counting any of the 36 hypotheses as observed benefit.
