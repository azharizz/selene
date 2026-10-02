# SELENE

A Vega-first viewing assistant for apps that expose supported playback sessions. Following the latest product direction, SELENE opens the playback companion first. Select a session, ask about its sampled moment, and add dialogue or scene detail when the provider does not supply it. The same real model produces a concise answer and SVG, with playback and Life Connection under explicit viewer control.

The [feature map](docs/product-workflow.md) records the workflow, sources and platform limits. The [companion](docs/companion.md) uses the real Vega Media Controls API and a guarded native/WebView bridge. The original **The Red Kite** player remains available with its own captions, authored scene evidence, Family/Solo selection, voice capability fallback and complete Moment Response flow. Answers pair a compact SVG with text; unsupported diagrams fail safely to words.

For an authorized transcript provider, see [the licensed scene-context contract](docs/scene-context.md).

## September 30: automatic evidence and native assistance

The own-player now includes a permitted **Sintel excerpt** imported automatically from SRT captions and seven sampled frames, without manually authored plot facts. Run `npm run ingest -- --help` to import another permitted local video. The agent distinguishes captions from provisional image-model observations and prevents generated observations from entering durable graph memory.

The Vega host reads native caption, screen-reader, high-contrast, UI-scale and audio-description preferences. Explicit caption choices remain under viewer control. “Easy to hear” is now “Slower answer voice”; it changes Selene's optional spoken answer only. Native program assistance and family help remain welcome.

[Implementation, import commands, native limits and the household comparison protocol](docs/improvement-verification.md) record the actual checks. `npm run evaluate -- evaluation/results-local.json` summarizes anonymous observations of usual assistance versus the same assistance plus Selene. The template contains no fabricated results. This implementation does not add universal third-party screen/audio capture or a Fire OS build.

The current local answer-model setting is `openai/gpt-6-luna`; the actual frame import used `google/gemini-2.5-flash`. Restart older relay processes to load source changes. Current full release and live-model checks are recorded in [Personal Pause and Guided Return](docs/personal-pause.md). A complete model-backed pass succeeded for Sintel and Offside on phone and shared-TV paths, and the permitted Sintel caption/frame checks passed. Model output can still vary between runs. Vega package builds pass, but this host currently reports no connected VDA device; physical Fire TV, phone pairing and household benefit remain unverified.

## Companion UI: September 20, 2026

Select a playback tile, then type one question or choose a quick question. Scene detail belongs in that same field. Preferences are optional and remember only explicit selections. Playback lists show three sessions per page; secondary response actions are under More. The Fire TV styling and original SELENE mark are documented in [DESIGN.md](DESIGN.md).

See the [screenshot review and current blockers](docs/ui-review.md). The web UI was checked at TV sizes with clearly labelled test fixtures. No Vega device was connected for this pass. Live model checks exposed grounding/visual errors; passing the code suites does not establish production readiness.

## Companion code review: September 19, 2026

The companion uses native provider discovery, a fixed moment snapshot, a separate companion relay session, the real explanation agent, and explicit playback controls. Code checks cover notification/cancellation races, clarification, voice consent, graph citations, HTTP scene-source boundaries and private-mirror revocation. See [the review and remaining production gates](docs/companion-review.md). No app, browser or device interaction is part of this review.

A scene-context adapter is available when `SELENE_SCENE_CONTEXT_URL` is configured; without that real endpoint the companion remains metadata-plus-viewer-detail only. An overlay inside another app is not implemented because no supported overlay API or privilege has been supplied. This is not a claim of universal Prime Video or sports-app access.

React state, event handlers and class lifecycle methods own the UI, cancellation, focus and cleanup; application code uses no effect hooks. The model makes interpretation and generation decisions. Host code enforces actual playback state, consent, evidence boundaries and renderer safety.

## Build and run

Use the existing Vega authentication. From this folder, build fresh web and native assets, then start the relay:

```sh
npm run build
npm start
```

In another terminal:

```sh
npm run vega:vvd
vega device install-app --packagePath build/aarch64-release/selene_aarch64.vpkg
npm run vega:run
```

`vega:run` reads the public URL generated by the web build and establishes reverse forwarding for its loopback port. `vega:vvd` keeps the existing macOS workaround that starts the VVD launcher directly. QMP screenshots can be black under software rendering; they are not proof that the UI is correct.

### Automation baseline, before SELENE

Keep `npm run vega:vvd` running in its terminal, and run `npm run vega:automation` before opening SELENE. Close any already-running app first; the check rejects other apps in the UI tree. This launcher-only check starts its own loopback Appium server, takes 1280x720 PNG screenshots, asserts that remote Down changes focus on the Vega launcher, then deletes its session and stops its server. It does not open SELENE, call the model, start the relay, or create a tunnel. Each run saves its report, screenshots, UI XML and Appium log under `artifacts/automation-baseline/<timestamp>/`.

The check pins the existing local toolchain and fails if it changes:

| Setting | Required baseline |
|---|---|
| Node | `~/.nvm/versions/node/v22.17.0/bin/node` (selected even if npm uses another Node) |
| Appium | `2.2.2`, installed under that Node version |
| Driver | `@amazon-devices/appium-vega-driver@3.34.1` in `~/.appium` |
| SDK | `0.24.12112`, including its own `vda` on the child process PATH |
| Virtual device | `emulator-5554`, 1280x720, software graphics |
| Capabilities | `Vega`, `automation-toolkit/JSON-RPC`, `vda://emulator-5554` |

On October 2, the bridge listed both `127.0.0.1:5555` and `emulator-5554`; `vda://default` failed because multiple transports were visible. An explicit serial avoids that ambiguity. The running guest also rejected shell commands with `Invalid component id: com.amazon.dev.shell.service`. A single reboot restored its shell without changing SDK, image or resolution. The reason that guest service became unavailable is not established.

If that shell error returns, stop at preflight. Use the pinned SDK's `vda -s emulator-5554 reboot`, wait for its `shell id` to succeed, then rerun. Do not change drivers, reset emulator data, or retry SELENE to repair a shell failure. The check never reboots automatically or kills another task's Appium server. Port 4723 must be free. Amazon's [Appium prerequisites](https://developer.amazon.com/docs/vega/0.24/appium-install) require a supported Node version and `vda` on PATH.

Two consecutive launcher-only checks passed on October 2 at 08:01 and 08:02 WIB: [first result](artifacts/automation-baseline/2026-10-02T01-01-59.980Z/result.json), [repeat result](artifacts/automation-baseline/2026-10-02T01-02-15.855Z/result.json). Both captured screenshots and verified different focused element IDs after remote Down. An earlier overlapping run correctly refused an occupied Appium port; run only one device test at a time.

This is an automation check only. Diagnose recap generation independently; combine the two only after each passes. A launcher pass does not establish SELENE feature reliability or physical-TV playback performance.

The relay reads `AGENT_PROVIDER_URL`, `AGENT_PROVIDER_MODEL`, and `AGENT_PROVIDER_API_KEY` from `../.env`. Provider requests use the actual HTTPS endpoint with strict structured outputs and function calls. Credentials never enter the TV bundle. Optional `SELENE_PORT`, `SELENE_BIND`, `SELENE_APP_URL`, `SELENE_MEDIA_ORIGIN` and `SELENE_PRIVATE_URL` configure the relay; changing the app URL requires a new web/native build. Remote relay and media origins require HTTPS. Set `SELENE_MEDIA_ORIGIN` to a trusted HTTPS host when testing Vega playback. The local relay must remain running; the TV package is not an offline model server.

The own player includes **Personal Pause and Guided Return**: open Selene tools, pair a phone with the six-digit code, then hold/replay/ask privately while the TV retains its own controls. The phone starts muted with original captions. Bring me back covers an explicitly bounded missed interval. Hold our place / Bring us back uses the same operation for a family conversation. See [implementation, current verification and remaining device gates](docs/personal-pause.md). The latest source has passed local release checks; real VDA interaction and HTTPS phone pairing remain pending.

Set `SELENE_PRIVATE_URL` to a reachable HTTPS URL for the relay and configure its proxy. Codes expire after five minutes and are single-use. Re-pairing revokes the previous viewer; closing a normal TV answer does not disconnect the phone. The separate third-party companion retains answer mirroring only, including confirmed Life Connection text and explicit phone-local Read aloud. No source media access is inferred from provider metadata.

The default relay is for one trusted TV on loopback. Same-origin checks and random session IDs do not authenticate a public client. The phone proxy now needs static/permitted media, code exchange and token-scoped caption, stream and personal-action routes. Follow the [exact route list](docs/personal-pause.md#connection-and-deployment); keep TV model/session-owner routes private. Public multi-household hosting still requires authenticated device access and usage limits at the deployment boundary.

## Code checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:live
npm run test:live -- --companion
npm run test:live -- --ingested
```

`npm run release` includes typecheck, lint, Node checks, and both web and native builds. `npm exec -- jest --runInBand` additionally checks native React fallback rendering in memory. `test:live` calls the real configured model for the original story. `--companion` uses explicitly synthetic provider metadata and viewer detail to exercise the real companion agent, SVG and Life Connection paths; it cannot verify another streaming app or device rendering. `--ingested` checks the real imported Sintel captions and sampled-image evidence. The deterministic suites mock external/native boundaries only inside `test/`.

Then exercise the installed device: D-pad and Back, actual playback and captions, compact/full visuals, microphone and read-aloud availability, mute restoration, background/return, clarification, cancellation, provider failures and manual Life Connection close/resume. Browser speech APIs are capability-gated and still need verification on the target Vega WebView; remote request choices and keyboard input remain available without them.

## Memory and privacy

Validated authored context lives in the content package. Scene/title generated connections and exact-response reuse stay in bounded process memory for one viewing session; only model-reviewed general concepts supported by authored evidence are persisted in the bounded graph store. Closing the session requests cleanup; abrupt device termination can leave an orphan until bounded eviction or relay restart. Questions and family conversations are not logged or persisted to disk. Life Connection never opens the microphone. Explicit voice requests may use the browser's speech service; only the reviewed request text is submitted to the SELENE agent.

Third-party metadata stays on device during discovery. Sending a question submits the selected identity/time, request and explicitly supplied scene detail to the relay/model. If `SELENE_SCENE_CONTEXT_URL` points to an authorized HTTPS scene service, the relay accepts only bounded data matching the provider, catalog, content and exact sampled time. Viewer accounts remain labeled as such and never become validated graph facts. The companion does not claim control of another app's microphone, narration, captions or audio focus. Browser voice requires a fresh reported pause and a live provider subscription; resumed or unknown playback stops voice. Closing/backgrounding releases the subscription.

The app does not enable proactive recommendations, continuous narration, automatic family recording, or direct TV headset routing. An explicit private mirror can stream a response to a reachable phone/tablet, where the viewer may use a connected headset. The own-player registers the documented Vega PlayerSession callbacks for playback voice commands and reports browser playback/audio-focus state; the WebView still falls back to remote/D-pad input when browser speech is unavailable. Fire OS, Alexa+/MCP and direct third-party overlays remain later platform work. The authored Offside Practice fixture is available as a second own-player content package; a sports app that exposes a session can still use the companion's viewer-detail flow without a hardcoded play claim.
