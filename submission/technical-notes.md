# SELENE technical notes

> The project overview lives in the [README](../README.md). This page keeps the detailed, dated implementation and verification record.

**SELENE — See & Learn through Narrative Explanation.**

A Vega-first viewing assistant for apps that expose supported playback sessions. Following the latest product direction, SELENE opens the playback companion first. Select a session, ask about its sampled moment, and add dialogue or scene detail when the provider does not supply it. The same real model produces a concise answer and SVG, with playback under explicit viewer control.

The feature map records the workflow, sources and platform limits. The companion uses the real Vega Media Controls API and a guarded native/WebView bridge. The own player offers exactly **Football Match** (`football-match`) and **The Missing Crown** (`the-missing-crown`), with their captions and movie-specific evidence. Retired Red Kite, Sintel and trial imports remain regression fixtures only, not live catalog choices. Answers pair a compact SVG with text; unsupported diagrams fail safely to words.

For an authorized transcript provider, see the licensed scene-context contract.

**Current test status:** Vega verification is the dated source of truth for the tested build, launcher, playback, recap and phone results. Older dated reviews below are historical.

## Requester profiles and voice questions

Type a first-person declaration such as “I'm grandma” or “I am a kid” in the existing Vega or Fire OS question field. The relay applies that role to this request only; it does not identify the speaker or create a profile. One shared agent prompt uses the resolved role: children get visual-first, familiar explanations with an optional clearly hypothetical playful analogy; grandparents get a relevant completed-caption quote and explanation when available; parents get shared-room language without assumed child needs; adults get a mechanism-focused visual when evidence supports one. With no requester, the answer remains neutral and concise. This applies to films, shows, sports and other permitted video. A separately selected profile style controls depth; age or family role never implies disability or low literacy.

The existing paired-phone **Use voice** action now records microphone audio and sends it to the same personalization processor as TV questions. On Vega and Fire OS, long-press the existing question field (hold Select on Fire OS) to start or finish recording; no profile selector or extra recording button is added. Explicit recording/transcription/matching consent and OS microphone permission are required. Review the resulting transcript, then press Ask; recording never auto-submits a question. An enrolled acoustic match supplies that draft's profile preferences; editing the draft removes the match, while clarification retains the original question's requester. Unknown speakers remain neutral unless their words explicitly declare a role. Cancel, Back, background and unmount stop capture and pending uploads. The Alexa remote microphone button remains system-owned, not an app-owned audio source: TV recording needs an app-accessible microphone; use the paired phone when unavailable.

Completed answers and ready Guided Returns show one small `For child · stated`-style badge on Vega, Fire OS, the web player, companion and paired phone. `stated` means the question explicitly declared a role; `profile` means a consented relay profile supplied by the matched recording or authorized request; `selected` means the request's audience preference. The host resolves this metadata after validating the answer, so it is not a model claim about who spoke, an age estimate, or authentication. A missing audience on historical responses shows no badge; unsuccessful returns do not show one. Personalization never enrolls a speaker automatically or guesses family relationships from audio.

Optional relay-side voice setup for such a client:

```sh
bash scripts/setup-voice.sh
npm start
```

The setup script uses `uv` and Python 3.11 to install pinned CPU SpeechBrain/ECAPA dependencies in `.venv-voice`. FFmpeg/FFprobe decode Fire OS M4A recordings. `SELENE_VOICE_PYTHON` overrides the interpreter; `SELENE_VOICE_MODEL_DIR` overrides the model cache (default `~/.cache/selene/ecapa`). The first capability check downloads/loads the real pretrained model. Transcription sends the short recording to the configured HTTPS provider using `google/gemini-2.5-flash`; matching runs locally.

Enrollment requires two distinct recordings of the same person alone, with the TV quiet, explicit biometric/storage consent, and guardian confirmation for child profiles. The initial cosine cutoff 0.65 and winner margin 0.15 are conservative but uncalibrated; children, noise and short speech can still misidentify a speaker. The energy/periodicity quality screen is not overlapping-speaker detection. Do not use this for security or assume a successful match is certain.

The relay keeps at most eight household profiles in `~/.local/share/selene/requesters.json` (`SELENE_REQUESTERS_FILE` overrides it), written atomically with owner-only permissions. Stored data includes speaker embeddings, not historical recordings. Temporary raw audio is deleted after completion, failure or cancellation; external-provider processing remains subject to its terms. Delete a profile to remove its preferences and enrolled embedding. Profiles are local trusted-relay personalization, not multi-user account isolation.

**Verification (10 October 2026):** An isolated live-relay smoke used two independent public adult speech clips to enroll an explicitly assigned test grandparent profile. A held-out utterance matched through both TV-session and paired-phone voice endpoints; another unenrolled speaker returned unknown. Real HTTPS transcription and the local ECAPA worker ran, and a typed child declaration overrode the matched role. These are research-fixture checks, not proof of recognizing your grandmother or general accuracy. Fire OS recording consent, microphone permission, Select-hold capture and Back cancellation were exercised on an Android TV emulator. The recorder and remote handler now survive Expo prebuild. Vega packages built successfully; physical microphone routing and household matching remain unverified. See voice verification, including the first-permission retry and HTTPS streaming requirements.

## Automatic conversation ideas on the paired phone

Opening a paired phone starts an always-enabled conversation agent for Selene's own player on Vega and Fire OS. The agent reads current playback and existing context, estimates a useful later opportunity, and schedules a relay-side check. At the wake-up it rereads the latest completed captions, available source facts/graph, retained TV and phone interactions, and existing requester preferences. It can defer, remain quiet, or automatically show two or three distinct conversation invitations on the phone. Known role, interests, language and style shape the questions; unknown viewers receive inclusive invitations. There is no new profile setup, history store, or background recording.

The two authored demo films use deterministic backend fixtures: Football Match takes a grandparent-oriented angle, and The Missing Crown uses child-friendly imaginative questions. Their follow-ups and ending invitations cite completed captions. This demo tailoring is title-based; it does not identify a speaker or use acoustic matching. Other content stays on the agent path.

These are invitations for viewers to talk together. They arrive silently without a Generate button, preserve the current question/answer, and wait while the person is typing, recording, or receiving an answer. They do not speak, pause playback, or appear on the TV. Dismiss hides the current set. The phone must have the paired page open; a suspended browser receives the latest valid set on reconnect, not an OS push notification.

The agent chooses timing through internal tools, using the existing model provider. The relay validates the schedule and source citations, reviews factual premises, limits generation to one background round per session, and yields to viewer requests. Pauses, seeks, playback rate changes, endings and new caption break hints cause reassessment. A break hint only requests a fresh assessment. Video elapsed time is not automatically a match clock, and a video ending does not prove a match ended. Repeated non-final sets have a ten-minute cooldown; an actual video ending can bypass it once. Failed generation retries once after a minute, then waits for new evidence. Unpairing or ending the session cancels the pending work.

**Verification (10 October 2026):** 167 Node tests, 23 native component tests and seven Fire OS voice/plugin tests passed, along with Vega/web and Fire OS TypeScript checks, lint (three existing root warnings), and the web build. New automated checks use fake time, a mocked model, a fixture HTTP relay, and phone component controllers. A limited live smoke showed two Football Match options and three The Missing Crown options on the paired phone; the Fire OS app was exercised in an Android TV emulator. This confirms those paths only: role-specific invitation quality, the full seek/reconnect lifecycle, physical Fire TV, and physical Vega remain unverified. The third-party companion flow does not yet supply the continuous phone timeline needed by this feature. See the implementation plan and remaining checks.

## Native answer placement

The Vega and Fire OS own players analyze ordinary assistant and prepared answers at their current display time. Authenticated `POST /api/placement` samples the permitted local video now and every two seconds through the next ten seconds; paused or ended playback uses one frame. Local CPU YOLOX-Nano detects COCO objects, including people/players. Detected boxes and the caption band exclude overlapping corners; the existing edge/contrast/motion scorer ranks only the remaining corners. This uses no remote inference or paid model calls. Person boxes include faces, but this is not a dedicated face recognizer; detection and sparse samples can miss subjects or intervening motion.

The answer initially occupies a separate region outside the video. Uncertain, unavailable, stale, slow or fully blocked analysis keeps that disjoint layout rather than claiming a safe corner. Source decoding and inference share a two-second deadline. A valid overlay still displays its sampling limitation. Playing answers dismiss at the end of the sampled ten-second horizon; paused answers dismiss ten seconds after placement settles. Seeking, closing or replacing an answer cancels outstanding work. Touch, scrolling, visual interaction, More focus and screen-reader use retain the answer until manual dismissal. Clarifications, recaps and expanded views are not auto-dismissed. Companion and browser placement are unchanged.

The bundled [YOLOX-Nano model](https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx) is licensed under Apache 2.0 (`server/models/YOLOX-LICENSE`); SHA-256 `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d`. `onnxruntime-node` is pinned to 1.30.0. `SELENE_PLACEMENT_MODEL` may select another local file with the same supported YOLOX tensor contract; unsupported or missing models produce the outside-video layout.

**Historical heuristic-only verification:** 134 Node tests and 20 native Jest tests passed; Vega and Fire OS TypeScript checks and the web build passed. Football Match and The Missing Crown answers visibly settled top-left and top-right in an Android TV emulator. Those results predate semantic detection and the outside-video fallback; they do not verify the new placement path or physical Fire TV/Vega hardware. The Vega Debug package built with the installed W3C media library's compatibility-metadata warning.

## Explicit answer sources and communication preferences

Ordinary typed questions and companion questions explicitly request `answer_mode: "generate"`. Generate bypasses prepared lookup and session-cache reads/writes, even for an exact demo alias. **Prepared example** requests use `answer_mode: "prepared"` and fail with HTTP 409 when no source/time-valid example exists; they never silently call the model. Omitting the field preserves the legacy demo selection behavior. Guided Return always generates its bounded recap. The phone exposes an answer-source selector.

The host adds provenance only after validation: `prepared` / `authored_example`, `generated` / `model`, or `reused` / `session_cache`, with content and timestamp. Prepared provenance also identifies the example and source version. Model-supplied provenance is rejected. Answer surfaces show the source; this is not a quality certificate.

Explicit `communication_preferences` keys (`role`, `style`, `language`, `need`) take precedence over non-neutral legacy controls, a current first-person role declaration, and consented profile or same-question defaults. Neutral explicit keys can reset defaults. Effective preferences flow through assistant skills, private answers, clarification, followed threads and recaps without changing bounded film evidence. Model context contains communication needs, not profile IDs, names, embeddings or ages. Host resolution is verified locally; model adherence is not guaranteed.

## Local SVG / AVG preview

The web answer's **SVG** and **AVG / APL** controls render the same validated explanation; changing renderer does not generate another answer. `server/visual-avg.mjs` converts supported SVG geometry, labels and animation to AVG 1.2 / APL 2024.3. Unsupported semantics report an error rather than silently dropping content. The official `apl-viewhost-web@2024.3.0` WASM runtime runs locally in an opaque-origin, script-only iframe. Only `/apl-preview.html` permits its dynamic wrappers; the main app retains its strict CSP, and the preview blocks network connections. Official LICENSE, NOTICE and THIRD-PARTY files ship with the web build. This local preview is not an Amazon Alexa adapter or deployment to an Echo device.

The pinned package's lifecycle downloader fetches the [official runtime artifact](https://d2o906d8ln7ui1.cloudfront.net/apl-viewhost-web-2024.3.js). If installation scripts were disabled, explicitly approve that download with `npm rebuild apl-viewhost-web --ignore-scripts=false` from `selene/`. The web build rejects missing or changed runtime bytes before writing assets: SHA-256 `e19cc25eb2424bfc6ea60a96aefa93c0b7b31f037462c6a35e4558a5ff13c164` (5,436,184 bytes). An upstream artifact change requires review, not bypassing the check.

Native SVG animation uses composed transform matrices, including skew; reduced motion retains static geometry. Browser verification rendered prepared offside, Alisson and a transform fixture through the official AVG engine, observed changing transform/opacity and a static reduced-motion state, with no remote requests or page errors. Native transform behavior has regression coverage but has not been rechecked on physical hardware.

**Current local verification:** 193 Node tests, 25 native Jest tests, Vega/web and Fire OS TypeScript checks, and the web build passed. Lint completed with three existing warnings. No paid model calls or physical-device verification were performed for this four-gap integration.

Real local relay checks returned a future prepared jump at 15.485 seconds, prepared host provenance at 15.5 seconds, and HTTP 409 at time zero. Actual football placement requests returned explicit outside-video uncertainty in 433 ms (paused) and 1,149 ms (playing); no detector-positive overlay was observed in that API smoke. Arbitrary-title profile resolution preserved the supplied caption/fact evidence, excluded identity data, and honored explicit overrides without a model call.

## HTTPS MP4 import

From the native companion landing screen, select **Import MP4** to open the existing import form directly; **Try the demo** still opens the film player. In the own player, **Films → Import MP4** opens the same form. It has three fields: a direct HTTPS MP4 URL, an optional SRT/WebVTT upload, and a title. Import only footage you have permission to download, process and reuse. A webpage, YouTube URL or protected streaming session is not a media file.

The relay streams the complete MP4 to disk with no application-imposed download-size or video-duration cap, prepares local Vega/browser playback and a literal poster, and builds a merged, caption-backed graph for that movie. It does not capture the TV screen or generate historical frame observations. Allow disk space for both downloaded and prepared video. Successful imports enter the catalog immediately; the existing Selene loader and Cancel remain.

The form uses supplied SRT/WebVTT or supported embedded text subtitles, without automatic transcription charges. Ordinary imported questions send every completed caption through the frozen question time, its caption-established graph, and actual source JPEGs requested at **t−10, −8, −6, −4, −2, +2, +4, +6, +8, +10 seconds** directly to answer generation. Missing or duplicate frames are reported explicitly. After-question images permit ten seconds of visual lookahead, not future dialogue or plot knowledge. Ordinary answers have no second-model semantic veto; pixel interpretations remain provisional. Recaps and followed-thread updates retain their separate text/evidence review.

Requirements: `ffmpeg`/`ffprobe`, Chrome or Chromium for rendered visual inspection, writable `content/` and `assets/media/`, and server-side provider credentials. All AI stages use `AGENT_PROVIDER_MODEL`, currently `openai/gpt-6-luna`: caption graphs, answers/SVG/WAAPI, rendered visual feedback, recap/thread review and optional CLI transcription. No alternate-model fallback is used. The entire transcript is submitted for movie-graph generation without cue-count truncation; upload safety bounds and provider limits remain explicit. New graphs belong only to their movie; existing imports build theirs once in relay memory. No general graph or answer-derived graph store remains.

**Earlier rendered-feedback verification:** 127 Node tests passed. Live OpenRouter/Luna runs for offside, Alisson and an Alisson follow-up each generated a draft, received two visual revisions and rendered all three candidates; elapsed times were 48.1, 47.7 and 44.5 seconds. The follow-up received the prior answer, SVG and visual feedback. All three exhausted the two-turn bound; the final diagrams still had teaching/layout problems. These are historical loop/continuity proofs, not semantic acceptance or a model reliability rate.

Ordinary generated explanations require safe animated SVG. After host validation, the relay renders the same page used by `Visual` in isolated headless Chromium, captures the reduced-motion diagram and three real WAAPI stages with measured target positions, and sends those pixels and measurements to the configured model. It can keep the explanation or return a complete revised response, for at most two feedback turns. Every revision passes source/time/SVG validation and is rendered again before display. At the revision bound, the last valid rendered revision is returned with a session-memory limit marker, not rejected for subjective wording; this does not certify teaching quality. Existing structural repair remains separate. Prepared examples, clarifications, text-only Guided Return and reviewed thread updates retain their separate paths.
Generation uses a free-form 16:9 viewBox, short essential labels and only the purposeful geometry targets needed to teach the answer, without an animation-count quota. Each descriptor lasts 1.5–5 seconds with opacity 0.4–1; supported transforms and SVG resource/security checks remain unchanged. The renderer repeats while the explanation is visible, cancels on page closure or reduced motion, and retains the unanimated reference diagram for reduced motion. Selecting the diagram restarts the cycle.

The generation prompt distinguishes concepts, observed actions, dialogue and relationships; asks for an explanatory change with fixed references and decisive-time conditions; and preserves a meaningful unanimated state. Visual feedback operates on actual rendered pixels, not declared animation descriptors alone; it introduces neither a football-specific validator nor the old ordinary wording veto. The live loop artifacts are `artifacts/agentic-{offside,alisson,alisson-followup}.json` with drafts, feedback, measured stages and final responses, plus matching fullscreen `.html` previews using the actual `Visual` component. Final offside positioning and Alisson links/layout still need human review. Run `npm run test:live -- --visual-quality` for the five cross-intent real-model cases; inspect their starting, decisive and final states and reduced-motion meaning. Passing schema/runtime checks is not proof of teaching quality.

Before the newer five-second/opacity-0.4 bounds, the relaxed contract was exercised with a real offside answer: one model call returned a 1.9-second animation in 17.3 seconds. Actual browser rendering confirmed that motion runs, plus a separate 1600×900 three-keyframe diagram with 280-unit translation, rotation, scale 1.2 and opacity starting at zero. Its three 1.8-second passes finished at 5.4 seconds without a layout veto; selecting the diagram restarted motion. This relaxation was browser-verified, not re-measured on the Vega device.

`artifacts/visual-example.html` is an animation-only fullscreen preview using the actual `Visual` renderer; its iframe occupies the full viewport, with no surrounding answer/title/subtitle. This preview layout does not change the main TV notification layout. `artifacts/visual-example.json` contains the unedited configured-model offside response. The latest rerun generated eight synchronized 3-second animation descriptors and six short labels; browser inspection confirmed all eight remain running beyond ten seconds and reduced motion cancels all eight while preserving the SVG. The animation is still not a verified offside lesson: several targets scale arrows/emphasis rather than demonstrate physical actions, and the opponents’ half is omitted. Typecheck, lint, all 102 tests and web build passed.

### Astra-authored prepared animations

`server/preloaded-answers.json` contains directly authored Astra SVG/WAAPI examples, not outputs of the runtime Luna prompt. Exact question aliases use source-hash and completed-caption checks. A valid prepared hit now precedes imported frame extraction and graph/model work; unsupported questions still use the live pipeline. The retired prepared catalog has been replaced with the two current titles.

The TV's **Prepared examples** menu lists source-valid examples at the sampled moment. Before the first supported interval, it offers the next example with an explicit **Jump to …s** label. Selecting that example waits for the seek, samples the new position and submits the prepared question; no future answer is shown early. Selection uses prepared-compatible presentation preferences without changing saved preferences. Loading and request failures are distinct from an empty list.

| Title / question | Available interval | Explanation |
| --- | --- | --- |
| Football Match / “What is offside?” | 15.485–60 seconds | Side-by-side level/onside versus beyond-both/offside positions; actual balls travel from teammate feet to receiver feet. |
| The Missing Crown / “Who is Alisson and why is he missing?” | 62.678–83.920 seconds | Aldric's brother and Lyra's uncle; empty chair, no invented reason. |
| Same question | 83.920–101.728 seconds | Secret meeting, note handoff to Captain Bren and pointing toward the Chancellor's tower. |
| Same question | 101.728–107.297 seconds | Returned with the true crown; protective motive not yet confirmed. |
| Same question | 107.297–120 seconds | The narration confirms he protected the crown. |

Self-contained fullscreen previews use the actual `web/Visual.tsx` renderer: `artifacts/prepared-offside-rule.html` and `artifacts/prepared-alisson-{empty-chair,secret-meeting,crown-return,protection-revealed}.html`. The illustrations have no slide titles or subtitles; essential actor, relationship and outcome labels remain. Offside uses a distinct goalkeeper glove instead of an extra outfield silhouette, preserving the second-last-opponent comparison. These previews do not enlarge the main TV notification. Current browser checks at 1280×720 verified all five cleaned illustrations and the actual TV menu/selection flows from 0 seconds for both films, including jumps to 15.485 and 62.678 seconds and prepared responses. Earlier animation-stage checks verified pass endpoints, note handoff, crown-carrier travel and reduced-motion cancellation. Typecheck, lint, all 127 Node tests and web build passed. Prepared integration tests cover source changes, spoiler boundaries, authorized seeks, preferences, failures, cancellation and no model calls. No new physical Vega verification is claimed.

**Football Match video:** the catalog ID is `football-match`, with title and scene label **Football Match**. It uses the supplied 60-second `offside_3d/offside.mp4`, copied to `assets/media/football-match/video.mp4`. Its 37 speech-timed cues are embedded in the catalog; the original `offside.srt` and `commentary_script.txt` are retained alongside playback. Its caption graph was generated with `openai/gpt-6-luna` (10 merged nodes, 6 edges). No attribution or license from the previous video is carried over. Browser playback decoded at 1280×720 and advanced; a question window at 20 seconds decoded all ten requested frames.

**The Missing Crown video:** the catalog ID is `the-missing-crown`, titled **The Missing Crown**. The supplied local source is `kingdom_alisson/the_missing_crown.mp4`, with speech-timed `the_missing_crown.srt` and verbatim `narration_script.txt`. Playback and both source text assets are retained under `assets/media/the-missing-crown/`; the script is provenance only, not additional runtime evidence. The film follows a missing royal crown, Princess Lyra, her family, Alisson and Chancellor Voss; explanations use completed captions and this film's caption-backed graph, not manually invented plot facts or another title's evidence. No license or attribution is inferred from the local filename or inherited from the retired Sintel asset. This import does not itself establish live answer quality or physical-device playback.

The two current demo MP4s are local assets, excluded from Git to avoid GitHub's file-size limit. A fresh clone must supply permitted copies at `assets/media/football-match/video.mp4` and `assets/media/the-missing-crown/video.mp4` before demo playback or source-frame questions work. Keep the exact source files matching the catalog provenance; posters, captions and catalog metadata remain versioned. Existing local videos are not deleted.

Fire OS bundles permitted local copies at `fireos/assets/offline/football-match.mp4` and `fireos/assets/offline/the-missing-crown.mp4`. These are also excluded from Git; supply them before building the Fire OS app. Other catalog titles stream from the relay.

Two-film cutover verification: typecheck, lint, 102 Node tests and web build passed. The live catalog contains only `football-match` (60 seconds) and `the-missing-crown` (120 seconds); both video range requests and posters succeeded. The Missing Crown decoded at 1280×720 in the browser with advancing playback and visible captions. Its supplied 58 cues generated a validated per-movie graph with 22 nodes and 23 edges. Split-caption labels require every consecutive source cue and become available only after all cited cues finish. The local phone smoke remains gated by a reachable HTTPS pairing address; no physical-device playback claim.



## September 30: automatic evidence and native assistance

This historical iteration introduced the permitted **Sintel excerpt** using SRT captions and seven sampled frames. The current pipeline above supersedes those stored image observations and the old durable graph behavior. Run `npm run ingest -- --help` for current permitted local/HTTPS import options.

The Vega host reads native caption, screen-reader, high-contrast, UI-scale and audio-description preferences. Explicit caption choices remain under viewer control. “Easy to hear” is now “Slower answer voice”; it changes Selene's optional spoken answer only. Native program assistance and family help remain welcome.

Implementation, import commands, native limits and the household comparison protocol record the actual checks. `npm run evaluate -- evaluation/results-local.json` summarizes anonymous observations of usual assistance versus the same assistance plus Selene. The template contains no fabricated results. This implementation does not add universal third-party screen/audio capture or a Fire OS build.

The imported Sintel frames used `google/gemini-2.5-flash`. The relay reads the answer model from local configuration; restart it after server changes. Earlier model checks exercised phone and shared-TV request paths, which do not establish a paired physical-device result. See current verification for the exact content and device evidence.

## Companion UI: September 20, 2026

Select a playback tile, then type one question or choose a quick question. Scene detail belongs in that same field. Preferences are optional and remember only explicit selections. Playback lists show three sessions per page; secondary response actions are under More. The Fire TV styling and original SELENE mark are documented in [DESIGN.md](../DESIGN.md).

See the screenshot review and current blockers. The web UI was checked at TV sizes with clearly labelled test fixtures. No Vega device was connected for this pass. Live model checks exposed grounding/visual errors; passing the code suites does not establish production readiness.

## Companion code review: September 19, 2026

The companion uses native provider discovery, a fixed moment snapshot, a separate companion relay session, the real explanation agent, and explicit playback controls. Code checks cover notification/cancellation races, clarification, voice consent, graph citations, HTTP scene-source boundaries and private-mirror revocation. See the review and remaining production gates. No app, browser or device interaction is part of this review.

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

For a one-command manual session using the existing debug package, run:

```sh
npm run vega:manual
```

This starts the 1280x720 VDA, starts the local relay if needed, installs `build/aarch64-debug/selene_aarch64.vpkg`, and launches SELENE. Rebuild first if the package or web assets changed. Press Ctrl+C to stop the session.

For TV plus phone pairing against the deployed demo, point the Vega package at its Lightsail HTTPS URL, then launch it:

```sh
SELENE_APP_URL=https://selene-phone-demo-v2.yyaex8bhyrtby.us-east-1.cs.amazonlightsail.com npm run build:web
npm run build:debug
npm run vega:manual:phone
```

The manual command sees the HTTPS URL in `src/config.json` and skips ngrok. To pair against a local relay instead, configure and authenticate ngrok (`brew install ngrok`, then `ngrok config add-authtoken <your-token>`); the command starts a temporary HTTPS tunnel. Scan the code shown on the TV and stop with Ctrl+C.

### AWS deployment status

As of October 11, 2026, the SELENE relay is running as the Lightsail container service `selene-phone-demo-v2` in `us-east-1`, deployment 12, with the refreshed prepared examples and wider compact TV diagram: [deployed relay](https://selene-phone-demo-v2.yyaex8bhyrtby.us-east-1.cs.amazonlightsail.com/). An Amazon EventBridge Scheduler schedule invokes an AWS Lambda function that calls `/api/health` on this relay and receives HTTP 200. Conversation timing still uses the process-local scheduler in `server/conversation-scheduler.mjs`. The health response reports `provider_configured: true` and `scene_context_configured: false`.

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

Historical launcher-only checks passed on October 2 at 08:01 and 08:02 WIB: first result, repeat result. Both captured screenshots and verified different focused element IDs after remote Down. An earlier overlapping run correctly refused an occupied Appium port; run only one device test at a time.

This is an automation check only. Diagnose recap generation independently; combine the two only after each passes. A launcher pass does not establish SELENE feature reliability or physical-TV playback performance.

For the full shared-TV flow, build the Debug package and start the relay, then run `npm run vega:automation -- --feature the-missing-crown`. This reuses the baseline, closes only SELENE, installs the local aarch64 Debug package and verifies preference persistence, Hold, a nonempty Guided Return, continuing TV time, dismissal and remote play/pause. It calls the live model. Reports include media/catalog/web/package hashes under `artifacts/vega-feature/`. Use `--feature football-match` for the other catalog film. See the verification guide for prerequisites and limits; previous title runs remain historical.

The relay reads `AGENT_PROVIDER_URL`, `AGENT_PROVIDER_MODEL`, and `AGENT_PROVIDER_API_KEY` from `../.env`. Provider requests use the actual HTTPS endpoint with strict structured outputs and function calls. Credentials never enter the TV bundle or Chromium process environment. Set `SELENE_CHROMIUM_PATH` if Chrome/Chromium is not installed at a recognized macOS/Linux path; missing browser or render/provider failures remain explicit. The Docker image includes Chromium and its sandbox helper and runs as a non-root user; its host must support Chromium's sandbox. Local Docker Desktop builds succeeded, but browser startup failed: the emulated amd64 image failed Chromium's SSE3 check, and native arm64 failed namespace creation with `Operation not permitted`. No sandbox bypass or extra container capability was enabled. Review [Puppeteer's container prerequisites](https://pptr.dev/guides/docker) before deployment; the documented `SYS_ADMIN` capability broadens privileges and needs an explicit deployment security decision. Use an init process to reap browser children. Ordinary generated explanations have a three-minute deadline for generation, rendering and bounded feedback; reviewed recap/thread paths retain their shorter deadlines. Optional `SELENE_PORT`, `SELENE_BIND`, `SELENE_APP_URL`, `SELENE_MEDIA_ORIGIN` and `SELENE_PRIVATE_URL` configure the relay; changing the app URL requires a new web/native build. Remote relay and media origins require HTTPS. Set `SELENE_MEDIA_ORIGIN` to a trusted HTTPS host when testing Vega playback. The local relay must remain running; the TV package is not an offline model server.

The TV welcome surface exposes Watch and Films; Films opens one compact list. In Ask Selene, Prepared examples lists only title-matched, source-checked demonstration questions already available at the frozen moment. Retired title examples are not offered for current films. A prepared answer is a demonstration path, not proof of live generation quality. Ordinary answers keep an animated SVG; Guided Return requests a short text recap and grounding review to avoid a full SVG generation delaying catch-up.

The own player includes **Personal Pause and Guided Return**: open Selene tools, pair a phone with the six-digit code, then ask privately while the film stays on the TV. The phone shows an animated SVG, a short explanation and a verbatim caption when available. The first Send saves the TV sample; Catch me up covers that point through its captured tap-time sample. Optional Follow thread keeps one chosen question current using reviewed new evidence. Hold our place / Bring us back uses the same operation for a family conversation. See implementation, current verification and remaining device gates. See current verification for separate VDA and phone results.

Set `SELENE_PRIVATE_URL` to a reachable HTTPS URL for the relay and configure its proxy. Codes expire after five minutes and are single-use. Re-pairing revokes the previous viewer; closing a normal TV answer does not disconnect the phone. The separate third-party companion retains answer mirroring only, including explicit phone-local Read aloud. No source media access is inferred from provider metadata.

The default relay is for one trusted TV on loopback. Same-origin checks and random session IDs do not authenticate a public client. The phone proxy now needs static/permitted media, code exchange and token-scoped caption, stream and personal-action routes. Follow the exact route list; keep TV model/session-owner routes private. Public multi-household hosting still requires authenticated device access and usage limits at the deployment boundary.

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

`npm run release` includes typecheck, lint, Node checks, and both web and native builds. `npm exec -- jest --runInBand` additionally checks native React fallback rendering in memory. `test:live` calls the real configured model for The Missing Crown at 27 seconds: explanation, spoiler boundary and Indonesian translation. `--companion` uses explicitly synthetic provider metadata and viewer detail; it cannot verify another streaming app or device rendering. `--ingested` exercises completed Missing Crown captions and its movie graph at 13 seconds, then a fresh ten-image source window at 40.5 seconds. `--visual-quality` spans both current films. These are runnable checks, not newly observed passes or evidence of household benefit. Deterministic tests isolate external/native boundaries; live checks use the configured provider.

Production reads sorted JSON files from `content/` and defaults to the first film (`football-match`). `SELENE_CONTENT_ROOT` selects an isolated catalog root. `npm test` preloads `test/bootstrap.mjs`, which selects `test/fixtures/content/` (the authored `00-story.json` regression default plus the production Football Match symlink). Run a direct isolated subset with `node --import ./test/bootstrap.mjs --test test/<name>.test.mjs`. Do not preload that fixture bootstrap for live checks or production-catalog checks.

Then exercise the installed device: D-pad and Back, actual playback and captions, compact/full visuals, microphone and read-aloud availability, mute restoration, background/return, clarification, cancellation, provider failures. Browser speech APIs are capability-gated and still need verification on the target Vega WebView; remote request choices and keyboard input remain available without them.

## Memory and privacy

Original captions and authored facts live in each content package. Imported caption graphs are provisional AI interpretations backed by those original cues, not generated-answer memory; new imports persist them only with their own movie. Existing imports generate their graph once in relay memory. There is no cross-title general graph. Ordinary imported answers bypass exact-response reuse so each question gets fresh source images; other session response reuse remains bounded. Temporary JPEG files are deleted, but their pixels are transmitted to the configured answer and review providers. Raw image bytes are excluded from runtime JSON, logs, response caches and catalog graphs. Questions and family conversations are not persisted to disk. Explicit voice requests may use the browser's speech service.

Third-party metadata stays on device during discovery. Sending a question submits the selected identity/time, request and explicitly supplied scene detail to the relay/model. If `SELENE_SCENE_CONTEXT_URL` points to an authorized HTTPS scene service, the relay accepts only bounded data matching the provider, catalog, content and exact sampled time. Viewer accounts remain labeled as such and never become validated graph facts. The companion does not claim control of another app's microphone, narration, captions or audio focus. Browser voice requires a fresh reported pause and a live provider subscription; resumed or unknown playback stops voice. Closing/backgrounding releases the subscription.

The app does not enable proactive recommendations, continuous narration, automatic family recording, or direct TV headset routing. An explicit private mirror can stream a response to a reachable phone/tablet, where the viewer may use a connected headset. The own-player registers the documented Vega PlayerSession callbacks for playback voice commands and reports browser playback/audio-focus state; the WebView still falls back to remote/D-pad input when browser speech is unavailable. Fire OS, live Alexa+ access and direct third-party overlays remain later platform work. An optional, disabled-by-default MCP developer experiment calls the same private actions using a paired-viewer capability; it is not an Alexa+ integration. The authored Offside Practice fixture is available as a second own-player content package; a sports app that exposes a session can still use the companion's viewer-detail flow without a hardcoded play claim.

UI rebuilds retain the native address in `src/config.json`. Set `SELENE_APP_URL` explicitly when changing between a local relay and the HTTPS demo.

### Deploy the UI and server together

Run `npm run build:web`, then `docker build --platform linux/amd64 -t selene:demo .`. The checked-in Dockerfile copies the entire server, content and generated assets from the same checkout. Do not update only `assets/` inside an older image: private phone request contracts change alongside the UI.

After deployment, run `node scripts/check-phone-contract.mjs https://YOUR-SELENE-HOST`. This uses a temporary current-catalog session to verify pairing, saving an ended-film timestamp and closing its branch without a model call. It does not establish device playback or answer quality.
