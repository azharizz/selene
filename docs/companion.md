# Third-party companion evidence

## Platform contract

Amazon's [Media Controls getting-started guide](https://developer.amazon.com/docs/vega/0.24/media-controls-get-started) explicitly limits the provider manifest prerequisites to provider apps, excluding client methods. Its client example calls the endpoint locator without a privilege request. That supports using the documented client API; it does not establish that every device or provider grants access. SELENE declares the actual SDK module dependency `/com.amazon.kepler.kepler_media_controls_1@IKeplerMediaControls_0`, does not invent a privilege, and does not register itself as a provider.

The client discovers endpoints ranked by focus. SELENE does not assume the first endpoint is Prime Video: the viewer selects a concrete package/session. It reads `getSessionState`, `getMetadata`, and the optional sampled playback position. It ignores catalog descriptions and artwork, which can reveal future story information. These APIs provide neither timed dialogue nor permission to overlay another app. A selected session with a content identity and position can open the real Moment Response flow, using explicit viewer-supplied scene details. If `SELENE_SCENE_CONTEXT_URL` is configured, the relay can additionally request an authorized, verified scene package for that exact provider identity and time; the package is accepted only after identity, source, time and spoiler-boundary checks. Metadata alone cannot justify a plot explanation; the agent asks one focused clarification or explains the missing evidence.

All discovery uses `MediaControlComponentAsync.makeMediaControlEndpointLocator().getMediaControlEndpoints()` from the public SDK. Temporary raw TurboModule probes and HTTP debug exports have been removed. Discovery does not send titles or sessions to the model. An explicit help submission starts `/api/session` with `{ "mode": "companion" }`, which returns a session ID without demo content, then sends the selected snapshot, request, preferences and scene details through `/api/companion/moment`. Own-player sessions cannot submit companion requests. Playback positions are sampled, never extrapolated. The question, clarification and Life Connection retain the selected snapshot while foreground notifications update transport state. There is no polling or background monitoring.

Before Play/Pause, SELENE re-reads the exact session, compares the documented catalog/content identifiers, and checks the advertised action. It also checks content identity in the returned state before retaining the old title. Cancellation, leaving the foreground, and unmounting invalidate pending reads and commands and release clients. Late discovery results release their own clients. Cancellation cannot undo a command already dispatched, and the UI says so. The SDK does not expose an atomic compare-and-control operation; a provider can still change content between the final read and the command. These controls target the selected **session**, not a guaranteed frozen frame.

The interface distinguishes no endpoints, endpoints with no sessions, unreadable sessions, and discovery failures. One failing provider does not discard results from successful providers. Stop waiting is available for a slow native request; no arbitrary timeout is added. Following the latest cross-app direction, the companion opens first. The authored stories remain explicit entries, with a route back from their welcome, preferences and relay-failure screens.

## Implemented Moment Response path

`src/Companion.tsx` re-reads the selected session and captures provider/catalog/content identity, provider name when the provider reports it, title and the actual fractional playback position. Three playback tiles appear per page. Selecting a tile opens `web/CompanionMoment.tsx` directly through the official WebView. One field accepts the question and scene detail; quick questions submit to the same agent. Family/Solo, need, language and recipient are optional saved preferences. One bound clarification returns directly to the answer field. Generated SVG, pause exploration, capability-gated voice, configured phone mirroring and Life Connection retain explicit consent. Secondary actions live under More; native Back first closes the current web panel. Remote navigation and the SVG renderer are shared with the original player.

`server/context.mjs` keeps provider metadata separate from viewer accounts. It creates an opaque identity for the selected title/moment, not an invented scene. No original-film facts, transcript or graph entries enter this context. `server/agent.mjs` uses the same real configured endpoint, tools, structured outputs, semantic review and SVG validation. Scene claims based on the viewer's description must be qualified; viewer accounts are not promoted into validated graph memory. A clarification answer stays available for a subsequent Life Connection at that same selected moment.

The native bridge accepts only fixed playback actions for the selected session; web code cannot choose another endpoint or execute arbitrary native commands. Before sending or displaying a model response it re-reads session identity. Reported content changes invalidate the open moment. Pause must be reported by the provider before full exploration or Life Connection begins. For delayed natural-language pause requests, a changed transport revision wins; without provider change notifications, the viewer gets an explicit pause choice. Back, cancellation and backgrounding invalidate pending work. Resume is explicit, and the viewer returns to the viewing app manually. A command already dispatched cannot be recalled.

Third-party playback remains the authority. SELENE never borrows the provider's mute control or claims another app's audio focus. Voice input and read-aloud require browser capability, a fresh provider read confirming pause and an active change subscription. A resumed or unknown state stops voice; providers without notifications retain typed/remote requests. A private mirror uses an explicit session token and SSE; revocation clears its text and speech.

## Device evidence

- CLI SDK: 0.24.9914.
- Only connected target: aarch64 TV VVD, OS 1.2, build TV Ship/101520710.
- Installed package titles identify no Prime Video app. Unknown-looking package IDs were resolved with `vpm info`: AROL is the APL runtime, Silverstone is the virtual keyboard.
- `vpm list apps --category=com.amazon.category.kepler.media` returns no component IDs.
- Raw local evidence: `artifacts/companion-installed-apps.txt`, `companion-installed-packages.txt`, `companion-package-titles.txt`, and `companion-provider-category.txt`.

The saved package inventory establishes that this VVD did not have Prime Video at capture time. It does not establish whether retail Prime Video opts into Media Controls. The empty provider category is device inventory, not evidence of a successful client discovery call or a client permission grant.

## Completion gates for Prime Video

1. Connect a supported Vega device with Prime Video installed. Start a title, then open SELENE and check playback apps. Verify the actual endpoint package, session, metadata, sampled position and supported actions. If the provider does not appear, obtain a supported provider integration from Amazon; do not sideload an Android APK or guess a privilege.
2. Verify what happens to video/audio when SELENE takes the foreground and Back returns. A standalone client cannot promise uninterrupted shared-screen viewing or an overlay.
3. Configure a legitimate time-aligned scene/dialogue source for automatic grounding. The implemented adapter sends the provider identity and sampled time to `SELENE_SCENE_CONTEXT_URL` and accepts only the documented verified response. Without that endpoint, the viewer-detail fallback remains the honest path.

The implementation includes real client calls and explicit controls. The unavailable provider, dialogue and overlay capabilities are not simulated.

## Current code handoff

The supported-client-to-agent flow and viewer-detail fallback are implemented. The optional scene-context adapter uses a real HTTPS/loopback endpoint boundary, but cannot claim coverage until an authorized source is configured. The September 19 code-only review added regression coverage and fixes; see [the current results](companion-review.md). No device, app or browser was opened for that review. Earlier device artifacts remain historical evidence. In-app overlays are still outside the supported capabilities; this is not a verified universal or Prime Video integration.

During testing, exercise cancellation while discovery/state reads are pending, Back/background before dispatch, content changes before and after a control request, partial provider failures, missing position/metadata, remote focus and relay failure recovery. Then perform the real-device gates above. Unit checks cannot prove provider participation, permissions, overlay behavior or 10-foot rendering.
