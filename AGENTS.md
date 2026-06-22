# AGENTS.md

## Project

Encore-style API DSL on Hono + zod-openapi. Function-based endpoint declaration with auto-generated OpenAPI docs, zod validation, and auth middleware.

## Stack

- Runtime: Node.js via [Nub](https://nubjs.com) (`nub file.ts` — no build step)
- Framework: Hono + @hono/zod-openapi
- Validation: Zod
- Docs UI: Scalar (@scalar/hono-api-reference)
- Language: TypeScript, strict mode, noUncheckedIndexedAccess

## Commands

| Purpose | Command |
|----------|---------|
| Run example | `npm run dev` or `nub example/index.ts` |
| Run blog | `npm run blog` or `nub blog/index.ts` |
| Typecheck | `npm run typecheck` |
| Example tests | `npm run check` |
| Blog tests | `npm run blog:check` |

## Structure

- `lib/api.ts` — library: createApi, api, auth, docs, APIError, AuthScheme
- `example/` — single-file example app (hello, things, search)
- `blog/` — multi-file blog API (posts + comments, setup.ts singleton pattern)

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
- `APIError(status, message)` for typed HTTP errors
- `auth(name, mw, scheme?)` registers middleware + optional OpenAPI security scheme
- Route import order matters for overlapping paths — more specific routes first
