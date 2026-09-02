# 03: Truthfully document the OAuth flow routes (planned improvement, NOT now) (blast-radius R3)

## Source

Blast-radius review — R3 (OAuth `/start` + `/callback` deliberately omitted from the
OpenAPI `paths`).

## Status

**PLANNED.** Do NOT implement / force the flow routes into the spec now. The
deliberate omission is correct this iteration and must stay documented. This ticket
captures the upgrade path for a future change and asks only that the omission remain
documented (it already is).

## What to build

The Google OAuth strategy (`src/auth/oauth.ts`) mounts `/auth/{provider}/start` and
`/auth/{provider}/callback` via `app.get(...)` (a browser `302` redirect + a code
exchange), NOT `app.openapi`. They are therefore absent from the generated OpenAPI
`paths`, while the `oauth2` security scheme IS emitted to `components.securitySchemes`.
`registerOAuthStrategy` (`src/api.ts`) calls `app.registerSecurityScheme(name,
handle.scheme)` and `handle.mount(app as unknown as FlowApp)` — the scheme is present,
the route *paths* are not.

**Why (documented decision):** `_buildResponses` (`src/openapi.ts`) is JSON-body
oriented — any declared success code other than `204` gets `content:
application/json`. Forcing the flow routes through `app.openapi` would make the spec
claim a `200 "Success"` JSON body for what is actually a `302` redirect (runtime
returns a `Response` with `Location`), a spec/runtime mismatch that violates the
library's spec-accuracy invariant. Documented in `docs/adr/012-built-in-auth-strategies.md`
(Consequences), `README.md`, and `AGENTS.md`.

## Planned improvement (future, once a truthful no-body/3xx response exists)

- **Extend `_buildResponses` to support 3xx and no-body responses.** `OpenAPIResponse`
  (`description?`, `content?`) can already express a description-only response (like
  the `204 -> { description: "No Content" }` branch). Generalize it so a `302` redirect
  (or any response with no JSON body) is representable without fabricating a JSON
  schema — e.g. a `3xx` branch that omits `content`, or an explicit no-content flag.
- **Add an opt-in config to register the flow routes as documented operations:** a
  `documentFlowRoutes?: boolean` (default `false`) on `auth.oauth` / `OAuthStrategyOptions`
  (the natural home, since `mount` lives in `oauth.ts`). When `true`, register
  `/start` + `/callback` through `app.openapi` (truthfully described with the no-body/
  redirect responses above) so they appear in `paths`.
- **Preserve default-off behavior.** With the flag unset, keep the current correct
  handling (routes via `app.get`, `oauth2` scheme emitted, paths omitted) and the
  deliberate omission as a documented `ponytail:` ceiling.

## Acceptance criteria (IF/WHEN implemented — NOT now)

- [ ] `_buildResponses` can emit a `302`/`3xx` or any no-body response without
      fabricating a JSON body; `src/openapi.selfcheck.ts` covers it.
- [ ] With `documentFlowRoutes: true`, `GET /auth/google/start` and
      `GET /auth/google/callback` appear in the generated OpenAPI `paths` with
      truthful redirect/no-body responses, and the `oauth2` security scheme stays in
      `components.securitySchemes`.
- [ ] With the flag unset (default), behavior is unchanged: flow routes are NOT in
      `paths` and the deliberate omission stays documented.
- [ ] Spec snapshot regenerated if affected
      (`rm examples/blog/spec.snapshot.json && nub examples/blog/selfcheck.ts`);
      `nub run typecheck` + `nub run check:all` pass.

## Blocked by

None. This is a "do later" improvement; the current behavior is intentional and must
NOT be changed now.

## Current task (if any)

No code change now. Verify `docs/adr/012-built-in-auth-strategies.md`, `README.md`,
and `AGENTS.md` still state that the OAuth flow routes are deliberately omitted and
reference this R3 upgrade path. Every `{ auth }` route continues to emit `401` +
`security` + `securitySchemes` — only the flow *paths* are intentionally excluded.
