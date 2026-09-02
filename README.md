# peta-hono

A function-based API DSL on top of [Hono](https://hono.dev) + [ArkType](https://arktype.io).

Write a function, get a typed REST endpoint with auto-generated OpenAPI docs, request validation, and auth middleware — all in a few lines of code.

## Install

```bash
npm install peta-hono hono arktype
```

Or with pnpm / bun:

```bash
pnpm add peta-hono hono arktype
bun add peta-hono hono arktype
```

`peta-hono` is a normal npm package (`main`/`exports`/`types` point at `dist/`). It requires `hono` and `arktype` as **peer dependencies** — install them alongside. It ships `jose` (JWT/JWK) and `@noble/hashes` (crypto/`scrypt`) as **runtime dependencies**, so the built-in auth strategies and an **opt-in password helper** (`import { hashPassword } from "peta-hono/password"`) work out of the box. Nub is **only** needed to run this repo's own examples (it resolves `.js` imports to `.ts` at runtime without a build step); it is not a runtime or install dependency of the package.

## Quickstart (dev with Nub)

For local development (TypeScript, no build step), install [Nub](https://nubjs.com/docs):

```bash
npm install -g @nubjs/nub
```

Then clone and run:

```bash
git clone https://github.com/zfadhli/peta-hono my-api
cd my-api
nub install
nub examples/basic/index.ts
```

Open `http://localhost:3000/docs` for the Scalar API reference UI.

## Write an API endpoint

```ts
import { createApi, fail } from 'peta-hono'
import { type } from 'arktype'

const { api, auth, docs, app } = createApi<{ user: { id: string } }>({ title: 'My API', version: '1.0.0' })

// Register auth middleware — return-based: throw to reject, return value becomes req.auth
auth('required', async (c) => {
  const token = c.req.header('Authorization')
  if (!token?.startsWith('Bearer ')) throw fail.unauthorized()
  return { user: { id: 'alice' } }
})

// GET /hello/:name — path params flat at top level, auth context available
// Shorthand api.get(path, config, handler) mirrors Hono's app.get
api.get('/hello/:name', { auth: 'required', operationId: 'sayHello' },
  async ({ name, auth }) => ({ message: `Hello ${name}! (${auth.user.id})` }),
)

// POST /things — body validation via ArkType, typed response
// Classic form still works — `method` is typed as `Method` (case-insensitive: POST/post/Post)
api(
  {
    method: 'POST', path: '/things',
    body: type({ name: 'string >= 1', count: 'number.integer > 0' }),
    responses: { 201: type({ id: 'string' }) },
    auth: 'required',
  },
  async ({ body, auth }) => {
    if (body.count > 100) throw fail.badRequest('count too high')
    return { id: crypto.randomUUID(), userId: auth.user.id }
  },
)

// GET /search — query params (also available as api.get)
api.get('/search',
  {
    query: type({ q: 'string', limit: '1 <= number.integer <= 100 = 10' }),
    auth: 'required',
  },
  async ({ query }) => ({ results: [...Array(query.limit)], total: query.limit }),
)

// Mount OpenAPI spec at /openapi.json, docs UI at /docs
// docs() accepts positional args or an options object
docs({ specPath: '/openapi.json', uiPath: '/docs' })
export default app
```

Run with `nub index.ts` (or `node index.ts` if you've built the lib).

## How it works

- **`createApi<Auth, Env>(opts)`** — returns `{ api, auth, docs, app }`. The optional `Auth` generic types the auth context (`req.auth`), and `Env` (Hono `Env`) types `req.c` (`c.var`, `c.env`). Omit both for apps with no auth/typed vars. `opts` supports `title` (default `"API"`), `version` (default `"0.0.0"` — a pre-1.0 lib must not claim `1.0.0`), and `debug` (dev-only; see below).
- **`api(config, handler)`** / **`api.get(path, config, handler)`** — registers a Hono route with OpenAPI metadata. The handler receives a flat request object with types inferred from the ArkType schemas in `config`. Path params (`:name`, `:id?`, `:id{[0-9]+}`) are parsed automatically and appear as top-level keys (optional params like `:id?` are typed as `string | undefined`). When `{ auth: 'name' }` is set, the handler also receives `auth: Auth`. Shorthands `api.get`, `api.post`, `api.put`, `api.patch`, `api.delete` (alias `api.del`) mirror Hono's `app.get` etc. and infer the path param types from the first arg. Config fields:
  - `method: Method` — HTTP method, typed with autocomplete (`GET`/`get`/etc, case-insensitive via `normalizeMethod`). The `Method` type includes `(string & {})` as an escape hatch for custom verbs, so a typo like `"GETT"` passes typecheck but throws `Unsupported method` at runtime — `normalizeMethod` is the enforcement point
  - `path: string` — Hono-style path with `:param` tokens
  - `tags?: string[]` — OpenAPI tags for grouping in docs
  - `summary?: string` — operation title in docs
  - `description?: string` — operation description
  - `operationId?: string` — override auto-generated operationId (useful for SDK generation)
  - `deprecated?: boolean` — mark operation as deprecated in spec
  - `status?: number` — explicit success status (use 204 for No Content; handler returns `null`). When multiple 2xx/3xx codes are declared in `responses`, the default resolves to the **lowest** 2xx/3xx (JS enumerates integer-like keys in ascending order), so set `status` explicitly to get a non-lowest default
- **`auth(name, middleware, scheme?)`** — registers a named auth middleware. **Return-based:** `(c: Context<Env>) => Auth` — throw to reject (e.g. `throw fail.unauthorized()`), or return a value that becomes `req.auth` in handlers. Apply via `{ auth: 'name' }` in the api config. The `scheme` argument registers an OpenAPI security scheme and controls the **lock-icon kind**: `{ type: 'http', scheme: 'bearer' }`, `{ type: 'http', scheme: 'basic' }`, or `{ type: 'apiKey', in: 'header', name: 'X-API-Key' }`. **A route with `{ auth }` is always documented as protected** — it emits a `401 Unauthorized` response, a `security` requirement, and the matching `components.securitySchemes` entry — even when `auth()` was registered *without* a `scheme`. When the `scheme` arg is omitted, a default `bearer` scheme is published so the `security` requirement resolves to a real scheme (no dangling reference) and the lock icon shows. **Scheme types — narrow input vs wide emitted:** the `scheme` argument to `auth()` is typed `AuthScheme` (the stable narrow input: `http` bearer/basic + `apiKey` header/query). The library *emits* a wider set into `components.securitySchemes` — `apiKey` with `in: "cookie"` and `oauth2`/`authorizationCode` — typed `SecurityScheme`. When reading `components.securitySchemes` (e.g. from a generated spec), type it as `SecurityScheme`, not `AuthScheme`. This split is a compile-time-only change; passing a scheme to `auth()` and exhaustive switches over `AuthScheme` are unaffected.
- **Built-in auth strategies (opt-in, no breaking change)** — `auth` also carries three strategy builders that register guards through the same path (so `{ auth: name }` keeps the 401 + `security` + `securitySchemes` behavior) and return flow helpers:
  - `const session = auth.session('session', { secret, cookieName?, store?, csrf?, origin?, cookie? })` — signed cookie (`sid.hmac`) + pluggable `SessionStore`. The cookie is `Secure` by default (dev-over-http opt-out: `cookie: { secure: false }`), and `hostPrefix` renames it to `__Host-sid` (which also forces `Secure` + `Path=/` + no `Domain` — so it is **not** combined with a non-`/` `path`). CSRF defaults to `origin` — a cross-site mutating request (`Origin` mismatch or `Sec-Fetch-Site: cross-site`) is rejected 403 with no client token; **`origin` mode requires the `origin` option** (a string/string[] of allowed origins — the strategy throws if it's omitted). `'double-submit'`/`true` keeps the `x-csrf-token` behavior; `false` restores legacy. Helpers: `session.create(c, data)` (sets the cookie *and* returns the `Set-Cookie` value), `session.destroy(c)`, `session.get(c)`, `session.generateCsrf(c)`, `session.verifyCsrf(c, token)`.
  - `const jwt = auth.jwt('jwt', { secret, keys?, jwks?, algorithms?, refreshTransport?, accessTtl?, refreshTtl?, issuer?, audience?, store? })` — access tokens via `jose` (`SignJWT`/`jwtVerify`, HS256 by default) + opaque rotating refresh tokens (single-use, family-revoked on reuse). `algorithms` pins the `alg` (default `['HS256']`, must include the signing alg); `keys`/`kid` rotation, `jwks` (URL or `{ keys: JWK[] }`), and asymmetric (RS256/EdDSA) are opt-in. `generateKey()` builds a ready-to-wire asymmetric keypair — `{ kid, privateKey, publicJwk }` with `publicJwk` already stamped `kid`+`alg` — so `keys: [{ kid, key: privateKey }]` + `jwks: { keys: [publicJwk] }` (and `algorithms` accepting the signing alg) is the RS256/EdDSA + rotation happy path without hand-rolling `crypto.subtle.generateKey`/`exportKey`. `refreshTransport: { cookie: { name, path?, hostPrefix?, secure?, sameSite?, httpOnly? } }` sets/clears an HttpOnly refresh cookie via `CookieTransport` — which defaults to Secure + SameSite=Lax, path-scoped, and **`hostPrefix: false`** (a deliberate default so `path` scoping works); `hostPrefix: true` renames `__Host-<name>` and **forces `Path=/`**, so a non-`/` `path` requires omitting it. Helpers: `jwt.issue(sub, claims?, c?)`, `jwt.refresh(refreshToken, c?)`, `jwt.revoke(refreshToken, c?)`, `jwt.verifyAccess(token)`.
  - `const google = auth.oauth('google', { clientId, clientSecret?, redirectUri, scopes?, onSuccess, ... })` — Google authorization-code + PKCE flow; registers the `oauth2` security scheme and mounts `/auth/google/start` + `/auth/google/callback`. PKCE is on by default (even for confidential clients with a `clientSecret`); the state cookie is `Secure` by default; a provider `error` deny is routed to `onError`. `onSuccess({ user, tokens, request, c })` is where you issue a JWT (`jwt.issue(...)`) or create a session (`session.create(c, ...)`). `tokenURL`/`userInfoURL`/`fetchFn` are injectable for tests/proxies. The `/start`+`/callback` flow routes are registered on `app` but deliberately **not** emitted in the OpenAPI `paths` (the spec emitter is JSON-body-oriented — a `302` redirect would mismatch; the `oauth2` security scheme *is* emitted).
  - `auth.strategy(name, { type: 'session' | 'jwt' | 'oauth', ... })` — unified dispatch over the same builders.
  - Stores are injectable: `createMemorySessionStore()` / `createMemoryRefreshTokenStore()`, or any object implementing `SessionStore` / `RefreshTokenStore` for production. **ponytail:** the default stores are in-memory (process-local, lost on restart) — a real deployment should supply a durable store (Postgres/Redis/KV) that implements the same interface. The contracts are tiny (`SessionStore`: `get`/`set`/`delete`; `RefreshTokenStore`: `get`/`save`/`delete`/`getFamily`/`deleteFamily`), so a DB adapter is a small table mapping: a session row holds `sid` + a `data` JSON blob + `expires_at` (pruned on `get`), and a refresh-token row holds `token_hash` + `sub` + `family_id` + `expires_at` + `used`, with `getFamily`/`deleteFamily` filtering on `family_id`. See `examples/blog/db.ts` for the SQLite+Drizzle pattern and `src/auth/store.ts` for the exact interfaces.
  - **Opt-in password hashing** — `import { hashPassword, verifyPassword } from 'peta-hono/password'`. `hashPassword` returns a self-describing `scrypt` hash (work factors + salt + derived key, via `@noble/hashes`); `verifyPassword` re-derives and constant-time-compares. scrypt is the default (argon2id is ~5× slower in pure JS). **`ponytail:`** credential hashing only — it does not manage users/passwords/sessions (that stays the caller's job).
- **`docs(specPath?, uiPath?)` / `docs({ specPath?, uiPath? })`** — mounts the OpenAPI JSON spec and Scalar docs UI. Both positional (`docs("/openapi.json", "/docs")`) and options-object (`docs({ specPath, uiPath })`) forms are supported. **`docs({ auth })` opt-in guard** — pass a raw Hono `MiddlewareHandler` or a registered auth name (e.g. `docs({ auth: 'session' })`) to gate both the spec and UI routes. The guard is registered before mounting (the auth-guarded recipe, no `app.use` boilerplate) and rejects via the same throw-to-onError path as route auth. The unauthenticated default is unchanged (non-breaking).
- **Header schemas must use lowercase keys** — Hono lowercases incoming headers via Fetch `Headers`; declare `type({ "x-api-key": "string" })` not `type({ "X-Api-Key": "string" })`. The spec emits lowercased header param names so runtime and docs match (`_addObjectParams` lowercases when `in === "header"`).
- **Path params & `{regex}`** — `:name`, `:id?`, `:id{[0-9]+}` are parsed from the path and typed at the top level. **The `{regex}` in `:param{regex}` is enforced by Hono's router, not the ArkType param validator** — a mismatch produces a 404 (route doesn't match), and the ArkType schema types/validates the segment as `string`.
- **Success code default** — the handler/status defaults to `status`, else the **lowest** declared 2xx/3xx response, else `200`. Because object keys are enumerated in ascending numeric order, `{ 200, 201 }` and `{ 201, 200 }` both default to `200`; set `status: 201` to get `201`.
- **`debug` is dev-only** — `createApi({ debug: true })` reveals `{ error, stack }` only when `NODE_ENV=development` (or `test`). In production — including a deploy that forgets to set `NODE_ENV`, or a Bun/Deno/edge runtime without `process` — it **withholds** details by default rather than leaking them. Strip `debug` (or set `NODE_ENV=development`) in dev; never ship it in prod bundles.
- **Reading `auth` without `{ auth: 'required' }`** — `req.auth` is only present when the route declares `auth` (and the app is registered with `createApi<Auth>`). A no-auth route that reads `auth` fails typecheck with `Property 'auth' does not exist on type 'ReqFor<...>'` — that means the route isn't auth-gated; add `auth: 'required'` to fix it. This negative case is pinned in `src/api.test-d.ts`.
- **`fail`** — throw named HTTP errors: `throw fail.notFound('post not found')`. `fail` is the canonical, single helper. (The `errors` and `httpErrors` aliases are deprecated pure synonyms kept for backward compatibility.) Helpers for common codes: `fail.badRequest` (400), `fail.unauthorized` (401), `fail.forbidden` (403), `fail.notFound` (404), `fail.conflict` (409), `fail.unprocessableEntity` (422), `fail.tooManyRequests` (429), `fail.internalServerError` (500), `fail.badGateway` (502), `fail.serviceUnavailable` (503), `fail.gatewayTimeout` (504). Each accepts an optional message (sensible default if omitted). For custom status codes, use `throw new APIError(status, message)` directly.

Handler returns a plain object (no `c.json()`). The library wraps it in the correct response. Return `null` for 204 No Content.

## Features

- Path params auto-typed from `:name` syntax — no `c.req.param('name')` digging (including optional `:id?` → `string | undefined`)
- Body/query/header validation via ArkType — schemas double as OpenAPI input documentation
- Response schemas feed into OpenAPI output documentation
- Auth middleware — named, reusable, applied per-endpoint, with OpenAPI security schemes
- **Typed auth context** — `createApi<Auth, Env>()` + return-based `auth()` middleware propagate the authenticated user to handlers as `req.auth` with full type safety; `Env` types `req.c` (`c.var` / `c.env`)
- **Built-in auth strategies** — session (cookie), JWT (bearer access + rotating refresh), and Google OAuth2 (authorization-code + PKCE), all opt-in and composable with the existing `{ auth: name }` gating. JWT uses `jose` (with opt-in `keys`/`jwks` rotation + `algorithms` alg-pinning, and `generateKey()` to build a ready-to-wire asymmetric keypair); the shared crypto is `@noble/hashes`. Emit the matching OpenAPI `securitySchemes` (`apiKey/in:cookie`, `bearer`, `oauth2/authorizationCode`). See the strategies example: `nub examples/strategies/index.ts`.
- **Opt-in password hashing** — `peta-hono/password` (`hashPassword`/`verifyPassword`) via `@noble/hashes` `scrypt`, kept out of the core barrel.

## Security notes

- **Secure cookies are on by default** for the session cookie (and the OAuth state cookie). A dev-over-http app opts out explicitly: `auth.session('session', { secret, cookie: { secure: false } })` (see `examples/strategies`).
- **`csrf` defaults to `"origin"`** for the session strategy — a cross-site mutating request is rejected 403 with no client token. Configure `origin` (a string/string[] of allowed origins), or set `csrf: "double-submit"` / `false`. Callers who ran `csrf: false` are unaffected.
- **`arctic` and `oslo` are deprecated** by their author — do not use them for OAuth/random. The hand-rolled Google authorization-code + PKCE OAuth flow is deliberate.
- **Password hashing is scrypt-based** (`@noble/hashes`); argon2id is ~5× slower in pure JS and is available if you need it. The password helper hashes credentials only — it does not manage accounts.
- **`fail` error helpers** — `throw fail.notFound('...')` for ergonomic typed HTTP errors (11 named status helpers + `APIError` for custom codes). `fail` is the canonical helper; `errors` / `httpErrors` are deprecated synonyms.
- **Accurate default docs** — auth-protected routes always document `401` + a `security` requirement (even when `auth()` is registered without a `scheme`, which defaults to `bearer`); the auto-documented 400 on `:param` routes can be suppressed per-route with `hide400`; `info.version` defaults to `0.0.0` not a misleading `1.0.0`
- **Unified 404** — unmatched routes return `application/json {error}` through the single error policy, matching `fail.notFound()`
- Method shorthands — `api.get`, `api.post`, `api.put`, `api.patch`, `api.delete`/`api.del` with full type inference, mirroring Hono idioms; `method` typed as `Method` with case-insensitive handling via `normalizeMethod` (`GET`/`get`/`Get` all work, `import { normalizeMethod } from "peta-hono"`)
- Header lowercasing — header param names are lowercased in spec and runtime to match Hono's Fetch-Header behavior; declare header schemas with lowercase keys
- OpenAPI `operationId` / `deprecated` / tags / summary / description for doc grouping and SDK generation
- `docs()` options-object form — `docs({ specPath, uiPath, auth })` alongside positional args; `docs({ auth })` guards the spec + UI with a middleware or registered auth name
- 204 No Content support — handler returns `null`
- Auto-generated OpenAPI 3.0 spec at `/openapi.json`
- Scalar API reference UI at `/docs`
- Built on Hono — runs anywhere Hono runs (Node, Bun, Deno, Cloudflare Workers)
- **Zero-config TypeScript** via [Nub](https://nubjs.com/docs) — `nub file.ts` runs it directly

## Project structure

```
src/
  openapi.ts    — OpenAPIHono class, arktypeValidator, APIError, OpenAPI spec emission
  api.ts        — createApi, api, auth (+ strategies), docs (DSL facade)
  paths.ts      — single source for path & method grammar (PARAM_TOKEN_RE, normalizeMethod, toOapiPath)
  auth/         — built-in auth strategies (crypto, store, cookie, session, jwt, oauth)
  password.ts   — opt-in `peta-hono/password` scrypt hash/verify helper
  index.ts      — public barrel (re-exports all public API)
examples/
  basic/        — single-file example app
    routes.ts     — route definitions
    index.ts      — server entry point
    app.test.ts       — end-to-end test suite (Vitest)
  blog/         — multi-file blog API
    setup.ts      — shared createApi() + auth singleton
    db.ts         — data layer (Drizzle ORM + SQLite)
    schema.ts     — DB schema
    posts.ts      — post CRUD routes
    comments.ts   — nested comment routes
    index.ts      — server entry
    app.test.ts       — end-to-end test suite (Vitest)
    spec.snapshot.json — golden OpenAPI spec for regression detection
  auth/         — peta-auth integration example (register/login/profile/logout)
    routes.ts     — route definitions
    index.ts      — server entry
    types.d.ts    — typed c.var.session augmentation
    app.test.ts       — end-to-end test suite (Vitest)
  strategies/   — built-in auth strategies example (session + jwt + google oauth)
    routes.ts     — route definitions
    index.ts      — server entry
    app.test.ts       — end-to-end test suite (Vitest)
dist/           — built output (created by `nub run build`)
```

## Multi-file example: Blog API

The `examples/blog/` directory demonstrates how to split routes across files. The pattern is:

1. **`examples/blog/setup.ts`** — creates the API builder and auth middleware, exports `{ api, auth, docs, app }`. This is your app's shared singleton — every route file imports `api` from here.
2. **`examples/blog/posts.ts`** and **`examples/blog/comments.ts`** — import `api` from `setup.ts` and register their routes via top-level `api()` calls. The `api()` function mutates the shared `app` instance.
3. **`examples/blog/index.ts`** — imports all route files *for their side effects* (the top-level `api()` calls register the routes), then calls `docs()` and starts the server.

```ts
// examples/blog/index.ts
import './posts.js'      // side-effect: registers post routes (REQUIRED)
import './comments.js'   // side-effect: registers comment routes (REQUIRED)
import { docs, app } from './setup.js'
docs()
serve(app)
```

**`import './posts.js'` is a required side-effect import.** The route files register routes by running top-level `api()` calls as a module side effect. The library's `package.json` declares `"sideEffects": false` (correct for the library's own `dist/`, which has none) — but a bundler honoring that flag can **drop** `import './posts.js'` from your app bundle, because the import looks like it has no side effects, **silently losing every route**. Keep a `// side-effect: registers routes` comment on each import, and mark your app's route files as side-effectful (a `sideEffects` override in your app's `package.json`, or a bundler `sideEffects` config) so the routes survive tree-shaking.

**Route import order matters** when you have overlapping paths — Hono matches routes in registration order. List the most specific routes before the less specific ones (`/posts/latest` before `/posts/:id`).

**`docs()` mount order:** `docs()` doesn't strictly need to be the last call — the OpenAPI spec builds **lazily** on the `/openapi.json` request, not at `docs()` call time. What matters for correctness is **route registration order** (Hono matches in registration order), so import your route files before you call `docs()` for clarity. The `setup.ts` singleton (`createApi()` once, export `{ api, auth, docs, app }`) is the protectable pattern for multi-file apps.

**Protecting docs (auth-guarded recipe):** Default `docs()` is unauthenticated (`ponytail: no auth on docs — protect it in production if needed`). For private APIs, opt in with the `docs({ auth })` shorthand — pass a raw Hono `MiddlewareHandler` or a registered auth name (the same names `api({ auth })` accepts). It guards both the spec and UI routes and is registered before mounting (Hono matches in registration order, so the guard must come first — an unregistered auth name throws):

```ts
// examples/blog/index.ts — auth-guarded variant via the shorthand
import './posts.js'
import './comments.js'
import { docs, app } from './setup.js'
import { authMiddleware } from './auth.js'

docs({ auth: authMiddleware }) // now requires auth
// or by registered name: docs({ auth: 'session' })
serve(app)
```

The manual recipe (`app.use('/openapi.json', authMiddleware)` + `app.use('/docs/*', authMiddleware)` before `docs()`) still works and is equivalent.

Run with:

```bash
nub examples/blog/index.ts
```

## TypeScript config

- **Dev (`nub file.ts`):** `tsconfig.json` uses `moduleResolution: "bundler"` — Nub resolves `.js` imports to `.ts` sources, so `import './posts.js'` works in dev without a build step.
- **Build (`nub run build`):** `tsconfig.build.json` uses `moduleResolution: "NodeNext"` — preserves `.js` ESM imports in `dist/` for the published artifact (Node, Bun, Cloudflare). Both configs enable `strict` + `noUncheckedIndexedAccess`.
- Imports always use `.js` extensions — works in both runtimes via Nub (dev) and NodeNext (build).

