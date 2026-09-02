# 01: Rebuild and gate the published artifact

**What to build:** The published package artifact faithfully reflects source semantics — consumers installing the package get the Web Crypto runtime, the throwing validator that routes through the single error chokepoint, correct type declarations including the debug option, and no stale exports.

**Blocked by:** None (can start immediately).

**Status:** done (committed 9b5f851)

- [x] Running the build from source produces `dist/` where the low-level OpenAPI layer uses the portable Web Crypto digest helper (no Node `node:crypto` import), the ArkType validator throws a typed HTTP error on `ArkErrors` instead of returning a `Response`, and the public barrel no longer re-exports removed symbols
- [x] Type declarations expose `createApi` options including the debug flag and the high-level barrel's `AuthScheme`/`ArkType`/`RouteConfig` shapes; a fresh `typecheck` passes with no drift between source and emitted declarations
- [x] Pre-publish and CI verify freshness — a clean build produces no diff in `dist/` and the publish workflow fails if the artifact is stale, so `npm publish` cannot ship a drifted artifact
- [x] Verified via `nub run build` + `nub run typecheck` + `nub run check:all` green and a spec snapshot unchanged except for intentionally fixed runtime behavior
