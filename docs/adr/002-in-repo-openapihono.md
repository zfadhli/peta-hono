# ADR 002 — In-repo OpenAPIHono (own the spec emitter)

**Date:** 2026-06-23 / hardened 2026-08-26 (issues 05–06)
**Status:** Accepted

## Context

Spec must be deterministic: `/:param` → `/{param}` for all Hono token shapes, `operationId` collision-free, `$defs` hoisted to stable names with no dangling refs, framework errors (400/401/404/500) deduplicated, header lowercasing, method case-insensitivity. External `hono-openapi` would require transforms and still not guarantee stable `schema_<12hex>` or `ponytail` 404 heuristic.

## Decision

Build `OpenAPIHono` in-repo (`src/openapi.ts`, ~700 LOC):

- Private `_routes:StoredRoute[]`, `_components:{schemas,schemes}`, `_errorSchemaRef` lazy.
- `openapi(config,handler)` assembles middlewares, registers `this.on(method,path,...)` via `dispatch` cast, flattens `req`.
- `_buildSpec()` async (Web Crypto `sha1Hex`), `_schemaToOA`/`rewriteRefs`/`_buildResponses`/`_addObjectParams`, `toOapiPath`/`normalizeMethod` single helpers, `doc()` mounts spec + Scalar `apiReference`.
- Use only `hono/validator` + `@scalar/hono-api-reference`; no `openapi3-ts` builder.

## Alternatives

- Adopt `hono-openapi` + post-transform spec — loses control of hashing/dedup, still need `coerceDeep` coupling.
- Use `openapi3-ts` builder — extra dep, no validator coupling.
- Keep legacy `Hono` with separate spec tool — drift between runtime and docs.

## Consequences

- **Migration:** Upgrading Hono internals requires pinning; `nub run build` + `nub run check:dist` guards `dist/` freshness (`package.json` `check:dist` + `prepublishOnly`, `.github/workflows/publish.yml`).
- **Testing:** `spec.snapshot.json` golden file (`examples/blog/spec.snapshot.json`) + selfcheck #4 asserts no `$defs`, no `#/$defs/`, all refs → `#/components/schemas/`, name regex `schema_[a-f0-9]{12}`.
- **Concurrency:** `_buildSpec` per-request but pure except lazy `_errorSchemaRef` (Map set-if-absent safe). No shared mutation hazard.
- **Docs:** Spec at `/openapi.json`, UI at `/docs` (Scalar). Snapshot workflow `rm spec.snapshot.json && nub examples/blog/selfcheck.ts` documented in `AGENTS.md`.
- **Ceiling:** One file owns crypto + coercion + spec + routing — violates SRP. Future split `src/{validation,paths,registry}.ts` (see `domain-model.md` §3.1) once 700 LOC becomes drag. Cache `toJsonSchema()` + hash via `WeakMap<Type,JsonSchema>` to avoid per-request `toJsonSchema()` (perf risk flagged in grilling Q12).

## References

- `src/openapi.ts` — `OpenAPIHono`, `_buildSpec`, `_schemaToOA`, `sha1Hex`, `rewriteRefs`, `toOapiPath`, `normalizeMethod`
- `HANDOFF.md` — issue 05 deterministic emission

