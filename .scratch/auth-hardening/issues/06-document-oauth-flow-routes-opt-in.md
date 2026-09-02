# 06: Opt-in `documentFlowRoutes` for the OAuth flow routes

**Source:** repo ADR-012 (R3 gap), `src/openapi.ts` `_buildResponses` (JSON-body-oriented emitter).

## What to build

Make the OAuth `/start` + `/callback` routes **optionally** appear in the OpenAPI `paths`. ADR-012 documents that they are deliberately omitted because the emitter maps any non-204 code to a JSON body, so a `302` redirect would be falsely declared as `200 "Success"`. This ticket adds a truthful, opt-in mechanism.

Concretely:
- Add `documentFlowRoutes?: boolean` (default `false`) to `OAuthStrategyOptions`.
- When set, emit the `/start` + `/callback` paths **truthfully** — i.e. give them accurate descriptions and a real `302` (redirect) response shape, or a `400` for the error path — without breaking the library's spec-accuracy invariant.
- The emitter (`src/openapi.ts`) may need a narrow allowance for a redirect/`No Content` response on these two hand-registered routes; keep the JSON-body default for everything else.

## Blocked by

None (can start immediately). Logically groups with ticket 05 but does not depend on it.

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] With `documentFlowRoutes: false` (default), the `paths` are unchanged (no `/auth/google/start` / `/callback` entries) — regression-pinned by the existing `examples/strategies`/`auth.selfcheck` spec checks.
- [ ] With `documentFlowRoutes: true`, `/start` + `/callback` appear in `paths` with accurate responses (302 redirect; 400 error path), and the `oauth2` `components.securitySchemes` entry is still emitted.
- [ ] The `blog`/`basic` spec snapshots are unaffected (`documentFlowRoutes` defaults off; the example apps don't set it).
- [ ] A new spec-emission test (in `src/auth.selfcheck.ts` or `src/openapi.selfcheck.ts`) asserts the on/off difference.

## Notes

This is the long-standing "R3" ceiling from ADR-012. It must stay off by default to preserve the spec-accuracy invariant; the win is giving users who want the flow routes in their published spec an honest way to do it.
