# 05: Deterministic OpenAPI spec emission

**What to build:** The generated OpenAPI 3.0 spec at `/openapi.json` deterministically reflects route declarations — paths use OpenAPI `{param}` form, method handling matches Hono conventions, parameter and schema shapes mirror ArkType constraints, and recursive schemas are stably hoisted with no dangling refs.

**Blocked by:** 01: Rebuild and gate the published artifact, 03: Deep query/header coercion before ArkType validation

**Status:** done (committed fd3c2d9, refined 38b4774, verified 2026-08-26)

- [x] `GET /openapi.json` emits `paths` with `/:param` → `/{param}` conversion for all Hono token shapes, `operationId` is deterministic and collision-free, and `parameters`/`requestBody`/`responses` carry the ArkType `minimum`/`maximum`/`type: integer` constraints used at runtime
- [x] Recursive ArkType schemas are hoisted via `$defs` → `components/schemas` with stable `schema_<12hex>` names (content-hash over normalized structure, not counter names), all `$ref` rewritten to `#/components/schemas/...`, no `$defs` key or `#/$defs/` refs remain, and shared error schemas are deduped
- [x] Method normalization is case-insensitive for the supported set (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) with a single helpful validation message; unsupported methods and edge path characters are handled consistently, and header param extraction respects Hono lowercasing with documented guidance
- [x] Verified via `app.request("/openapi.json")` snapshot comparison (golden `spec.snapshot.json` workflow: remove and re-run to regenerate), plus regression checks that existing `/docs` Scalar mount still 200s with `Scalar` marker
