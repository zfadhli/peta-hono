# 05: Add an opt-out for the auto-documented 400 on `:param` routes

## Source

Prioritized DX review — H3 (non-suppressible 400 auto-doc noise).

## What to build

Developers must be able to remove the `400 Bad Request` that is auto-documented on any route whose path contains a `:param`, when that 400 cannot actually occur.

Today `_buildResponses` (`src/openapi.ts:629–638`) documents `400` whenever `hasParamTokens(config.path)` is true, because the route gets an auto-generated `params` schema of `type({id:"string"})`. A string path segment always satisfies that schema, so the 400 is effectively unreachable — yet it shows in the spec for every `GET /posts/{id}` route. The only escape is to declare `responses:{400: schema}`, which replaces the schema but **keeps the 400 entry** (guard `if(!responses["400"])`). There is currently **no way to suppress it**.

This is spec clutter that misleads API consumers ("can this 400?" — no, it is a string ID), and the ADR-007 `hide400`/`documentNotFound` ceiling was never built.

## Acceptance criteria

- [ ] A route can suppress the auto-documented `400` on a pure path-param route via an explicit opt-out — e.g. a `hide400: true` config flag, and/or an explicit `errors`/`responses` exclusion.
- [ ] Suppressing `400` does not remove the `500` (always documented) or a user-declared `400`.
- [ ] The opt-out is surfaced consistently through both the DSL (`api()`, `api.get()`) and the low-level `OpenAPIHono.openapi()` (`RouteConfig`).
- [ ] A committed selfcheck (`src/openapi.selfcheck.ts`) asserts the `400` can be hidden on a `:param` route, and that the noise is still present by default (no behavioral regression for the existing framework-error contract).
- [ ] `nub run check:all` (lib + basic + blog + auth) passes; `examples/blog/spec.snapshot.json` regenerated if the default output changes.

## Blocked by

None (can start immediately). Touch-point overlaps `_buildResponses` with #03 (auth 401) — coordinate landing so the two edits to the same function don't conflict.
