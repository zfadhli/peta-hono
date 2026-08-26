# Handoff

## Goal

Hardening v0.5.0 — deterministic spec emission, controllable error responses, lint/CI/docs hygiene. Verify issues 05-07.

## Session Info

- **Branch:** `master`
- **Project:** peta-hono
- **Saved:** 2026-08-26

## Changes

- Verified issues 05, 06 originally done (fd3c2d9, b6354f3) and implemented pending 07 hygiene (2026-08-26)

## Files Touched

| File | Status | Done | Left |
|------|--------|------|------|
| `src/openapi.ts` | verified | 05 deterministic emission (fd3c2d9 + 38b4774) + 06 controllable errors (b6354f3) intact — `toOapiPath`, `normalizeMethod`, stable `schema_<12hex>` hoisting, deduped error component, 400/401/404/500 guards, `404` ponytail with `documentNotFound` ceiling | None |
| `examples/blog/spec.snapshot.json` | verified | Paths `/{param}` + `404` on 6 param routes present (excluded from Biome via overrides) | None |
| `package.json` | modified | `check:all` now `lib+blog+basic+auth`, `lint`/`lint:fix`/`format` now `src/ examples/` | None |
| `pnpm-workspace.yaml` | fixed | `allowBuilds: '@evilmartians/lefthook': true` (was placeholder string) | None |
| `lefthook.yml` | fixed | `biome check --write --unsafe src/ examples/` (was `src/`-only) | None |
| `biome.json` | modified | Added `overrides` to exclude `spec.snapshot.json` from formatter/linter/assist | None |
| `examples/*` (14 files) | formatted | Biome `check --write --unsafe` — import sort, 2-space, double-quotes, template literal, unused `_j7` | None |
| `AGENTS.md` | modified | Documented `bundler` vs `NodeNext` tsconfig duality, `docs()` mount order + singleton, auth-guarded docs recipe | None |
| `README.md` | modified | Added `docs()` mount order, auth-guarded docs recipe, `TypeScript config` section | None |
| `CHANGELOG.md` | verified | `[0.4.0]` present | None |
| `.scratch/hardening-v0.5.0/issues/05-deterministic-openapi-spec-emission.md` | updated | Marked `done` (fd3c2d9 / 38b4774) | None |
| `.scratch/hardening-v0.5.0/issues/06-controllable-framework-error-responses.md` | updated | Marked `done` (b6354f3) | None |
| `.scratch/hardening-v0.5.0/issues/07-lint-ci-docs-hygiene.md` | updated | Marked `done` (all 4 checklist items) | None |
| `HANDOFF.md` | modified | Updated for implementation session | None |

## Key Decisions

- **404 auto-injection: path `:param` heuristic (not auth):** Path params strongly imply resource lookup → potential 404. Auth is a weaker signal (ownership checks are handler logic, not structural). The `!responses["404"]` guard lets users suppress 404 by declaring an explicit one.
- **v0.4.0 (minor)**: Feature addition (changed generated spec) → minor bump.
- **Snake case `postId` / `commentId` preserved:** The blog spec uses `:postId` not `:id`. The 404 heuristic treats any `:param` the same — correct behavior.

## Dead Ends

(None — straightforward implementation.)

## Blockers

(None.)

## Verification (2026-08-26)

- **05 deterministic spec emission:** `nub run typecheck` ✓, `nub run check:all` (6/6 lib + 41 blog + basic + auth) ✓, `/openapi.json` → `/{param}` for `:id`/`:name{regex}`/`/*`→`/{wildcard}`, `operationId` collision-free (`_2`), `minimum`/`maximum`/`integer` preserved, `$defs` hoisted to `schema_<12hex>`, no `#/$defs/`, `header` lowercasing (`X-Token`→`x-token`), `normalizeMethod` case-insensitive, `GET /docs` 200 `Scalar` ✓
- **06 controllable errors:** `/health`→`200,500` no `400/404`, `/things` (body)→`201,400,500` no `404`, `/items/{id}` (param)→`200,400,404,500`, explicit `responses:{404}` suppresses heuristic, `401` only with `security`/`AuthScheme`, single deduped `{error:string}` component (`schema_84c5e…`), `ponytail`+`documentNotFound` ceiling ✓
- **07 lint/CI/docs (DONE):** `nub run lint` (`src/ examples/` with snapshot override) ✓, `nub run typecheck` ✓, `nub run check:all` (lib+basic+blog+auth) ✓, `GET /docs` 200 `Scalar` ✓, `pnpm-workspace.yaml` valid, `tsconfig` `bundler` vs `NodeNext` documented in `AGENTS.md`+`README.md`, `docs()` mount order + singleton + auth-guarded recipe documented

## Next Steps

- [x] 05 marked done (fd3c2d9 / 38b4774)
- [x] 06 marked done (b6354f3)
- [x] 07 marked done — `biome`/`lefthook` now `src/ examples/`, `check:all` + `auth`, `allowBuilds` fixed, `tsconfig` documented, `docs()` recipe documented, all green
- [ ] v0.4.0 ready to publish (`nub ci && npm publish`) — run `nub run build` + `nub run check:dist` to confirm `dist/` fresh before publish
- [ ] Potential next features: `errors: [403, 404]` config field for explicit error-code docs without full schemas; response status override; route-level tags.

## Suggested Skills

- (No specific skills needed.)
