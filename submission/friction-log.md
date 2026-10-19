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

### 2. No way to take a screenshot on Vega OS 🟠
- **Task:** Capture VVD screenshots for automated UI checks and the demo.
- **Steps:** Tried `screencap` (the Android habit), then the on-device `screenshooter` / `gwsi-tool-screenshooter`.
- **Expected:** A PNG of the screen.
- **Actual:** `screencap` doesn't exist on Vega OS, so we got a 0-byte file. `screenshooter` needs a 1920×1080×4 = 8,294,400 B Wayland shm buffer, but `/dev/shm` on the VVD is capped at 5 MiB. The allocation fails with `Permission denied` and it writes a 0-byte PNG, with no clear error.
- **Workaround:** Capture host-side through QEMU QMP `screendump` on the VVD's QMP socket (`scripts/vega-screenshot.sh`).
- **Suggestion:** Add `vega device screenshot`, or raise the VVD's `/dev/shm` limit so the shipped tool works. Document the supported method.

### 3. VVD crashes on Apple Silicon with GPU acceleration 🟠
- **Task:** Start the Vega Virtual Device on a Mac (AArch64).
- **Steps:** `virtualdevice create-and-launch` with default rendering.
- **Expected:** The emulator starts and renders.
- **Actual:** The bundled host Vulkan/GL renderer crashed on Mac AArch64.
- **Workaround:** Launch with `--gl-accel-off` (software rendering) at 1280×720 to keep it usable (`scripts/start-vega-vvd.sh`).
- **Suggestion:** Fix the host renderer on Apple Silicon. Until then, detect it and fall back to software rendering automatically, and put the flag in the VVD troubleshooting docs.

### 4. A11y module autolink breaks the build 🟠
- **Task:** Build the Vega app with `react-native build-vega`.
- **Steps:** Installed dependencies and ran a Debug/Release build.
- **Expected:** A clean build.
- **Actual:** `@amazon-devices/kepler-a11y-settings-interface-turbo` ships `react-native.config.js` with `linkDynamic: true`, which our build could not use as shipped.
- **Workaround:** A `prebuild` script patches `node_modules` to `linkDynamic: false`, and refuses to build if the config shape changes (`scripts/fix-vega-a11y-autolink.mjs`).
- **Suggestion:** Ship the module with a link mode that works under `build-vega` by default, or document the required setting.

### 5. Appium Vega driver breaks on newer Node 🟡
- **Task:** Automate launcher and feature checks with Appium.
- **Steps:** `npm` ran the automation under the system Node (26).
- **Expected:** Appium and the Vega driver start.
- **Actual:** Appium and its children had to run on Node 22. The supported Node range isn't stated where we installed the driver.
- **Workaround:** The script re-executes itself under a pinned Node 22.17 (`scripts/vega-automation.mjs`).
- **Suggestion:** Declare `engines` in `appium-vega-driver` and fail fast with a clear message.

### 6. No sample media on the VVD; GStreamer quirks 🟡
- **Task:** Get test video onto the VVD to exercise playback.
- **Steps:** Looked for sample media, then generated a clip with on-device `gst-launch-1.0`.
- **Expected:** Sample files, or an H.264 encoder.
- **Actual:** Vega OS ships no sample media and no `x264enc`, so we had to use VP8/WebM. `gst-launch-1.0` also trips an APMF assert on teardown (`schema.elsz >= 1`) after writing the file, which looks like a failure but isn't.
- **Workaround:** Synthesize clips with `videotestsrc` / `audiotestsrc` (143 plugins ship) and pull them back (`scripts/vega-testvideo.sh`).
- **Suggestion:** Bundle a few sample videos in the VVD image, and fix or silence the teardown assert.

### 7. No way to overlay another provider's player 🔴
- **Task:** Show Selene's answer as an overlay over any app (for example Prime Video).
- **Steps:** Searched the Vega SDK and Fire OS docs for overlay, system-window or companion-surface APIs, and tested the WebView and native layers.
- **Expected:** A consented permission or capability to draw a small layer over another app.
- **Actual:** No documented API, permission or capability exists.
- **Workaround:** Overlay only Selene's own player. For other apps, use Vega Media Controls session discovery plus the paired phone as a second screen.
- **Suggestion:** A consented "companion overlay" capability, or document clearly that this isn't supported.

### 8. Alexa+ can't be tested end to end 🟠
- **Task:** Connect Selene's skills to Alexa+.
- **Expected:** Add-on developer access or a simulator.
- **Actual:** Neither was available during the hackathon.
- **Workaround:** A real MCP skills server plus an in-app orchestrator, labelled "simulated Alexa+ experience". Answers already render as AVG.
- **Suggestion:** An Alexa+ add-on sandbox for hackathon participants.

### 9. SVG/WAAPI to AVG has no published mapping 🟡
- **Task:** Render the same animated diagram on Alexa surfaces.
- **Actual:** Transforms, text metrics and animation differ between SVG and AVG, with no compatibility guide. Previewing needed `apl-viewhost-web@2024.3.0`, sandboxed and pinned by hand.
- **Workaround:** A converter (`server/visual-avg.mjs`) maps each WAAPI animation to an AVG parameter driven by APL `AnimateItem`, and reports unsupported features instead of dropping them.
- **Suggestion:** An official SVG to AVG guide or converter, and a packaged local APL preview.
