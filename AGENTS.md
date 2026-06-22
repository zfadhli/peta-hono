# AGENTS.md

## Project

Function-based API DSL on Hono + ArkType. Declare endpoints with auto-generated OpenAPI docs, ArkType validation, and auth middleware.

## Stack

- Runtime: Node.js via [Nub](https://nubjs.com) (`nub file.ts` — no build step)
- Framework: Hono + `lib/openapi.ts` (in-repo OpenAPIHono + ArkType validator)
- Validation: ArkType
- Docs UI: Scalar (@scalar/hono-api-reference)
- Language: TypeScript, strict mode, noUncheckedIndexedAccess

## Commands

| Purpose | Command |
|----------|---------|
| Run example | `nub example/index.ts` |
| Run blog | `nub blog/index.ts` |
| Typecheck | `tsc --noEmit` |
| Example tests | `nub example/selfcheck.ts` |
| Blog tests | `nub blog/selfcheck.ts` |
| Lib tests | `nub lib/openapi.selfcheck.ts` |
| All tests | `nub lib/openapi.selfcheck.ts && nub example/selfcheck.ts && nub blog/selfcheck.ts` |

## Structure

- `lib/openapi.ts` — OpenAPIHono class, createRoute, arktypeValidator, ArkType/AuthScheme types, OpenAPI spec emission
- `lib/api.ts` — library: createApi, api, auth, docs, APIError
- `lib/openapi.selfcheck.ts` — runnable lib integration test
- `example/` — single-file example app (hello, things, search)
- `blog/` — multi-file blog API (posts + comments, setup.ts singleton pattern)
- `blog/spec.snapshot.json` — golden OpenAPI spec for regression detection

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
- Route import order matters for overlapping paths — more specific routes first
- To update the blog spec snapshot: `rm blog/spec.snapshot.json && nub blog/selfcheck.ts`
