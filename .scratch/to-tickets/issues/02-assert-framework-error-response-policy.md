# 02: Assert the framework-guaranteed error-response policy in committed selfchecks

## Parent

[#19 Spec: Type-safe method shorthands and controllable framework error responses](https://github.com/zfadhli/peta-hono/issues/19)

## What to build

The automatically documented framework error responses (`400`, `401`, `404`, `500`) appear exactly where the spec says they can occur — accurate, non-noisy, deduplicated, and controllable — and that rule is asserted by the existing selfcheck seams (`nub run check:all`), so the OpenAPI spec can't drift from intent.

Concretely, for a given API the generated `/openapi.json` must show:
- `400 Bad Request` on routes with validated `request.body`/`query`/`headers`/`params` **or** a path containing a `:param` (auto-generated `request.params`).
- `400` must **not** appear on a route with no validation and no path params (e.g. a health/status route → `200` + `500` only).
- `401 Unauthorized` only on routes behind a registered `AuthScheme`/`security`; never on public routes.
- `404 Not Found` only on routes whose path has a `:param` (ponytail heuristic).
- `500 Internal Server Error` always (unless explicitly declared).
- The four framework errors share a single deduped `{error:string}` component (stable `schema_<12hex>`), not repeated inline schemas.
- Declaring an explicit `responses:{400}`/`{404}` suppresses/replaces the auto-doc for that code via the guard.

## Acceptance criteria

- [ ] A committed selfcheck asserts `400` appears on a validated-body route, a validated-query route, and a path-param route (`hasParamTokens`), and is **absent** on a non-param, non-validated route.
- [ ] A committed selfcheck asserts `401` appears only when `security`/`AuthScheme` is present (e.g. `components.securitySchemes` + per-route `security`) and is absent on public routes.
- [ ] A committed selfcheck asserts `404` auto-injects only on path-param routes.
- [ ] A committed selfcheck asserts all four framework errors dedupe to one `{error:string}` component (`schema_<12hex>`), not one per route.
- [ ] A committed selfcheck asserts an explicit `responses:{404}` suppresses the heuristic (and `responses:{400}` replaces the auto `400`), via the `if(!responses[key])` guard.
- [ ] `nub run check:all` passes (lib + basic + blog + auth) and `examples/blog/spec.snapshot.json` is regenerated/consistent.

## Blocked by

None (can start immediately).
