# Alexa+ on Fire TV vs SELENE

Research date: 2026-10-09. Sources: Amazon docs, Amazon announcements, developer community posts and press, linked inline. Anything marked **unverified** was not confirmed in a primary source. Device checks were run on a Live Device Interaction cloud unit (Fire OS 14, Cuttlefish virtual hardware) and the local Vega Virtual Device. No physical Fire TV was used.

## 1. The core question: explaining a movie that plays in the *real* app

SELENE explains films today only when it plays them itself (the two-film catalog, or Import MP4). The goal is to explain a movie playing in Prime Video, Netflix and similar apps.

| Need | Vega OS | Fire OS (8 / 14 / 16) |
|---|---|---|
| Know *which* title is playing in another app, and where | ✅ **Yes**, when that app registers as a provider with the documented [Media Controls client API](https://developer.amazon.com/docs/vega/0.22/media-controls-get-started). It gives title, session state and a sampled position. SELENE's Vega companion already calls it (`docs/companion.md`). | ❌ **Not for a regular app.** Android's `getActiveSessions` needs an enabled notification listener ([MediaSessionManager](https://developer.android.com/reference/android/media/session/MediaSessionManager)). The cloud Fire OS 14 unit has no settings screen for that (`ACTION_NOTIFICATION_LISTENER_SETTINGS` → "unable to resolve Intent"), so it can only be granted over ADB. |
| Know *what is happening* in the scene (dialogue, picture) | ❌ Media Controls gives no dialogue or pixels. Amazon says not to capture DRM content ([Appium guidance](https://developer.amazon.com/docs/vega/0.22/appium-commands.html)). | ❌ Screen capture needs a consent prompt ([MediaProjection](https://developer.android.com/media/grow/media-projection)), and protected windows capture black ([FLAG_SECURE](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE)). |
| Show SELENE on top of the real app | ❌ One foreground app at a time. A backgrounded media app must "Stop content playback" ([lifecycle](https://developer.amazon.com/docs/vega/0.21/foreground-background)). Only Alexa's own UI overlays. | ⚠️ Possible only through `SYSTEM_ALERT_WINDOW` granted over ADB. There is no user setting, and Amazon staff say it is "not supported on Fire TV" ([forum](https://community.amazondeveloper.com/t/firetv-overlay-permissions/6053)). Apps can also hide overlays on Android 12+ ([secure activities](https://developer.android.com/security/fraud-prevention/activities)). |

**Bottom line:** the "phone as overlay" design can follow the *real* app only on Vega, and only for providers that publish Media Controls sessions. Even then SELENE knows the **title and time**, not the **scene**. A grounded explanation of a real third-party film needs scene data (captions or X-Ray-like metadata) from someone licensed to supply it. SELENE already has the adapter for that ([scene-context contract](scene-context.md)), but no licensed source is connected.

The only player that already has that scene data for real films is **Amazon itself**, through Prime Video X-Ray. That is why Alexa+ is the relevant comparison.

## 2. What Alexa+ does on Fire TV today

| Capability | Status | Source |
|---|---|---|
| Availability | Free on compatible US Fire TVs since Aug 2026, with no Prime needed. Covers current Fire TV Sticks, Fire TV Cube, Ember TVs and third-party Alexa+ TVs. A dedicated Alexa+ hub is rolling out from Nov 2026. Outside the US: early 2027. | [Amazon](https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-free-ai), [TechCrunch](https://techcrunch.com/2026/08/19/amazon-makes-its-ai-powered-alexa-free-on-fire-tv-no-prime-required/), [TechMyMoney](https://techmymoney.com/2026/10/04/fire-tv-alexa-plus-hub-comes-to-us-tvs-in-november/) |
| Vega devices | The Fire TV Stick 4K Select (Vega) launched with Alexa+ marked "coming soon". Newer Vega sticks ship with it. Treat per-device support as **check on device**. | [Android Authority](https://www.androidauthority.com/amazon-vega-os-fire-tv-stick-3602647/), [Liliputing](https://liliputing.com/the-40-amazon-fire-tv-stick-4k-select-ships-with-vega-os/) |
| On-screen questions | "On-screen and informational context", for example "Alexa, how many movies has Hilary Duff been in?" plus follow-ups. Also actor filmography, soundtrack and trivia while watching. | [Amazon](https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-free-ai), [Amazon: Jump to scene](https://www.aboutamazon.com/news/devices/fire-tv-alexa-plus-jump-to-the-scene) |
| Jump to a described scene | Prime Video movies only (Prime-included or purchased), thousands of titles. TV shows "soon". Built on "visual understanding and movie captions, processed through Prime Video's X-Ray", using Amazon Bedrock (Nova, Claude). | [Amazon](https://www.aboutamazon.com/news/devices/fire-tv-alexa-plus-jump-to-the-scene), [TechCrunch](https://techcrunch.com/2025/12/03/amazon-fire-tvs-new-ai-feature-lets-you-jump-to-scenes-by-describing-them-to-alexa/) |
| Recap what happened so far | Prime Video **X-Ray Recaps** is a separate Prime Video feature. You pause, then get an AI summary up to the exact minute. It is limited to Amazon MGM originals at launch, and is a TV-series feature. | [Amazon](https://www.aboutamazon.com/news/entertainment/amazon-prime-video-x-ray-recaps) |
| "Explain *why* this plot moment happened" | **Unverified.** No Amazon source shows Alexa+ explaining the plot logic of the current scene. The documented answers cover cast, music, trivia and scene search. | — |
| Works in Netflix, YouTube and other apps | **Unverified** for on-screen questions. Scene features are documented for Prime Video only. Netflix and HBO Max are mentioned only for *recommendations*. | [Amazon](https://www.aboutamazon.com/news/devices/fire-tv-alexa-plus-jump-to-the-scene), [Artiverse](https://www.artiverse.ca/fire-tv-turns-alexa-into-a-more-capable-viewing-guide/) |
| Visual answers (diagrams) | **Unverified** how answers render over video. No source describes diagrams or animations. | — |

## 3. Can SELENE plug into Alexa+? (Alexa+ add-ons)

| Fact | Detail | Source |
|---|---|---|
| Integration paths | **Category SDK (Action)** for supported categories: restaurant, food, home services, local booking, ticketing. **Category SDK (MCP)**: ride booking. **MCP Toolkit** for services outside those categories. | [Choose approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html) |
| Fit for SELENE | **MCP Toolkit** is the only path that fits, since "Explain a movie scene" isn't a category. | same |
| Access | The MCP Toolkit is "available in the United States". The add-on docs describe Category SDK and MCP Toolkit access as limited to **select partners**. Everything is subject to Amazon certification. | [MCP Toolkit](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html), [Add-ons home](https://developer.amazon.com/docs/alexaplus/add-ons/home.html), [Overview](https://developer.amazon.com/docs/alexaplus/add-ons/overview.html) |
| Screens | One integration renders on Echo, Echo Show, **Fire TV**, the Alexa app and Alexa.com. Screen UI comes as **fragments** inside the conversation or **full-screen** experiences, built with React, Vue, Svelte or plain JS plus Alexa's JS SDK. MCP add-ons use **MCP Apps** inside an Alexa-provided webview. | [Development stages](https://developer.amazon.com/docs/alexaplus/add-ons/alexa-plus-add-on-development-stages.html), [Choose approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html) |
| Latency rule | The MCP Toolkit requires round-trip responses **under 500 ms**. | [Choose approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html) |
| What's playing / scene context passed to add-ons | **Not documented.** No page says an add-on receives the current title, position or X-Ray data. | Overview and MCP Toolkit pages (silent) |

What that means for SELENE:
- **MCP is a head start.** SELENE already has an MCP endpoint (`docs/mcp.md`, `POST /api/mcp`) with `get_viewing_context`, `ask_question`, `catch_me_up` and related tools. It's an experiment, not an Alexa+ integration, but it is the right shape.
- **The 500 ms rule doesn't match SELENE's answer path.** Measured live answers take **44.5–48.1 s** (README). An add-on would have to return an immediate acknowledgement plus an async result, or pre-computed prepared answers. Whether Alexa+ supports long-running tool results is **unverified**.
- **Context is the gap.** Unless Amazon passes the playing title and time, SELENE inside Alexa+ would not know the moment better than it does on Vega today.
- **The visual would appear in Alexa's UI**, as a fragment or full screen, not as a SELENE-designed overlay. Whether that UI can show over playing video is **unverified**.

## 4. Side-by-side: Alexa+ vs SELENE today

| Dimension | Alexa+ on Fire TV | SELENE (current) |
|---|---|---|
| Works over the real streaming app | ✅ System-level and always available, with no app switch | ❌ Own player (catalog + Import MP4). On Vega the companion reads title and time from Media Controls providers. |
| Scene knowledge | ✅ Prime Video X-Ray, captions and visual understanding for Prime titles | ✅ Full captions and a per-film graph for imported or catalog films only |
| Third-party apps (Netflix…) | Unverified for scene Q&A | ❌ No scene data. The viewer can describe the scene; that's the viewer-detail fallback. |
| Answer type | Spoken/text facts: cast, music, trivia, scene jump, recaps (Prime Video) | **Explains the moment** with a concise answer plus an **animated SVG diagram** (e.g. offside lines) |
| Spoiler control | Not documented | ✅ Answers are bounded to what has already been seen (timestamp-gated evidence) |
| Prepared lessons | — | ✅ Authored animations ("What is offside?", Alisson scenes) |
| Personal / second screen | Alexa app | ✅ Paired-phone private mirror, Hold our place, Guided Return, follow-a-thread |
| Accessibility needs | VoiceView etc. are system-wide | ✅ Per-question need, language and recipient; captions control |
| Latency | Conversational, near real time | 44–48 s for generated answers. Prepared answers are instant. |
| Platforms | Fire OS and Vega (system) | ✅ Vega native + Fire OS native (same UI) |
| Distribution | Built in | Appstore app |
| Who can build on it | Amazon. Add-ons are US/select partners only, with certification. | You |

## 5. Recommendations

1. **Pitch SELENE as the explanation layer, not as Alexa+.** Alexa+ answers *who/what/where* (cast, songs, find the scene). SELENE answers *why/how* (offside rule, plot logic) with spoiler-safe visuals. They complement each other.
2. **Short term (no Amazon permission needed):** keep the own player for full explanations. On Vega, use Media Controls plus the phone for real apps, with the viewer-detail fallback.
3. **Medium term:** apply for Alexa+ add-ons through the **MCP Toolkit** with the existing `/api/mcp`. Ask Amazon three concrete questions:
   1. Can an add-on receive the playing title and position on Fire TV?
   2. Is there an async / long-running result pattern beyond 500 ms?
   3. Can MCP Apps UI show over playing video on Fire TV?
4. **Scene data for real films** needs a licensed source per provider: SELENE's `SELENE_SCENE_CONTEXT_URL` adapter, or an Amazon/X-Ray partnership. Without it, any explanation of a third-party film is based on the viewer's description.
5. **Avoid ADB-only overlays and screen capture** for anything shipped. They work only on developer devices, are unsupported by Amazon, and can be blocked by apps.
