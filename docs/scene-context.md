# Licensed third-party scene context

Set `SELENE_SCENE_CONTEXT_URL` to an authorized HTTPS endpoint (loopback HTTP is allowed for local development). SELENE sends the selected Media Controls identity and sampled position:

```json
{
  "provider": {
    "package_id": "com.example.player",
    "session_id": 12,
    "catalog_name": "catalog",
    "content_id": "licensed-content-id",
    "title": "Title supplied by the provider",
    "provider_name": "Example Player",
    "at_seconds": 412.5
  },
  "at_seconds": 412.5
}
```

The endpoint must return JSON whose identity and time match the request exactly:

```json
{
  "verified": true,
  "provider_package_id": "com.example.player",
  "provider_catalog_name": "catalog",
  "provider_content_id": "licensed-content-id",
  "at_seconds": 412.5,
  "source": "Your authorized source",
  "transcript": [{"id": "line-1", "start": 400, "end": 405, "text": "Completed dialogue"}],
  "facts": [{"id": "fact-1", "available_at": 405, "text": "A fact visible by that time"}]
}
```

An optional `scene` has `id`, `label`, `start`, and `end`; its bounds must contain the requested time. Labels must not disclose later events. `verified` is an assertion by your configured source, not proof of a license obtained by SELENE. Configure only a source you are authorized to use.

SELENE accepts at most 128 KiB of response data, 40 transcript lines and 40 facts, drops unfinished/future evidence, rejects package/catalog/content/time mismatches and redirects, and keeps the returned evidence out of durable Connection Graph memory. A clarification reuses the original evidence rather than fetching a possibly changed scene. A bearer token may be supplied with `SELENE_SCENE_CONTEXT_TOKEN`; the value is never returned to the client or logged. Source failure leaves the viewer-detail fallback available; cancellation stops the request.

Without this endpoint the companion remains honest: it uses provider metadata and any scene detail the viewer supplies. The endpoint does not grant an overlay, Prime Video participation, or control of another app's captions or audio.
