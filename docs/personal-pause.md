# Personal Pause and Guided Return

## Current phone decision, 2 October 2026

This supersedes the historical replay UI below. The paired phone is now a private SVG explainer: no video element, caption track, original audio, replay speed or preference selectors. Its centered timestamp follows the observed TV sample and can select an earlier moment. Questions are available immediately. The first Send saves the confirmed TV sample for catch-up, even when the question is about an earlier selected scene. Follow-ups keep the explained moment and the first Send marker. Dictation only creates an editable draft; Send starts help. English is the request default; communication needs are stated in text or voice and passed unchanged to the model. No age or role is guessed. A full-width labeled SVG and a short explanation carry the answer, with explicit optional Read aloud.

Catch me up captures the confirmed TV sample at its tap, validates its sequence/version/epoch against the last six seconds of reports, then freezes that endpoint during generation. It reuses the first Send marker; choosing an earlier moment does not move an existing interval. With no open interval, an explicit earlier-point catch-up remains possible. Successful or empty returns close the interval; errors preserve retry. Reconnection restores a completed card without restoring its old marker. These are observed samples, not frame-exact tap times. Follow TV closes that private branch without issuing TV transport commands. Server evidence limits, pairing tokens, cancellation and seek invalidation remain active. Third-party sessions with answer-only sharing remain answer mirrors; this redesign does not create source evidence for an unsupported provider.

Original completed captions are quoted verbatim beside the answer when available. Imported movies use their own caption-cited graph, filtered to established evidence; there are no authored general references or persistent general-graph facts. A previous answer or conversation remains continuity, not proof of movie events.

One optional Follow thread toggle follows one answered question per pairing. The relay checks only when new completed source evidence exists, at most once every 15 seconds, with one generation in flight. A material update must cite new original evidence and pass the grounding review. Irrelevant evidence stays quiet. Typing, voice activity, hidden pages, stale playback and selected earlier moments suspend display/checks; a result arriving during typing or speech waits. Seeking, title changes and revocation cancel the thread. Follow-up questions use the displayed update, while the first Send marker remains unchanged. A catch-up card pauses following so it cannot be replaced while being read; a new conversation or Follow TV ends the old topic.

The phone no longer provides original-media replay or speed/audio assistance. The previous 36-row coverage hypothesis includes those functions and is not a verified claim for this new UI. The old test and design sections below are historical records. Local browser previews use clearly labeled fixtures; they are not physical-phone, Vega playback or live-model evidence.

Current results live in [Vega verification](vega-verification.md). This document describes the implementation and preserves historical checks; it is not a second current-status table.

This implements option A from [the approved research](../../SELENE_BREAKTHROUGH_OPTIONS.md). The two features share Selene's existing permitted media, reviewed answer pipeline and compact SVG renderer. No dependency was added.

## Code review corrections, 1–2 October 2026

The review separated playback, pairing reachability and generated return quality. Previous attempts mixed app failures with changing ports/builds, tunnel availability and automation behavior. That prevented a reliable end-to-end conclusion. The existing diff includes feature implementation, generated assets, media changes and earlier repairs; it is not all new work from this review.

The latest follow-up keeps the existing Vega WebView and relay. A native-player rewrite is the second possible approach, but the evidence does not justify its extra scope: prior playback reports did advance, and missing pairing and rejected generated answers have separate causes.

| Confirmed code defect | Current correction |
| --- | --- |
| Pair phone was hidden whenever the session reported no HTTPS configuration. | The own-player tools always expose pairing. The existing server error explains the missing reachable HTTPS address. This improves diagnosis; it does not create a phone connection by itself. |
| Pairing, code exchange and personal requests could wait indefinitely on the network or response body. | Non-model operations are bounded to 15 seconds, private asks to 135 seconds for full-caption/ten-image work, and returns/thread checks to 45 seconds. Timeout remains distinct from user cancellation; lost hold/end responses still reconcile. |
| A paused-and-ended video was reported as paused to native controls; timeupdate cleared buffering even without a playing event. | Ended takes precedence; timeupdate only updates position. Playing/seek completion still clear buffering. |
| Overlength answers received a generic, visual-heavy repair instruction. | Validation now supplies the observed word count and exact limit. The single correction explicitly asks for a shorter essential-change sentence, preserving the selected language. It still requires grounding review. |
| Return logic exposed unfinished captions and required a separate endpoint clause. | Only completed cues and already available facts enter generation. Cues completed after the marker count even if they started before it. There is no forced “Now” clause or invented present-time orientation. |
| Private help fetched evidence with a model tool call although the server already held the exact source. | The host supplies the evidence directly for private questions and both returns. Ordinary companion requests retain their retrieval path and semantic review. |
| Provider calls had no total generation deadline. | Ordinary imported questions share 120 seconds across graph acquisition, ten-frame decoding, drafting, one correction and review; other generation retains 30 seconds. Graph calls are bounded to 60 seconds and frame decoding to 90 seconds within caller cancellation. |
| The parser accepted a first JSON object and silently discarded trailing output. | Standard JSON parsing rejects trailing prose or a second verdict. |
| Provider failure could become a successful source-quote recap. | `unavailable` is explicit and separate from `insufficient_evidence`. The phone offers retry or another question; closing an unsuccessful TV return retains its marker for retry. |
| Public phone/media origins could reach session-owner routes. | Those origins expose code exchange and token-scoped personal routes, while TV-owner routes are blocked. Hosting a TV itself at the public app origin still requires access control outside this local prototype. |
| Animation-target failures gave an unspecific repair instruction. | The error identifies the missing target and requires a matching SVG geometry ID. Existing WAAPI and reduced-motion handling remain in use. |

Regression checks cover strict JSON, caption and time boundaries, explicit provider failure/cancellation, public route isolation, missing animation IDs, failed return markers, compact answer limits and optional frame handling. `npm run release` runs the local release checks and package build; consult [Vega verification](vega-verification.md) for which checks actually ran on the latest source. The real-model smoke checks are separate because model judgment can vary between runs.

The local build uses `http://127.0.0.1:4519`; the Vega launcher establishes the matching reverse port forward. Phone pairing separately requires a reachable HTTPS relay origin. A local browser or launcher check cannot substitute for the complete device feature flow. For a failed model request, the product keeps the saved marker and offers retry; it never presents one caption as a completed Guided Return.

## Historical replay interaction, superseded on 2 October 2026

| Path | Interaction | Playback behavior |
| --- | --- | --- |
| Personal | Pair a phone, tap **Pause for me**, replay/read/ask, then **Bring me back**. | The phone holds its own position. Its requests never issue TV transport commands. |
| Family | Open TV tools, choose **Hold our place**, talk, then **Bring us back**. | This marks film time only. The family can keep watching or deliberately use its existing pause control. |

Personal Pause starts muted with original captions. Native video controls provide play, pause, seeking, caption choice and audio. Replay speed and answer preferences are under one collapsed disclosure. Read aloud and microphone input require explicit actions; speech input is reviewed before submission. A caregiver can operate the phone for a child who cannot read it.

The ordinary TV launcher remains three compact controls: Ask Selene, tools, dismiss. Pairing and the family marker live in tools. Answers retain the finite WAAPI SVG renderer and reduced-motion behavior. There is no expanding answer panel or replacement TV transport bar.

## Historical replay source review corrections

The review traced the TV tools, pairing, phone hold/replay/question, personal return, shared return and close handlers. Current component checks cover these paths:

- Moving or restarting personal replay clears its previous answer and cancels pending generated output, so a later scene's explanation does not remain above an earlier replay.
- A failed hold or close reloads the relay's actual saved branch. Closing an already closed branch is safe to retry; an old close cannot delete a newer branch.
- TV disconnect keeps the existing connection visible until the relay confirms it ended. Errors explicitly warn that the phone may still be connected.
- TV snapshots are withheld during seeking so a new position cannot be sent with the previous seek generation.
- Spoken phone answers use the language of the delivered answer, including mirrored translations, even if preferences change afterward.
- A return with no missed interval describes its sampled moment, without claiming the moving TV is still there.
- Shared return passes a deliberately paused or ended TV state to the answer pipeline instead of always reporting playback as playing.

These checks run in the current local release suite. They do not simulate Fire TV remote input, Vega WebView playback, or a real phone connection.

## Historical verification results

These dated implementation-stage records are historical. For current results, use [Vega verification](vega-verification.md). The following records predate the latest fixes. In particular, the old build status and hidden Pair phone behavior do not describe the current source. None of these rows certifies the current TV-plus-phone flow.

| Check | Result |
| --- | --- |
| `npm test` | 50 passed, 0 failed. The model and service boundaries use test fixtures. |
| `npm run typecheck` | Passed after fixing two reconnect/preference update type errors. |
| `npm run lint` | Passed. |
| `npm run build:web` | Passed. Web assets are rebuilt. |
| Local TV browser at 1280×720 | **Hold our place** saves a marker while playback and captions continue. **Bring us back** reaches the relay, but the live result is “not enough evidence” for the 0:21–0:30 gap at TV 0:38. Playback continues and the compact limitation toast appears. This is a safe fallback, but the core guided return was not useful for this interval. Health reports a model configured and no scene-context service configured. No browser console errors. |
| Local phone layout at 390×844 | The compact code-entry screen renders. End-to-end pairing is unavailable: no HTTPS phone URL is configured, so the TV hides **Pair phone** on localhost. The phone was not connected to a TV session. |
| Vega Virtual Device, OS 1.2, aarch64 | `npm run build:debug` passed. `build/aarch64-debug/selene_aarch64.vpkg` installed and launched; the device reports `com.selene.tv.main` running, and its React Native surface mounted. Reverse forwarding reaches the local relay, which returns HTTP 200 from the device. This proves package launch and relay reachability, not the Personal Pause flow. |
| Vega Virtual Device visual capture and interaction | **Partially observed, not interactively verified.** The user-provided screenshot shows the native companion fallback screen and a two-warning debugger toast. QMP produced a black 1280×720 frame with software rendering; the device screenshot utility produced a 0-byte file and did not return. Computer Use could not bind to the QEMU window because it is absent from the host app inventory. The repository documents the QMP/software-rendering limitation in [README](../README.md#running-on-vega-virtual-device). |
| Fire TV plus physical phone | Not tested. Browser previews do not establish hardware compatibility or a real two-device session. |

Those historical relay checks used a mock model. They prove request routing and source/interval checks, not live answer quality. The historical live browser result was an evidence fallback, and the historical native run proved installation and launch only. Their limitations must not overwrite later dated device results.

## Historical replay research decisions

| Finding | Decision |
| --- | --- |
| Browser playback can be rejected, especially when audible and outside a user action. [MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) | Start held and silent. Play and original audio are viewer choices. Catch a rejected replay and leave the native Play control available. |
| HTML media provides its own playback position and seeking. [MDN currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime) | Reuse one independent HTML video element rather than build a streaming or synchronization framework. |
| Native text tracks accept WebVTT. [MDN track](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/track) | Serialize the ingested original captions as text, including escaping tag-like content, and attach a native caption track. No generated replacement dialogue. |
| EventSource reconnects and supports heartbeat comments. [MDN server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) | Reuse the existing stream for TV snapshots. Reconnection receives current state but never automatically resumes personal audio. |
| The TV advances while help is generated and read. See the approved report's timing analysis. | Every return exposes its start and sampled endpoint. Further TV progress remains visible. There is no automatic recap loop or claim that the person understood. |
| Earlier generated answers are not independent source facts. | Private help and returns exclude generated graph connections. A follow-up can use the previous question/answer as conversational context only, and only when it is no later than the newly selected source position. |

## What the code does

The TV sends ordered snapshots about once per second during playback and every two seconds when held. Each includes content version, position, state, speed, sequence and a seek generation. The relay accepts only reports matching the session's catalog version and duration. Older sequence numbers cannot replace newer positions. The content version hashes the loaded catalog record, including ingestion media hashes when present; catalog and media must remain immutable during that relay process.

A position expires after six seconds without a fresh report. A phone hold validates the sample captured when Send was pressed; an explicitly selected earlier position is only the question boundary, or the start of a standalone earlier catch-up. No wall-clock extrapolation moves the source evidence boundary forward. Seeking the TV invalidates an existing personal branch; a title change ends the viewing session. The phone offers explanations about already reached material. Neither reading an answer nor receiving a thread update marks comprehension.

The paired viewer has its own request controller, clarification and bounded answer memory. A TV request cannot cancel or publish over that private answer. One paired viewer is supported in this first implementation. Replacing a pairing revokes its previous token and cancels its pending work.

Private Guided Return takes the first Send marker, confirmed TV sample captured on tap and unresolved question, when present. Shared TV Guided Return retains its existing endpoint sampling. It reuses the reviewed explanation pipeline with an interval-specific instruction. It asks for the essential supported change, a necessary earlier connection where available, and orientation to the endpoint. A response must cite original evidence completed or made available after the starting point and no later than the sampled endpoint. A caption that starts before the marker but ends afterward remains usable once completed. Earlier original evidence may explain a connection; generated graph memories cannot fill missing facts.

Returns target 31 words on the phone and 20 on TV, with hard ceilings of 31 and 26 words respectively. Generation failure returns an explicit unavailable state; it does not fabricate a recap from clipped source text. A gap that cannot be explained faithfully within the evidence or this budget must produce a limitation and allow another question or retry. Empty intervals and intervals without new source evidence avoid a model request altogether. Model review is still fallible; citing a real source ID does not prove a claim is correct.

The phone shows the return boundary and a separate live TV clock. **Follow TV** closes private help and speech without changing the TV. The phone has no original video or replay control. It does not claim to recreate every missed shot, emotion or shared reaction.

The optional disabled MCP endpoint shares these private actions. See [MCP operation and limits](mcp.md). No X-Ray API, live Alexa+ connection or AVG presentation is claimed.

## Connection and deployment

Use the existing own-player demo in the Vega app, or the existing browser player. Phone explanations use those permitted catalog sources; the phone does not load their video. The separate third-party companion still supports answer mirroring; provider metadata alone does not make its movie available for personal replay or Guided Return.

The demo is deployed at the Lightsail HTTPS origin recorded in `src/config.json` when building the Vega package. `npm run vega:manual:phone` uses that reachable relay directly and skips ngrok; local development can still use ngrok to expose a local relay. The 2 October 2026 browser-simulation pass verified pairing, question, caption quote, SVG answer, and Follow thread opt-in against the deployed service. This was a desktop browser at a phone-sized viewport, not a physical handset. Vega screen automation failed at the launcher, so this pass does not verify the TV UI or device-to-phone flow. The Lightsail relay is a single-process demo with in-memory pairing/session state, so restarts invalidate active pairings and it is not production-ready.

On the TV: Selene → tools → Pair phone. On the phone: open the displayed `/?join=1` address and enter the six-digit code. Codes expire after five minutes and are single-use. Eight attempts per connecting address per minute are allowed, with bounded in-memory tracking. A proxy can make several users share that limit. The token remains a capability for one paired viewer, not a household account system.

If using a restricted phone proxy, allow:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/HEAD | `/`, `/app.js`, `/app.css`, permitted `/media/` assets | Phone UI and original media, including byte ranges |
| POST | `/api/private/join` | Exchange the short code for its token |
| GET | `/api/private/<token>` | Current session and TV position stream; disable proxy buffering |
| GET | `/api/private/<token>/captions` | Original WebVTT caption track |
| POST | `/api/private/<token>/hold`, `/ask`, `/return`, `/end`, `/thread`, `/thread-check` | Token-scoped personal actions |

TV/session/model-owner routes stay on the existing trusted device boundary. The phone token does not authorize `/api/playback`, `/api/return`, pairing replacement or ending the TV session. The relay remains a local prototype with process-local sessions, not an authenticated public multi-household service.

## Historical replay coverage hypotheses, not current measured benefits

| Research group | Original rows | What this implementation provides |
| --- | --- | --- |
| Information tasks, 14 | 1, 4–10, 17, 23–25, 31, 34 | Original replay/captions, private questions with one clarification, a source-backed return. Answers still depend on sufficient evidence. |
| Recovery/conflict consequences, 9 | 2, 3, 11, 13, 16, 33, 35, 36, 38 | Time for personal help without a phone request controlling the TV, followed by explicit gap recovery. It cannot undo an interruption already spoken. |
| Access tasks, 5 | 18–22 | Silent captions, optional original replay audio, selectable local speed and explicit answer speech. Native assistance remains available; headphone routing and audibility need actual device trials. |
| Chosen family activities, 8 | 14, 15, 26, 27, 39–42 | A deliberate film marker and shared return after chosen discussion. No room recording or judgment of whether someone is talking too much. |
| Not counted, 6 | 12, 28–30, 32, 37 | No claim to change attention, personality, age-related ability or phone habits. |

**36 eligible research hypotheses, zero newly measured benefits in this phase.** These rows are not independent proven outcomes. Social benefits are particularly conditional. TV-only use cannot provide separate timelines for different people looking at one screen. Young children may need a caregiver. Personal playback can distract or create a larger gap; ordinary shared pause may work better.

The current own-player catalog contains only Football Match (`football-match`) and The Missing Crown (`the-missing-crown`). The latter uses the supplied local MP4 and SRT; its narration script is retained as a source asset, not additional runtime evidence. Historical checks involving Sintel and authored demos below remain evidence for those earlier assets only. These features use the same catalog interface; they do not import another provider's stream, integrate Alexa+, add a Fire OS port, route headphones or implement continuous synchronized phone listening.

## Deferred checks and demo

A previous implementation record reports 50 passing automated checks. That is historical, not a result for the latest source. The suite covers ordered/time-bounded state, stale/version/seek rejection, source-only recovery, caption escaping, pairing, request routes and revocation. Its model fixture verifies routing, not semantic answer quality.

Before claiming the feature works end to end, configure an HTTPS phone origin and run the native build with a real phone and Fire TV. The device exercise should show the TV and phone simultaneously:

1. Hold/replay a line on the muted phone while the TV visibly advances; optionally enable original headphone audio.
2. Ask a question privately while another TV request occurs; verify neither response is overwritten or disclosed.
3. Generate a return while the TV continues. Check the stated source interval, its factual support and new events missed during generation/reading.
4. Mark a family conversation, try both continuing playback and a deliberate shared pause, then request the shared return.
5. Seek or change the TV title, background the phone/TV, disconnect the network, replace pairing and cancel a pending request. Old results must not reappear.
6. Check D-pad focus and Back on TV, portrait/landscape text and native captions on the phone, explicit audio control, reduced motion and large text.

Later compare the same clips with captions, rewind, native assistance and family help available in both conditions. Measure understanding, unwanted interruptions, time away from the TV, newly missed events and voluntary reuse. Only those observations can justify a coverage or benefit claim.
