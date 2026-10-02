# Vega verification

## 3 October 2026, compact TV follow-up

| Check | Current evidence |
| --- | --- |
| Code checks | 86/86 Node tests, 4/4 native Jest tests, typecheck, lint, web build and diff whitespace checks pass. |
| Compact tools and movie switching | Saved and Clear share a row. One Films action opens the title list; individual film actions are absent from the welcome surface. Controller checks cover the list, saved row and frozen example timestamp. The latest VDA screenshots verify the movie chooser and same-row Saved/Clear controls. |
| Prepared TV examples | All six source-checked examples work on the own-player TV. One Prepared examples button reveals only eligible questions for the selected title and frozen moment. Story/evidence hashes, time windows, cancellation and schema/SVG validation remain enforced. Slower read-aloud does not invalidate a prepared answer. These are demonstration answers, not live generation. |
| Wider SVG | TV diagram area is 160 by 90 px, with a landscape crop. Finite WAAPI animations and reduced-motion handling remain. |
| Life Connection | Removed from active web screens, request/response/review contracts, private route, model instructions and current product docs. Historical research is not a supported feature list. |
| Bring us back diagnosis | Previous records showed generation timeouts and unsupported-claim rejections, not a broken button. Return generation now requests bounded text without generated SVG, with a 1024-token ceiling and a separate 512-token grounding review. Original-caption fallback remains explicitly unavailable and preserves retry. Ordinary explanations still include animated SVG. |
| Real provider, three stories | Reviewed returns passed for Red Kite 0:08 to 0:34 (3.5 s), Sintel 0:20 to 0:36 (3.6 s) and Offside 0:20 to 0:45 (3.1 s). [Exact results](evidence/compact-tv-2026-10-03/live-return-results.json). These are direct server/model checks, not device playback results or a reliability benchmark. |
| Deployment and VDA | Lightsail deployment 9 is active. [Latest Red Kite VDA flow](evidence/vega-feature/2026-10-02T18-13-13.747Z/result.json) passed: clean entry, movie chooser, prepared TV answer with wider SVG, no Life Connection, Hold, reviewed recap, playback under the recap, dismissal and one-press remote pause/resume. Served assets and native package hashes remained unchanged. Phone and physical hardware were not tested in this run. |

The latest Red Kite return covered 0:35 to 1:01 while the displayed TV position advanced from 1:05 to 1:07. [Saved controls on one row](evidence/vega-feature/2026-10-02T18-13-13.747Z/saved-tools.png), [prepared answer with wider SVG](evidence/vega-feature/2026-10-02T18-13-13.747Z/prepared-answer.png), [recap while playback advances](evidence/vega-feature/2026-10-02T18-13-13.747Z/return-advancing.png). This is one successful current-build device flow, not a statistical reliability or all-story VDA certification.

Automation uses the installed driver's 100 ms remote tap. The earlier 50 ms run failed at the examples toggle; the 100 ms run opened it. A subsequent failure showed Chromium accessibility IDs changing between reading a button and setting focus. The shared click helper now refreshes focus against the current button for at most five seconds and sends OK only after focus is confirmed. It never retries an OK action. Saved tools are reached using normal D-pad input, keeping the quiet saved control's Return action intact. Earlier failed attempts remain in their dated artifact folders.

The following October 2 results are historical and describe the previous build.

Updated: 3 October 2026, Asia/Jakarta. This is the current verification record. Historical tables elsewhere describe their dated runs only.

## Latest compact UI revision, 2 October 2026, 23:59 WIB

The current revision ships the web UI and the complete server together in the checked-in Dockerfile. The previous image omitted newer private-action modules: pairing could succeed while the new phone's saved-moment request was rejected by an older contract. Deployment 6 fixed that mismatch. Deployment 7 is active and additionally supplies a labeled original-caption fallback when AI recap generation or review fails. A fallback remains `unavailable`, retains the saved marker for retry, and never publishes rejected model text as a successful recap.

| Check | Current evidence and limits |
| --- | --- |
| Compact TV UI | Smaller first-launch copy and buttons; one primary Watch action and a compact three-story row; attribution moved to Credits. Obsolete age, language, family and answer-style menus removed. Playback controls and available slower read-aloud remain. [Actual Sintel picker](evidence/vega-feature/2026-10-02T16-41-15.180Z/selected.png). |
| Known developer notices | Entry point filters the SDK's known deprecation/debug banners in LogBox; console diagnostics and error overlays remain. This does not repair Amazon's upstream deprecated API. The [23:56 VDA run](evidence/vega-feature/2026-10-02T16-56-48.718Z/result.json) records `cleanEntry: true`; its [entry screenshot](evidence/vega-feature/2026-10-02T16-56-48.718Z/entry.png) visibly contains no notice banners. |
| Quiet control and loading | Real VDA screenshots show a logo-only control with a saved-place dot and a single animated loader. [Quiet control](evidence/vega-feature/2026-10-02T16-41-15.180Z/held.png), [loader](evidence/vega-feature/2026-10-02T16-41-15.180Z/preparing-return.png). Existing SVG explanations retain finite WAAPI animations and reduced-motion support. |
| Shared-TV Guided Return | [23:21 run](evidence/vega-feature/2026-10-02T16-21-40.863Z/result.json) passed: recap 0:10 to 0:33, TV 0:41 to 0:43 under the card, dismissal and remote pause/resume. A later [23:41 run](evidence/vega-feature/2026-10-02T16-41-15.180Z/result.json) failed: server recorded `grounding/unsupported_claim`. This is an intermittent model-review failure, not a launch or media-decode failure. The final [23:56 run on deployment 7](evidence/vega-feature/2026-10-02T16-56-48.718Z/result.json) encountered a separate `generation_provider/timeout` at 30 seconds. The [real VDA fallback](evidence/vega-feature/2026-10-02T16-56-48.718Z/failure.png) correctly showed the original caption “Hey, sit still.” from 0:25, labeled Recap unavailable, requested 0:09 to 0:32, TV 1:00. The runner deliberately marks that result failed, not a reviewed recap pass. Overall recap reliability is not established. |
| Phone pairing and live updates | [23:34 VDA pairing](evidence/vega-feature/2026-10-02T16-34-53.101Z/result.json) plus Chrome at 390x844 connected over the deployed HTTPS origin and received live TV position updates. Physical handset not tested. |
| Prepared phone example 5 | Selected Red Kite 0:50, asked “Why did Arun keep the old kite?”, and received prepared source-bound text, SVG and original caption. No saved-moment error at the ended TV position 1:36. [Phone screenshot](evidence/compact-phone-explanation.png). The prepared answer does not establish live model quality or thread relevance. |
| Ended film and retry protection | Local regressions prove TV answers/returns do not restart an ended film; failed returns preserve their saved marker. The deployed model-free phone-contract smoke passed on deployment 7: pairing, exact ended-film hold and branch close. |
| Local verification | Typecheck, lint, 83 Node tests, three native Jest tests, web build and `git diff --check` pass. Current Debug packages built for aarch64, armv7 and x86_64. Caption-fallback regressions cover provider, JSON, schema, word-limit and grounding failures, including absence of an eligible caption. |
| Sintel refusal about Arun and Maya | Correct behavior. Those characters are in Red Kite, not Sintel. Do not substitute the prepared Red Kite answer into a Sintel context. |
| Not established | Physical Vega TV/phone behavior, audio smoothness, current Release UI, all-story reliability, every timing edge and live Follow thread relevance. Optional MCP remains disabled; no Alexa+ client was tested. |

See [implementation](personal-pause.md) and [optional MCP operation](mcp.md). `npm run vega:manual:phone` uses the configured HTTPS `src/config.json` origin directly. Deployment or restart expires existing pairing sessions; create a fresh code. `npm run build:web` now retains the configured native relay unless `SELENE_APP_URL` explicitly overrides it; a runnable build-and-assert check confirmed the HTTPS origin survives an ordinary rebuild. An intermediate final-run attempt stopped at preflight because an earlier rebuild had reset that origin to an unavailable local relay. It did not reach product behavior.

## Scope and fixed environment

Keep the React Native host and WebView player. Enable DOM storage on both native WebViews. Keep Vega capability names, supported by the installed driver; its Kepler aliases are deprecated. No player migration, SDK upgrade, re-encoding, hosting or new dependency is part of this change.

Node 22.17.0, Appium 2.2.2, Vega driver 3.34.1, SDK 0.24.12112, explicit `vda://emulator-5554`, 1280x720, software graphics. A second transport or another Appium server must not be silently reused. Run only one device test at a time.

## Local checks, without Vega

```sh
npm run typecheck
npm run lint
npm test
npx --no-install jest --runInBand
npm run build:web
```

These checks do not control a device or call the live answer model. The relay tests use a temporary local server with mock remote services.

## Later device check

Build the native package with `npm run build:debug`. Keep `npm run vega:vvd` and `npm start` running in separate terminals. Wait for the VDA to finish booting and for its shell to respond, then:

```sh
npm run vega:automation
npm run vega:automation -- --feature sintel-excerpt
npm run vega:automation -- --feature offside-rule
```

No arguments runs the launcher baseline only. Feature mode closes SELENE, verifies the launcher baseline, checks the relay, installs the local Debug package and opens the chosen catalog title. It calls the real configured model. It records native package, local web bundle, stylesheet, catalog and video hashes. Before installation and after the flow, it compares the relay's story version and streamed asset bytes against the local inputs. A stale relay must be restarted; it is not silently treated as the current build. Local hashes are checked again after the flow. Do not edit or rebuild during a run. An altered clip with the same display title is a different media result.

The runner writes `result.json` before starting and checkpoints the feature step. A `running` record with no finish time, or an older folder without a result file, is incomplete. Neither is a pass. This preserves the last step if the process is forcibly stopped; it does not promise cleanup after an external process kill.

Appium focuses the element through the driver's JSON-RPC interface, verifies focus in the UI tree, then sends a 50 ms remote OK tap. The generic `press_keycode` command holds for 1000 ms and can repeat Enter into the next screen. Its generic click instead taps a coordinate and does not report interception. Source selectors resolve actionable elements; picker text cannot count as the currently selected title. Known SDK/debug notice banners are filtered at entry. If a warning panel still appears, the runner dismisses and records it instead of mistaking it for the player.

The feature check requires preference persistence after recreating the WebView, a saved marker, a reviewed nonempty recap interval, increasing TV time while that recap remains visible, dismissal and single-press remote pause/resume. Fallbacks, a finished clip and expired waits are failures, not feature passes. Screenshots, source XML, Appium/device logs and result JSON remain in a dated artifact folder. This TV flow does not certify phone pairing, human comprehension, audio quality or physical-device performance.

## Playback and control diagnostics

`web/mediaDiagnostics.ts` observes startup and sparse lifecycle events before and after the first playing event. It records content ID, media error code and redacted message, position, ready/network state, buffered ranges, frame counters, video dimensions, playback rate and advisory MP4 support. It excludes questions, URL credentials and pairing tokens. `canPlayType` is a hint, not successful decoding of this bitstream. Buffered ranges and frame counters help separate lack of buffered data from lack of frame progress; neither proves the root cause alone. There is no per-frame logging, periodic polling, playback retry or seeking in this observer.

Vega 0.24 message events omit `nativeEvent.url` on this VDA even though the TypeScript interface requires it. Both WebViews now use only their last completed, trusted native load URL when that field is absent, clear it on navigation/error/close, and reject explicit foreign URLs. Regression checks cover both components. Previously this mismatch silently discarded valid native bridge messages.

Control records label `media-session`, `player-session` and `keyboard`. Their coexistence does not by itself prove duplicate delivery. Compare one remote input with resulting control records and actual pause/resume transitions before deleting any route. Provider discovery in `src/Companion.tsx` remains a separate consumer for other apps.

Use Appium for native UI, `loggingctl log --follow --vpkg com.selene.tv` for the app log, and the documented port 9229 DevTools endpoint for Debug WebView inspection when available. The console helper `scripts/measure-playback.js` now catches pre-play startup failure as well as a separate ten-second progress sample. It reports waiting events and frame counters, not perceived audio quality. An unavailable DevTools endpoint does not justify changing the player architecture.

## Earlier VDA results (historical)

The 2 October device pass used Vega VDA at 1280x720 with the pinned SDK and Appium setup. Red Kite, Sintel and Offside each completed the shared-TV flow against verified unchanged builds. Offside requires a new constrained-baseline 24 fps encode. Its VDA feature flow now passes, but software-rendered VDA still drops frames. A clean Release build was produced for aarch64, armv7 and x86_64. Physical-device performance and the public HTTPS phone stream remain unverified.

| Original finding | Implementation | Verification and remaining limits |
| --- | --- | --- |
| WebView storage | Enabled on both native WebViews. | VDA preference survived own-player WebView recreation. Caption persistence, device restart and the external-provider WebView's storage were not separately exercised. |
| Pinned automation | Reused Node 22.17.0, Appium 2.2.2, driver 3.34.1, SDK 0.24.12112 and 720p. | Launcher screenshot and remote focus change passed in the completed runs below. |
| Vega versus Kepler capabilities | Retained Vega names. | Installed driver 3.34.1 deprecates Kepler aliases. No migration needed. |
| Repeatable Selene feature test | Added shared-TV flow to the existing runner, verified focus with short remote taps, asset identity checks and incomplete-run checkpoints. Fixed its return-time parser to read the live nested time label rather than a stale parent label. | [Red Kite](evidence/vega-feature/2026-10-02T08-02-28.473Z/result.json), [Sintel](evidence/vega-feature/2026-10-02T08-22-35.500Z/result.json) and [Offside](evidence/vega-feature/2026-10-02T08-27-42.761Z/result.json) now pass shared-TV checks, including unchanged-build validation. |
| Offside playback diagnostics | Added startup/lifecycle records and native bridge forwarding; expanded buffered/frame details. Re-encoded the permitted clip to H.264 Constrained Baseline, 960x540, 24 fps, yuv420p, AAC-LC, and updated the catalog to that tested asset. | Original High Profile clip stalled after three frames despite full buffering. The new [VDA run](evidence/vega-feature/2026-10-02T08-27-42.761Z/result.json) advanced from the saved point and passed Guided Return. VDA logs still show dropped frames (219 of 903 observed), so smoothness requires hardware measurement. |
| Media control overlap | Trace keyboard, Media Session and native PlayerSession callbacks. Retain existing controls. | Sampled pause/resume keys reached the keyboard route and stayed paused/resumed. Other remote/voice/provider paths remain unverified. |
| Status documentation | README and Personal Pause now point to this dated record. | Historical results remain historical; this table replaces the unfinished placeholder. |
| Native player replacement | Deferred. | No verified WebView limitation currently justifies the migration. |
| Narration-source deletions | The removed `video/the-red-kite` authoring folder is not used by the runtime app. Updated `scripts/narrate.py` to put generated audio under `assets/media/the-red-kite/narration`. | Python syntax check passed. The deleted authoring material cannot be rebuilt from this checkout; confirm that its removal is intended before committing. |
| Demo hosting | Deployed to Lightsail, deployment version 4 active. | HTTPS health, catalog, static bundle parity, and phone/API smoke passed. This is a single-process hackathon demo, not production validation. Sessions, phone tokens, pairing codes, and join-rate limits are process-memory state. |

| Evidence from 2 October 2026 (WIB) | Result |
| --- | --- |
| [15:02 Red Kite VDA run](evidence/vega-feature/2026-10-02T08-02-28.473Z/result.json) | Full shared-TV flow passed on the unchanged, hash-verified build. Preferences persisted, Hold saved, recap covered 0:08 to 0:26, displayed TV advanced from 0:30 to 0:34 while the recap remained visible, dismissal worked, and remote pause/resume worked. |
| [15:22 Sintel VDA run](evidence/vega-feature/2026-10-02T08-22-35.500Z/result.json) | Clean overall pass. Preferences persisted, Hold saved, recap covered 0:09 to 0:32, TV advanced from 0:42 to 0:44 under the recap, dismissal and remote pause/resume worked, and served/build hashes remained unchanged. |
| [15:28 Offside VDA run](evidence/vega-feature/2026-10-02T08-27-42.761Z/result.json) | Pass using the new baseline-profile encode. Recap covered 0:07 to 0:25; TV advanced from 0:29 to 0:30 under it; dismissal, remote pause/resume and unchanged-build checks passed. VDA software rendering dropped frames during playback. |
| Earlier [Offside original-encode attempt](evidence/vega-feature/2026-10-02T08-24-35.737Z/result.json) | Initially timed out because the runner read a stale accessibility label. The screenshot showed advancing TV time; the diagnostic log recorded 903 frames with 219 dropped. The parser was corrected and a passing run followed. |
| Phone-sized browser checks | Personal Pause replay was muted by default, its replay timeline advanced independently, Guided Return used the saved personal interval, and Back to TV reset the personal view for Red Kite and Sintel. Offside fallback behaved correctly. These checks used a 390x844 desktop browser, not a physical phone. Local SSE delivered both the initial `personal` event and a live `playback` update. Over two quick HTTPS tunnels, pairing/code exchange and HTTP 200 succeeded, but the SSE stream delivered no event within 20 seconds. This isolates the observed failure to the temporary public tunnel path; a stable HTTPS host still needs testing. |
| [14:18 earlier Sintel run](evidence/vega-feature/2026-10-02T07-18-16.635Z/result.json) | Historical. Launcher, preference persistence, Hold, Guided Return, dismissal and remote pause/resume completed. Recap covered 0:10 to 0:33; displayed TV position advanced from 0:46 to 0:49 underneath it. The run overlapped a web rebuild, so its recorded local web hash cannot certify the exact served bundle. |
| [14:22 earlier Offside run](evidence/vega-feature/2026-10-02T07-22-28.671Z/result.json) | Historical preliminary failure. The newer Offside run above verifies served asset identity and adds frame/buffer diagnostics. |
| 14:27 final repeat (`artifacts/vega-feature/2026-10-02T07-27-12.653Z/`, local output) | Incomplete. Captures reach the held state; there is no final result JSON. Not a pass. |
| Native bridge regression | Actual VDA omitted message URL; fallback to a completed trusted load was implemented in both components. Local checks reject foreign URLs and clear trust on navigation/close. |
| Local code and Release checks | `npm run release` passed typecheck, lint, 69 Node tests, and built valid Release packages for aarch64, armv7 and x86_64. Manifest validation passed; Vega emitted a nonfatal missing-icon warning. `scripts/narrate.py` syntax and `git diff --check` passed. |
| Release VDA smoke | The aarch64 Release package installed, and Vega reported the app running. QMP captures were black, so the Release UI itself is not visually verified. Feature passes above used the Debug package. |
| Phone, physical Fire TV, sound quality and 1080p | A 390x844 desktop browser exercised the phone flow for three titles; no physical handset, physical Fire TV, sound-quality check or 1080p run was performed. |
| WebView DevTools | Port 9229 did not return a usable endpoint in the earlier attempt. The console measurement helper was not run on the VDA; native lifecycle logs were captured instead. |

The baseline-profile 24 fps encode resolves the reproducible Offside VDA frame stall sufficiently for the feature flow, but the test changed profile, frame rate and encoder settings together, so it does not isolate which exact bitstream property caused the original failure. Do not generalize this encode as a device-wide playback fix until it is checked on physical Vega hardware. Audio quality still requires listening on appropriate hardware.

## Production gates

The Release packages build and pass Vega manifest/ABI validation, but a QMP screenshot of the Release app was black in an earlier run. A previous launcher attempt was black with an empty Appium tree. The latest compact-UI runs subsequently passed launcher screenshot and remote-focus checks. Current Debug UI is observable; the earlier Release capture still does not establish Release UI behavior.

The relay is intentionally a small, single-process prototype: session and pairing state are in memory, so a restart invalidates active sessions and multiple replicas do not share streams or rate limits. The Lightsail demo has a stable TLS endpoint and the phone browser smoke passed, but there was no physical handset/Vega end-to-end run and no production reliability, load, privacy, or recovery review. Multiple replicas would require shared session, pub/sub and rate-limit state or guaranteed single-instance routing.

The removed Red Kite authoring directory is not referenced by the runtime app, which uses `assets/media/the-red-kite.mp4` and `content/story.json`. One remaining script reference was repaired. Its source artwork and authoring files are not recoverable from this working tree unless the deletions are restored from source control; their removal intent is still unknown.

## Native-player decision

1. Recommended: retain the current player, use the tested Offside encode for the demo, and verify playback plus audio on physical Vega hardware.
2. Conditional: replace the TV playback layer only after a reproducible WebView limitation establishes that need. Such a migration must reconnect timing, captions, audio focus, relay snapshots and return behavior; it grants no access to another app's protected stream.

## Platform references

- [WebView properties, including DOM storage](https://developer.amazon.com/docs/vega-api/0.24/webview-component-reference)
- [WebView media controls and Debug DevTools](https://developer.amazon.com/docs/vega/0.24/develop-your-app-with-webview)
