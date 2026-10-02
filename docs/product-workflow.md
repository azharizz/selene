# PRODUCT.md implementation coverage

Scope: the Vega MVP in [PRODUCT.md](../../PRODUCT.md), plus the latest request for a cross-app assistant. The companion is the launch surface; the authored story and Offside Practice packages remain explicit secondary options. Third-party requests use genuine provider snapshots, separate companion sessions and a viewer-detail fallback. An optional scene-context adapter requires an authorized endpoint; overlays inside viewing apps remain unsupported without a platform contract. See [the September 19 code-review results](companion-review.md) for executed checks and remaining gates.

## Implemented flow

1. Select a supported playback session, or open the original narrated film. Both request surfaces support explicit Family/Solo selection. SELENE owns captions and transport only for the original film; a third-party provider retains authority over its own playback.
2. A playback tile opens one question directly. That sampled moment stays fixed. Type a question with any scene detail, or select a quick question; need, recipient and language live in optional preferences. Use D-pad, keyboard, or capability-gated voice. Playback lists contain three sessions per page.
3. Send the request, keep watching, or pause to explore. The relay associates it with a viewing session. The real model calls time-bounded scene and graph tools, then returns the strict Moment Response contract. Missing detail permits one clarification tied to the same request and moment.
4. Validate schema, evidence availability, recipient, word limits and SVG safety. One model review checks the proposed claims and explicit natural-language pause/Life intent against the supplied evidence. One correction is permitted, including for an invalid SVG; a remaining diagram failure preserves reviewed text. A flagged semantic issue rejects the response even if the reviewer contradictorily sets supported=true. Model review can still miss factual errors: see [current live results](ui-review.md).
5. Display one answer and matching visual, silently. Compact output accompanies continued playback; paused output has more room. The host reads actual playback events and rejects stale responses. A newer transport action takes precedence over a delayed pause request.
6. A Life Connection needs an explicit personal-connection request or the viewer's selection and pause confirmation. Show one question for the selected recipient. The family supplies its own perspective; no microphone or recording starts. Back closes without resuming. Resume is a separate viewer action.
7. Close the moment or leave the app. Cancel pending work and speech, restore film audio, discard the transient question, and release background playback. Return requires a manual Continue action.

## Feature map

| Product requirement | Implementation |
| --- | --- |
| Authored films, timed captions, scenes and facts | `assets/media/the-red-kite.mp4`, `assets/media/offside-rule/`, `content/*.json`; `web/App.tsx` owns playback/captions |
| Automatically acquired evidence from another permitted title | `scripts/ingest-video.mjs`, `content/sintel-excerpt.json`, `assets/media/sintel-excerpt/`; SRT/WebVTT cues and individually timed, provisional frame observations; no durable graph writes |
| Native accessibility collaboration | `src/Accessibility.ts`, `web/accessibility.ts`; official read-only Vega preferences/listeners, caption defaults/style with explicit overrides, high contrast/text scale, VoiceView speech guard and accurately named slower-answer voice |
| Collaborative evaluation | `scripts/evaluate.mjs`, `evaluation/trials.template.json`; anonymous usual-help versus usual-help-plus-Selene pairs, comprehension, group/viewer disruption and observed reuse; [protocol and executed checks](improvement-verification.md) |
| Family/Solo, four viewer needs, explicit recipient, translation | `web/App.tsx`; English, Indonesian and Spanish selections; no inferred household profile |
| Quiet position awareness and frozen request context | Video events resolve the scene locally; `server/context.mjs` exposes only completed dialogue and already-available facts |
| Natural request, D-pad, keyboard and optional real voice | `web/App.tsx`, `web/voice.ts`; explicit start/stop, review transcript before submission, capability/error fallback |
| One structured answer plus free-form visual | `server/prompt.txt`, `server/contract.mjs`, `server/agent.mjs`; real configured HTTPS provider, strict JSON schema and actual tool calls |
| Connection Graph and reuse | `content/graph.json`, `server/context.mjs`; scoped lookup, cached-visual tool, evidence-backed proposals, bounded session memory and model-reviewed general concepts persisted to `SELENE_GRAPH_PATH` (default `data/general-graph.json`); exact request reuse in `server/agent.mjs` |
| Grounding, spoiler limits and output failure recovery | `server/agent.mjs`; time-bounded evidence IDs plus model semantic review; bounded repair; unsafe visuals become text fallback |
| Renderer-safe SVG and finite motion | `server/visual.mjs`, `web/Visual.tsx`; XML allowlist, no generated scripts/assets/navigation, server nonce, isolated frame, geometry-only WAAPI, reduced motion and legibility/overflow fallback |
| Playback choice and authority | `web/App.tsx`; actual pause/play events, explicit choices, revision guard, no automatic resume; model output describes requested actions only |
| One optional Life Connection | `web/App.tsx`, `server/agent.mjs`; selected recipient, explicit intent, confirmed pause, manual close/resume, no conversation capture |
| Audio control and accessible TV navigation | `web/voice.ts`, `web/App.tsx`, `src/OwnPlayerSession.ts`, `web/style.css`; explicit read aloud, film mute/restore, native own-player callbacks/audio-focus state, large text, safe areas, focus states, D-pad, semantic labels and Back |
| Session association, cancellation and memory boundary | `server/index.mjs`; same-origin API, session header, abort on replacement/disconnect, request bounds, one bound clarification, no private disk history |
| Vega host and dev loop | `src/App.tsx`, `manifest.toml`, `scripts/build.mjs`, `scripts/vega-run.sh`; official WebView, media services, loopback forwarding, guarded host messages, full release build |
| Requested third-party client | `src/Companion.tsx`; public endpoint discovery, selected-session metadata/state/position, supported Play/Pause, cancellation and native client cleanup |
| Third-party request-to-response workflow | `src/Companion.tsx`, `web/CompanionMoment.tsx`, `/api/companion/moment`; real snapshot bridge, optional verified licensed scene context, viewer account fallback, bound clarification, source-separated agent context, shared SVG renderer and confirmed Life Connection |
| Third-party state changes and consent | Foreground provider listener, identity checks before request/display/control, reported pause requirement, delayed transport revision guard, explicit resume and no background monitoring |
| Private phone mirror | `/api/private/pair`, `/api/private/<token>`, `web/PrivateMirror.tsx`; explicit session token, SSE response stream, manual close, phone-local read aloud/headset output; Life Connection text is withheld until the TV confirms it |

## Deliberate limits

- **Model review is model review.** It is evidence checking, not human approval or a guarantee of factual correctness. Authored graph entries and generated reviewed entries remain distinguishable.
- **Memory is scoped.** Scene and title entries are limited to the viewing session, with at most 32 connections and 16 exact responses per session. Only a model-reviewed `general` proposal supported entirely by authored evidence can enter the bounded durable general graph (64 entries); viewer answers and third-party accounts are rejected. The relay retains at most eight sessions and does not save family answers.
- **Voice needs device evidence.** The own-player implementation uses genuine Web Speech APIs when present, with audio restoration even when a voice cancellation fails. The native Vega PlayerSession now receives own-player playback commands and audio-focus state; microphone and speech-service behavior still need device evidence. The companion offers browser voice only while provider playback is explicitly paused; otherwise requests stay remote/keyboard-based. No Alexa simulation or invented native speech integration is included.
- **Prime Video remains gated.** Saved VVD evidence contains no Prime Video provider. The public client provides no timed dialogue or third-party overlay. The optional licensed scene-context adapter can supply automatic grounding only when a real authorized endpoint is configured; otherwise the fallback explains an explicit viewer account. See [companion evidence](companion.md) and [scene-context contract](scene-context.md).
- **No unsolicited intervention.** Host recommendations are disabled. The no-request path is quiet; background scene tracking causes no model calls.
- **Private mirror.** An explicit session pairing can stream the current Moment Response to a reachable phone/tablet over SSE; the private device may read it aloud through its own browser/headset after a tap. Direct TV headset routing still depends on a platform audio API that is not present. Fire OS and Alexa+/MCP remain later targets. The own-player includes an authored Offside Practice fixture; third-party sports playback still uses only verified provider context or viewer detail.

## Testing handoff

`test/` now covers companion transport races, immutable moment time, clarification, voice shutdown, session separation, source identity/time/size boundaries, HTTP routes, private stream revocation and SVG safety. These code checks do not prove Vega rendering or provider participation. Device-only gates remain selected-provider discovery, foreground/Back behavior, real captions/audio, voice capability, ten-foot legibility and actual provider controls. No device or browser checks were performed during the September 19 review; saved device artifacts are historical only.
