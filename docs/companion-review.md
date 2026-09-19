# Companion code review — September 19, 2026

Reviewed the current `selene` Git project, including the user's uncommitted changes. The old `selene_test` directory no longer exists. Work was solo. Checks ran through code and command-line tools; no app, browser UI, VVD or device was opened or controlled.

## What the application actually does

The launch flow is `src/App.tsx` → `src/Companion.tsx` → native Vega Media Controls discovery → an explicitly selected session → `web/CompanionMoment.tsx` → `/api/companion/moment` → the real model, context tools and grounding review → the shared SVG renderer. Native controls re-read the selected identity and report provider state. Closing a moment does not resume playback.

The original stories, captions, `OwnPlayerSession`, narration/video authoring scripts and `/api/moment` are connected to the explicit original-player option. They are secondary to the companion, not fake third-party integrations. Shared agent, graph, visual, navigation and voice code serves both paths. Companion sessions now return only a session ID; they do not receive the original story or transcript.

The current product is a **standalone companion for providers that expose Vega sessions**. It does not display an overlay or third-party video inside SELENE. “Keep watching” requests continued provider transport; it does not establish that the other application's picture remains visible while SELENE is foreground. The original PRODUCT.md still describes the own-player MVP; the feature map and README describe the later companion direction.

## Fixed findings

| Fault | Change |
| --- | --- |
| A notification replaced the snapshot object and caused a pending native reply to be discarded | Stable moment ownership guards replies and listeners; cancellation invalidates late work without relying on object identity |
| Notifications and refreshes moved the question timestamp, breaking clarification and Life Connection grounding | The selected snapshot stays fixed; only actual transport state changes |
| A second metadata read could reopen a cancelled moment | Reuse the guarded selection result; remove the duplicate read |
| A late notification from an old provider could affect a new provider with the same numeric session ID | Listener ownership is scoped to the open moment and invalidated on close |
| Provider notifications could arrive before the WebView registered its receiver | Publish current playback/subscription state on WebView load as well as subscription completion |
| Graph tools returned a general rule that response validation could not accept | Lookup, cached visuals, citation validation and review share the same available graph scope |
| A scene feed could match a bare content ID from the wrong catalog/provider/time | Require exact package, catalog, content and sampled time; bound response bytes; reject redirects and future evidence |
| A clarification re-fetched external evidence and could change scenes when the source changed or failed | Reuse the original evidence within that session and selected moment |
| Microphone/read-aloud trusted stale paused state and continued after provider resume | Re-read state, require change notifications, stop speech on resume/unknown state, and withdraw the mirrored Life question |
| Private pairing supplied an unusable loopback phone address; revoked streams left private text/speech active | Require reachable HTTPS configuration; send an explicit close event and clear private output on revocation/disconnection |
| Native rewind/fast-forward sent a field the player ignored | Use the existing relative seek message contract |
| Contract failures gave the model no actionable correction details | Include schema paths and constraints in the existing single repair, with safe failure diagnostics in the synthetic live-check script |
| An unused external memory proposal discarded a complete answer | Host drops external proposals before evidence review; third-party accounts still cannot write graph memory |
| Continued-playback responses could exceed the prompt's 35-word limit | Enforce that limit at the response boundary; paused responses retain the 55-word limit |
| Provider-neutral companion screen contained a soccer-specific starter question | Remove the canned prompt; the viewer supplies the request and optional scene detail |
| A failed fresh request could leave an earlier clarification usable | Clear the session clarification before each non-continuation request and reject stale follow-ups |
| Life visibility could be changed before a private mirror was paired | Require an active mirror before accepting the visibility update |

The authored offside concept now includes the opponents' half and distinguishes position from an offence, with a source link to [IFAB Law 11](https://www.theifab.com/laws/latest/offside/). No player position or referee decision is hardcoded into production responses.

## Code verification

- `npm test`: 25 Node tests, including real loopback HTTP routes with external/model/native fixtures confined to test code.
- `npm exec -- jest --runInBand`: one native React fallback test, without opening an app.
- `npm run typecheck`: both native and web TypeScript projects.
- `npm run lint`: native, web and TypeScript test code; intentional `void` calls and native bitmasks are documented instead of producing warning noise.
- `npm run build`: web bundle and Vega release packages for aarch64, armv7 and x86_64. Packaging uses the existing SDK; no installation or launch.
- `git diff --check` and Node syntax checks for changed relay code.

The live check uses the configured HTTPS model with explicitly synthetic provider metadata and viewer detail. It exercises actual tool calls, Structured Outputs, grounding review and SVG safety. It cannot establish Prime Video provider availability, content access or renderer layout. Initial runs exposed a schema failure and an unwanted memory proposal; those led to the fixes above.

**Live result: not fully passed.** An intermediate companion explanation completed with a validated SVG in 77 seconds. The subsequent Life Connection run failed before the external-proposal fix. Final reruns after that fix could not connect to the configured endpoint (`ETIMEDOUT` / `EHOSTUNREACH`), including an IPv4-first diagnostic retry; no model reply was received. Deterministic HTTP tests cover source-unavailable fallback and safe model-failure handling, but do not replace a final successful live check. The synthetic success/failure payloads are in ignored `artifacts/live-companion*.json`; the latest network log is `artifacts/code-review-live.log`.

The final release build completed for all three architectures; `artifacts/code-review-build.log` records the output. The SDK still reports its missing optional React Native asset glob, locale/color warnings, and default app icon. It nevertheless validates the manifest and produces the packages; that is build evidence, not device execution evidence.

The source changes reuse the existing TV controls and styles. The source-only check against the [Impeccable catalog](https://impeccable.style/slop/) focused on actionable labels, existing focus/contrast rules and avoiding additional decorative containers. Pixel layout and D-pad behavior remain device checks.

## Remaining production gates

1. **Real provider participation and foreground behavior.** Code tests cannot establish whether retail Prime Video or a sports app exposes sessions, position and controls. No third-party overlay/invocation API is integrated.
2. **Automatic scene access.** `SELENE_SCENE_CONTEXT_URL` is not configured in this environment. The adapter is real HTTP code, but no authorized scene provider is connected. Viewer-supplied context remains the working fallback.
3. **Private deployment.** `SELENE_PRIVATE_URL` is not configured. The relay has no public client authentication or per-account usage controls. Keep model/session APIs on the trusted loopback/device boundary; a public deployment requires authentication and limits, and a mirror proxy should expose only token-scoped read access and static assets.
4. **Latency and device behavior.** A successful intermediate live explanation took 77 seconds, which is too slow for a brief viewing interruption. Benchmark a lower-latency model that still passes this contract before release. Code-only checks cannot prove microphone availability, audio routing, ten-foot readability or visual layout on Vega.

## Two viable directions

**Recommended now:** keep the standalone companion honest and narrow: supported provider selection, fixed sampled moment, viewer-detail fallback, explicit controls and one response. Keep the original player as an explicit reference/demo. Connect one real authorized context provider before expanding automatic coverage.

**For the full in-app assistant:** secure a supported host/provider integration for invocation, video-preserving presentation, context and audio ownership. Implement that concrete contract when available. Adding more generic adapters, guessed privileges or simulated provider data will not supply those capabilities.
