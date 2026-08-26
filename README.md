# peta-hono

A function-based API DSL on top of [Hono](https://hono.dev) + [ArkType](https://arktype.io).

Write a function, get a typed REST endpoint with auto-generated OpenAPI docs, request validation, and auth middleware — all in a few lines of code.

## Install

```bash
nub add peta-hono
```

Requires `hono` and `arktype` as peer dependencies — install them alongside:

```bash
nub add peta-hono hono arktype
```

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

- **`createApi<Auth, Env>(opts)`** — returns `{ api, auth, docs, app }`. The optional `Auth` generic types the auth context (`req.auth`), and `Env` (Hono `Env`) types `req.c` (`c.var`, `c.env`). Omit both for apps with no auth/typed vars.
- **`api(config, handler)`** / **`api.get(path, config, handler)`** — registers a Hono route with OpenAPI metadata. The handler receives a flat request object with types inferred from the ArkType schemas in `config`. Path params (`:name`, `:id?`, `:id{[0-9]+}`) are parsed automatically and appear as top-level keys (optional params like `:id?` are typed as `string | undefined`). When `{ auth: 'name' }` is set, the handler also receives `auth: Auth`. Shorthands `api.get`, `api.post`, `api.put`, `api.patch`, `api.delete` (alias `api.del`) mirror Hono's `app.get` etc. and infer the path param types from the first arg. Config fields:
  - `method: Method` — HTTP method, typed with autocomplete (`GET`/`get`/etc, case-insensitive via `normalizeMethod`)
  - `path: string` — Hono-style path with `:param` tokens
  - `tags?: string[]` — OpenAPI tags for grouping in docs
  - `summary?: string` — operation title in docs
  - `description?: string` — operation description
  - `operationId?: string` — override auto-generated operationId (useful for SDK generation)
  - `deprecated?: boolean` — mark operation as deprecated in spec
  - `status?: number` — explicit success status (use 204 for No Content; handler returns `null`)
- **`auth(name, middleware, scheme?)`** — registers a named auth middleware. **Return-based:** `(c: Context<Env>) => Auth` — throw to reject (e.g. `throw fail.unauthorized()`), or return a value that becomes `req.auth` in handlers. Apply via `{ auth: 'name' }` in the api config. Optional `scheme` registers an OpenAPI security scheme (adds lock icon in docs): `{ type: 'http', scheme: 'bearer' }`, `{ type: 'http', scheme: 'basic' }`, or `{ type: 'apiKey', in: 'header', name: 'X-API-Key' }`.
- **`docs(specPath?, uiPath?)` / `docs({ specPath?, uiPath? })`** — mounts the OpenAPI JSON spec and Scalar docs UI. Both positional (`docs("/openapi.json", "/docs")`) and options-object (`docs({ specPath, uiPath })`) forms are supported.
- **`fail` / `errors` / `httpErrors`** — throw named HTTP errors: `throw fail.notFound('post not found')`. Aliases `errors` and `httpErrors` are re-exports of `fail` for callers preferring noun forms. Helpers for common codes: `fail.badRequest` (400), `fail.unauthorized` (401), `fail.forbidden` (403), `fail.notFound` (404), `fail.conflict` (409), `fail.unprocessableEntity` (422), `fail.tooManyRequests` (429), `fail.internalServerError` (500), `fail.badGateway` (502), `fail.serviceUnavailable` (503), `fail.gatewayTimeout` (504). Each accepts an optional message (sensible default if omitted). For custom status codes, use `throw new APIError(status, message)` directly.

Handler returns a plain object (no `c.json()`). The library wraps it in the correct response. Return `null` for 204 No Content.

## Features

- Path params auto-typed from `:name` syntax — no `c.req.param('name')` digging (including optional `:id?` → `string | undefined`)
- Body/query/header validation via ArkType — schemas double as OpenAPI input documentation
- Response schemas feed into OpenAPI output documentation
- Auth middleware — named, reusable, applied per-endpoint, with OpenAPI security schemes
- **Typed auth context** — `createApi<Auth, Env>()` + return-based `auth()` middleware propagate the authenticated user to handlers as `req.auth` with full type safety; `Env` types `req.c` (`c.var` / `c.env`)
- **`fail` error helpers** — `throw fail.notFound('...')` for ergonomic typed HTTP errors (11 named status helpers + `APIError` for custom codes; also available as `errors` / `httpErrors`)
- Method shorthands — `api.get`, `api.post`, `api.put`, `api.patch`, `api.delete`/`api.del` with full type inference, mirroring Hono idioms; `method` typed as `Method` with case-insensitive handling
- OpenAPI `operationId` / `deprecated` / tags / summary / description for doc grouping and SDK generation
- `docs()` options-object form — `docs({ specPath, uiPath })` alongside positional args
- 204 No Content support — handler returns `null`
- Auto-generated OpenAPI 3.0 spec at `/openapi.json`
- Scalar API reference UI at `/docs`
- Built on Hono — runs anywhere Hono runs (Node, Bun, Deno, Cloudflare Workers)
- **Zero-config TypeScript** via [Nub](https://nubjs.com/docs) — `nub file.ts` runs it directly

## Project structure

```
src/
  openapi.ts    — OpenAPIHono class, createRoute, arktypeValidator, spec emission
  api.ts        — createApi, api, auth, docs, APIError
  index.ts      — public barrel (re-exports all public API)
examples/
  example/      — single-file example app
    routes.ts     — route definitions
    index.ts      — server entry point
    selfcheck.ts  — runnable end-to-end test suite
  blog/         — multi-file blog API
    setup.ts      — shared createApi() + auth singleton
    store.ts      — in-memory data store
    posts.ts      — post CRUD routes
    comments.ts   — nested comment routes
    index.ts      — server entry
    selfcheck.ts  — runnable end-to-end test suite
dist/           — built output (created by `nub run build`)
```

## Multi-file example: Blog API

The `examples/blog/` directory demonstrates how to split routes across files. The pattern is:

1. **`examples/blog/setup.ts`** — creates the API builder and auth middleware, exports `{ api, auth, docs, app }`. This is your app's shared singleton — every route file imports `api` from here.
2. **`examples/blog/posts.ts`** and **`examples/blog/comments.ts`** — import `api` from `setup.ts` and register their routes via top-level `api()` calls. The `api()` function mutates the shared `app` instance.
3. **`examples/blog/index.ts`** — imports all route files *for their side effects* (the top-level `api()` calls register the routes), then calls `docs()` and starts the server.

```ts
// examples/blog/index.ts
import './posts.js'      // side effect: registers post routes
import './comments.js'   // side effect: registers comment routes
import { docs, app } from './setup.js'
docs()
serve(app)
```

**Route import order matters** when you have overlapping paths — Hono matches routes in registration order. List the most specific routes before the less specific ones (`/posts/latest` before `/posts/:id`).

**`docs()` mount order:** `docs()` must be called **after** all route imports — routes register via side-effect `api()` calls on the shared `app` from `setup.ts`. The `setup.ts` singleton (`createApi()` once, export `{ api, auth, docs, app }`) is the protectable pattern for multi-file apps.

**Protecting docs (auth-guarded recipe):** Default `docs()` is unauthenticated (`ponytail: no auth on docs — protect it in production if needed`). For private APIs, guard the spec and UI with auth middleware *before* mounting:

```ts
// examples/blog/index.ts — auth-guarded variant
import './posts.js'
import './comments.js'
import { docs, app } from './setup.js'
import { authMiddleware } from './auth.js'

app.use('/openapi.json', authMiddleware)
app.use('/docs/*', authMiddleware)
docs() // now requires auth
serve(app)
```

Run with:

```bash
nub examples/blog/index.ts
```

## TypeScript config

- **Dev (`nub file.ts`):** `tsconfig.json` uses `moduleResolution: "bundler"` — Nub resolves `.js` imports to `.ts` sources, so `import './posts.js'` works in dev without a build step.
- **Build (`nub run build`):** `tsconfig.build.json` uses `moduleResolution: "NodeNext"` — preserves `.js` ESM imports in `dist/` for the published artifact (Node, Bun, Cloudflare). Both configs enable `strict` + `noUncheckedIndexedAccess`.
- Imports always use `.js` extensions — works in both runtimes via Nub (dev) and NodeNext (build).

