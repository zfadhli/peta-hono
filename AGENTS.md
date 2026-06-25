# AGENTS.md

## Project

Function-based API DSL on Hono + ArkType. Declare endpoints with auto-generated OpenAPI docs, ArkType validation, and auth middleware.

## Stack

- All-in-one toolkit: [Nub](https://nubjs.com/docs) — runs TypeScript, installs deps, runs scripts, manages Node (`nub file.ts`, `nub install`, `nub run`, `nubx`, `nub node`)
- Framework: Hono + `src/openapi.ts` (in-repo OpenAPIHono + ArkType validator)
- Validation: ArkType
- Docs UI: Scalar (@scalar/hono-api-reference)
- Language: TypeScript, strict mode, noUncheckedIndexedAccess

## Commands

| Purpose | Command |
|----------|---------|
| Install deps | `nub install` |
| Build package | `nub run build` (tsc emits `dist/`) |
| Run example | `nub examples/basic/index.ts` |
| Run blog | `nub examples/blog/index.ts` |
| Typecheck | `nub run typecheck` |
| Lint | `nub run lint` |
| Lint auto-fix | `nub run lint:fix` |
| Format check | `nub run format` |
| Example tests | `nub examples/basic/selfcheck.ts` |
| Blog tests | `nub examples/blog/selfcheck.ts` |
| Lib tests | `nub src/openapi.selfcheck.ts` |
| All tests | `nub src/openapi.selfcheck.ts && nub examples/basic/selfcheck.ts && nub examples/blog/selfcheck.ts` |

## Structure

- `src/openapi.ts` — OpenAPIHono class (with default `onError`), arktypeValidator, APIError, ArkType/AuthScheme types, OpenAPI spec emission
- `src/api.ts` — library: createApi, api, auth, docs, fail (re-exports APIError from openapi.ts)
- `src/index.ts` — public barrel (re-exports all public API)
- `src/openapi.selfcheck.ts` — runnable lib integration test
- `examples/basic/` — single-file example app (hello, things, search)
- `examples/blog/` — multi-file blog API (posts + comments, setup.ts singleton pattern)
- `examples/blog/spec.snapshot.json` — golden OpenAPI spec for regression detection

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extensions (Nub resolves to `.ts`)
- `ponytail:` comments mark deliberate simplifications with ceiling/upgrade path
- No test framework — selfcheck.ts files are runnable integration tests
- TypeScript strict mode, noUncheckedIndexedAccess

## Key patterns

- `createApi()` returns a closure; route files import `api` from a shared `setup.ts`
- Routes register via top-level `api()` calls (side effects)
- Handler receives flat request object: path params at top level, body/query/headers nested
- Handler returns plain object → library wraps in `c.json()`. Return `null` → `c.body(null, status)` for 204
- `APIError(status, message)` for typed HTTP errors (status is `ContentfulStatusCode`)
- `auth(name, mw, scheme?)` registers middleware + optional OpenAPI security scheme
- All errors — handler-thrown `APIError`, validator failures, unexpected throws — route through `app.onError` (single chokepoint). `OpenAPIHono` registers a default `onError`; `createApi()` overrides it with its own policy
- `arktypeValidator` throws `APIError(400, summary)` on validation failure (does not return a `Response`) so `onError` sees validation errors
- Route import order matters for overlapping paths — more specific routes first
- To update the blog spec snapshot: `rm examples/blog/spec.snapshot.json && nub examples/blog/selfcheck.ts`
