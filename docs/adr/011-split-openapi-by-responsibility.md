# ADR 011 — Split `src/openapi.ts` by responsibility (deferred incremental)

**Date:** 2026-08-26
**Status:** Proposed — **deferred incremental (do NOT big-bang split now)**

## Context

`src/openapi.ts` is ~700 LOC and owns five concerns (smell: **divergent change**):

| Concern | Symbols | LOC | Change trigger |
|---------|---------|-----|----------------|
| **Coercion** | `coerceValue`, `coerceDeep`, `resolveRef`, `isNumericType/isBooleanType/isArrayType/isObjectType` | ~110 | Query/header shape or ArkType `JsonSchema` change (ADR-008) |
| **Routing** | `normalizeMethod`, `toOapiPath`, `PARAM_TOKEN_RE` (duplicated), `SUPPORTED_METHODS` | ~40 | Hono token grammar change |
| **Spec emission** | `OpenAPIHono`, `_routes`, `_buildSpec`, `_buildResponses`, `_addObjectParams`, `doc`, `registerSecurityScheme` | ~350 | OpenAPI 3.0 emission or framework-error policy (ADR-007) |
| **Registry / hashing** | `ComponentRegistry`, `sha1Hex`, `rewriteRefs`, `_schemaToOA`, `_getErrorSchemaRef` | ~120 | Stable hash / `$defs` hoisting (ADR-006) |
| **Error kernel** | `APIError`, `ErrorHandler`, `createErrorHandler` | ~40 | Error policy / `debug` gating (ADR-005) |

`src/api.ts` (~320 LOC) already isolates the DSL facade (`createApi`, overloads, `ReqFor`). The file passes all selfchecks (`nub run check:all` 6/6 + blog 41), snapshot is stable, and `_buildSpec`/`_schemaToOA` are tightly coupled (share `_components` mutable `Map` + `rewriteRefs` in-place). Extracting naïvely risks:

- Circular `api ↔ openapi ↔ validation ↔ errors` if `APIError` stays in `openapi.ts` (validator must throw it).
- Leaky `ComponentRegistry` mutable map shared across async `sha1Hex` calls — split requires explicit ownership.
- Extra indirection for a 700 LOC file that is still navigable (single-file grep, no `paths.ts` hopping yet).

The project has no prior module-split ADR; ADR-002 chose in-repo `OpenAPIHono` and noted ceiling "700 LOC … future split `src/{validation,paths,registry}.ts`" once it becomes drag.

## Decision

**Defer a full split. Do incremental extraction in priority order; do not create `src/registry.ts` or `src/validation.ts` in this PR.**

Proposed order (each is a separate commit, gated on LOC / change frequency):

1. **Now — `src/paths.ts` (ADR-010):** `PARAM_TOKEN_RE`, `parseParamTokens`, `hasParamTokens`, `normalizeMethod`, `toOapiPath`, `SUPPORTED_METHODS` + types `ParamToken`, `HttpMethod`, `Method`. Pure, zero deps, fixes duplication smell immediately. Re-export from `openapi.ts` for barrel stability.
2. **Next — `src/errors.ts` (kernel):** Move `APIError`, `ErrorHandler`, `createErrorHandler`, `fail/errors/httpErrors`. No deps. Both `openapi.ts` and `api.ts`/`validation.ts` import from kernel — breaks the `validator → APIError` cycle that currently forces `APIError` to live in `openapi.ts`.
3. **After — `src/validation.ts`:** Move `coerceDeep`, `coerceValue`, `resolveRef`, `is*Type`, `arktypeValidator`. Depends only on `errors.ts` + `arktype`. Imported by `openapi.ts` for middleware assembly.
4. **Defer — `src/registry.ts`:** `ComponentRegistry`, `sha1Hex`, `rewriteRefs`, `schemaToOA`, `getErrorSchemaRef`. Defer until `openapi.ts` exceeds **800 LOC** *or* a second divergent change touches both coercion and spec hashing in the same PR. Until then, keep it co-located with `OpenAPIHono` — `_components` + `_buildSpec` cohesion outweighs SRP.

Target end state (when all four are extracted, `openapi.ts` ≈ 280 LOC orchestrator):

```
src/errors.ts      ← kernel (no deps)
src/paths.ts       ← pure
src/validation.ts  ← errors + arktype
src/registry.ts    ← errors + Web Crypto
src/openapi.ts     ← Hono + validation + registry + paths + errors (orchestrator)
src/api.ts         ← paths + openapi (types) + errors (facade)
src/index.ts       ← barrel
```

Barrel (`src/index.ts`) re-exports public symbols from their new homes so `import { APIError } from "peta-hono"` never breaks.

**Threshold to revisit:** if `openapi.ts` >800 LOC, or two consecutive PRs edit `coerce*` and `_buildSpec` together, or `toJsonSchema()` caching (`WeakMap<Type,JsonSchema>`) is added (grilling Q23) and belongs in `registry.ts`, trigger step 4.

## Alternatives

- **Big-bang split now into `src/{paths,validation,registry,errors}.ts`:** Cleanest SRP, lowest divergent-change risk, but highest churn: 4 new files, `dist/` + `package.json` `files` + `tsconfig` updates, circular import audit, and review cost for a file that has not yet caused a merge conflict. Rejected for now — incremental achieves same end state with less risk.
- **Keep `src/openapi.ts` monolith forever (single file is simpler):** Avoids indirection, but divergent change persists — spec hashing fix risks breaking coercion, param regex stays duplicated, and onboarding suffers (700 → 900 LOC ceiling noted in ADR-002). Rejected — at least `paths.ts` + `errors.ts` pay off immediately.
- **Split by layer `src/core/{routing,validation,spec}.ts` nested folder:** Adds directory depth for 2–3 files; premature. Prefer flat `src/*.ts` until >6 modules.

## Consequences

- **Migration:** No breaking change if re-exports preserved. Each extraction is a mechanical move + `s/\.ts/.js/` import fix (Nub `bundler` → `ts` resolution, `NodeNext` build preserves `.js`). `npm publish` includes new `dist/*.js` automatically via `files:["dist"]`.
- **Testing:** After each step, `nub run typecheck`, `nub run lint`, `nub run check:all` (lib 6 + basic + blog + auth) must stay green; `spec.snapshot.json` must not diff (except `paths.ts` — no spec change). Add unit test for `parseParamTokens` after step 1.
- **Concurrency/docs:** No runtime concurrency change — `ComponentRegistry` stays per-`OpenAPIHono` instance, `Map.setIfAbsent` pattern unchanged. Update `docs/glossary.md` and `docs/domain-model.md` per extraction; cross-ref ADRs 005/006/008 for ownership.
- **When NOT to follow this ADR:** If the next feature is `toJsonSchema()` caching or CSV query `?ids=1,2` support — those touch `validation` + `registry` together and justify step 4 early.

## References

- `src/openapi.ts` — ~700 LOC, `coerce*`, `toOapiPath`, `rewriteRefs`, `_buildSpec`
- `src/api.ts:193,413` — duplicated regex, `createApi` facade
- `docs/domain-model.md` §1 — bounded contexts / module map
- `docs/adr/002-in-repo-openapihono.md` — ceiling "700 LOC … future split"
- `.scratch/grill-with-docs/domain-model.md` §3.1 — proposed `src/{types,validation,paths,registry}` map

