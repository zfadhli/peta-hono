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
api(
  { method: 'GET', path: '/hello/:name', auth: 'required' },
  async ({ name, auth }) => ({ message: `Hello ${name}! (${auth.user.id})` }),
)

// POST /things — body validation via ArkType, typed response
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

// GET /search — query params
api(
  {
    method: 'GET', path: '/search',
    query: type({ q: 'string', limit: '1 <= number.integer <= 100 = 10' }),
    auth: 'required',
  },
  async ({ query }) => ({ results: [...Array(query.limit)], total: query.limit }),
)

// Mount OpenAPI spec at /openapi.json, docs UI at /docs
docs()
export default app
```

Run with `nub index.ts` (or `node index.ts` if you've built the lib).

## How it works

- **`createApi<Auth>(opts)`** — returns `{ api, auth, docs, app }`. The optional `Auth` generic types the auth context object that handlers receive as `req.auth` (omit it for apps with no auth).
- **`api(config, handler)`** — registers a Hono route with OpenAPI metadata. The handler receives a flat request object with types inferred from the ArkType schemas in `config`. Path params (`:name`) are parsed automatically and appear as top-level keys. When `{ auth: 'name' }` is set, the handler also receives `auth: Auth` (typed via `createApi<Auth>`). Config fields:
  - `tags?: string[]` — OpenAPI tags for grouping in docs
  - `summary?: string` — operation title in docs
  - `description?: string` — operation description
  - `status?: number` — explicit success status (use 204 for No Content; handler returns `null`)
- **`auth(name, middleware, scheme?)`** — registers a named auth middleware. **Return-based:** `(c) => Auth` — throw to reject (e.g. `throw fail.unauthorized()`), or return a value that becomes `req.auth` in handlers. Apply via `{ auth: 'name' }` in the api config. Optional `scheme` registers an OpenAPI security scheme (adds lock icon in docs): `{ type: 'http', scheme: 'bearer' }`, `{ type: 'http', scheme: 'basic' }`, or `{ type: 'apiKey', in: 'header', name: 'X-API-Key' }`.
- **`docs(specPath?, uiPath?)`** — mounts the OpenAPI JSON spec and Scalar docs UI.
- **`fail`** — throw named HTTP errors: `throw fail.notFound('post not found')`. Helpers for common codes: `fail.badRequest` (400), `fail.unauthorized` (401), `fail.forbidden` (403), `fail.notFound` (404), `fail.conflict` (409), `fail.unprocessableEntity` (422), `fail.tooManyRequests` (429), `fail.internalServerError` (500). Each accepts an optional message (sensible default if omitted). For custom status codes, use `throw new APIError(status, message)` directly.

Handler returns a plain object (no `c.json()`). The library wraps it in the correct response. Return `null` for 204 No Content.

## Features

- Path params auto-typed from `:name` syntax — no `c.req.param('name')` digging
- Body/query/header validation via ArkType — schemas double as OpenAPI input documentation
- Response schemas feed into OpenAPI output documentation
- Auth middleware — named, reusable, applied per-endpoint, with OpenAPI security schemes
- **Typed auth context** — `createApi<Auth>()` + return-based `auth()` middleware propagate the authenticated user to handlers as `req.auth` with full type safety
- **`fail` error helpers** — `throw fail.notFound('...')` for ergonomic typed HTTP errors (8 named status helpers + `APIError` for custom codes)
- OpenAPI tags, summary, description for doc grouping
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

Run with:

```bash
nub examples/blog/index.ts
```

