# Selene: ingestion, native assistance and collaborative evaluation

Implementation record, September 30, 2026. This is the executable follow-up to [the product research](../../SELENE_DEEP_RESEARCH_AND_RECOMMENDATION.md).

| Agreed priority | Delivered | What it establishes |
| --- | --- | --- |
| Use another permitted video without hand-written plot facts | Local SRT/WebVTT + frame ingestion; a real Sintel excerpt in the existing player | The answer pipeline can receive automatically acquired evidence from another title. Visual observations remain provisional. |
| Collaborate with native accessibility | Read/subscription bridge, caption defaults/style, text scaling, high contrast, VoiceView speech guard; accurate slower-answer label | Selene follows available settings and preserves viewer control. Physical device behavior still needs testing. |
| Compare existing help with existing help + Selene | Anonymous paired trial format and summary CLI; protocol below | Measurement is ready. No household benefit has been measured yet. |

## Import another video

Install FFmpeg/ffprobe through your usual trusted package manager. The import uses the existing HTTPS model endpoint/key in `../.env`; the selected ingestion model must accept images and structured output. This import explicitly selected `google/gemini-2.5-flash` for frame observations. The final answer-model setting is **`openai/gpt-6-luna`**, selected after compatibility and grounding failures with earlier configurations; the endpoint and credentials were preserved. Restart existing relay processes to load the new setting. Frame-ingestion provenance remains Gemini; changing the answer model does not regenerate those observations.

Run from `selene/` with a local video and matching caption file:

```sh
npm run ingest -- \
  --id your-new-clip --title 'Your title' \
  --video /absolute/path/video.mp4 --captions /absolute/path/captions.vtt \
  --source https://publisher.example/source \
  --license https://publisher.example/license \
  --credit 'Creator, source, license and changes' --permitted \
  --model google/gemini-2.5-flash --offset 0 --duration 120 --interval 15
npm run build
npm start
```

`--permitted` records your permission acknowledgment; it cannot establish rights automatically. Check the video, captions and model-processing rights before importing. The script sends sampled JPEGs to the configured provider; it does not upload the whole video. Never use private family footage as a convenience test.

The importer re-encodes the excerpt, shifts complete caption cues, samples individual frames and asks the model for visible observations. It writes `content/<id>.json` and `assets/media/<id>/`, including timestamps, source/license/credit, file hashes, model and frame provenance. It refuses existing IDs and publishes the catalog entry only after successful processing. Restart the relay to reload content. Rebuild/reinstall the native package to include new bundled assets.

The ceiling is a five-minute excerpt, 512 MiB input, 1 MiB captions and 40 frames at least five seconds apart. This is offline preprocessing; it is not continuous capture of another streaming app. It keeps the first video/audio streams, converts audio to stereo and does not add an audio-description track selector. Supply an appropriate permitted version of the program.

Only completed captions and observations already available at the frozen player time reach the answer agent. Captions do not identify a speaker unless the caption itself supplies that information. An image near a caption cannot prove who spoke or why. A sparse frame cannot prove intervening motion. Generated observations never enter durable graph memory. A diagram is optional when it would require invented details; the existing schema/semantic review still rejects unsupported answers. Model review can miss errors.

### Actual second-title import

**Sintel © 2010 Blender Foundation, durian.blender.org.** Blender permits reuse under [CC BY 3.0](https://durian.blender.org/sharing/). Original caption downloads are linked from [the project's download page](https://durian.blender.org/download/) and hosted by [Xiph](https://media.xiph.org/sintel/subtitles/). The local source came from [the Internet Archive mirror](https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4); the caption file was `sintel_en.srt`.

The actual import command was:

```sh
npm run ingest -- --id sintel-excerpt --title 'Sintel — excerpt' \
  --video artifacts/ingestion-source/sintel.mp4 \
  --captions artifacts/ingestion-source/sintel_en.srt \
  --source https://durian.blender.org/ \
  --license https://creativecommons.org/licenses/by/3.0/ \
  --credit 'Sintel © 2010 Blender Foundation | durian.blender.org. Trimmed and re-encoded excerpt; captions and visual observations imported automatically.' \
  --permitted --model google/gemini-2.5-flash --offset 185 --duration 105 --interval 15
```

Result: **105 seconds, five caption cues, seven sampled frames and 27 model observations**, acquired through seven real image-model calls. Media totals 5,420,446 bytes. No plot facts, character biographies or scene labels were manually authored. The package retains uncertainty and credit; the player displays attribution. Source downloads are ignored by Git; the playable excerpt and provenance are deliverables. This excerpt contains an injured creature and a later threatening scene; a caregiver should review it before any child session. It is an ingestion demonstration, not automatically a suitable household evaluation stimulus.

## Work with native assistance

The official [Vega accessibility API](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_kepler-a11y-settings-interface-turbo.html) supports reading and subscribing to preferences; its setters require a system-only privilege. Selene uses getters/listeners only. The installed `1.0.0` package exports **named** `KeplerA11ySettingsInterface`, although the documentation shows default-import examples. The implementation uses the installed signature.

| Available preference | Selene behavior |
| --- | --- |
| Caption enablement | Own-player default follows TV; explicit Captions on/off wins. “Use TV caption setting” clears that override when a native setting is available. |
| Caption appearance | Maps documented size, font, color, opacity, background and edge enums to the existing caption surface. Window-background preferences are not separately rendered. |
| UI scaling / high contrast | Native discovery text and WebView text adapt; panels allow scrolling. Generated SVG label sizes do not track the text-scale multiplier. |
| Screen reader | Existing semantic controls remain available; when VoiceView is reported enabled, Selene hides/stops its extra TV read-aloud to avoid competing speech. |
| Audio description preference | Read and acknowledged. Current bundled clips do not offer a separate AD track. In another playback app, use that app's available track. |

Missing APIs remain unknown, rather than being treated as disabled. One root owner subscribes once, ignores stale results, removes listeners and passes updates through the guarded WebView bridge. Browser-only previews cannot read TV settings.

“Easy to hear” is now **“Slower answer voice.”** Saved values migrate. It changes Selene's optional spoken-answer rate to 0.85, including the explicit phone mirror; it does not improve movie dialogue. The mirror uses the phone's own browser/audio output and does not inherit the TV screen reader.

Use the TV's existing assistance alongside Selene. VoiceView, audio description, captions, Dialogue Boost and hearing-device/dual-audio options have device, app or title availability constraints; verify the exact setup rather than claiming universal availability. Amazon documents them in [Fire TV accessibility help](https://digprjsurvey.amazon.com/csad/help/node/202105050). An eventual Android/Fire OS build would need the separate [Fire OS AD/CC integration](https://www.developer.amazon.com/docs/fire-tv/implement-reading-and-subscribing-to-adcc.html); this release remains Vega.

## Evaluate collaboration, not replacement

Use two conditions on the **same participant and family group**:

| Condition | Available help |
| --- | --- |
| `usual_help` | Their usual captions, rewind, available native assistance and another family member |
| `usual_help_plus_selene` | Exactly the same help, plus Selene |

Do not disable accessibility or discourage family conversation to make Selene look better. Ask which help each person actually wants; age does not establish a need. Obtain agreement to participate; a caregiver chooses appropriate material and remains with a child. Keep IDs anonymous and do not record voices, questions, diagnoses or family memories.

For a formative hackathon check, recruit 6–8 households if feasible. This is a recruitment target, not a sample already tested. Give one brief practice clip before scored trials. Each target viewer watches two different, unfamiliar, similarly difficult clips with the same number of prewritten comprehension questions (for example three). A human checks each question and correct answer against the permitted source; this does not require hand-writing plot facts into the ingestion package. Score understanding privately without coaching, accepting an equivalent answer in the viewer's preferred language. Do not compare post-Selene recall of a clip with earlier recall of that same clip.

Rotate the four sequences across households: A/usual → B/+Selene; B/usual → A/+Selene; A/+Selene → B/usual; B/+Selene → A/usual. Keep device, captions, volume, native options and family helper consistent within a pair. Note the actual device/title/assistance configuration in anonymous session notes. If assistance availability differs, the CLI excludes that pair. Clip difficulty and learning effects still require human judgment; counterbalancing does not eliminate them.

An observer times help from attention shifting away from the program until attention returns. `scope: "shared"` means a pause/rewind or help stops the group; `"viewer"` means only the target viewer's attention shifts while others can continue. Mark **one event** with multiple causes when, for example, a rewind and family explanation overlap. Do not double-count overlapping intervals. Routine captions alone are not an interruption. Log family help as collaboration, not failure. Model wait time and navigating Selene count when they occupy viewer/group attention.

After scored trials, offer a fresh unscored segment and leave all help available. Give a neutral choice and no reminder to use Selene. Record `voluntary_reuse: true` only if the person independently chooses Selene again; false requires a real opportunity and no reuse; null means not observed. Put this result on the +Selene trial only. This is observed reuse in a session, not proof of long-term retention.

Start with the empty template:

```sh
cp evaluation/trials.template.json evaluation/results-local.json
# Enter observed anonymous trials; results*.json is ignored by Git.
npm run evaluate -- evaluation/results-local.json
```

The following is a **format example, not a measured result**. A comparison needs a matching record with the same `pair_id`/participant, the other condition/order and a different clip:

```json
{
  "trials": [{
    "trial_id": "example-a", "participant_id": "viewer-01", "pair_id": "pair-01",
    "clip_id": "clip-a", "condition": "usual_help", "order": 1,
    "correct": 2, "questions": 3, "voluntary_reuse": null,
    "available_support": {"captions": "available", "rewind": "available", "family_help": "available", "native_assistance": "unavailable"},
    "interruptions": [{"seconds": 8, "scope": "shared", "causes": ["rewind", "family_help"]}]
  }]
}
```

The CLI reports comprehension percentage, shared interruption count/time, target-viewer attention time, family-help events, observed-reuse denominator/rate and individual paired changes. An empty sample prints zero observations and null outcomes. Inspect individual pairs, incorrect answers, frustration and model failures alongside averages. Predeclare your decision: retain Selene for a need only when understanding improves without an unacceptable group disruption, or similar understanding requires less disruption. If captions/rewind/family help work as well with less effort, narrow Selene to the situations where it adds value. A small convenience sample does not establish population benefit or a probability of winning.

## Verification and remaining gates

Earlier ingestion checks completed September 30, 2026 (live results below predate the compact-toast prompt changes):

| Check | Actual result | Limit |
| --- | --- | --- |
| `npm test` | 41/41 passed, none skipped | Native/provider boundaries are mocked in the deterministic checks. |
| `npm run typecheck`, `npm run lint`, `git diff --check` | Passed | Static checks do not establish runtime accessibility. |
| `npm run build:web`, `npm run build:release` | Passed; armv7, x86_64 and aarch64 release packages passed SDK ABI checks | A build is not installation or physical-device validation. |
| `npm run test:live` | 4/4 passed with GPT-6 Luna: explanation, spoiler boundary, Life Connection and Indonesian translation | Narrow smoke checks use authored demo evidence and model semantic review, which can miss errors. |
| `npm run test:live -- --companion` | 2/2 passed with GPT-6 Luna | Provider metadata/viewer detail are explicitly synthetic; this does not verify a real streaming app. |
| `npm run test:live -- --ingested` | 2/2 passed with GPT-6 Luna: imported caption and sampled-image questions | Visual observations are still provisional. |
| Actual own-player browser flow | Played the imported MP4; checked captions, attribution, persistent manual caption choice and a real caption-grounded answer with playback choices visible at 1920×1080 | Browser speech and simulated native preferences do not prove Vega WebView/VoiceView behavior. |
| Local HTTP relay | Catalog/package, media range response and imported Moment Response checked | Public deployment authentication and device connectivity remain separate work. |
| Empty evaluation template | Zero observed pairs; outcome values remain null | **No household understanding, interruption or reuse improvement is claimed.** |
| `vega device list` | No devices found | Hardware checks remain pending. |

The latest live checks passed after earlier configurations produced unsupported scene inferences, empty responses, schema errors or reviewer disagreements. The final setup keeps schema, renderer and semantic checks; it can still reject a valid answer or miss an error. Passing eight selected cases is not a reliability estimate or a production-ready claim.

Reviewable proof: [imported player](../artifacts/ui-review/2026-09-30-ingested-player.jpg), [real answer with playback choices](../artifacts/ui-review/2026-09-30-ingested-answer.jpg), [accurate assistance settings](../artifacts/ui-review/2026-09-30-accessibility.jpg). The local browser preview is at `http://127.0.0.1:4627/?story=sintel-excerpt` while its relay is running. Normal `npm start` uses the configured relay port; a TV bundle must be rebuilt for the intended reachable relay URL.

Two next gates remain: **(1)** install on a Vega Fire TV and test native settings, VoiceView, D-pad/Back, speech/audio behavior, captions and interruption recovery; **(2)** run the paired family sessions above and record actual anonymous observations. Test unavailable native assistance as unavailable, not as a Selene feature. The separate Fire OS/Android path and universal third-party capture are not delivered by this Vega implementation.


## Compact notification correction — September 30, 2026

Removed the response header, metadata and large button row. The notification uses one row with an 80px SVG, adjacent text and small dismiss/More icons; it has no expansion action. Ordinary responses wait for confirmed resumed playback, including the native-provider path. Explicit Life Connection remains a separately confirmed pause flow. SVGs run host-owned WAAPI emphasis even without model animation descriptors; reduced-motion preferences disable animation.

`npm run release` passed: 44 deterministic checks, typecheck, lint, web bundle and all three native release architectures. New runnable checks cover successful and failed resume and WAAPI/reduced-motion behavior. Physical-device testing remains pending.

Do not treat the earlier eight live passes as current reliability evidence. Later prompt checks passed both companion cases and the imported caption case, but rejected sampled-image and some authored-demo answers during semantic review. The first live browser attempt during this UI correction also returned the safe unavailable state. These failures are not fixed by the layout change.

Browser verification of the final toast: 420.57×111.99 CSS pixels in a 914×514 CSS viewport, no vertical clipping. The player reported `paused:false`, and advanced from 74.77s to 86.90s while the notification remained present. The sandbox SVG reported an interpolated opacity of 0.619333 during its host WAAPI pulse. The real caption answer succeeded after retry; no test fixture was substituted. [Final compact notification](../artifacts/ui-review/2026-09-30-toast-playing.jpg).


## Watching UI revision, September 30, 2026

This supersedes the earlier pulse and 80px-square notification design. The answer toast is capped at 440px with 18px text, 8px gaps, 32px icon controls and a 76 by 56px explanatory SVG. The launcher offers only Ask Selene, answer preferences and dismiss. Demo transport/captions remain under the explicitly labelled Demo playback disclosure in preferences; native media commands remain available. The question box is capped at 480px with one input row and two explanation shortcuts. The same compact question treatment applies to the provider companion. Generated answer text and the imported title no longer display em dashes.

Removed the whole-SVG looping pulse. New model instructions request label-free schematic geometry and finite WAAPI motion that demonstrates the answer, then settles. Legacy connector geometry can draw once. Reduced motion remains respected. The SVG validator now permits a label-free diagram with geometry and a required accessible description, while rejecting empty diagrams and retaining script/resource restrictions.

A live model check at 32 seconds returned a ready SVG of a schematic figure at rest with a finite translation animation. Live model reliability is still variable, as noted above. This is not evidence of a universal overlay on Prime Video or other apps: the own-player demo is the visual proof surface; native provider integration remains a separate foreground app.

Latest automated validation: 46 checks, including a Selene-only launcher assertion, one-row question entry, finite connector drawing, reduced motion, label-free accessibility and playback resume. See [launcher](../artifacts/ui-review/compact-launcher.jpg) and [question box](../artifacts/ui-review/compact-question.jpg).

The final release command passed typecheck, lint, all 46 tests, the web bundle and armv7/x86_64/aarch64 packages with ABI validation. The isolated-dot check excludes the SVG background from its shape count. A playback regression check also covers the internal seek caused by restarting an ended clip: it must not cancel the answer that requested resume. Real Fire TV hardware and household readability testing remain pending.

Final live browser proof: the generated diagram contains a grouped figure and a fixed baseline. Its WAAPI descriptor moves the whole figure into place over 700ms, then holds the final state. The toast measured 440×79.99 CSS pixels without clipping; playback reported `paused:false` at 71.08 seconds. [Final answer](../artifacts/ui-review/compact-answer.jpg). The browser viewport override was reset afterward.
