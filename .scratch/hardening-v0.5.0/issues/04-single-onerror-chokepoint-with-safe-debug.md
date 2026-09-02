# 04: Single onError chokepoint with safe debug policy

**What to build:** Every error — handler-thrown typed HTTP errors, ArkType validation failures, and unexpected throws — flows through a single error handling policy for both the low-level OpenAPI class and the high-level builder, with the builder's debug option safely gated for production use.

**Blocked by:** 01: Rebuild and gate the published artifact

**Status:** done (committed 5eec106)

- [x] Validation failures, `throw fail.*` / `throw new APIError`, and uncaught handler throws all reach one `app.onError` policy that logs server-side and returns `{ error: string }` to the client with the correct `ContentfulStatusCode`; no duplicated policy between the low-level class and the high-level builder
- [x] `createApi({ debug: true })` includes the real `error` message and `stack` for unexpected 500s (useful in development), while the same path when `NODE_ENV=production` or without the flag returns the generic internal message and warns/redacts — no absolute paths or code snippets leaked by accident
- [x] `arktypeValidator` contract holds: on `ArkErrors` it throws the typed HTTP error so custom `onError` handlers (request IDs, structured logging) see 400s, and client-visible shape stays `{ error: string }` 400
- [x] Verified via `app.request()` for 400 validation, 401/403/404 via typed errors, and 500 unexpected throws with and without debug, using the existing lib selfcheck pattern against the `app.request` seam
