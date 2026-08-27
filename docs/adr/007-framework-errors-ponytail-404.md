# ADR 007 — Framework errors 400/401/404/500 (deduplicated) + ponytail 404 heuristic

**Date:** 2026-07-04 / hardened 2026-08-26 (issue 06 b6354f3)
**Status:** Accepted

## Context

Spec should document `400 Bad Request` only where validation can happen, `401 Unauthorized` only behind a security scheme, `404 Not Found` where resource lookup plausible, `500` always — sharing one `{error:string}` component (not repeated inline). Heuristic must avoid noisy 404 on every route but not miss real resource routes.

## Decision

`_buildResponses(config)` auto-injects with guards `if(!responses[key])`:

- **400** if any validated `request.{body,query,headers,params}` **or** path has `:param` (auto-generated `params` schema via `hasParamTokens(config.path)`) — guard `if(!responses["400"])` respects explicit `responses:{400: schema}` (replaces auto doc, does not suppress 400 entirely). Ponytail: auto-generated params means `GET /:id` documents `400` even though no explicit `body/query` validation was declared; literal wording “validated params” alone diverged before b6354f3 — now intentional and documented. Benign false-positive (path string always passes `type({id:"string"})`) is safe spec noise; ceiling: explicit `hide400`/`errors` opt-out or `responses:{}` exclusion if noise matters. Divergence noted as grilling 06.
- **400** if any validated `request.{body,query,headers,params}` **or** path has `:param` (auto-generated `params` schema via `hasParamTokens(config.path)`) — guard `if(!responses["400"])` respects explicit `responses:{400: schema}` (replaces auto doc). `hide400: true` suppresses the auto 400 entirely (a user-declared 400 still survives). Ponytail: auto-generated params means `GET /:id` documents `400` even though no explicit `body/query` validation was declared; literal wording "validated params" alone diverged before b6354f3 — now intentional and documented. Benign false-positive (path string always passes `type({id:"string"})`) is safe spec noise. **Issue #05 (2026-08-27): `hide400` opt-out built** — the former ceiling is now implemented.
- **401** if `config.security` — i.e. ANY route with `{auth}`. Issue #03 (2026-08-27): a route with `{auth}` is always documented protected even when `auth(name,mw)` is registered WITHOUT a `scheme`; the `scheme` argument only controls the lock-icon kind, and a default `{type:"http",scheme:"bearer"}` is published when omitted so the `security` requirement resolves to a real `components.securitySchemes` entry.
- **404 ponytail heuristic** if path matches `:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??` (any `:param`). Benign false-positive (e.g., `/search/:query`) is noisy but safe; user suppresses by declaring `responses:{404:schema}` (guard `if(!responses["404"])`). Documented as `ponytail:` with ceiling → explicit `documentNotFound` opt-in or `responses:{404:…}` for custom schema. Guard preserves custom 404.
- **500** always if not already declared — via `if(!responses["500"])`.
- **Dedup:** Single `_getErrorSchemaRef()` lazily creates `type({error:"string"})` → `toJsonSchema` → hoisted `schema_<hash>` → `{$ref:"#/components/schemas/schema_<hash>"}` reused for 400/401/404/500.

Success code selection: `config.status ?? lowest 2xx/3xx in responses ?? "200"`. **Issue #08 (2026-08-27):** doc corrected from "first" to "lowest" — JS enumerates integer-like response keys in ascending numeric order, so the default is the LOWEST 2xx/3xx regardless of declaration order; set `status` explicitly when declaring multiple 2xx/3xx. 204 has no `content`.

## Alternatives

- Always emit 400/401/404/500 on every operation — noisy (`/health` would claim 401).
- Never auto-emit — under-doc, `fail.notFound()` runtime 404 invisible in spec.
- Explicit `errors:[400,404]` config array — more control but extra field (noted in `HANDOFF.md` Next Steps as potential feature).

## Consequences

- **Migration:** 0.4.0 minor bump added 404 auto docs (spec drift → minor semver pre-1.0). Consumers pinning `^0.5.0` get spec drift without major — documented as pre-1.0 snapshot-minor contract.
- **Testing:** `blog/selfcheck` asserts `/posts/{id}` has 404, `/health` → no 404, explicit `responses:{404}` suppresses heuristic, single deduped `schema_84c5e…` component count, `components.securitySchemes` + per-route `security` only where scheme present (Scalar lock).
- **Concurrency:** None.
- **Docs:** `ponytail:` comment with ceiling/upgrade (`documentNotFound` opt-in). Next step `errors` array field remains ceiling, not implemented. `src/openapi.ts` `_buildResponses` comment now states `OR path has :param (auto-generated)` and `Guard if(!responses["400"])` respects explicit 400 — addresses grilling 06 literal-wording drift.
- **Gap (grilling Q21):** `POST /lookup {id} → 404` via `fail.notFound` (body lookup) not auto-documented because no path param — inconsistent; requires `responses:{404:…}` or future `errors` field.
- **Gap (grilling 06):** `400` on `:param` routes used to be benign noise (string param always passes) and non-suppressible except by `responses:{400: schema}` (still documents 400, just custom). **Closed 2026-08-27 (issue #05):** `hide400: true` suppresses the auto 400 on a pure `:param` route; a user-declared `responses:{400}` is still honored.
- **404 unification (issue #04):** unmatched routes now return `application/json {error}` via the shared `createErrorHandler` policy (`OpenAPIHono` ctor registers `app.notFound`), unifying the two 404 shapes — a `fail.notFound()` and an unmatched route — under the single chokepoint.

## References

- `src/openapi.ts` — `_buildResponses`, `_getErrorSchemaRef`, ponytail heuristic
- `HANDOFF.md` Key Decisions — 404 heuristic rationale

