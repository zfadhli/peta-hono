# 03: Deep query/header coercion before ArkType validation

**What to build:** Query and header values arriving as strings are coerced to the types expected by ArkType schemas before validation runs — including nested objects, arrays, and booleans — so numeric and flag query schemas work without manual parsing and empty/missing values correctly 400.

**Blocked by:** 01: Rebuild and gate the published artifact

**Status:** done (committed deda20b)

- [x] `GET /search?limit=5&offset=0` with `query: type({ limit: "1 <= number.integer <= 100", offset: "number.integer >= 0" })` validates as numbers via `app.request` and returns typed numbers in the handler
- [x] Nested shapes (e.g. `filters: { limit: "number" }`), array shapes (`ids: "number[]"`, repeated `?ids=1&ids=2`), and `boolean` flag shapes (`?active=true`) coerce element-wise before ArkType validation; non-numeric strings for numeric fields 400 with the standard `{ error: string }` body
- [x] Empty string `?limit=` and missing required fields do not coerce to `0`/`false` — they fail validation and reach the single error chokepoint with 400, preserving the `arktypeValidator` throws-instead-of-returns contract
- [x] Verified via `app.request()` cases for flat, nested, array, boolean, and empty-string queries/headers against the highest `app.request` seam, plus `/openapi.json` still documents the same parameter schemas with correct `minimum`/`maximum`/`type`
