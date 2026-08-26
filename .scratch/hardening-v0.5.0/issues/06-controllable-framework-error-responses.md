# 06: Controllable framework error responses

**What to build:** Framework-guaranteed error responses in the OpenAPI spec (400, 401, 404, 500) are accurate, non-noisy, and deduplicated — auto-documented only where they can actually occur and suppressible by explicit route declarations, with a single shared error schema component.

**Blocked by:** 04: Single onError chokepoint with safe debug policy, 05: Deterministic OpenAPI spec emission

**Status:** done (committed b6354f3, verified 2026-08-26)

- [x] `400 Bad Request` appears only for routes with validated `body`/`query`/`headers`/`params`, `401 Unauthorized` only for routes with a registered `AuthScheme`/`security`, and `500 Internal Server Error` always — all sharing one deduped `{ error: string }` component schema instead of repeated inline schemas
- [x] `404 Not Found` auto-inject for path-param routes is controllable: declaring `responses: { 404: ... }` suppresses the heuristic, and the heuristic itself is documented as a `ponytail:` with a clear ceiling/upgrade to an explicit `documentNotFound` opt-in; specs for non-param routes are not polluted
- [x] `auth(name, mw, scheme)` registering a bearer/basic/apiKey scheme produces `components.securitySchemes` and per-route `security: [{ name: [] }]` only where the route's `auth` name has a scheme, so Scalar lock icons match runtime auth without manual spec edits
- [x] Verified via `app.request` status checks (validated vs unvalidated, authed vs public, param vs non-param) and `/openapi.json` assertions that the 400/401/404/500 entries appear exactly where expected and deduplicate to one component
