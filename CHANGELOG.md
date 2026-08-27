# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.2] - 2026-08-27

### Fixed

- Method-shorthand overload collapse — `api.get/post/put/patch/del/delete(path, config, handler)` now uses an explicit two-overload `ApiMethodHelper<Auth,E>` interface instead of `ReturnType<typeof makeMethodHelper>`. Both `auth?: undefined` → `ReqFor` and `auth: string` → `ReqFor & AuthField<Auth>` overloads are preserved, so on a no-auth app (`createApi<undefined>`) reading `auth` in a shorthand handler is a type error, identical to the classic `api({ method, path, auth })` form. Closes #20.
- Framework-error documentation contract — `_buildResponses` auto-doc comment now states 400 applies to validated `request.body/query/headers/params` **or** a path containing `:param` (auto-generated `request.params` via `hasParamTokens`), and the guard `if(!responses["400"])` respects an explicit `responses:{400: schema}` (replaces the auto doc rather than suppressing it). `ponytail:` marker added for the benign 400-on-`:param` false-positive. Closes #21.

### Added

- Regression guard `src/typecheck.selfcheck.ts` (typecheck-only, excluded from `dist/`) — `@ts-expect-error` assertions pin the no-auth negative case (`auth` must not be readable in a handler) for both the classic and shorthand forms; `tsc` fails if the overload collapse recurs.
- `src/openapi.selfcheck.ts` `assertFrameworkErrorControl` — asserts 400 auto-doc on `:param`, 404 ponytail heuristic, shared deduped error component, and that explicit `responses:{404}` replaces rather than suppresses the auto schema.

## [0.5.1] - 2026-08-26

### Fixed

- Public barrel now re-exports `normalizeMethod` as documented in 0.5.0 — `import { normalizeMethod } from "peta-hono"` works in dev (`bundler`) and `dist` (`NodeNext`), case-insensitive `GET`/`get`/`Get` → `get`, throws `Unsupported method: X. Use one of: GET, POST, PUT, PATCH, DELETE`. Closes #17, spec #16.

### Changed

- Header `ArkType` keys MUST be lowercase — `type({ "x-api-key": "string" })` validates and emits `OpenAPIParameter { name: "x-api-key", in: "header" }` via `_addObjectParams` `name.toLowerCase()`; mixed-case `X-Api-Key` reliably 400s via single `ErrorHandler` chokepoint; wire `X-Custom-Token` still satisfies lowercase schema (Hono lowercases via Fetch `Headers`); `coerceDeep` does not auto-lowercase; path/query casing preserved. `Ponytail` relocated from `toOapiPath` to `_addObjectParams`. Closes #17.
- Routing grammar single source — `src/paths.ts` canonical for `PARAM_TOKEN_RE`/`PARAM_HAS_RE`/`parseParamTokens`/`hasParamTokens`/`normalizeMethod`/`toOapiPath`/`SUPPORTED_METHODS` per ADR-010; `src/api.ts` + `src/openapi.ts` import rather than duplicate; barrel re-export chain `paths → openapi → index` stable for `Method`/`HttpMethod`/`normalizeMethod`.
- Docs — `README` How it works + Features and `AGENTS` Key patterns each document header lowercase invariant + barrel `normalizeMethod` import; `docs/glossary.md` adds `Method / HttpMethod / normalizeMethod` and amends `Coercion`/`OapiPath`/`Ponytail`; `docs/domain-model.md` §1/§4 marks `src/paths.ts` canonical and header `parameters[]` invariant; ADRs 001–011 added. Closes #18, spec #16.
- Deterministic spec emission unchanged — no `#/$defs/` leakage, no `Spec snapshot` regeneration required.

## [0.5.0] - 2026-08-26

### Added

- Method shorthands `api.get`, `api.post`, `api.put`, `api.patch`, `api.delete`/`api.del` with full path-param and ArkType inference — mirrors Hono `app.get` ergonomics. Classic `api({ method, path })` form unchanged.
- Typed `Method` / `HttpMethod` exports — `method` field now autocompletes known verbs and `normalizeMethod` handles any casing (`GET`/`get`/`Get`).
- `operationId` and `deprecated` route config fields — custom operationIds for SDK generation and deprecated marking in OpenAPI spec.
- `docs()` options-object overload — `docs({ specPath, uiPath })` alongside existing positional `docs(specPath, uiPath)`.
- `createApi<Auth, Env>` second generic — types `req.c` (`Context<Env>`) for `c.var` / `c.env` access; `auth()` middleware now typed as `(c: Context<Env>) => Auth`.
- `Env`-aware `ReqFor` — path, body, query, headers plus `c: Context<Env>`.
- `fail` aliases `errors` / `httpErrors` and new helpers `fail.badGateway` (502), `fail.serviceUnavailable` (503), `fail.gatewayTimeout` (504) — 11 helpers total.
- Optional path-param typing — `:id?` and `:id{regex}?` correctly infer as `string | undefined`; runtime schema now emits `string?` for optional params.
- Examples updated to shorthands, `operationId`/`deprecated` usage, and `docs({ specPath, uiPath })` form.

### Changed

- `docs()` signature extended (non-breaking) to support options object while keeping positional args.
- Deterministic spec emission intact — `toOapiPath`, `normalizeMethod`, stable `schema_<12hex>` hoisting unchanged; `operationId` custom values deduplicate with `_2` suffix on collision, `deprecated` emits verbatim.

## [0.4.0] - 2026-07-04

### Added

- Auto-documented 404 "Not Found" responses in generated OpenAPI spec for endpoints with path params (`:id`). The spec now reflects runtime `fail.notFound()` behavior for resource lookup endpoints. Closes #7.

## [0.3.0] - 2026-06-25

### Added

- `debug` option to `createApi()` — when enabled, non-`APIError` responses include the real error message and stack trace instead of the generic `"Internal Server Error"`. Useful for development; production should omit this option.

## [0.2.2] - 2026-06-25

### Fixed

- Validation errors now route through `app.onError` instead of short-circuiting with a direct `Response`. `arktypeValidator` throws `APIError(400, summary)` on validation failure (previously returned `c.json(...)`), so custom `onError` handlers (request IDs, structured logging, env-based message hiding) now see validation 400s. Client-visible response shape (`{ error: string }` 400) is unchanged. `APIError` moved from `api.ts` to `openapi.ts` to break the resulting import cycle; `OpenAPIHono` gained a default `onError` so standalone/advanced use still emits 400s. Closes #4.

## [0.2.1] - 2026-06-25

### Fixed

- Peer dependency `arktype` missing from `pnpm-lock.yaml`, causing `nub ci` to reject the frozen lockfile and fail npm publish. Regenerated lockfile to include `arktype` and its sub-dependencies (`@ark/schema`, `@ark/util`, `arkregex`).

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
