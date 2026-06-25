# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-25

### Added

- Handler access to Hono Context via `req.c` — enables calling `session.save()`/`session.destroy()` for login/logout flows
- `examples/auth/` — peta-auth integration example with register, login, profile, and logout endpoints
- `examples/auth/types.d.ts` — TypeScript module augmentation pattern for typed `c.var.session` via Hono's `ContextVariableMap`
- `peta-auth` as dev dependency for the auth example
- Blog example now uses Drizzle ORM + SQLite (`@libsql/client`) instead of an in-memory Map store — `examples/blog/db.ts` + `examples/blog/schema.ts`

### Removed

- Blog example's in-memory store (`examples/blog/store.ts`)

## [0.1.1] - 2026-06-24

### Changed

- Swapped `node:crypto` for Web Crypto API — package now portable to any runtime (Bun, Deno, CF Workers, browsers)
- Updated repository metadata and license holder

### Added

- npm publish workflow with provenance support

### Fixed

- README clone URL now points to the actual repository instead of a placeholder

## [0.1.0] - 2026-06-23

### Added

- Function-based API DSL on Hono + ArkType — declare endpoints, get typed REST APIs
- Auto-generated OpenAPI 3.0 specs at `/openapi.json` with Scalar UI at `/docs`
- Typed route handlers with ArkType request validation (body, query, headers, path params)
- Auth middleware system — return-based `(c) => Auth`, typed `req.auth` in handlers
- OpenAPI security scheme registration (bearer, basic, apiKey) with automatic lock icon in docs
- Ergonomic error helpers: `fail.notFound()`, `fail.badRequest()`, `fail.unauthorized()`, etc.
- Query string → number coercion for ArkType numeric fields
- Recursive schema support — ArkType `$defs` hoisted to `components/schemas` with stable content-hash names
- Auto-documented 400 (validation), 401 (unauthorized), 500 (server error) framework responses
- Multi-file app pattern via `setup.ts` singleton (see `examples/blog/`)
- MIT license

### Infrastructure

- Published as `peta-hono` npm package with `hono` + `arktype` peer dependencies
- Biome for linting/formatting, Lefthook for pre-commit + pre-push hooks
- CI via GitHub Actions (Node 20/22)
- Example apps: `examples/basic/` (single-file) and `examples/blog/` (multi-file blog API)
