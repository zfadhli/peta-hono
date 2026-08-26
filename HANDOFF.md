# Handoff

## Goal

Hardening v0.5.0 — deterministic spec emission, controllable error responses, lint/CI/docs hygiene. Verify issues 05-07.

## Session Info

- **Branch:** `master`
- **Project:** peta-hono
- **Saved:** 2026-08-26

## Changes

- Verified issues 05, 06, 07 against live codebase and `app.request` seams (2026-08-26)

## Files Touched

| File | Status | Done | Left |
|------|--------|------|------|
| `src/openapi.ts` | verified | 05 deterministic emission (fd3c2d9 + 38b4774) + 06 controllable errors (b6354f3) intact — `toOapiPath`, `normalizeMethod`, stable `schema_<12hex>` hoisting, deduped error component, 400/401/404/500 guards, `404` ponytail with `documentNotFound` ceiling | None |
| `examples/blog/spec.snapshot.json` | verified | Paths `/{param}` + `404` on 6 param routes present | None |
| `package.json` | verified | `0.4.0` — `check:all` still `src+blog+basic` (no `auth`), `lint` still `src/`-only | `auth` missing from `check:all`, lint scope mismatch — tracked in 07 |
| `CHANGELOG.md` | verified | `[0.4.0]` present | None |
| `.scratch/hardening-v0.5.0/issues/05-deterministic-openapi-spec-emission.md` | updated | Marked `done` (fd3c2d9 / 38b4774) | None |
| `.scratch/hardening-v0.5.0/issues/06-controllable-framework-error-responses.md` | updated | Marked `done` (b6354f3) | None |
| `.scratch/hardening-v0.5.0/issues/07-lint-ci-docs-hygiene.md` | verified | Still `ready-for-agent` — `biome`/`lefthook` `src/`-only, `check:all` missing `auth`, `pnpm-workspace.yaml` `allowBuilds` placeholder, `tsconfig` `bundler` vs `NodeNext` not reconciled | Remains open |
| `HANDOFF.md` | modified | Updated for this verification session | None |

## Key Decisions

- **404 auto-injection: path `:param` heuristic (not auth):** Path params strongly imply resource lookup → potential 404. Auth is a weaker signal (ownership checks are handler logic, not structural). The `!responses["404"]` guard lets users suppress 404 by declaring an explicit one.
- **v0.4.0 (minor)**: Feature addition (changed generated spec) → minor bump.
- **Snake case `postId` / `commentId` preserved:** The blog spec uses `:postId` not `:id`. The 404 heuristic treats any `:param` the same — correct behavior.

## Dead Ends

(None — straightforward implementation.)

## Blockers

(None.)

## Verification (2026-08-26)

- **05 deterministic spec emission:** `nub run typecheck` ✓, `nub run check:all` (6/6 lib + 41 blog + basic) ✓, `/openapi.json` → `/{param}` for `:id`/`:name{regex}`/`/*`→`/{wildcard}`, `operationId` collision-free (`_2`), `minimum`/`maximum`/`integer` preserved, `$defs` hoisted to `schema_<12hex>`, no `#/$defs/`, `header` lowercasing (`X-Token`→`x-token`), `normalizeMethod` case-insensitive, `GET /docs` 200 `Scalar` ✓
- **06 controllable errors:** `/health`→`200,500` no `400/404`, `/things` (body)→`201,400,500` no `404`, `/items/{id}` (param)→`200,400,404,500`, explicit `responses:{404}` suppresses heuristic, `401` only with `security`/`AuthScheme`, single deduped `{error:string}` component (`schema_84c5e…`), `ponytail`+`documentNotFound` ceiling ✓
- **07 lint/CI/docs (NOT done):** `nub run lint` passes for `src/` but `biome check src/ examples/` → 22 errors; `lefthook.yml` `src/`-only; `check:all` missing `examples/auth/selfcheck.ts` (session cookie-jar flow); `pnpm-workspace.yaml` still placeholder `set this to true or false`; `tsconfig.json` `bundler` vs `tsconfig.build.json` `NodeNext` (+ `.js` ESM) undocumented

## Next Steps

- [x] 05 marked done
- [x] 06 marked done
- [ ] 07 remains `ready-for-agent` — fix `biome`/`lefthook` scope, `allowBuilds`, `check:all` + `auth`, reconcile `tsconfig` docs, then re-verify `nub run lint` + `typecheck` + `check:all` green + `GET /docs` `Scalar`
- [ ] v0.4.0 ready to publish (`nub ci && npm publish`) — `dist/` already fresh (`nub run build` → no diff)
- [ ] Potential next features: `errors: [403, 404]` config field for explicit error-code docs without full schemas; response status override; route-level tags.

## Suggested Skills

- (No specific skills needed.)
