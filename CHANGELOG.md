# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`docs({ auth })` opt-in docs guard** — `docs()` now accepts an optional `auth` (a raw Hono `MiddlewareHandler`, or a registered auth name like `'session'`) to gate both the OpenAPI spec and the Scalar UI route. The guard is registered **before** mounting (the auth-guarded recipe, hand-`app.use` boilerplate removed) and rejects via the same throw-to-onError path as route auth. The unauthenticated default is unchanged (non-breaking); an unregistered auth name throws (mirrors `api()`'s guard).

## [0.6.2] - 2026-08-29

### Changed

- **Example auth secrets now read from the environment** — `examples/strategies/routes.ts` and `examples/auth/routes.ts` load credential-bearing config (`SESSION_SECRET`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_PASSWORD`) from the environment with documented non-secret fallbacks, so a deployed app commits no real value. This is a response to a GitGuardian "Generic Password" alert that was a **false positive** on the intentional demo/test placeholders — a full git-history scan confirmed no real credential was ever committed (no rotation or history scrub required).

## [0.6.1] - 2026-08-29

### Added

- **`jose` for the JWT layer (ADR-013)** — `src/auth/jwt.ts` now signs/verifies via `jose` `SignJWT`/`jwtVerify` instead of hand-rolled JWS (landed as part of the auth-lean hardening). Opt-in capability: `keys`/`kid` rotation, `jwks` (a `URL` or `{ keys: JWK[] }`) for local/remote JWKS, asymmetric signing (RS256/EdDSA via a `CryptoKey`), `algorithms` alg-pinning (default `["HS256"]`; must include the signing alg), and `refreshTransport` (an HttpOnly refresh cookie set/cleared via `CookieTransport` on `issue`/`refresh`/`revoke`). Existing single-`secret` callers are unchanged (HS256, no `kid`, body-only tokens).
- **`@noble/hashes` for the shared crypto (ADR-014)** — `src/auth/crypto.ts` delegates HMAC-SHA256, SHA-256, and CSPRNG bytes to `@noble/hashes` with the same exported helper names/signatures (session/oauth unchanged; landed as part of the auth-lean hardening, and it set the Node floor to `>=20.19`).
- **Opt-in `peta-hono/password` subpath** — `hashPassword`/`verifyPassword` via `@noble/hashes` `scrypt` (audited, zero-dependency). Returns a self-describing, parameter-encoded hash (work factors + salt + derived key) with constant-time verification; per-call work-factor overrides; documented argon2id caveat.
- **Cookie serialization hardening** — `serializeCookie` gains `domain`/`priority`/`hostPrefix`/`securePrefix`; `__Host-<name>` forces `Secure` + `Path=/` + no `Domain` (throws on `domain`/non-`/` path); `__Secure-<name>` requires `Secure` but does not force `Path=/`; `SameSite="None"` requires `Secure` (RFC-6265bis). A `createCookieTransport(opts)` helper (`read`/`set`/`clear`) round-trips an opaque bearer token in an HttpOnly cookie.

### Changed

- **Session CSRF default is now `"origin"`** — `csrf: "origin" | "double-submit" | false` (default `"origin"`), with a new `origin?: string | string[]` option (required when `csrf` is `"origin"` and unset — throws a helpful error). `"origin"` rejects cross-site mutating requests (mismatched `Origin` / `Sec-Fetch-Site: cross-site` → 403) with no client token; `true` is an alias for `"double-submit"` (the classic `x-csrf-token` behavior); `false` restores legacy. **Migration:** callers who ran `csrf: false` are unaffected; callers relying on cookie-auth mutations without a token should set `csrf: false` or configure `origin`.
- **Session cookie is `Secure` by default** — a `cookie` block (`{ secure?, sameSite?, path?, httpOnly?, hostPrefix? }`) defaults `secure: true` (dev-over-http opt-out: `cookie: { secure: false }`) and supports `__Host-` via `hostPrefix`.
- **OAuth PKCE is on by default** — `usePKCE` defaults to `true` even for confidential clients with a `clientSecret`; the state cookie is `Secure` by default, and a provider `error` query param (user denial) is routed to `onError` instead of "Invalid OAuth state".
- **Node floor bumped to `>=20.19.0`** — `@noble/hashes` v2 is ESM-only. `engines.node` reflects this.

### Security notes (ponytail ceilings)

- JWT is HS256-symmetric by default; asymmetric (RS256/EdDSA)/JWKS/key-rotation are opt-in via `keys`/`jwks`/`algorithms`. Tokens are signed not encrypted.
- Default session/refresh stores are in-memory (process-local) — supply a durable `SessionStore`/`RefreshTokenStore` for production.
- `hashPassword`/`verifyPassword` are credential hashing only — no user/password/session management (the caller's job).
- `arctic`/`oslo` are deprecated (by their author); the hand-rolled Google OAuth flow is deliberate.

## [0.6.0] - 2026-08-28

### Added

- **Built-in auth strategies (ADR-012)** — opt-in `auth.session(name, opts)`, `auth.jwt(name, opts)`, `auth.oauth(name, opts)`, and the unified `auth.strategy(name, { type, ...opts })`. Each registers a guard through the same path as `auth(name, mw, scheme?)` (so `{ auth: name }` keeps the 401 + `security` + `securitySchemes` behavior) and returns flow helpers:
  - **session** — signed `sid.hmac` cookie + pluggable `SessionStore` (in-memory via `createMemorySessionStore()`); helpers `create`/`destroy`/`get`/`generateCsrf`/`verifyCsrf`. `create`/`destroy` set the cookie on the context *and* return the `Set-Cookie` value for Response-returning handlers.
  - **jwt** — HS256 access tokens (Web Crypto, no new dep) with a unique `jti`, plus opaque, hashed, rotating, single-use, family-revoked refresh tokens (in-memory via `createMemoryRefreshTokenStore()`); helpers `issue`/`refresh`/`revoke`/`verifyAccess`.
  - **oauth (Google)** — authorization-code + PKCE flow; emits an `oauth2` security scheme and mounts `/auth/google/start` + `/auth/google/callback`; `onSuccess({ user, tokens, request, c })` is the integration point to issue a JWT or create a session; `fetchFn`/`tokenURL`/`userInfoURL` injectable for tests/proxies.
- **Security-scheme type split** — a new `SecurityScheme` type is added for the *wide* emitted set `components.securitySchemes` (`apiKey`/`in:"cookie"` + `oauth2`/`authorizationCode`), re-exported from the barrel alongside the existing narrow `AuthScheme`. `AuthScheme` (the *input* to `auth(name, mw, scheme?)`) is UNCHANGED since v0.5.4 (`http` bearer/basic + `apiKey` header/query). **Compile-time-only break:** consumers who type `components.securitySchemes` entries (or a union over it) with `AuthScheme` must switch to `SecurityScheme`; passing a scheme to `auth()` and exhaustive switches over `AuthScheme` are unaffected.
- **Strategies example** — `examples/strategies/` demonstrates session + jwt + google oauth in one app, wired into `check:all` and the README structure tree.
- **Strategy self-check** — `src/auth.selfcheck.ts` (7 assertions) plus the strategies example, run via `nub run check:auth` / `nub run check:all`.

### Security notes (ponytail ceilings)

- JWT is **HS256 symmetric only** — no asymmetric (RS256/EdDSA) or JWKS support yet; the signing secret is a raw HMAC key.
- Session cookies are **signed, not encrypted**, and are not `Secure` by default (set `secure: true` on https); CSRF is an opt-in double-submit token with `SameSite=Lax` as the default mitigation.
- Default session/refresh stores are **in-memory (process-local)** — supply a durable `SessionStore`/`RefreshTokenStore` for production.

## [0.5.4] - 2026-08-27

### Changed

- **Docs accuracy** — reconcile `README`, `AGENTS.md`, the `docs/` glossary/domain-model/ADRs, and the example apps with the shipped v0.5.3 behavior. `AGENTS.md` now reflects the real tree (`src/paths.ts`, `src/typecheck.selfcheck.ts`, `examples/auth/`), softens the `docs()` ordering (the spec builds lazily on `/openapi.json`; route registration order is what matters), and documents the default-bearer auth scheme (#03), the unified 404 ctor `notFound` (#04), `hide400` (#05), the dev-only `debug` gate (#06), the lowest-2xx/3xx success-code default (#08), `fail` as canonical (#09), and the `"sideEffects": false` side-effect-import risk. The example apps got comment-only notes (no behavior change) on the optional `scheme` arg and the lazy-spec `docs()` ordering. Spec snapshot unchanged — no regeneration required.

### Fixed

- **Stale comment in `src/api.ts`** — the debug-gate prose still described the error handler as gated by `NODE_ENV=production`; corrected to the v0.5.3 (#06) dev-only gate (reveals `{ error, stack }` only under `NODE_ENV=development|test`, redacts otherwise).

## [0.5.3] - 2026-08-27

### Fixed

- **Auth-doc contract (#03)** — a route with `{ auth }` is always documented as protected: it emits a `401 Unauthorized` response, a `security` requirement, and the matching `components.securitySchemes` entry — even when `auth()` is registered *without* a `scheme` argument. When the `scheme` arg is omitted, a default `{ type: "http", scheme: "bearer" }` scheme is published (the `scheme` arg only controls the lock-icon kind).
- **Unified 404 (#04)** — unmatched routes now return `application/json {error}` through the single `createErrorHandler` policy instead of Hono's `text/plain "404 Not Found"`, so a `fail.notFound()` and an unmatched route share one shape (and one chokepoint).
- **Dev-only `debug` (#06)** — `debug: true` reveals `{ error, stack }` only when `NODE_ENV=development` (or `test`). In a production deploy where `NODE_ENV` is absent (or a Bun/Deno/edge runtime without `process`), details are withheld rather than leaked — the old gate leaked because `isProd = NODE_ENV === "production"` defaulted to false when unset.
- **Success-code selection (#08)** — the default success status is the **lowest** declared 2xx/3xx (JS enumerates integer-like response keys in ascending order), not "first". Docs corrected; set `status` explicitly when declaring multiple 2xx/3xx.
- **Default `info.version` (#12)** — an omitted `version` now defaults to `"0.0.0"` instead of a misleading `"1.0.0"` for a pre-1.0 library.

### Added

- **`hide400` opt-out (#05)** — suppress the auto-documented `400` on a pure `:param` route via `hide400: true` (surfaced through `api()`, the `api.get()` shorthands, and `OpenAPIHono.openapi()`); a user-declared `responses: {400}` and the always-on `500` are preserved.

### Changed

- **`fail` is the canonical error helper (#09)** — `errors` and `httpErrors` are deprecated pure synonyms (still exported); README/glossary/ADR now use one consistent name.
- **Negative auth type diagnostic (#11)** — `ReqFor` documents that `Property 'auth' does not exist on type 'ReqFor<...>'` means the route is missing `auth: "required"`; README shows the negative case.
- **Docs accuracy (#07, #10)** — README structure tree reflects the real tree (`basic/`, `db.ts`+`schema.ts`, `auth/`, `src/paths.ts`, `spec.snapshot.json`); standard `npm install peta-hono hono arktype` (and pnpm/bun) install path; Nub noted as only needed for repo examples; Multi-file section warns that `import "./posts.js"` is a required side-effect import that `"sideEffects": false` can drop, and softens the `docs()` ordering (the spec builds lazily; route registration order is what matters). ADR-010 status corrected to Accepted-implemented; the `errors`/`validation`/`registry` sketch is marked proposed.
- **`:param{regex}` and `method` typos documented (#12)** — `{regex}` is enforced by Hono's router (a mismatch → 404), not the ArkType param validator (which types/validates the segment as `string`); `method`'s `(string & {})` escape hatch means a typo passes typecheck and throws at runtime via `normalizeMethod`.

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
