# 10: Warn about the interaction between `sideEffects: false` and side-effect route imports

## Source

Prioritized DX review — M4 (side-effect registration + `sideEffects:false` bundling hazard).

## What to build

The multi-file route pattern must not be silently broken by tree-shaking, and the risk must be documented.

The library's documented multi-file pattern registers routes via **side-effect top-level `api()` calls** (`import "./posts.js"` in `examples/blog/index.ts`). Meanwhile `package.json` declares `"sideEffects": false`. A bundler honoring `sideEffects:false` can **drop the `import "./posts.js"`** (it appears to have no side effects), silently losing all routes in a shipped bundle. The "`docs()` after all routes" ordering rule is also stronger than reality (the spec builds lazily on the `/openapi.json` request), but the side-effect drop is a real hazard.

This is a documentation + packaging guarantee issue, not a runtime logic change (unless a guard is added).

## Acceptance criteria

- [ ] README "Multi-file example: Blog API" warns that `import "./posts.js"` is a **required side-effect import** and that `sideEffects:false` in `package.json` can cause a bundler to drop it — recommend adding a `// side-effect: registers routes` comment or republishing a stable pattern.
- [ ] The "must call `docs()` after all route imports" language is softened to reflect that the spec is built on request (route **registration order** is what matters for Hono matching), while keeping the guidance for clarity.
- [ ] Either the `sideEffects` field in `package.json` is changed to accurately reflect the library (note: the library's own distributable has no side effects; the **example app** is what relies on side-effect imports), or the README makes the distinction explicit.
- [ ] `nub run check:all` passes after doc changes.

## Blocked by

None (docs/package metadata; can start immediately).
