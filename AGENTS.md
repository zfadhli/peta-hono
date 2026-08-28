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
| Lint | `nub run lint` (covers `src/` + `examples/`, snapshot excluded via `biome.json` overrides) |
| Lint auto-fix | `nub run lint:fix` |
| Format check | `nub run format` |
| Example tests | `nub examples/basic/selfcheck.ts` |
| Blog tests | `nub examples/blog/selfcheck.ts` |
| Auth tests | `nub examples/auth/selfcheck.ts` |
| Lib tests | `nub src/openapi.selfcheck.ts` |
| Strategy tests | `nub src/auth.selfcheck.ts` |
| Strategies example | `nub examples/strategies/index.ts` |
| Strategies tests | `nub examples/strategies/selfcheck.ts` |
| All tests | `nub run check:all` (`lib + auth-strategies + basic + blog + auth + strategies`) |

## Structure

- `src/paths.ts` — single source for path & method grammar (PARAM_TOKEN_RE/PARAM_HAS_RE, parseParamTokens, hasParamTokens, toOapiPath, normalizeMethod, SUPPORTED_METHODS)
- `src/openapi.ts` — OpenAPIHono class (default `onError` + `notFound`), arktypeValidator, APIError, AuthScheme, createErrorHandler, OpenAPI spec emission (re-exports paths helpers)
- `src/api.ts` — library: createApi, api, auth, docs, fail (re-exports APIError from openapi.ts)
- `src/index.ts` — public barrel (re-exports all public API)
- `src/auth/` — built-in auth strategies (session / jwt / oauth): crypto, store, cookie, session, jwt, oauth
- `src/openapi.selfcheck.ts` — runnable lib integration test (12 assertions)
- `src/auth.selfcheck.ts` — runnable built-in auth strategy test (session / jwt / oauth / scheme emission / coexistence)
- `src/typecheck.selfcheck.ts` — type-only regression guard (tsc --noEmit; excluded from dist/ build)
- `examples/basic/` — single-file example app (routes.ts + index.ts + selfcheck.ts; hello, things, search, legacy)
- `examples/blog/` — multi-file blog API (setup.ts singleton, db.ts + schema.ts, posts.ts + comments.ts, index.ts + selfcheck.ts)
- `examples/blog/spec.snapshot.json` — golden OpenAPI spec for regression detection
- `examples/auth/` — peta-auth integration example (routes.ts + index.ts + types.d.ts + selfcheck.ts)
- `examples/strategies/` — built-in auth strategies example (session + jwt + google oauth; routes.ts + index.ts + selfcheck.ts)

## Conventions

- Always use `nub` for install/run/build — never `npm`, `pnpm`, or `bun` directly. Exceptions: `npm publish` (Nub has no registry-publish command) and `npm install -g @nubjs/nub` (bootstraps Nub itself).
- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extensions (Nub resolves to `.ts`)
- `ponytail:` comments mark deliberate simplifications with ceiling/upgrade path
- No test framework — selfcheck.ts files are runnable integration tests
- TypeScript strict mode, noUncheckedIndexedAccess
- Lint/format via Biome covers `src/` + `examples/` (lefthook pre-commit + `biome.json` overrides exclude `examples/blog/spec.snapshot.json` which is a generated golden file)
- TypeScript module resolution: `tsconfig.json` uses `bundler` for `nub file.ts` dev (Nub resolves `.js` → `.ts`); `tsconfig.build.json` uses `NodeNext` for `dist/` build (preserves `.js` ESM imports for published artifact). Both target `ESNext`/`ES2022` with `strict` + `noUncheckedIndexedAccess`.

## Key patterns

- `createApi<Auth, Env>({ title?, version?, debug? })` returns `{ api, auth, docs, app }`. `version` defaults to `"0.0.0"` (a pre-1.0 lib must not falsely claim `1.0.0`); `debug` is dev-only. Route files import `api` from a shared `setup.ts`.
- Routes register via top-level `api()` calls (side effects)
- Handler receives flat request object: path params at top level, body/query/headers nested
- Handler returns plain object → library wraps in `c.json()`. Return `null` → `c.body(null, status)` for 204
- `APIError(status, message)` for typed HTTP errors (status is `ContentfulStatusCode`)
- `fail` is the canonical error helper — `throw fail.notFound("...")`. `errors` / `httpErrors` are deprecated pure synonyms (still exported). The 11 named helpers (`fail.badRequest`, `fail.unauthorized`, `fail.forbidden`, `fail.notFound`, `fail.conflict`, `fail.unprocessableEntity`, `fail.tooManyRequests`, `fail.internalServerError`, `fail.badGateway`, `fail.serviceUnavailable`, `fail.gatewayTimeout`) live in `src/api.ts`.
- `auth(name, mw, scheme?)` registers middleware + an OpenAPI security scheme. The `scheme` arg defaults to `bearer` if omitted; every `{auth}` route is **always documented as protected** — it emits a `401` response, a `security` requirement, and the matching `components.securitySchemes` entry.
- Built-in auth strategies (opt-in, ADR-012): `auth.session(name, opts)`, `auth.jwt(name, opts)`, `auth.oauth(name, opts)` (and `auth.strategy(name, { type, ...opts })`) register guards through the same path as `auth(name, mw, scheme?)`, so `{ auth: name }` keeps the 401 + `security` + `securitySchemes` behavior. Session = signed `sid.hmac` cookie + pluggable `SessionStore`; JWT = HS256 access tokens (Web Crypto, no dep) + opaque rotating/revocable refresh tokens; OAuth = Google authorization-code + PKCE flow. **OAuth registers only the `oauth2` scheme + mounts `/start`/`/callback`; it is NOT a request guard** — protect downstream routes with a jwt/session gate. The `/start`+`/callback` flow routes are intentionally NOT emitted in the OpenAPI `paths` (the spec emitter is JSON-body-oriented; a `302` redirect would mismatch), but the `oauth2` securitySchemes entry is. Stores default in-memory — supply a durable `SessionStore`/`RefreshTokenStore` in prod (ponytail). **Input vs emitted security-scheme type:** `AuthScheme` is the narrow `auth(name, mw, scheme?)` input (http bearer/basic, apiKey header/query — unchanged since v0.5.4); `SecurityScheme` is the wide emitted `components.securitySchemes` type (adds `apiKey` `in: "cookie"` and `oauth2` with `authorizationCode` flows).
- All errors — handler-thrown `APIError`, validator failures, unexpected throws — route through `app.onError` (single chokepoint). `OpenAPIHono` registers a default `onError`; `createApi()` overrides it with its own policy. The `OpenAPIHono` ctor also registers `this.notFound(...)` so an unmatched route returns `application/json {error:"Not Found"}` via the shared `createErrorHandler` policy — unifying the 404 shape with `fail.notFound()`.
- `arktypeValidator` throws `APIError(400, summary)` on validation failure (does not return a `Response`) so `onError` sees validation errors
- `createErrorHandler(debug?)` is **dev-only** — it reveals `{ error, stack }` only when `NODE_ENV` is explicitly `development` or `test`; otherwise (production, or `NODE_ENV` absent on Bun/Deno/edge) it redacts to `{"error":"Internal Server Error"}`. `createApi({ debug: true })` wires this; never rely on `NODE_ENV === "production"` (the old gate leaked when unset).
- `hide400?: boolean` (on `RouteConfig`/`RouteFields`) suppresses the auto-documented `400` that any `:param` route gets (path params always pass `string` validation → benign noise). A user-declared `responses: {400}` still survives; the always-on `500` is untouched.
- Success code default: `status ?? lowest declared 2xx/3xx ?? 200`. JS enumerates integer-like keys in ascending numeric order, so `{200, 201}` and `{201, 200}` both yield `200` — set `status` explicitly for a non-lowest default (e.g. `status: 201`). Handlers return `null` for 204.
- Route import order matters for overlapping paths — more specific routes first
- `docs()` does **not** need to be the last call — the OpenAPI spec builds **lazily** on the `/openapi.json` request, not at `docs()` time. What matters for correctness is **route registration order** (Hono matches in registration order), so import your route files before `docs()` for clarity; the `setup.ts` singleton (`createApi()` once, export `{ api, auth, docs, app }`) is the protectable pattern for multi-file apps.
- Multi-file route imports must be **side-effect imports** — `import "./posts.js"` in the entry runs top-level `api()` calls to register routes. The library declares `"sideEffects": false` (true for its own `dist/`), so a bundler honoring it may **drop** that import and silently lose routes — comment each import (`// side-effect: registers routes`) and mark your app's route files side-effectful.
- Default `docs()` is unauthenticated (`ponytail: no auth on docs — protect it in production if needed` in `examples/basic/routes.ts`). For private APIs, guard docs with auth middleware before mounting:
  ```ts
  // auth-guarded docs — mount only for authenticated users
  app.use('/docs/*', authMiddleware)
  app.use('/openapi.json', authMiddleware)
  docs()
  ```
- Header schemas must use lowercase keys — Hono's `c.req.header()` lowercases via Fetch `Headers`; `_addObjectParams` emits `name.toLowerCase()` when `in === "header"` so spec and runtime match. Declare `type({ "x-api-key": "string" })` not `"X-Api-Key"` (ponytail: ceiled — `coerceDeep` does not auto-lowercase; strict fail-fast 400 if you use uppercase).
- `normalizeMethod` is public — `import { normalizeMethod } from "peta-hono"` (re-exported via `src/openapi.ts` from `src/paths.ts` single source, case-insensitive `GET`/`get`/`Get` → `"get"`, throws `Unsupported method` otherwise). `Method`/`HttpMethod` types are also re-exported from the barrel for `method` autocomplete.
- To update the blog spec snapshot: `rm examples/blog/spec.snapshot.json && nub examples/blog/selfcheck.ts`
