# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
