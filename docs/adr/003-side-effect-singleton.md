# ADR 003 — Side-effect registration & setup.ts singleton

**Date:** 2026-06-25 (blog example) — documented 2026-08-26 (issue 07)
**Status:** Accepted

## Context

Ergonomics goal: `api()` at top-level registers a route without threading `app` through every file (Encore-style). Multi-file apps (`examples/blog/posts.ts`, `comments.ts`) need shared `Auth`/`Env` generics and one `OpenAPIHono` instance. Requirement: `docs()` must see all routes (mount after imports), route order matters for shadowing (`/posts/latest` vs `/posts/:id`).

## Decision

`createApi<Auth,Env>()` returns closure-captured `{api,auth,docs,app}`. `examples/blog/setup.ts` calls it **once** and re-exports `{api,auth,docs,app}`. Route files `import {api} from "./setup.js"` and call `api()` / `api.get()` at top level for side effects. `examples/blog/index.ts` imports route files for side effects then calls `docs()` after.

```ts
// setup.ts
export const {api,auth,docs,app} = createApi<{user:{id:string}}>({
  title:"Blog API"
});
// posts.ts
import {api} from "./setup.js";
api.get("/posts", {...}, async ({query})=>...);
// index.ts
import "./posts.js"; import "./comments.js";
import {docs} from "./setup.js";
docs({specPath:"/openapi.json", uiPath:"/docs"});
```

## Alternatives

- No singleton — each file calls `createApi()` (breaks one `app`, auth maps desync).
- Explicit `register(app, config, handler)` — verbose, loses generic plumbing.
- Decorator / config-object array — non-idiomatic for Hono, worse inference for `ParamsFromPath`.

## Consequences

- **Migration:** Adopted in v0.1; future linter could detect double `createApi` calls.
- **Testing:** `blog/selfcheck.ts` dynamic `import("./posts.js")` ensures import order; `spec.snapshot.json` catches missing import (route silently dropped → snapshot diff).
- **Concurrency:** Side effects run at import time before `serve`; no race. `setup.ts` is module singleton — parallel selfchecks need isolated `createApi()` per test (not shared singleton) if they require clean `app`.
- **Docs:** `AGENTS.md` documents mount order, singleton protectable pattern, route-order shadowing warning, auth-guarded docs recipe (`app.use('/docs/*',mw)` before `docs()`).
- **Improvements flagged (Q4 grilling):** Add lint rule preserving `import "./posts.js"` (no-unused-import must ignore), add warning if `docs()` called when `_routes.length===0`, consider explicit factory `export const routes=[defineGet(...)]` + `mount(app,routes)` as opt-in for HMR/tree-shaking users.

## References

- `examples/blog/setup.ts`, `examples/blog/index.ts`, `src/api.ts` closure
- `AGENTS.md` Key patterns — `setup.ts` singleton

