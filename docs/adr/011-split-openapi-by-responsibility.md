# ADR 011 — Split `src/openapi.ts` by responsibility (incremental, completed)

**Date:** 2026-08-26
**Status:** Accepted — incremental split implemented (2026-09-02, steps 1–5)

## Context

`src/openapi.ts` was ~700 LOC and owned five concerns (smell: **divergent change**):

| Concern | Symbols | LOC | Change trigger |
|---------|---------|-----|----------------|
| **Coercion** | `coerceValue`, `coerceDeep`, `resolveRef`, `isNumericType/isBooleanType/isArrayType/isObjectType` | ~110 | Query/header shape or ArkType `JsonSchema` change (ADR-008) |
| **Routing** | `normalizeMethod`, `toOapiPath`, `PARAM_TOKEN_RE` (duplicated), `SUPPORTED_METHODS` | ~40 | Hono token grammar change |
| **Spec emission** | `OpenAPIHono`, `_routes`, `_buildSpec`, `_buildResponses`, `_addObjectParams`, `doc`, `registerSecurityScheme` | ~350 | OpenAPI 3.0 emission or framework-error policy (ADR-007) |
| **Registry / hashing** | `ComponentRegistry`, `sha1Hex`, `rewriteRefs`, `_schemaToOA`, `_getErrorSchemaRef` | ~120 | Stable hash / `$defs` hoisting (ADR-006) |
| **Error kernel** | `APIError`, `ErrorHandler`, `createErrorHandler` | ~40 | Error policy / `debug` gating (ADR-005) |

`src/api.ts` (~320 LOC) already isolated the DSL facade (`createApi`, overloads, `ReqFor`). The file passed all selfchecks (`nub run check:all` 6/6 + blog 41), snapshot is stable, and `_buildSpec`/`_schemaToOA` are tightly coupled (share `_components` mutable `Map` + `rewriteRefs` in-place). Extracting naively risked:

- Circular `api ↔ openapi ↔ validation ↔ errors` if `APIError` stays in `openapi.ts` (validator must throw it).
- Leaky `ComponentRegistry` mutable map shared across async `sha1Hex` calls — split requires explicit ownership.
- Extra indirection for a 700 LOC file that is still navigable (single-file grep, no `paths.ts` hopping yet).

The project has no prior module-split ADR; ADR-002 chose in-repo `OpenAPIHono` and noted ceiling "700 LOC … future split `src/{validation,paths,registry}.ts`" once it becomes drag.

## Decision

**Split incrementally, in priority order — never big-bang.** Each step is a separate commit, gated on LOC / change frequency, keeping the barrel and `dist/` green throughout:

1. **Done (2026-08-26, ADR-010) — `src/paths.ts`:** `PARAM_TOKEN_RE`, `parseParamTokens`, `hasParamTokens`, `normalizeMethod`, `toOapiPath`, `SUPPORTED_METHODS` + types `ParamToken`, `HttpMethod`, `Method`. Pure, zero deps, fixed the duplicated-regex smell immediately. Re-exported from `openapi.ts` for barrel stability.
2. **Done (2026-09-01) — `src/errors.ts` (kernel):** `APIError`, `ErrorHandler`, `createErrorHandler`, `fail`/`errors`/`httpErrors`. No deps. Both `openapi.ts` and `api.ts` import from kernel — broke the `validator → APIError` cycle that previously forced `APIError` to live in `openapi.ts`.
3. **Done (2026-09-02) — `src/validation.ts`:** `ArkType`, `is*Type` guards, `resolveRef`, `coerceValue`, `coerceDeep`, `arktypeValidator`. Depends only on `errors.ts` + `arktype`. Imported by `openapi.ts` for middleware assembly; `ArkType` + `arktypeValidator` re-exported for barrel stability.
4. **Done (2026-09-02) — `src/registry.ts`:** `sha1Hex`, `rewriteRefs`, `SchemaCacheEntry`/`schemaCache`, `schemaToOA`, `getErrorSchemaRef`. **Triggered**: `openapi.ts` hit 809 LOC (>800 gate) and the `WeakMap<Type,JsonSchema>` cache was added (1caccde) — both named triggers. Split requires explicit ownership: the functions take the per-instance schemas map (`SchemaHost`) as a parameter; `OpenAPIHono` passes `_components` explicitly, and the error-ref memo is per-registry via `WeakMap`.
5. **Done (2026-09-02) — `src/spec.ts` (step 5 added during implementation):** OpenAPI document types, `AuthScheme`/`SecurityScheme`/`OAuth2Flows`, `RouteConfig`/`RouteHandler`/`StoredRoute`, plus `buildSpec`/`buildResponses`/`addObjectParams` as **pure functions** over `(routes, ComponentRegistry, config)` and the shared `resolveSuccessCode` policy (used by both the emitter and the runtime dispatch so they cannot drift). This was the largest remaining concern (~350 LOC) and the only way `openapi.ts` reaches the ~280 LOC orchestrator target below.

Target end state (implemented):

```
src/errors.ts      ← kernel (no deps)
src/paths.ts       ← pure
src/validation.ts  ← errors + arktype
src/registry.ts    ← arktype + Web Crypto (SchemaHost)
src/spec.ts        ← validation + registry + paths (pure emission + route model)
src/openapi.ts     ← Hono dispatch + StoredRoute[] + re-exports (orchestrator)
src/api.ts         ← paths + openapi (types) + errors (facade)
src/index.ts       ← barrel
```

Layering is acyclic: `errors ← validation ← registry ← spec ← openapi ← api ← index` (plus `paths` feeding `spec`/`openapi`/`api`). `registry.ts` depends only on a structural `SchemaHost` (`{ schemas: Map }`), not on `openapi.ts` — `SecurityScheme` stays with the spec model so no module imports the orchestrator type.

Barrel (`src/index.ts`) re-exports public symbols from their new homes so `import { APIError } from "peta-hono"` never breaks. Public API unchanged: `OpenAPIHono`, `arktypeValidator`, `normalizeMethod`, `generateKey`, auth strategies, and all public types keep their names.

## Alternatives

- **Big-bang split into 4 new files at once:** Cleanest SRP, lowest divergent-change risk, but highest churn — 4 new files, `dist/` + `package.json` `files` + `tsconfig` updates, circular import audit, and review cost for a file that had not yet caused a merge conflict. Rejected — incremental achieves the same end state with less risk (and is what was executed).
- **Keep `src/openapi.ts` monolith forever (single file is simpler):** Avoids indirection, but divergent change persists — spec hashing fix risks breaking coercion, param regex stays duplicated, and onboarding suffers (700 → 900 LOC ceiling noted in ADR-002). Rejected — `paths.ts` + `errors.ts` paid off immediately and the 800-LOC gate fired before long.
- **Split by layer `src/core/{routing,validation,spec}.ts` nested folder:** Adds directory depth for 2–3 files; premature. Prefer flat `src/*.ts` until >6 modules.

## Consequences

- **Migration:** No breaking change — re-exports preserved. Each extraction was a mechanical move + `s/.ts/.js/` import fix (Nub `bundler` → `ts` resolution, `NodeNext` build preserves `.js`). `npm publish` includes new `dist/*.js` automatically via `files:["dist"]`.
- **Testing:** After each step, `nub run typecheck`, `nub run lint`, `nub run check:all` (lib + basic + blog + auth) stayed green; `spec.snapshot.json` did not diff (except `paths.ts` — no spec change). Colocated unit tests added per module: `src/validation.test.ts` (coercion/validator), `src/registry.test.ts` (hash/hoisting/cache), `src/spec.test.ts` (emission policy). Full suite: 10 files / 97 tests.
- **Concurrency/docs:** No runtime concurrency change — `ComponentRegistry` stays per-`OpenAPIHono` instance, `Map.setIfAbsent` pattern unchanged. `docs/glossary.md` and `docs/domain-model.md` updated per extraction; cross-ref ADRs 005/006/008 for ownership.
- **Threshold to revisit:** if `spec.ts` > ~400 LOC, or two consecutive PRs edit `coerce*` and `buildSpec` together, consider splitting `spec.ts` (e.g. `params.ts` for `addObjectParams`).

## References

- `src/openapi.ts` — pre-split ~700 LOC, `coerce*`, `toOapiPath`, `rewriteRefs`, `_buildSpec`; post-split ~270 LOC orchestrator
- `src/api.ts:193,413` — duplicated regex (fixed), `createApi` facade
- `docs/domain-model.md` §1 — bounded contexts / module map (updated 2026-09-02)
- `docs/adr/002-in-repo-openapihono.md` — ceiling "700 LOC … future split"
- `.scratch/grill-with-docs/domain-model.md` §3.1 — proposed `src/{types,validation,paths,registry}` map
