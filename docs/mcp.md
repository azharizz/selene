# Optional private-help MCP experiment

Implemented as `POST /api/mcp` in the existing relay. Disabled unless `SELENE_MCP_ENABLED=1`. It calls the same private actions as the phone; there is no parallel recap engine or new dependency. This is an independent developer experiment, not a live Alexa+ integration.

## Enable when ready to exercise it

1. Set `SELENE_MCP_ENABLED=1` in the relay environment and restart the relay. Remove the setting to disable the endpoint again. No deployment setting is changed by the implementation.
2. Pair a phone with the own-player TV session through the normal code flow. Use that viewer's private capability as the MCP Bearer credential. Treat it like a password; never paste it into a prompt, log, source file or public demo. The TV-owner session ID is not accepted.
3. Use a trusted MCP client that supports custom authorization headers. Configure the same relay's HTTPS `/api/mcp` URL, `Authorization: Bearer <paired-viewer-token>`, `Content-Type: application/json`, and `Accept: application/json, text/event-stream`. Loopback HTTP is only for local development. A separate proxy must explicitly allow this POST route; it is unnecessary for ordinary phone use.
4. Initialize with the supported protocol, then send the initialized notification. All subsequent requests include `MCP-Protocol-Version: 2025-11-25`.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"selene-local-client","version":"1.0.0"}}}
```

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_viewing_context","arguments":{}}}
```

The endpoint implements JSON responses over Streamable HTTP, with no GET/SSE transport or MCP session header. The paired-viewer capability scopes state. Unsupported GET/DELETE returns 405; successful notifications return 202. HTTP disconnection alone does not cancel an MCP action; `notifications/cancelled` with its matching `requestId` does. Model generation remains deadline-bounded. One active MCP action is allowed per pairing.

## Tool flow

| Tool | Data and behavior |
| --- | --- |
| `get_viewing_context` | Confirmed playback sample plus this viewer's hold, answer, return and followed thread. No full transcript, future scene data or TV-owner credentials. |
| `save_place` | On first Send, copy `content_version`, `epoch`, `sequence`, `at_seconds` from the captured sample. Follow-ups reuse the returned hold. `from_seconds` is optional and only for an explicitly requested earlier catch-up. |
| `ask_question` | Use `branch_id`, frozen `at_seconds`, `request`, `clarification`, `new_topic`, and the existing `need`, `language`, `recipient` fields. Defaults for the simple phone are `Show visually`, `English`, `everyone`; communication needs belong in the question. |
| `catch_me_up` | On the viewer's request, capture a fresh sample. Submit `branch_id`, `from_seconds`, `through_seconds`, `content_version`, `epoch`, `sequence`, and the same three explanation fields. The endpoint never moves during generation. |
| `follow_thread` | Explicit opt-in/out with `enabled` and the answered question's `answer_id`. One topic, with no TV transport authority. |
| `check_thread` | Submit a confirmed sample. Checks are source-gated and throttled to 15 seconds; quiet results are not new explanations. The client controls polling and must defer presentation during typing or speech, as the phone does. |
| `end_help` | Close the active `branch_id`, private answer and followed topic. |

Always read actual tool schemas from `tools/list`. Sample checks reject stale, fabricated, wrong-film and previous-seek positions. Successful catch-up closes the hold; a failed return retains it. Pair replacement or revocation invalidates its Bearer token and cancels outstanding work. The token exposes the same private help as that phone, so connect it only to a trusted client. It does not authenticate a household account or provide OAuth discovery.

## Verification and platform limits

`node --test test/relay.test.mjs test/private-continuity.test.mjs` exercises HTTP initialization, tools, shared actions, origin/protocol/auth rejection, revocation, sample boundaries and thread behavior with a mocked model provider. It does not prove external MCP client compatibility, live answer quality, Alexa+ access or device behavior. Browser, phone and Vega testing is deliberately deferred for this code-only request.

The implementation follows the [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) documentation. The [hackathon FAQ](https://amazonappdev2026.devpost.com/details/faqs) distinguishes an independent MCP demonstration from gated Alexa+ tooling. [X-Ray Recaps](https://www.aboutamazon.com/news/entertainment/amazon-prime-video-x-ray-recaps) has no established public integration in this project. [AVG](https://www.developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-avg-format.html) belongs to an Alexa presentation; phone and Vega continue using validated SVG and WAAPI.
