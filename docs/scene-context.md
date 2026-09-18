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

The endpoint must return JSON with `verified: true`, the same `provider_content_id`, a non-empty `source`, and optional time-coded `scene`, `transcript`, and `facts` fields. SELENE drops future transcript lines and facts, rejects identity mismatches, and keeps the returned evidence out of durable Connection Graph memory. A bearer token may be supplied with `SELENE_SCENE_CONTEXT_TOKEN`; the value is never returned to the client or logged.

Without this endpoint the companion remains honest: it uses provider metadata and any scene detail the viewer supplies. The endpoint does not grant an overlay, Prime Video participation, or control of another app's captions or audio.
