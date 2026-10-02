# Phone continuity implementation plan

**Goal:** Correct private catch-up boundaries and add one optional evidence-backed followed question.

**Architecture:** Reuse the private relay, original evidence, SVG/WAAPI renderer and playback stream. Keep the question's scene, the help interval and the followed topic independent. An optional authenticated MCP endpoint delegates to the same private actions.

**Tech stack:** Existing Node HTTP server, Ajv, React and Node test runner. No new runtime dependencies.

**Spec:** User-approved assessment in the conversation, 2 October 2026.

## Constraints

- Work solo in the existing checkout, preserving unrelated uncommitted work.
- Stop before browser, phone, Vega or other UI testing. Run code-level checks only.
- First Send starts the help interval; follow-ups retain it. Catch me up freezes the confirmed TV sample at tap.
- Earlier question selection changes question context, not an active help interval. A standalone earlier-point catch-up remains explicit.
- Original caption quotes must come directly from completed source cues. General references remain distinct from plot evidence.
- One optional followed topic, silent and bounded. No TV transport commands, inferred age, new preferences menu, or phone video.
- Keep existing animation and reduced-motion behavior. No em dashes in new interface copy.
- X-Ray has no established public integration here; AVG stays deferred until an actual Alexa presentation exists. MCP is optional and does not claim a live Alexa+ integration.

## Implementation and checks

- [x] Update `server/personal.mjs` and `server/contract.mjs`: bounded playback history, validate captured samples, independent question anchor, closed successful return with retry recovery.
  - Check old samples after TV advances, invented/future/stale samples, seek invalidation, return failures and repeated success.
- [x] Update `server/context.mjs`, `server/agent.mjs` and private actions: scoped authored references, literal caption quotes, persistent explicit question context, thread response validation.
  - Check general references cannot become scene facts, unfinished captions stay hidden, generated graph memory stays excluded, irrelevant updates stay quiet.
- [x] Add shared private action handler and optional thread check. Reuse it from HTTP and MCP.
  - Check one topic, deduplication, throttling, retry, cancelled generation, revocation and unchanged TV state.
- [x] Update `web/PrivateMirror.tsx`, `web/personal.ts`, `web/style.css`: corrected Send/tap snapshots, one Follow toggle, original quote, stable follow-ups and queued updates during typing/speech.
  - Exercise controller logic in Node without opening a browser or device.
- [x] Add disabled-by-default Streamable HTTP MCP interface, using a paired-viewer bearer capability and shared validation.
  - Check initialize/list/call, invalid origin/auth/protocol/input, token revocation and real action routing with a mocked provider boundary.
- [x] Update product/design/operation docs. Run targeted checks, full local test suite, typecheck, lint, web build and diff checks. Record that UI/device/live-model validation remains pending.

## Decisions

Selected approach: implement the core improvements plus an isolated optional MCP experiment. No inactive integration placeholders and no new Alexa-dependent UI.

## Completion record, 2 October 2026

Completed the agreed code scope, including the optional disabled MCP experiment. `npm test`: 80/80 passed; typecheck, lint, web build and `git diff --check`: passed. The Impeccable source detector reported no findings for the changed phone component and stylesheet. The preview fixture was updated and syntax-checked, never started.

Regression coverage includes captured Send/tap samples, closed intervals and failed retries, literal captions and scoped references, optional quiet thread updates, follow-ups to displayed updates, typing/read-aloud and reconnect deferral, stale-sample opt-out, seek/revocation cancellation, and MCP access/action routing. Model boundaries are mocked in these checks; semantic answer quality is not thereby proven.

Stopped before all browser, phone and Vega UI testing. No live provider request, AWS deployment, relay restart, native package installation, commit or push was performed for this change. Prior device results describe their earlier builds only. The web assets are rebuilt; a running relay must load the new server code before subsequent testing.

Operation: [personal-pause.md](../../personal-pause.md), [mcp.md](../../mcp.md). Production validation, external MCP clients and any live Alexa presentation remain outside this code-only completion.
