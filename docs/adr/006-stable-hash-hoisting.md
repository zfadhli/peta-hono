# ADR 006 — Stable content-hash component names + $defs hoisting

**Date:** 2026-08-26 (issue 05 fd3c2d9 + 38b4774)
**Status:** Accepted

## Context

ArkType `toJsonSchema()` emits `$defs: {intersection216: {...}}` with counter names and dangling `#/$defs/` refs — unstable across runs, non-OpenAPI (spec expects `#/components/schemas/`). Snapshot tests and SDK generation require deterministic names, deduped error schema, no dangling refs.

## Decision

- `sha1Hex(data)` via `crypto.subtle.digest("SHA-1")` (Web Crypto, no `node:crypto`) → hex slice(0,12) → `schema_<12hex>` (48 bits, ok for <1k schemas).
- Build `name→index` map, `normalizeRefs(JSON.stringify(def)).replace(/#\/\$defs\/([^"]+)/g, "#/$defs/${index}")` before hashing — hash depends on structure not counter `intersection216`/`intersection217`.
- `rename: Map<old, stable>`, `rewriteRefs(json, rename)` recursive in-place (objects + arrays) rewriting `$ref: "#/$defs/X"` → `"#/components/schemas/schema_<hash>"`.
- Hoist each def to `_components.schemas` (`if(!has) set`), `delete json.$defs`, `delete json.$schema`, return `json` (no `$defs` key, no `#/$defs/` remains). Single dedup Map ensures shared error schema written once.
- `operationId` dedup `*_2` via `seenOperationIds:Set` + `baseCounts:Map` (ADR 007).

## Alternatives

- Use raw counter names `intersectionN` — unstable diffs, snapshot churn.
- Hash raw JSON without normalization — changes when ArkType ref names change (structural equality lost).
- UUID — nondeterministic, breaks snapshot.

## Consequences

- **Migration:** Snapshot must be rebased after hash change: `rm examples/blog/spec.snapshot.json && nub examples/blog/selfcheck.ts` (documented in `AGENTS.md`). Minor bump for spec drift (0.4.0 did 404 injection).
- **Testing:** Selfcheck #4 asserts no `"$defs"`, no `#/$defs/`, all refs → `#/components/schemas/`, name regex `schema_[a-f0-9]{12}`, deduped single `schema_84c5e…` for `{error:string}`.
- **Concurrency:** `sha1Hex` async but pure; `_buildSpec` per-request builds refs from scratch except `Map` set-if-absent.
- **Docs:** Snapshot workflow documented. Future perf (grilling Q23): cache `JsonSchema` per `Type` via `WeakMap<Type,JsonSchema>` and compute hashes sync at registration if `node:crypto` available; currently recomputes per `GET /openapi.json` (thundering-herd risk).

## References

- `src/openapi.ts` — `sha1Hex`, `rewriteRefs`, `_schemaToOA`, `_getErrorSchemaRef`, `_components`
- `AGENTS.md` — spec snapshot workflow
