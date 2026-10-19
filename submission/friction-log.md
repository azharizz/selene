# Selene: developer friction log

Each entry was hit while building Selene. Every workaround below is in this repository. Where a script is named, it is the evidence.

**Environment:** macOS 15 on Apple Silicon · Vega SDK 0.24.12112 · Vega CLI 1.3.4 · Vega Virtual Device (VVD), TV image · Node 22.17 · `@amazon-devices/appium-vega-driver`

**Severity:** 🔴 High = blocked a core feature or a whole workflow · 🟠 Medium = cost hours, workaround found · 🟡 Low = papercut

---

### 1. App launches, then is torn down with a misleading power-session error 🔴
- **Task:** Run Selene's WebView UI on the VVD against a local dev server.
- **Steps:** Set the app URL to `http://127.0.0.1:<port>` (allowed by `manifest.toml`'s network-traffic-policy), installed the debug `.vpkg`, launched it.
- **Expected:** The WebView loads the local page.
- **Actual:** The app closed right after launch. The only log was `Unable to create power components ... has display power session = false`. The real cause: `127.0.0.1` is the guest's loopback, not the host's, so the page never loaded. No log says the WebView failed to load.
- **Workaround:** Run `vda reverse tcp:<port> tcp:<port>` before every launch (`scripts/vega-run.sh`).
- **Suggestion:** Log WebView load failures with the URL. Document that the VVD's loopback is the guest's own. Have `vega` offer the reverse forward automatically when a manifest allows localhost.

### 2. W3C VideoPlayer can't play from the local relay; WebView video stalls on the VVD 🔴
- **Task:** Play the demo films in the Vega app from the dev relay on `127.0.0.1`.
- **Steps:** Loaded the film URL into `@amazon-devices/react-native-w3cmedia` `VideoPlayer` (URL mode), then tried playing it inside a WebView.
- **Expected:** The video plays in either mode.
- **Actual:** URL mode can't fetch the loopback relay (`media error 4`). In the WebView, the decoder stalled after three to five frames on the VVD.
- **Workaround:** Dropped the WebView for video. The app fetches fragmented `video-v.mp4` / `video-a.mp4` tracks itself and appends them through MSE, reading the codec string from the init segment. Ingest writes those tracks next to every film (`src/media.ts`, `DESIGN.md`).
- **Suggestion:** Let `VideoPlayer` URL mode reach a forwarded loopback, or return a specific error that says why. Document the supported way to play local or dev-server media on the VVD.

### 3. No way to take a screenshot on Vega OS 🟠
- **Task:** Capture VVD screenshots for automated UI checks and the demo.
- **Steps:** Tried `screencap` (the Android habit), then the on-device `screenshooter` / `gwsi-tool-screenshooter`.
- **Expected:** A PNG of the screen.
- **Actual:** `screencap` doesn't exist on Vega OS, so we got a 0-byte file. `screenshooter` needs a 1920×1080×4 = 8,294,400 B Wayland shm buffer, but `/dev/shm` on the VVD is capped at 5 MiB. The allocation fails with `Permission denied` and it writes a 0-byte PNG, with no clear error.
- **Workaround:** Capture host-side through QEMU QMP `screendump` on the VVD's QMP socket (`scripts/vega-screenshot.sh`).
- **Suggestion:** Add `vega device screenshot`, or raise the VVD's `/dev/shm` limit so the shipped tool works. Document the supported method.

### 4. VVD crashes on Apple Silicon with GPU acceleration 🟠
- **Task:** Start the Vega Virtual Device on a Mac (AArch64).
- **Steps:** `virtualdevice create-and-launch` with default rendering.
- **Expected:** The emulator starts and renders.
- **Actual:** The bundled host Vulkan/GL renderer crashed on Mac AArch64.
- **Workaround:** Launch with `--gl-accel-off` (software rendering) at 1280×720 to keep it usable (`scripts/start-vega-vvd.sh`).
- **Suggestion:** Fix the host renderer on Apple Silicon. Until then, detect it and fall back to software rendering automatically, and put the flag in the VVD troubleshooting docs.

### 5. A11y module autolink breaks the build 🟠
- **Task:** Build the Vega app with `react-native build-vega`.
- **Steps:** Installed dependencies and ran a Debug/Release build.
- **Expected:** A clean build.
- **Actual:** `@amazon-devices/kepler-a11y-settings-interface-turbo` ships `react-native.config.js` with `linkDynamic: true`, which our build could not use as shipped.
- **Workaround:** A `prebuild` script patches `node_modules` to `linkDynamic: false`, and refuses to build if the config shape changes (`scripts/fix-vega-a11y-autolink.mjs`).
- **Suggestion:** Ship the module with a link mode that works under `build-vega` by default, or document the required setting.

### 6. Appium Vega driver: unclear session setup, server crash, undeclared Node range 🟠
- **Task:** Automate launcher and feature checks on the VVD with Appium 2.2.2 + `@amazon-devices/appium-vega-driver`.
- **Steps:** Started a session with `platformName: Vega`, `appium:automationName: Vega`, `vega:device: vda://default`, then retried with `automation-toolkit/JSON-RPC`. `npm` ran the automation under the system Node (26).
- **Expected:** A session starts with the documented capabilities.
- **Actual:**
  - `automationName: Vega` failed with `Could not find a driver for automationName 'Vega' and platformName 'Vega'`.
  - With `automation-toolkit/JSON-RPC`, a session was created, then the whole Appium server died with `UnhandledPromiseRejection ... The promise rejected with the reason "undefined"`. The driver's bundled BaseDriver (8.2.4) didn't match Appium's (9.18.0).
  - Appium and its children also had to run on Node 22, and the driver doesn't declare a supported Node range.
- **Workaround:** Pinned capabilities (`Vega`, `automation-toolkit/JSON-RPC`, explicit `vda://emulator-5554`). The script re-executes itself under Node 22.17 and refuses to reuse or kill another Appium process (`scripts/vega-automation.mjs`, log in `artifacts/appium-selene-vda.log`).
- **Suggestion:** Document one working capability set in the Appium guide. Declare `engines` and peer versions so a mismatch fails fast with a clear message instead of crashing the server.

### 7. No sample media on the VVD; GStreamer quirks 🟡
- **Task:** Get test video onto the VVD to exercise playback.
- **Steps:** Looked for sample media, then generated a clip with on-device `gst-launch-1.0`.
- **Expected:** Sample files, or an H.264 encoder.
- **Actual:** Vega OS ships no sample media and no `x264enc`, so we had to use VP8/WebM. `gst-launch-1.0` also trips an APMF assert on teardown (`schema.elsz >= 1`) after writing the file, which looks like a failure but isn't.
- **Workaround:** Synthesize clips with `videotestsrc` / `audiotestsrc` (143 plugins ship) and pull them back (`scripts/vega-testvideo.sh`).
- **Suggestion:** Bundle a few sample videos in the VVD image, and fix or silence the teardown assert.

### 8. `vda://default` fails with two transports; the guest shell service drops out 🟠
- **Task:** Target the VVD from Appium and `vda` for automated checks.
- **Steps:** Ran the checks with `vega:device: vda://default`.
- **Expected:** `default` picks the running virtual device.
- **Actual:** The bridge listed both `127.0.0.1:5555` and `emulator-5554`, and `vda://default` failed because more than one transport was visible. The running guest then rejected shell commands with `Invalid component id: com.amazon.dev.shell.service`. The reason that service disappeared was never established.
- **Workaround:** Always pass an explicit serial (`vda://emulator-5554`). When the shell error appears, stop and recover with `vda -s emulator-5554 reboot`, then rerun (`submission/technical-notes.md`).
- **Suggestion:** Make `vda://default` choose the single VVD, or fail with the list of transports. Explain the `com.amazon.dev.shell.service` error and how to recover from it.

### 9. Fire OS gives apps no access to other apps' media sessions 🔴
- **Task:** On Fire OS, discover what is playing in another app so Selene can explain that moment (as Vega Media Controls is meant to do).
- **Steps:** Looked for a Fire OS API, permission or capability for reading other apps' playback sessions.
- **Expected:** A consented way to read the active session's title and position.
- **Actual:** A regular Fire OS app gets no access to other apps' media sessions. The landing screen always shows "Playback discovery is unavailable. Watch a demo instead."
- **Workaround:** On Fire OS, Selene offers its demo films and imported videos only, with the paired phone as the second screen (`fireos/MIGRATION_REPORT.md`, `fireos/src/Companion.tsx`).
- **Suggestion:** A consented "now playing" capability for companion apps on Fire OS, matching what Vega Media Controls exposes.

### 10. No way to overlay another provider's player 🔴
- **Task:** Show Selene's answer as an overlay over any app (for example Prime Video).
- **Steps:** Searched the Vega SDK and Fire OS docs for overlay, system-window or companion-surface APIs, and tested the WebView and native layers.
- **Expected:** A consented permission or capability to draw a small layer over another app.
- **Actual:** No documented API, permission or capability exists.
- **Workaround:** Overlay only Selene's own player. For other apps, use Vega Media Controls session discovery plus the paired phone as a second screen.
- **Suggestion:** A consented "companion overlay" capability, or document clearly that this isn't supported.

### 11. Alexa+ can't be tested end to end 🟠
- **Task:** Connect Selene's skills to Alexa+.
- **Expected:** Add-on developer access or a simulator.
- **Actual:** Neither was available during the hackathon.
- **Workaround:** A real MCP skills server plus an in-app orchestrator, labelled "simulated Alexa+ experience". Answers already render as AVG.
- **Suggestion:** An Alexa+ add-on sandbox for hackathon participants.

### 12. SVG/WAAPI to AVG has no published mapping 🟡
- **Task:** Render the same animated diagram on Alexa surfaces.
- **Actual:** Transforms, text metrics and animation differ between SVG and AVG, with no compatibility guide. Previewing needed `apl-viewhost-web@2024.3.0`, sandboxed and pinned by hand.
- **Workaround:** A converter (`server/visual-avg.mjs`) maps each WAAPI animation to an AVG parameter driven by APL `AnimateItem`, and reports unsupported features instead of dropping them.
- **Suggestion:** An official SVG to AVG guide or converter, and a packaged local APL preview.
