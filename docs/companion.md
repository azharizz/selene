# Third-party companion evidence

**Current own-player catalog:** `football-match` and `the-missing-crown` only. Dated Sintel import/model results below are historical, not current-film verification. The current `npm run test:live -- --ingested` command targets the supplied Missing Crown captions and source frames; it does not rerun the old Sintel cases.

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

## Capability investigation — 7 October 2026

Target: assistance alongside existing Fire TV playback apps, not a requirement to watch inside SELENE. The current implementation is Vega-only. A universal overlay or automatic scene feed is **not** implemented or established by the public APIs.

### Implementation decision

Reuse the existing paths; no second discovery client, capture workaround, scene-feed simulator, or Android build was added:

- `src/Companion.tsx`: actual endpoint discovery, explicit session selection, sampled identity/position, supported playback controls and change notifications.
- `web/CompanionMoment.tsx` → `server/index.mjs`: actual companion request path, without borrowing the own-player catalog.
- `server/external-context.mjs`: authorized scene-source adapter. See [the wire contract](scene-context.md); setting a URL does not prove authorization or provider coverage.
- `scripts/ingest-video.mjs` → `server/context.mjs`: permitted local captioned-excerpt processing and timestamp-bounded evidence. This does not capture another app.

Amazon's [Media Controls client documentation](https://developer.amazon.com/docs/vega/0.24/media-controls-get-started) requires provider participation; [playback features](https://developer.amazon.com/docs/vega/0.24/media-controls-attributes-features.html) determine optional position/control availability. Neither interface supplies the actual dialogue or screen pixels. Development screenshots are not a production scene feed; [Amazon's Appium guidance](https://developer.amazon.com/docs/vega/0.22/appium-commands.html) says not to capture DRM content.

An Android/Fire OS implementation is a separate decision, not a Vega patch. [MediaProjection](https://developer.android.com/media/grow/media-projection) requires user consent; [secure windows](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE) and [source audio-capture policy](https://developer.android.com/media/platform/av-capture) constrain access. The overlay permission flow, remote focus, uninterrupted playback and app distribution remain device-specific verification gates. Do not use ADB-only permission grants or bypass protected playback.

### Observed checks

| Check | Result | Evidence limit |
| --- | --- | --- |
| Initial `vega device list`, before starting the installed VVD | `No devices found` | A stopped VVD was not evidence that the virtual-device installation was absent. See the device follow-up below. |
| Initial `adb devices -l` | Empty device list | Later tester inspection found `emulator-5554`; that establishes an Android emulator, not a verified Fire OS target or a physical Fire TV. No capture, consent or overlay was exercised. |
| Actual relay `/api/health` | `provider_configured: true`, `scene_context_configured: false` | Presence of model configuration is not proof of a licensed scene source. |
| `npm run test:live -- --companion` | Live viewer-description answer and SVG; position alone was not called an offside offence. | Synthetic snapshot, not a real provider session. |
| `npm run test:live -- --ingested` | Live caption explanation and qualified sampled-frame answer. | Existing authorized Sintel excerpt, not arbitrary streaming-app access. |
| Fresh temporary Sintel import → live answer | Real FFmpeg processing and image-model call: 20 seconds, two captions, one sampled frame, four provisional observations. Answer cited `caption-2`: “Sit still” means stay in one place without moving. | Temporary import, no authored plot facts or prepared answer; no full-movie, audio-transcription or native playback proof. |
| Actual `/api/companion/moment`, no scene details/feed | HTTP 200 clarification: “What happened just before the person left? The available scene information does not explain why they left.” | Live model with a synthetic snapshot; `provider-metadata` citation identifies the request, not a reason for the scene event. |
| Tester: `node --test test/external-context.test.mjs` | One test passed, zero failed: identity/time matching, future-evidence filtering, mismatches, payload bound and cancellation. | Ephemeral local fixture only; no licensed endpoint, real provider scene or source-failure UI proof. |

The temporary import and its media were removed. The relay session was ended. Existing live-check artifacts use only public/synthetic fixtures. No physical-device, protected-content or statistical reliability claim follows from these checks.

### Remaining execution checklist

- [x] Trace native selection → web request → relay grounding and authorized-source validation.
- [x] Check documented platform boundaries and current device/configuration prerequisites.
- [x] Exercise current live companion answers, imported evidence and missing-scene clarification.
- [ ] **Real Vega provider gate:** connect a supported device with YouTube/Prime Video installed. Play content, open SELENE, select the actual provider and record package/session identity, sampled position and advertised actions. Observe foreground video/audio and Back behavior. Missing endpoints mean no verified support for that provider.
- [ ] **Authorized source gate:** obtain a source with processing rights and exact provider-ID/time alignment; configure `SELENE_SCENE_CONTEXT_URL` and optional token only then. Exercise a real question and identity/time mismatch, unfinished-caption, source-failure and cancellation cases. Do not substitute public plot summaries or an invented feed.
- [ ] **Separate Fire OS gate, if that platform is chosen:** connect an Android-based Fire TV and prove user-operable capture consent, eligible screen/audio capture and overlay/remote coexistence on authorized unprotected content. Record protected-content exclusions; do not claim universal coverage.
- [x] **Permitted-source ingestion gate:** actual licensed local and HTTPS Sintel imports, unprepared questions and local playback were exercised. Current imports have no application video-duration/download-byte ceiling; captions may be supplied/embedded or explicitly unavailable. The current [import guide](improvement-verification.md#import-another-video) supersedes the former five-minute/512-MiB/40-frame restrictions. This proves source-file processing, not access to arbitrary streaming-app content.

These unchecked gates need real hardware, an authorized source or a user-supplied asset. More application code cannot establish those prerequisites. Expand ingestion or build another platform only after the corresponding requirement and evidence justify it.

### Existing VVD follow-up

The installed virtual device was started with SDK `0.24.12112`; SELENE launched on its actual 1280 × 720 surface. The own-player fallback rendered The Red Kite, and native media diagnostics showed playback advancing from `0` to `11.234536`, `31.639588` and `67.641611` seconds. Selecting Pause changed the accessible control to Play; the native pause event recorded `currentTime: 74.058478`, `paused: true`, `ended: false`.

Screenshot and accessibility evidence is retained under `artifacts/companion-vvd/2026-10-07/`. This proves the own-player fallback and pause transition on the VVD, not playback alongside YouTube/Prime, continuous scene capture or an authorized provider feed.

A tester independently checked that `SELENE_SCENE_CONTEXT_URL` is absent from the process environment and the workspace `.env`, without exposing secret values. The focused adapter test passed against its local fixture; the authorized-source gate remains blocked. The test does not establish source licensing, optional scene-interval handling, source-failure UI behavior or production provider coverage.

### Tester phone-join attempt

The supplied `https://selene-phone-demo-v2.yyaex8bhyrtby.us-east-1.cs.amazonlightsail.com/?join=1` loaded the join screen and matches the configured TV relay host. Health returned HTTP 200 with the model configured and scene source unconfigured.

The tester used the existing Appium connection and attempted the actual **Try the demo** route. In this attempt, SELENE disappeared from the accessibility tree and the launcher became visible before the Pair phone controls were reached. Screenshot requests timed out/aborted; restarting only Appium once did not restore screenshot transport. This is an automation/application-navigation blocker, not evidence that pairing or provider support is impossible.

No genuine pairing code was obtained, so phone join, a private question, playback continuity during phone use and saved-place/return remain unverified. Prior own-player playback evidence is not evidence of this phone flow. See `artifacts/companion-vvd/2026-10-07/phone-join-report.json` and the accompanying phone screenshot/XML captures. The tester closed its browser tabs and released the recovered Appium session; the VVD remains running. No application code or configuration was changed.
