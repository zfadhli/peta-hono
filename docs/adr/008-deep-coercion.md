# ADR 008 — Deep query/header coercion before ArkType validation

**Date:** 2026-08-26 (issue 03 deda20b)
**Status:** Accepted

## Context

Query/header arrive as strings (`?limit=5` → `"5"`, `?active=true` → `"true"`, `?ids=1&ids=2` → `string[]` or `?ids=1` → `"1"`). ArkType `type({limit:"1 <= number.integer <= 100"})` expects `number`. Hand-rolled `Number()` at top level misses nested objects (`filters:{limit:"number"}`), arrays element-wise, booleans, and mis-coerces `""→0` causing silent 200 instead of 400.

## Decision

`coerceDeep(schema, data)` walks `schema.toJsonSchema()` object properties; per-property delegates to `coerceValue(prop, raw, defs)` resolving `$ref` via `resolveRef`:

- `isNumericType` → `Number(raw)` if string and `!isNaN`, else preserve.
- `isBooleanType` → `"true"→true`, `"false"→false` strictly (capital `True` no coerce → 400).
- `isArrayType` → each element via `coerceValue(items, el)`; single `"1"` with `items:number` wraps to `[1]`.
- `isObjectType` → `JSON.parse` attempt on `"{...}"` string then walk sub-properties.
- **Guards never coerce:** `raw===undefined` or `typeof raw==="string" && trim()===""` (empty/whitespace) → preserve for ArkType 400; caller skips missing keys.

`arktypeValidator(target,schema)` calls `coerceDeep` **before** `schema(data)`; on `ArkErrors` throws `APIError(400)` (ADR 005).

## Alternatives

- No coercion — require `Number(q.limit)` in handler (poor UX, leaks validation).
- Shallow coercion top-level primitives only — misses nested/arrays.
- ArkType built-in coercion scopes — inconsistent with Hono `validator` flow and header lowercasing `ponytail`.

## Consequences

- **Migration:** Additive; `GET /search?limit=5` previously 400 (string vs number) now 200 correctly; empty `?limit=` still 400 (guard).
- **Testing:** Issue 03 cases: flat `limit/offset`, nested `filters.limit`, arrays `ids:number[]` repeated and single, booleans `active`, empty-string, wrong-type `limit=abc` → `{error} 400` via chokepoint; spec still shows `minimum/maximum/type: integer`.
- **Concurrency:** Sync walk, no locks; per-request.
- **Docs:** Header lowercasing caveat (`ponytail: Hono lowercases via Fetch Headers; header schemas must use lowercase keys`), array query shape guidance (`?ids=1&ids=2` not `?ids=1,2` CSV — CSV explicitly unsupported), `coerceDeep` scope documented.
- **Ceilings flagged (Q12–13):** `?ids=1,2` CSV not handled, `True` case-insensitive not coerced, `toJsonSchema()` per-request without cache (perf cliff — future `WeakMap<Type,JsonSchema>` at validator creation), header key normalization in `coerceDeep` for `target==="header"` — lowercasing both sides if mismatch reported.

## References

- `src/openapi.ts` — `coerceDeep`, `coerceValue`, `resolveRef`, `is*Type`, `arktypeValidator`
- `HANDOFF.md` — issue 03 verification

