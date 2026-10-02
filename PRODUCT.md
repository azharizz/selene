# SELENE companion

<!-- impeccable:product-schema 1 -->

The full Moment Response contract is in [the original product brief](../PRODUCT.md). These current decisions supersede its original own-player-first positioning.

## Platform and stack
Vega-first Fire TV app. Native Media Controls discovers real opt-in playback sessions and owns transport. React in a Vega WebView presents one model-generated answer with a validated SVG. The local relay supplies the configured model and, when available, an authorized scene-context feed. The original player is an explicitly selected demo.

## Users and task
People watching films, shows, or sport who want to understand the current moment without a persistent chat. Family View defaults to everyone; preferences are explicit and optional. No inferred age, disability, household presence, or consent.

## Current experience decisions
On 2 October 2026 the user changed the paired phone into an optional private SVG explainer. The film stays on the TV; the phone renders no original video, replay controls, pace settings, language selector or family-role selector. A centered clock follows the observed TV position; tap it to choose an earlier moment. The first Send saves the confirmed TV sample for catch-up; an earlier selected scene is a separate question boundary. Follow-ups stay with the explained scene until an explicit change or a displayed thread update. English questions and optional voice dictation can explicitly describe communication needs, such as "I am grandma, explain simply". The model adapts wording from that request, never from an inferred age. Catch me up freezes the confirmed TV sample at its button tap and closes the interval on success. Failure keeps the marker for retry. The next conversation starts a fresh interval. Original completed caption text is quoted separately from the explanation; attributed general references explain concepts without establishing film events. One optional Follow thread toggle silently updates the same SVG card only after a materially relevant, reviewed development. Typing, dictation, read-aloud and catch-up cards hold those updates. No age selectors or extra settings are added. Shared TV markers and returns remain available. The earlier phone replay design is historical; its claimed access benefits must be reassessed for this simpler surface. Details: [personal-pause.md](docs/personal-pause.md).

Confirmed by the user on 20 September 2026: open directly into one question about the selected playback; put viewing preferences behind an optional action. Minimize typing, clicks, sections, repeated text, and unbounded lists. Keep keyboard/D-pad input alongside capability-gated voice. Prepared examples are explicitly labelled, title-matched and source-checked; ordinary questions invoke the real agent.

## Brand commitments
Follow Amazon Fire TV's dark UI, bright focus states, generous TV spacing, rounded controls, navigation, and restrained motion. Use the platform font and a SELENE wordmark with an original orange crescent. SELENE remains its own app. No Amazon logos, product identity, or invented affiliation. The user explicitly selected this familiar visual direction.

## Boundaries
Playback continues unless the viewer confirms otherwise. Pause/play claims require a provider result. Explain only the sampled moment; provider metadata alone is not scene evidence. Accept dialogue or scene details in the question and clarify only if needed. Never claim a Prime Video overlay, automatic transcript access, or control of an unsupported provider. Never record family conversation. Silent output is the default.

## Verification
Read the current code, run code checks, and inspect screenshots at TV sizes. Isolated UI fixtures may exercise hard-to-reach states, but must never ship as providers or be presented as evidence of a working third-party integration.
