# SELENE companion

<!-- impeccable:product-schema 1 -->

The full Moment Response contract is in [the original product brief](../PRODUCT.md). These current decisions supersede its original own-player-first positioning.

## Platform and stack
Vega-first Fire TV app. Native Media Controls discovers real opt-in playback sessions and owns transport. React in a Vega WebView presents one model-generated answer with a validated SVG. The local relay supplies the configured model and, when available, an authorized scene-context feed. The original player is an explicitly selected demo.

## Users and task
People watching films, shows, or sport who want to understand the current moment without a persistent chat. Family View defaults to everyone; preferences are explicit and optional. No inferred age, disability, household presence, or consent.

## Current experience decisions
On 30 September 2026 the user selected Personal Pause and Guided Return for the next own-player experience. One paired phone can hold/replay permitted media, ask privately and request a bounded return while the TV keeps its own playback controls. A shared film marker uses the same return operation after a chosen family conversation. Silent phone playback with original captions is the confirmed default. This is a code-only implementation phase; testing is explicitly deferred. Details and limitations: [personal-pause.md](docs/personal-pause.md).

Confirmed by the user on 20 September 2026: open directly into one question about the selected playback; put viewing preferences behind an optional action. Minimize typing, clicks, sections, repeated text, and unbounded lists. Keep keyboard/D-pad input alongside capability-gated voice. A quick question invokes the real agent, never a canned answer.

## Brand commitments
Follow Amazon Fire TV's dark UI, bright focus states, generous TV spacing, rounded controls, navigation, and restrained motion. Use the platform font and a SELENE wordmark with an original orange crescent. SELENE remains its own app. No Amazon logos, product identity, or invented affiliation. The user explicitly selected this familiar visual direction.

## Boundaries
Playback continues unless the viewer confirms otherwise. Pause/play claims require a provider result. Explain only the sampled moment; provider metadata alone is not scene evidence. Accept dialogue or scene details in the question and clarify only if needed. Never claim a Prime Video overlay, automatic transcript access, or control of an unsupported provider. Life Connection requires an explicit request and confirmation; never record family conversation. Silent output is the default.

## Verification
Read the current code, run code checks, and inspect screenshots at TV sizes. Isolated UI fixtures may exercise hard-to-reach states, but must never ship as providers or be presented as evidence of a working third-party integration.
