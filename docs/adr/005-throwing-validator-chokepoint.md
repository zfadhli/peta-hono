# ADR 005 — Throwing validator + single onError chokepoint

**Date:** 2026-06-25 (fix 0.2.2, hardened 2026-08-26 issue 04)
**Status:** Accepted

## Context

Early `arktypeValidator` returned `c.json({error},400)` directly, bypassing custom `app.onError` (request IDs, structured logging, prod redaction). Need one policy for three error sources: handler-thrown `APIError`, validator failures, unexpected throws. Also need `debug` dev-mode detail without leaking in prod (Cloudflare/Node/Bun).

## Decision

- `arktypeValidator(target,schema)` **throws** `new APIError(400, result.summary)` on `ArkErrors` (never returns `Response`), so `app.onError` is the only chokepoint.
- Move `APIError` to `src/openapi.ts` (from `src/api.ts`) to break circular `api↔openapi` (validator needs it).
- `OpenAPIHono` ctor installs default `this.onError(createErrorHandler())`; `createApi()` **overrides** with `createErrorHandler(opts.debug)`.
- Shared `createErrorHandler(debug?)`: `if err instanceof APIError → c.json({error:err.message}, err.status)` else `console.error`; `isProd = typeof process!=="undefined" && process.env.NODE_ENV==="production"`; `if(debug&&isProd) console.warn(redacting)`; `effectiveDebug=!!debug && !isProd`; `if(effectiveDebug) {error,stack}` else generic 500.

## Alternatives

- Return `Response` from validator — violates chokepoint, custom `onError` never sees 400s.
- Separate validator error handler — duplicates policy.
- Middleware chain `next(err)` — non-idiomatic for Hono.

## Consequences

- **Migration:** Fixed 0.2.2 (issue #4); `APIError` moved breaks `import {APIError} from "peta-hono/api"` — re-export via `src/api.ts` keeps barrel stable.
- **Testing:** `src/openapi.selfcheck.ts` #5 `assertValidationErrorReachesOnError` mounts probe with failing body, counts `onError` invocations; debug redaction tested with/without `NODE_ENV=production`.
- **Concurrency:** `onError` is per-request Hono hook; no shared state.
- **Docs:** `AGENTS.md` chokepoint section, `ponytail:` comment on log. Known gaps (grilling Q14): `app.notFound` (unmatched routes) bypasses `onError` → returns Hono text/html 404, not JSON. Future `app.notFound((c)=>c.json({error:"Not Found"},404))` in constructor. `process.env` gate leaks in Workers (`process` undefined → `isProd=false`); future check `c.env?.NODE_ENV` first, default redact if ambiguous.

## References

- `src/openapi.ts` — `APIError`, `createErrorHandler`, `arktypeValidator`, `OpenAPIHono` ctor
- `src/api.ts` — `fail`, `createApi` override
- `HANDOFF.md` — issue 04 single chokepoint

