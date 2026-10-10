# Automatic Phone Conversation Invitations Implementation Plan

**Status:** Recommended implementation authorized on 10 October 2026. Code and automated checks completed; stopped before Vega/Fire OS and paired-phone runtime testing as requested. No commit, push, or running development-service changes.

**Goal:** Automatically show several contextually timed, personalized invitations on the paired phone that help the people watching talk together.

**Architecture:** A relay-side agent plans its next check from fresh TV playback context. A bounded session timer wakes it to read the latest existing context and decide whether to publish several invitations or reschedule. The current paired-phone event stream delivers invitations independently of questions, answers, Guided Return, and Follow thread.

**Tech Stack:** Existing Node relay, model completion wrapper, Ajv validation, React paired-phone page, server-sent events, and Vega/Fire OS playback reports. No new dependency or external service is proposed.

**Spec:** The confirmed requirements and proposed decisions below were reviewed in this chat. The user selected the recommended agent-driven version and requested code first, with no commit and no TV OS or paired-phone runtime tests.

## Confirmed requirements

- Always enabled for an active paired viewing session. No enable switch, permission-to-show step, or Generate button.
- Show the invitations automatically on the **paired phone only**.
- Use the TV's actual content and playback timing. Both Vega OS and Fire OS remain playback sources.
- An AI agent estimates an opportunity early, schedules a wake-up, then gathers fresh context at that wake-up.
- Personalization must change the meaning and direction of the invitations, using existing grandparent, parent, child, and adult context.
- Provide several options, rather than one question.
- Reuse only information the current application already obtains. Do not introduce new history collection, storage, profile enrollment, room listening, or data feeds.
- Help people converse with each other. Automatic appearance does not require recording their answers.
- Implement the recommended version in the current checkout. Do not commit or push; stop before TV OS or paired-phone runtime testing.

## Existing context that can actually be reused

| Existing source | Available information | Boundary |
|---|---|---|
| `server/personal.mjs` playback snapshot | Content/version, position, state, playback rate, sequence, seek epoch, freshness | Reports older than six seconds are stale. A video position is not necessarily a sports match clock. |
| `server/context.mjs` scene context | Title, duration, scenes, every completed caption up to the captured position, available source facts, bounded per-title graph | Exclude future dialogue and facts. Reaching a position does not prove every earlier second was watched. |
| TV `session.assistant.turns` | Up to six recent routed viewer/assistant turns | Ephemeral; not a complete lifetime history. Turns lack per-turn source timestamps and must remain interest context. |
| TV `session.memory.lastExplanation` | Latest explanation request, answer, captured content/time | Generated answers support continuity, not proof of an event. |
| Phone `mirror.assistantSession` | Its own recent assistant turns and last explanation | Belongs to this paired capability. Do not transfer across pairings or sessions. |
| Phone hold/help | Original and latest question, anchored previous answer, current requester/preferences, clarification context | Read what is already retained; do not create an additional conversation archive. |
| Phone followed thread/return | Followed question, latest explanation, requester/preferences, cited evidence, completed recap where retained | Keep these operations independent and preserve their existing state. |
| Existing personalization | Host-resolved audience metadata on completed responses; requester role/style/language where already retained in hold, thread, or clarification | A stored household profile is not evidence that its owner is currently watching. Do not expose embeddings or enumerate unused profiles to the model. |

The context adapter will read existing TV and paired-phone state without mutating it. Available sources will be labeled by origin and confidence. It will remove SVG/animation payloads and duplicate items, retaining source captions and useful textual interests. No additional model-generated history summary will be persisted.

Roles are useful for question design, not proof of presence, identity, age, personal memories, or family relationships. A newer explicit declaration takes priority for that request. An explicit declaration without an ID cannot establish which of several people with that role spoke. Conflicting or incomplete context leads to inclusive phrasing instead of an invented participant roster.

## Two technical approaches

1. **Recommended: agent plans, host schedules, agent reassesses.** Internal tools expose a read of existing viewing/conversation context and a bounded request to schedule the next check. The model chooses the opportunity; the relay validates and executes the timer. This follows the requested initiative and allows changing conditions.
2. **Simpler comparison: deterministic timing, agent writes invitations.** Host rules choose duration/end/break checks; the model only creates the options. This needs fewer planning calls but gives the agent less control over when it appears.

Both approaches are always enabled and automatic. The remainder specifies approach 1 for review.

## Timing and wake-up behavior

1. When the paired phone first opens and a fresh TV report exists, read current timing and ask the agent to select the next useful check. Joining a match late starts from its current context, not from the beginning.
2. Store one pending check per paired TV session, tied to its content version, seek epoch, and pairing capability. Store scheduling/output state only; do not add a history store.
3. The internal `get_conversation_context` tool reads the allowed existing context. The internal `schedule_conversation_check` tool accepts a bounded target/delay and reason. No public Alexa/MCP integration is needed for these internal tools.
4. The host validates finite timing, scope, and an allowlisted opportunity kind. A target in playback seconds is converted using current position/rate. A paused or buffering stream does not advance because wall-clock time passed.
5. When the timer wakes, read fresh playback, completed captions, retained interactions, and personalization again. Decide to show invitations, reschedule, or remain quiet when evidence/provider availability is insufficient. No viewer confirmation is needed.
6. A seek, content change, playback-rate change, pause/resume, actual end event, or meaningful new timing evidence invalidates or brings forward the relevant pending estimate. Ordinary heartbeats do not trigger a model call each time.
7. Before publishing a completed model result, verify the pairing, content, seek epoch, and a fresh playback sample again. Discard results from a revoked pairing or old timeline.

### Football example

- If existing, supported context identifies the match clock as about 70 minutes, the agent can schedule an estimated check roughly 20 minutes later at normal playback speed.
- If the only known value is 70 minutes into the video, record that uncertainty; do not silently reinterpret it as the match clock.
- At the wake-up, read fresh evidence. If play continues, do not claim full time; defer to another check or offer an invitation explicitly about the match **so far** when the agent judges that suitable.
- Stoppage time, extra time, interruptions, and highlights can make the initial estimate wrong. A confirmed break/end overrides that estimate.
- Team names and scores come from existing captions/facts, never from a guessed fixture or a live-score API added for this feature.

### Movie/show example

- Remaining playback time and total duration give an initial end estimate. Plan an assessment near that boundary.
- Fresh captions, existing scene metadata, and the actual ended state inform whether to show or defer. Total duration alone does not identify the start of credits or a calm scene.
- Ended playback can bring the check forward; a phone paired after the ending can get one automatic assessment from the available completed context.
- Earlier opportunities are possible when the current evidence supports them; the feature is not restricted to endings.

### Proposed operational defaults for review

- One outstanding timer and one generation per session; no continuous model polling.
- Use a minimum 30-second interval for repeated agent checks. Playback lifecycle changes may trigger an immediate reassessment.
- Do not display the same boundary's invitation set twice. Use a ten-minute cooldown between different non-final sets; a newly confirmed ending may bypass the cooldown once.
- Viewer questions have priority over background generation. Reuse the relay's existing concurrency limit; defer rather than cancel an active answer.
- On provider failure, allow one delayed retry after 60 seconds while the scope remains valid, then wait for new playback evidence. Do not generate a generic invented fallback.
- Clear timers and abort generation on unpair, session end, content replacement, or relay shutdown. A relay restart loses the current ephemeral session; normal session/pairing recovery starts a new plan.

## Personalization and multiple options

**Proposed count:** Aim for three distinct, complete invitations per appearance. Two are acceptable if only two are grounded. If fewer than two can be supported, defer rather than publish one question or pad the set.

Each option contains a short readable angle and one complete open question. The content connection is part of the invitation. Every question is visible automatically; no tap is required to reveal the actual choices. Selecting an option, dismissing, or voluntarily asking a follow-up can remain optional interactions.

Personalization uses the existing role, explicit interests/needs, language, and style together. The following are possible directions, not mandatory role templates:

| Existing role context | Possible conversational direction | Avoid |
|---|---|---|
| Grandparent | An experience, an opinion, a comparison across their own life, or expertise | Assuming a decade they lived through, forcing nostalgia, or implying frailty |
| Parent | A choice, family experience, values, or something to explore together | Assuming every parent wants parenting advice |
| Child | A concrete observation, playful possibility, or invitation to ask another viewer | Testing comprehension or making childish language automatic regardless of preference |
| Adult | An interpretation, tradeoff, connection, or comparison with experience | Treating the person as a parent or forcing serious debate |

For a mixed group, vary the options: one personal experience, one comparison/opinion, and one inclusive group question where the context supports those directions. Do not manufacture a role-specific option for a person the current context has not established. Couple/friend relationships are used only if already stated; otherwise use wording everyone can join.

Example for a supported playground scene, with grandparent/child context already available:

1. **Remember together:** “What games did you enjoy growing up, and who taught you to play?”
2. **Imagine together:** “If you could invent a game for that playground, what would everyone need to do?”
3. **Compare experiences:** “Which game would each of you teach the others, and why?”

These are illustrative wording only. Real generation must anchor the set to the supplied scene and interactions. It can reference an earlier viewer question, but must not present an earlier generated answer as a new source fact.

## Phone behavior and delivery

- Add an independent conversation-invitation area to `web/PrivateMirror.tsx`; retain the current answer, draft, hold, return, and followed thread.
- Publish a dedicated phone event with one stable set ID, captured position, boundary identity, and options. Include the latest valid set in the reconnect bootstrap.
- Keep the existing own-player guard that prevents shared TV answers replacing private phone help. Do not remove that guard to deliver this new event; explicitly allow/publish only the conversation event.
- Invitations appear as readable text. Do not automatically speak, start a microphone, submit a question, pause the TV, or steal keyboard/screen-reader focus.
- If the person is typing, recording, submitting, or receiving an answer, queue the incoming set. Reveal it automatically once that interaction is idle and the scope is still valid; no approval click is required.
- The server owns the wake-up even when the phone browser is temporarily suspended. A locked/background browser cannot be promised to show new content; reconnect revalidates the latest set before showing it.
- Clear a queued/displayed set on content/seek-scope change or revoked pairing. Do not replace it with stale options from an earlier connection.
- A sports score is a statement at the captured moment, not a constantly updated scoreboard. Avoid stale “currently leading” wording when replaying an older set.

## Implementation tasks

### Task 1: Existing-context adapter and invitation agent

**Create:** `server/conversation.mjs`, `test/conversation.test.mjs`.
**Reuse:** `server/context.mjs`, `server/personal.mjs`, `server/agent.mjs` completion wrapper; existing requester metadata without changing enrollment or matching.

- [x] Add tests for completed-caption boundaries, existing TV/phone history, provenance, deduplication, and exclusion of embeddings/unrelated profiles/other sessions.
- [x] Define `conversationContext(session, now)` to return identity/timing, bounded source evidence, retained textual interactions, and existing preference context. Never treat response caches as an ordered chat archive.
- [x] Define an internal bounded agent round with the context-read and schedule tools. A turn can return a validated schedule or a validated invitation set; reject unknown tools and arbitrary URLs/actions. Limit a round to four tool calls and a 30-second deadline.
- [x] Validate a set with two or three unique option IDs, nonempty angle/question, existing evidence IDs, and explicit audience provenance where known. Limit angles to 60 characters and each question to 280 characters; render text as text.
- [x] Require supported factual premises and original citations; use a lightweight text grounding review through the existing completion wrapper. Permit one revision attempt, then stay quiet on unresolved factual errors. Do not run the ordinary animated-diagram generation pipeline for conversation invitations.
- [ ] Test role differences semantically: an invitation to share a memory, imagine a possibility, or discuss a choice must change in substance. Changing only “Grandma” to “Child” does not pass. Also test unknown/conflicting roles, source-text instruction injection, duplicate options, unsupported scores, and future-caption leakage.

**Check:** `node --import ./test/bootstrap.mjs --test test/conversation.test.mjs`; expect all new boundary and personalization tests to pass with only the provider boundary mocked.

### Task 2: Scheduling and relay integration

**Create:** `server/conversation-scheduler.mjs`, `test/conversation-scheduler.test.mjs`.
**Modify:** `server/index.mjs`, `test/relay.test.mjs`.

- [x] Define `updateConversationSchedule(session, hooks)` and `closeConversationSchedule(session)` to own one timer/controller, deduplication, and the latest valid set. Hooks supply the current time, timer functions, agent round, and phone publisher so timing is testable without real waits.
- [x] Begin automatic planning when the paired event stream connects with fresh own-player playback. Update the scheduler after accepted playback reports; connect it to pairing replacement and session cleanup.
- [x] Use model-selected estimates plus lifecycle invalidation. Implement freshness checks, scope checks, cooldown, viewer priority, retry budget, and cleanup exactly as specified above.
- [x] Add the dedicated conversation event and reconnect state while keeping ordinary private help and TV playback responses intact. Do not expose a new public scheduling endpoint.
- [x] Use fake time to test a 70-minute context and 20-minute wake-up, fresh reread at wake-up, pause/seek/rate changes, early end, continued play at the estimated end, missing match clock, stale reports, duplicate heartbeats, disconnected/replaced phone, provider failure, and shutdown.
- [x] Test that neither planning nor delivery issues transport commands, changes current answers/history, or publishes private material to a TV renderer.

**Check:** `node --import ./test/bootstrap.mjs --test test/conversation.test.mjs test/conversation-scheduler.test.mjs test/relay.test.mjs`.

### Task 3: Automatic paired-phone presentation and end-to-end verification

**Modify:** `web/PrivateMirror.tsx`, `web/personal.ts`, `web/style.css`, `test/companion-web.test.mjs`, `README.md`; rebuild tracked web assets through `npm run build:web`.
**Verify existing integrations:** `src/Player.tsx` and `fireos/src/Player.tsx` remain compatible playback sources. No new TV UI is required.

- [x] Add the invitation-set type and isolated phone event/state handling. Display every option automatically and preserve private question/answer state.
- [x] Reuse the phone's existing busy/editing/voice/visibility checks for queued delivery and automatic reveal, with a separate queue from Follow thread.
- [x] Test automatic arrival without a click, two/three visible options, typing and voice deferral, reconnect deduplication, old-scope clearing, unpair cleanup, text escaping, and unchanged draft/help/follow behavior.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, `npx jest --runInBand`, and `npm run build:web`. In `fireos/`, run `npx tsc --noEmit`, `npm run lint`, and `npm run test:voice` to catch regressions in the existing pairing/voice integration.
- [ ] Exercise the current Fire OS emulator with a paired HTTPS browser: no show/enable button; real playback reaches a planned opportunity; multiple options arrive only on the phone. Test TV pause, seek, ending, phone editing, reconnect, and continued play after an estimated sports ending.
- [ ] Test the real model separately for role-dependent invitations, distinct choices, source grounding, and use of retained interactions. Automated fixture tests do not establish conversational quality.
- [ ] Verify Vega pairing/runtime when its device is available. If unavailable, distinguish Vega source/type/build checks from actual runtime proof; do not substitute Android evidence for Vega.
- [x] Document actual results and limitations. No commit/push is part of the current planning authorization.


## Acceptance criteria

- [ ] After ordinary phone pairing, the feature starts by itself, without enabling or generating anything manually.
- [ ] The agent selects a future check and reads fresh context when it wakes; it does not merely replay content generated at the beginning.
- [ ] Changing retained requester role/preferences or relevant earlier questions changes the conversational direction where supported.
- [ ] Two or three useful, distinct invitations appear together on the paired phone, with no conversation UI added to the TV.
- [ ] A sports estimate does not become an unsupported final whistle or guessed score. Movie timing does not leak future captions.
- [ ] Pauses, seeks, stale reports, revoked pairing, model failure, and reconnects cannot deliver an old or duplicate set.
- [ ] Existing TV/phone questions, voice capture, private answers, Guided Return, and Follow thread continue working.
- [ ] No additional history persistence, room recording, profile collection, or third-party feed has been introduced.

## Operating limits

- The user selected the recommended approach. The implementation uses the three-option target, timing/cooldown defaults, and silent presentation described above; conversational quality and timing still need live validation.
- “Use existing context” can combine retained current TV and paired-phone interactions for this paired phone. It cannot recover earlier sessions that the application no longer retains.
- Role-specific invitations depend on personalization already available at wake-up. With no such context, use inclusive invitations; do not fabricate a family roster or start listening automatically.
- This plan delivers automatic scheduling for the existing own-player pairing flow on Vega and Fire OS. The current third-party companion path shares answers but does not expose the same continuously synchronized phone timeline. Universal third-party scheduling would require additional integration beyond the existing-data-only constraint.
- Locked-phone OS notifications are outside the current browser pairing capability. Automatic appearance is delivered when the paired page is active or revalidated on return.
- Session scheduling is relay-side and ephemeral. It is an application feature, not a Codex automation or a permanent device alarm.

## Implementation record, 10 October 2026

Implemented `server/conversation.mjs` (read existing context, internal model tool loop, strict schemas and one-revision text review), `server/conversation-scheduler.mjs` (one ephemeral schedule, lifecycle invalidation, cooldown, retries, cancellation and foreground priority), relay event/bootstrap integration, and a separate readable invitation section in the paired phone page. Both TV apps already publish the required playback contract; their source and UI do not need changes. No dependency, public scheduling API, profile enrollment, or history persistence was added.

Code checks completed:

- `npm test`: 167 passed. New checks cover context boundaries/provenance, requester metadata transmission, invalid outputs and grounding-review rejection, fake-time schedules, playback lifecycle, cancellation, retries, cooldown, SSE reconnect/clearing, and automatic phone-controller rendering/deferral. Provider boundaries are mocked; semantic model quality is not established by these tests.
- `npx jest --runInBand`: 23 passed across two suites.
- `npm run typecheck`: Vega and web passed.
- `npm run lint`: no errors; the three pre-existing warnings in the native test mock and web voice helper remain.
- Fire OS `npx tsc --noEmit`, `npm run lint`, `npm run test:voice`: passed, including seven voice/plugin tests.
- `npm run build:web`: passed; tracked phone/web assets regenerated.
- Static UI detector: no findings. No browser screenshot or paired-device UI check was performed.

Pending at the user's requested stop point:

- [ ] Evaluate real model invitation quality and role-specific meaning with representative caption/history inputs.
- [ ] Inspect actual phone layout, focus, accessibility, automatic appearance and reconnect behavior in a browser.
- [ ] Exercise a real paired phone with Fire OS emulator playback and then Vega runtime.
- [ ] Measure actual model latency and scheduling behavior through a full viewing session.

No TV emulator/device was launched, no phone was paired, no native package was built/installed, and no live development relay was restarted for this work. HTTP integration tests run only isolated fixture relays with a mocked provider.
