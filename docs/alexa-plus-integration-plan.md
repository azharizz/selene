# Plan: SELENE as a simulated Alexa+ (the explanation layer next to Alexa+)

Status: **Phases 1–5 implemented (uncommitted, branch `alexa-sim`); Phase 6 waits for Amazon preview access.** Updated: 2026-10-09.

## Implementation status (2026-10-09)

| Piece | Where | Verified |
|---|---|---|
| Skills MCP server (TV session, spec 2025-11-25): `get_viewing_context`, `explain_moment`, `catch_me_up`, `who_is_on_screen`, `trivia`, `control_playback` | `server/skills.mjs`, route `/api/skills/mcp` (device hosts only, never phone addresses) | `test/assistant.test.mjs` |
| Simulated Alexa+ orchestrator: a real MCP client over HTTP, model tool-choice routing, last 6 turns of memory, TV position forced as the spoiler boundary | `server/assistant.mjs`, route `/api/assistant` | Tests + live model runs on both films (routing 1–4 s; explanations 25–75 s) |
| Authored trivia with `safe_after` | `server/trivia.json`. Kept out of `content/*.json` because film hashes bind prepared answers. | Tests |
| TV conversation panel, "Try asking" chips, question above the answer, "SELENE · SIMULATED ALEXA+ EXPERIENCE" label | `src/` (Vega) and `fireos/src/` (Fire OS), the same edits | Fire OS: Android TV emulator screenshots `.tmp/fireos-shots/a03–a07`. Vega: built, installed and launched on the VVD; screenshots unavailable (black under software rendering, and Appium's screenshot fails). |
| Phone companion: typed or voice questions → `/api/private/:token/assistant`. Quick skills are answered directly; explanations stay on the private phone path; "pause / go back" reach the TV on its next playback heartbeat. | `web/PrivateMirror.tsx`, `server/index.mjs` | Tests (phone → TV command delivered exactly once; skills endpoint refuses phone hosts) |

Known gaps:
- "Who is this?" on Football Match is thin. The commentary names roles ("number ten, striker"), not people.
- The existing explain agent intermittently returns 502 for some questions (seen on `/api/moment` too, so not new).
- `test/relay.test.mjs` fails with and without these changes.

Demo script (both films only):
1. **Football Match:** open Ask → "Who is this?" → "What is offside?" (prepared, with animation) → "Something fun" → "Go back 10 seconds".
2. **The Missing Crown:** at about 62 s, "Who is that?" → "Why did Alisson hide the crown?" → follow-up "and who should they watch?" → "What did I miss?" at about 75 s.
3. **Paired phone:** say "pause the TV" with the mic; the TV pauses on its next heartbeat. Companion analysis: [alexa-plus-vs-selene.md](alexa-plus-vs-selene.md). **Unverified** marks claims not confirmed in a primary source.

## 1. Positioning

SELENE **collaborates** with Alexa+. It does not compete.

| Role | Answers |
|---|---|
| **Alexa+ on Fire TV** (built into the system, Prime Video X-Ray) | *who / what / where*: cast, songs, trivia, "jump to the scene", recaps |
| **SELENE** | *why / how*: spoiler-safe explanations of the current moment, with animated diagrams and personal phone help |

Inside the app, SELENE's AI agent behaves like a **simulated Alexa+**. One assistant understands the viewer's request and routes it to SELENE skills over **MCP**, the same protocol a real Alexa+ add-on uses. Where Alexa+ has a feature SELENE can reproduce with its own data, SELENE provides it. When Amazon grants add-on access, the same MCP tools plug into the real Alexa+.

On-screen naming: **"Selene"** with a small *"simulated Alexa+ experience"* label. No Amazon logos, wake-word branding or Alexa voice (third-party trademarks need permission).

## 2. Feature mapping (scope of this plan)

| # | What Alexa+ has | What SELENE has now | Change: what it will look like |
|---|---|---|---|
| **1. Request routing** | One assistant routes any request to the right skill: scene jump, cast info, recap, playback, add-ons | Every question goes to one explain agent (`server/agent.mjs`, tool `get_scene_context`), which always returns an explanation with an SVG | **New orchestrator, the "simulated Alexa+"** (`server/assistant.mjs`). It reads request + film + time, picks a skill and calls SELENE's MCP tools (`/api/mcp`). Skills: explain, recap, who-is-this, trivia, control. For example, "Pause it" → pause; "Why was that offside?" → explain; "What did I miss?" → recap. The existing explain agent becomes one skill, unchanged. |
| **2. Voice** | "Alexa, …" through the remote mic, an Echo or the Alexa app | No voice on the TV (Vega's native runtime has no speech API). Typed Ask sheet + prepared examples. Speech is only capability-gated on the phone page. | A **mic button on the paired phone page** (browser speech-to-text) sends the request to the orchestrator; the answer shows on the TV and the phone. The TV keeps typed input and suggestions. The Fire TV remote's mic stays with the real Alexa; we don't capture it. |
| **3. Follow-ups** | Conversational context (question → natural follow-up) | One clarification turn; follow-ups receive the prior answer and SVG; "follow thread" on the phone | **Short conversation memory per viewer session** (last few turns + frozen time), so "and why did he do that?" works. The Ask sheet becomes a small conversation panel: previous Q/A, then the next input. Spoiler gate unchanged. |
| **4. On-screen "who is this?"** | Cast/actor info from Prime Video X-Ray | Characters and relations exist in `movie_graph`, but no tool or UI asks "who's on screen now" | **`who_is_on_screen` tool**: the characters active in the current scene, from captions + graph nodes up to the current time. The answer card shows names, roles and relations so far (e.g. Lyra → Princess, Alisson → guard). Character info only; these films have no real actors or filmographies. |
| **6. Trivia** | Behind-the-scenes trivia and fun facts | `facts` field exists in each film JSON but is empty | **Author 3–5 facts per film** in `content/*.json`, each with a "safe after" time, plus a `trivia` tool. "Tell me something fun about this" → instant answer. Authored, not generated. |
| **8. Recaps** | Prime Video X-Ray Recaps, up to the exact minute | ✅ `catch_me_up` (MCP) + Guided Return (`/api/return`), grounded and spoiler-safe | **No logic change.** The orchestrator maps "what did I miss / recap / catch me up" to the existing tool. |
| **9. Explain the moment** (SELENE's added value) | ❌ Not documented; Alexa+ answers who/what/where, not why/how | ✅ Grounded, spoiler-safe answer + animated SVG, prepared and generated | **No logic change.** It becomes the orchestrator's main skill (`ask_question`). This is the collaboration pitch. |
| **11. Visual answer** | Answers appear as a **fragment** in the Alexa conversation or full screen. Classic Alexa skills draw vectors with **AVG** (Alexa Vector Graphics, APL). | ✅ Answer card: SVG + **WAAPI** animation (`Visual.tsx`), text alongside (`Moment.tsx`) | **Keep the current card**, with small edits: the question shown above the answer, and suggestion chips under it (#12). Visuals stay **SVG + WAAPI**. For a real Alexa+ later, either serve the same card as an MCP Apps widget (`ui://selene/answer`, web: the documented Alexa+ add-on UI path), or export the diagram as **AVG** (APL's parameterized SVG subset, animated with `AnimateItem`; Fire TV supports APL). See note below. |
| **12. Suggestions** | Alexa+ hub "try asking…" prompts | ✅ "Prepared examples" in the Ask sheet, unlocked by time | **Restyle only:** "Try asking…" chips at the top of the Ask panel, ordered by what's relevant to the current scene. Same data. |
| **14. Works over any app** | System level, every app, no app switch | Own player only (catalog + Import MP4). On Vega the companion reads a real app's title and time via Media Controls. | **Framing only.** In the demo, SELENE's player plays the "TV app" role and the simulated Alexa+ sits on top of it. On Vega, also show the companion picking up a real app's title and time. No overlay over other apps (not possible; see the comparison doc). |
| **15. Second screen** | Echo Show / Alexa app as extra screens | ✅ Paired-phone **private mirror**: answers, hold, return, follow thread | **Restyle:** the phone page becomes the simulated-Alexa+ companion, with the mic (#2), conversation (#3) and answer card (#11). The TV shows the short version, the phone the full one. Existing pairing, no new login. |

Out of scope:
- #5 soundtrack (no music data);
- #7 jump to scene;
- #10 voice transport beyond the orchestrator's `control` skill;
- #13 speed changes (not needed);
- #16 recommendations (two-film catalog).

**Note on AVG vs SVG + WAAPI:**
- AVG is a parameterized subset of SVG for APL documents ([AVG format](https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-avg-format-v1.html)). It's shown with the `VectorGraphic` component ([VectorGraphic](https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-vectorgraphic-v1-5.html)) and animated with `AnimateItem` ([APL 1.1](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2019/07/introducing-alexa-presentation-language-1-1-beta-animation-improved-tools-and-the-alexa-design-system)).
- The APL authoring tool imports SVG into AVG (beta) ([SVG import](https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/import-svg.html)), and APL targets Fire TV ([APL GA](https://developer.amazon.com/en-US/blogs/alexa/post/f01a503d-e3a4-4ef8-a2ef-9372c8570033/alexa-presentation-language-now-generally-available-build-multimodal-experiences-that-come-alive-with-animatio)).
- Whether **Alexa+ add-ons** render APL/AVG is **unverified**. Their documented UI path is web (MCP Apps).
- So SELENE keeps **SVG + WAAPI** as the source of truth. AVG is an optional export for classic-Alexa/APL surfaces. Only static shapes and simple position/scale/rotate/opacity motion map cleanly to AVG + `AnimateItem`.

## 3. Architecture

```
Viewer (TV remote typing, or phone mic)
        │  "Why was that offside?" / "Who is she?" / "What did I miss?" / "Pause it"
        ▼
Simulated Alexa+ orchestrator   server/assistant.mjs   (new)
  • understands intent, keeps short conversation memory (per viewer session)
  • MCP client → SELENE MCP server (spec 2025-11-25, Streamable HTTP)
        ▼
SELENE MCP server   /api/mcp   (exists: server/mcp.mjs)
  existing: get_viewing_context · ask_question (explain) · catch_me_up (recap) · save_place · follow_thread · check_thread · end_help
  new:      who_is_on_screen · trivia · control_playback
  later:    ui://selene/answer (MCP Apps widget) for a real Alexa+ add-on
        ▼
Same agent / movie graph / spoiler gates / SVG+WAAPI renderer
        ▼
TV app (Fire OS + Vega, same UI)  ·  paired phone page (companion)
```

Rules:
- **Reuse, don't fork.** One relay, one agent, one evidence graph, one renderer. The orchestrator only routes; it never answers plot questions itself.
- **Spoiler gate everywhere.** Every skill uses evidence only up to the viewer's position (trivia uses each fact's "safe after" time).
- **Honest labels.** "Simulated Alexa+ experience" on screen, and in the README and demo.
- **Real MCP calls.** The orchestrator really calls `/api/mcp` in code, the same contract a real Alexa+ add-on would use.

## 4. Phases (each ends with a test gate; only the two catalog films)

**Phase 1: MCP tools** (`server/mcp.mjs`, `content/*.json`)
- Add `who_is_on_screen`, `trivia` and `control_playback`.
- Author 3–5 facts per film with `safe_after` times.
- Gate: unit tests per tool (spoiler cut-off, unknown time, empty data). `npm test` green; MCP Inspector lists and calls all tools.

**Phase 2: orchestrator** (`server/assistant.mjs`, route `/api/assistant`)
- Intent routing + per-session memory (last N turns), acting as the MCP client.
- Gate: tests for routing (explain / recap / who / trivia / control / follow-up), plus a live run on Football Match "What is offside?" at 15.5 s and a Missing Crown "who is she?".

**Phase 3: TV UI** (Fire OS + Vega)
- Ask sheet → conversation panel (#3);
- "Try asking…" chips (#12);
- answer card edits (#11);
- small "simulated Alexa+ experience" label.
- Gate: screenshots on the Android TV emulator and the VVD match the current design language; checks green in both apps.

**Phase 4: phone companion**
- Mic button (browser speech) → `/api/assistant`, conversation view and answer card (#2, #15).
- Gate: phone ↔ TV round trip with typed and spoken input; speech stays capability-gated.

**Phase 5: framing / demo** (#14)
- Demo script: SELENE's player as the TV app + simulated Alexa+ on top; on Vega, the companion reading a real provider's title and time if one is available.
- Gate: script reviewed; every claim matches the comparison doc.

**Phase 6: real Alexa+ add-on** (only when Amazon grants Private Preview access)
- `alexa-ai new mcp` → `addon.json` → `alexa-ai deploy` → web simulator → on-device test → `alexa-ai submit`.
- Add OAuth account linking (PKCE `S256`) and the `ui://selene/answer` widget.
- Amazon's 500 ms rule applies here.
- Gate: certification.

## 5. Research reference

### 5a. Access status
- **Sep 9, 2026, Amazon reply:** Alexa+ add-on tools are a phased **Private Preview**. Our interest is registered; access and timing are not guaranteed.
- Docs: "Category SDK and MCP Toolkit are available to select partners only" ([add-ons home](https://developer.amazon.com/docs/alexaplus/add-ons/home.html)). The MCP Toolkit is US-only ([MCP overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html)). The developer marketplace must be Alexa+-supported ([dev environment](https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html)).

### 5b. Real add-on facts (for Phase 6)
- **Path:** the MCP Toolkit, since "explain a scene" isn't a Category SDK category ([choose approach](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html)).
- **Tooling:** Alexa AI CLI: `alexa-ai configure / new mcp / deploy / test / submit` ([MCP quickstart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)).
- **Latency:** under 500 ms round trip; no documented async pattern.
- **Visuals:** MCP Apps (`ui://`, sandboxed web view).
- **Auth:** account linking with OAuth PKCE `S256`.
- **Testing:** standard MCP Inspector (no access needed); Alexa+ Local Inspector with device frames ([Local Inspector](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html)); web simulator after deploy; on-device test before submit ([development stages](https://developer.amazon.com/docs/alexaplus/add-ons/alexa-plus-add-on-development-stages.html)).
- **Not documented:** whether an add-on receives the playing title, position or X-Ray context on Fire TV.

### 5c. Alexa+ features referenced
- On-screen questions, cast, soundtrack and trivia; Jump to the scene (Prime Video, X-Ray + captions + visual understanding) ([Amazon](https://www.aboutamazon.com/news/devices/fire-tv-alexa-plus-jump-to-the-scene)).
- Free on US Fire TVs ([Amazon](https://www.aboutamazon.com/news/devices/alexa-plus-fire-tv-free-ai)).
- X-Ray Recaps ([Amazon](https://www.aboutamazon.com/news/entertainment/amazon-prime-video-x-ray-recaps)).
- X-Ray data has no public API. The Prime Video partner APIs serve managed partners only ([Video Central](https://videocentral.amazon.com/support/prime-video-apis)).

### 5d. Existing Alexa ↔ TV-app integrations (later, optional)
- **Fire OS MediaSession voice transport:** `com.amazon.permission.media.session.voicecommandcontrol` ([docs](https://developer.amazon.com/docs/fire-tv/mediasession-api-integration.html)).
- **Video Skills Kit:** needs catalog integration ([docs](https://developer.amazon.com/docs/fire-tv/voice-enable-your-app-and-content.html)).
- **Vega:** Media Controls (automatic with the W3C Media API) ([docs](https://developer.amazon.com/docs/vega/0.22/media-controls-guide)); Content Launcher + Account Login ([docs](https://developer.amazon.com/docs/vega/0.21/content-launcher-integration-guide)).

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Viewers mistake the simulation for the real Alexa+ | Trust and trademark issues | Persistent "simulated Alexa+ experience" label; no Amazon marks or voice |
| Orchestrator routes wrongly (e.g. explains when asked to pause) | Bad UX | Small fixed intent set, routing tests, a "did you mean…" fallback |
| Follow-up memory leaks future info | Spoilers | Memory stores only answers already shown; the spoiler gate re-checks every turn |
| Browser speech unavailable on some phones | No voice | Typed input always available; mic shown only when supported |
| Authored trivia/facts wrong | Credibility | Facts kept short, sourced from the film's own material, reviewed |
| Private Preview never granted | Phase 6 blocked | Phases 1–5 stand alone; the same MCP tools are ready if access comes |
| Generated explanations are slow (44–48 s measured) | Waiting in the conversation | Accepted for now. Prepared answers stay instant; the existing loader remains. |

## 7. Decisions needed

1. Branch: build on the planned unified TV branch (Fire OS + Vega share `app/`), or a separate `alexa-sim` branch?
2. Who authors the trivia facts (#6): you, or a draft from me for your review?
3. Orchestrator model: the same `AGENT_PROVIDER_MODEL` as the explain agent, or a smaller, faster model for routing only?
