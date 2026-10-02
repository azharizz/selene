# Personal Pause and Guided Return

Updated: 2 October 2026. The current source has passed the full local release checks and live model checks for Sintel caption/frame ingestion plus both phone and shared-TV Guided Return on Sintel and Offside. These are code and model-fixture checks, not a real two-device or production deployment pass. The Vega Virtual Device process is running, but `vega device list` currently reports no connected devices; phone pairing also lacks a reachable HTTPS origin.

This implements option A from [the approved research](../../SELENE_BREAKTHROUGH_OPTIONS.md). The two features share Selene's existing permitted media, reviewed answer pipeline and compact SVG renderer. No dependency was added.

## Code review corrections, 1–2 October 2026

The review separated playback, pairing reachability and generated return quality. Previous attempts mixed app failures with changing ports/builds, tunnel availability and automation behavior. That prevented a reliable end-to-end conclusion. The existing diff includes feature implementation, generated assets, media changes and earlier repairs; it is not all new work from this review.

The latest follow-up keeps the existing Vega WebView and relay. A native-player rewrite is the second possible approach, but the evidence does not justify its extra scope: prior playback reports did advance, and missing pairing and rejected generated answers have separate causes.

| Confirmed code defect | Current correction |
| --- | --- |
| Pair phone was hidden whenever the session reported no HTTPS configuration. | The own-player tools always expose pairing. The existing server error explains the missing reachable HTTPS address. This improves diagnosis; it does not create a phone connection by itself. |
| Pairing, code exchange and personal requests could wait indefinitely on the network or response body. | One shared request function bounds non-model operations to 15 seconds and questions/returns to 45 seconds. A timeout reaches the error UI without being mistaken for user cancellation. Lost hold/end responses still reconcile with the server. |
| A paused-and-ended video was reported as paused to native controls; timeupdate cleared buffering even without a playing event. | Ended takes precedence; timeupdate only updates position. Playing/seek completion still clear buffering. |
| Overlength answers received a generic, visual-heavy repair instruction. | Validation now supplies the observed word count and exact limit. The single correction explicitly asks for a shorter essential-change sentence, preserving the selected language. It still requires grounding review. |
| Return logic exposed unfinished captions and required a separate endpoint clause. | Only completed cues and already available facts enter generation. Cues completed after the marker count even if they started before it. There is no forced “Now” clause or invented present-time orientation. |
| Private help fetched evidence with a model tool call although the server already held the exact source. | The host supplies the evidence directly for private questions and both returns. Ordinary companion requests retain their retrieval path and semantic review. |
| Provider calls had no total generation deadline. | Drafting, correction and semantic review share a 30-second deadline, with one output correction at most. Caller cancellation remains authoritative. |
| The parser accepted a first JSON object and silently discarded trailing output. | Standard JSON parsing rejects trailing prose or a second verdict. |
| Provider failure could become a successful source-quote recap. | `unavailable` is explicit and separate from `insufficient_evidence`. The phone offers original replay; closing an unsuccessful TV return retains its marker for retry. |
| Public phone/media origins could reach session-owner routes. | Those origins expose code exchange and token-scoped personal routes, while TV-owner routes are blocked. Hosting a TV itself at the public app origin still requires access control outside this local prototype. |
| Animation-target failures gave an unspecific repair instruction. | The error identifies the missing target and requires a matching SVG geometry ID. Existing WAAPI and reduced-motion handling remain in use. |

Regression checks cover strict JSON, caption and time boundaries, explicit provider failure/cancellation, public route isolation, missing animation IDs, failed return markers, compact answer limits and optional frame handling. `npm run release` is the final gate for the current source; its result is recorded below. The real-model smoke checks are separate because model judgment can vary between runs.

The local build uses `http://127.0.0.1:4519`; the Vega launcher must establish the matching reverse port forward. The package build succeeds, but the current VDA is not visible to the Vega device CLI, so no current package install, Appium session, screenshot or playback flow is claimed. Phone pairing requires a reachable HTTPS relay origin; `SELENE_PRIVATE_URL` is unset on this host. A local browser check cannot substitute for those device checks.

Two next paths remain: reconnect the VDA to the Vega SDK and install the freshly built package, or use the local browser for layout and relay checks while waiting for device connectivity. For a failed model request, the product keeps the saved marker and offers original replay; it never presents one caption as a completed Guided Return.

## The two paths

| Path | Interaction | Playback behavior |
| --- | --- | --- |
| Personal | Pair a phone, tap **Pause for me**, replay/read/ask, then **Bring me back**. | The phone holds its own position. Its requests never issue TV transport commands. |
| Family | Open TV tools, choose **Hold our place**, talk, then **Bring us back**. | This marks film time only. The family can keep watching or deliberately use its existing pause control. |

Personal Pause starts muted with original captions. Native video controls provide play, pause, seeking, caption choice and audio. Replay speed and answer preferences are under one collapsed disclosure. Read aloud and microphone input require explicit actions; speech input is reviewed before submission. A caregiver can operate the phone for a child who cannot read it.

The ordinary TV launcher remains three compact controls: Ask Selene, tools, dismiss. Pairing and the family marker live in tools. Answers retain the finite WAAPI SVG renderer and reduced-motion behavior. There is no expanding answer panel or replacement TV transport bar.

## Source review corrections

The review traced the TV tools, pairing, phone hold/replay/question, personal return, shared return and close handlers. Current component checks cover these paths:

- Moving or restarting personal replay clears its previous answer and cancels pending generated output, so a later scene's explanation does not remain above an earlier replay.
- A failed hold or close reloads the relay's actual saved branch. Closing an already closed branch is safe to retry; an old close cannot delete a newer branch.
- TV disconnect keeps the existing connection visible until the relay confirms it ended. Errors explicitly warn that the phone may still be connected.
- TV snapshots are withheld during seeking so a new position cannot be sent with the previous seek generation.
- Spoken phone answers use the language of the delivered answer, including mirrored translations, even if preferences change afterward.
- A return with no missed interval describes its sampled moment, without claiming the moving TV is still there.
- Shared return passes a deliberately paused or ended TV state to the answer pipeline instead of always reporting playback as playing.

These checks run in the current local release suite. They do not simulate Fire TV remote input, Vega WebView playback, or a real phone connection.

## Current verification, 2 October 2026

| Check | Result |
| --- | --- |
| Full local release | `npm run release` passes typecheck, lint, Node tests, web bundle, and Vega Release packages for aarch64, armv7 and x86_64. |
| Guided Return with the real configured model | One complete four-case pass succeeded: Sintel and Offside, phone and shared-TV output. Answers cited interval evidence and kept playback at `keep_watching`. Model output is nondeterministic; earlier attempts before prompt/validation fixes failed review or length checks. |
| Automatic permitted-video evidence | The live Sintel caption question returned a grounded WAAPI-animated SVG; the frame-only answer cited provisional frame evidence and used the required sampled-frame qualifier. |
| Vega VDA/Appium | The VDA QEMU process is running, but `vega device list` reports no connected device. Appium 2.2.2 and the Vega driver are installed; there is no device session to install or interact with. |
| Phone | No real phone session. `SELENE_PRIVATE_URL` is unset, so the local loopback page cannot pair a phone over HTTPS. |

## Historical verification results

The following records predate the latest fixes. In particular, the old build status and hidden Pair phone behavior do not describe the current source. None of these rows certifies the current TV-plus-phone flow.

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

The passing relay tests use a mock model. They prove request routing and source/interval checks, not live answer quality. The live result demonstrates the evidence fallback, not a successful return. The missing HTTPS address separately blocks two-device pairing. The local browser screens were shown during the browser review; this table records their limits. The Vega run confirms installation and launch, but its broken capture path leaves feature behavior on Vega unverified.

## Research decisions applied to code

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

A position expires after six seconds without a fresh report. A phone hold records the most recent observed TV position or an explicitly selected earlier position. No wall-clock extrapolation moves the source evidence boundary forward. Seeking the TV invalidates an existing personal branch; a title change ends the viewing session. A phone can replay already reached material and explicitly set the point it last followed. Replay alone does not mark comprehension.

The paired viewer has its own request controller, clarification and bounded answer memory. A TV request cannot cancel or publish over that private answer. One paired viewer is supported in this first implementation. Replacing a pairing revokes its previous token and cancels its pending work.

Guided Return takes the declared starting point, latest observed TV endpoint and unresolved question, when present. It reuses the reviewed explanation pipeline with an interval-specific instruction. It asks for the essential supported change, a necessary earlier connection where available, and orientation to the endpoint. A response must cite original evidence completed or made available after the starting point and no later than the sampled endpoint. A caption that starts before the marker but ends afterward remains usable once completed. Earlier original evidence may explain a connection; generated graph memories cannot fill missing facts.

Returns target 31 words on the phone and 20 on TV, with hard ceilings of 31 and 26 words respectively. Generation failure returns an explicit unavailable state; it does not fabricate a recap from clipped source text. A gap that cannot be explained faithfully within the evidence or this budget must produce a limitation and original-replay route. Empty intervals and intervals without new source evidence avoid a model request altogether. Model review is still fallible; citing a real source ID does not prove a claim is correct.

The phone shows the return boundary and how far the last TV sample has progressed beyond it. **Back to TV** closes personal playback and speech without changing the TV. **Replay from here** starts at the bridge endpoint, or at the saved starting point when evidence was insufficient. It does not claim to recreate every missed shot, emotion or shared reaction.

## Connection and deployment

Use the existing own-player demo in the Vega app, or the existing browser player. Phone replay currently uses those permitted catalog assets. The separate third-party companion still supports answer mirroring; provider metadata alone does not make its movie available for personal replay or Guided Return.

Configure `SELENE_PRIVATE_URL` with a reachable HTTPS relay origin and forward that origin to this same relay. The existing `SELENE_APP_URL` HTTPS origin can also supply pairing when no separate phone origin is configured. The latest code-only follow-up did not change a tunnel, environment value or deployment. A configured URL is not proof that a phone can reach it.

On the TV: Selene → tools → Pair phone. On the phone: open the displayed `/?join=1` address and enter the six-digit code. Codes expire after five minutes and are single-use. Eight attempts per connecting address per minute are allowed, with bounded in-memory tracking. A proxy can make several users share that limit. The token remains a capability for one paired viewer, not a household account system.

If using a restricted phone proxy, allow:

| Method | Path | Purpose |
| --- | --- | --- |
| GET/HEAD | `/`, `/app.js`, `/app.css`, permitted `/media/` assets | Phone UI and original media, including byte ranges |
| POST | `/api/private/join` | Exchange the short code for its token |
| GET | `/api/private/<token>` | Current session and TV position stream; disable proxy buffering |
| GET | `/api/private/<token>/captions` | Original WebVTT caption track |
| POST | `/api/private/<token>/hold`, `/ask`, `/return`, `/end` | Token-scoped personal actions |

TV/session/model-owner routes stay on the existing trusted device boundary. The phone token does not authorize `/api/playback`, `/api/return`, pairing replacement or ending the TV session. The relay remains a local prototype with process-local sessions, not an authenticated public multi-household service.

## Coverage and honest limits

| Research group | Original rows | What this implementation provides |
| --- | --- | --- |
| Information tasks, 14 | 1, 4–10, 17, 23–25, 31, 34 | Original replay/captions, private questions with one clarification, a source-backed return. Answers still depend on sufficient evidence. |
| Recovery/conflict consequences, 9 | 2, 3, 11, 13, 16, 33, 35, 36, 38 | Time for personal help without a phone request controlling the TV, followed by explicit gap recovery. It cannot undo an interruption already spoken. |
| Access tasks, 5 | 18–22 | Silent captions, optional original replay audio, selectable local speed and explicit answer speech. Native assistance remains available; headphone routing and audibility need actual device trials. |
| Chosen family activities, 8 | 14, 15, 26, 27, 39–42 | A deliberate film marker and shared return after chosen discussion. No room recording or judgment of whether someone is talking too much. |
| Not counted, 6 | 12, 28–30, 32, 37 | No claim to change attention, personality, age-related ability or phone habits. |

**36 eligible research hypotheses, zero newly measured benefits in this phase.** These rows are not independent proven outcomes. Social benefits are particularly conditional. TV-only use cannot provide separate timelines for different people looking at one screen. Young children may need a caregiver. Personal playback can distract or create a larger gap; ordinary shared pause may work better.

The existing catalog includes automatically ingested Sintel plus authored demos. This change works through the same catalog interface and does not add manually written plot facts. It does not create a second automatically ingested film, import another provider's stream, integrate Alexa+, add a Fire OS port, route headphones, or implement continuous synchronized phone listening. Those are outside these two additions.

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
