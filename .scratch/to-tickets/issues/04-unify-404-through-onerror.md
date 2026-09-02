# 04: Route unmatched-route 404s through the single onError chokepoint (unify 404 shapes)

## Source

Prioritized DX review — H2 (two 404 shapes / router 404 bypasses onError).

## What to build

A `404 Not Found` must have one consistent shape and flow through the library's single error chokepoint.

Today there are two:
- A handler that throws `fail.notFound()` returns `application/json: {"error":"post not found"}` **through** `onError`.
- An unmatched route (no matching path/method) returns Hono's default `text/plain: "404 Not Found"` and **bypasses** `onError` entirely.

Live probe confirms the unmatched-route case responds `404 text/plain "404 Not Found"`. This breaks the "single chokepoint for all errors" guarantee (ADR-005) and hands API consumers two content types for the same status — a client calling `res.json()` on a wrong path gets a parse failure, and the auto-documented `404` OpenAPI entry (which implies a JSON `{error}` schema) is untrue for the unmatched-route case.

## Acceptance criteria

- [ ] `OpenAPIHono` registers an `app.notFound` handler that returns `application/json` using the shared `createErrorHandler` policy (e.g. `{"error":"Not Found"}`), not Hono's default text.
- [ ] The unmatched-route response now matches the shape and content-type of a `fail.notFound()` response.
- [ ] Both `createApi()` (which installs a `createErrorHandler(opts.debug)` `onError`) and bare `new OpenAPIHono()` (default handler) surface the unified 404.
- [ ] A committed selfcheck (`src/openapi.selfcheck.ts`) asserts an unmatched route returns status 404, `content-type: application/json`, and an `error` field.
- [ ] `nub run check:all` passes (lib + basic + blog + auth).

## Blocked by

None (can start immediately).
