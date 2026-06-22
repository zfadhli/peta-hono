# encore-hono

A thin Encore-style API DSL on top of [Hono](https://hono.dev) + [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi).

Write a function, get a typed REST endpoint with auto-generated OpenAPI docs, request validation, and auth middleware — all in a few lines of code.

## Quickstart

Requires [Nub](https://nubjs.com) (a Node.js toolkit that runs TypeScript directly — no build step):

```bash
npm install -g @nubjs/nub
```

Then:

```bash
npx degit your-mirror/encore-hono my-api
cd my-api
npm install
nub example/index.ts
```

Open `http://localhost:3000/docs` for the Scalar API reference UI.

## Write an API endpoint

```ts
import { createApi, APIError } from './lib/api.js'
import { z } from 'zod'

const { api, auth, docs, app } = createApi({ title: 'My API', version: '1.0.0' })

// Register auth middleware
auth('required', async (c, next) => {
  if (!c.req.header('Authorization')?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

// GET /hello/:name — path params, Encore-style
api(
  { method: 'GET', path: '/hello/:name', auth: 'required' },
  async ({ name }) => ({ message: `Hello ${name}!` }),
)

// POST /things — body validation via zod, typed response
api(
  {
    method: 'POST', path: '/things',
    body: z.object({ name: z.string().min(1), count: z.number().int().positive() }),
    responses: { 201: z.object({ id: z.string() }) },
    auth: 'required',
  },
  async ({ body }) => {
    if (body.count > 100) throw new APIError(400, 'count too high')
    return { id: crypto.randomUUID() }
  },
)

// GET /search — query params
api(
  {
    method: 'GET', path: '/search',
    query: z.object({ q: z.string(), limit: z.coerce.number().int().optional().default(10) }),
    auth: 'required',
  },
  async ({ query }) => ({ results: [...Array(query.limit)], total: query.limit }),
)

// Mount OpenAPI spec at /openapi.json, docs UI at /docs
docs()
export default app
```

Run with `nub index.ts`.

## How it works

- **`createApi({ title, version })`** — returns `{ api, auth, docs, app }`
- **`api(config, handler)`** — registers a Hono route with OpenAPI metadata. The handler receives a flat request object with types inferred from the zod schemas in `config`. Path params (`:name`) are parsed automatically and appear as top-level keys. Config fields:
  - `tags?: string[]` — OpenAPI tags for grouping in docs
  - `summary?: string` — operation title in docs
  - `description?: string` — operation description
  - `status?: number` — explicit success status (use 204 for No Content; handler returns `null`)
- **`auth(name, middleware, scheme?)`** — registers a named auth middleware. Apply via `{ auth: 'name' }` in the api config. Optional `scheme` registers an OpenAPI security scheme (adds lock icon in docs): `{ type: 'http', scheme: 'bearer' }`, `{ type: 'http', scheme: 'basic' }`, or `{ type: 'apiKey', in: 'header', name: 'X-API-Key' }`.
- **`docs(specPath?, uiPath?)`** — mounts the OpenAPI JSON spec and Scalar docs UI.
- **`APIError`** — throw typed HTTP errors: `throw new APIError(400, 'bad request')`.

Handler returns a plain object (no `c.json()`). The library wraps it in the correct response. Return `null` for 204 No Content.

## Features

- Path params auto-typed from `:name` syntax — no `c.req.param('name')` digging
- Body/query/header validation via zod — schemas double as OpenAPI input documentation
- Response schemas feed into OpenAPI output documentation
- Auth middleware — named, reusable, applied per-endpoint, with OpenAPI security schemes
- OpenAPI tags, summary, description for doc grouping
- 204 No Content support — handler returns `null`
- Typed errors via `APIError` — maps to `{ error }` JSON with the right status code
- Auto-generated OpenAPI 3.0 spec at `/openapi.json`
- Scalar API reference UI at `/docs`
- Built on Hono — runs anywhere Hono runs (Node, Bun, Deno, Cloudflare Workers)
- **Zero-config TypeScript** via [Nub](https://nubjs.com) — `nub file.ts` runs it directly

## Type-safe RPC client

Hono's `hc` client works with the exported app type for fully typed API calls:

```ts
import type { App } from './routes.js'
import { hc } from 'hono/client'

const client = hc<App>('http://localhost:3000')
const res = await client.hello[':name'].$get({ param: { name: 'world' }, header: { authorization: 'Bearer ...' } })
```

## Project structure

```
lib/api.ts      — the library (~260 lines)
example/
  routes.ts     — route definitions (single-file)
  index.ts      — server entry point
  selfcheck.ts  — runnable end-to-end test suite
blog/
  setup.ts      — shared createApi() + auth singleton (imported by all route files)
  store.ts      — in-memory data store (posts + comments)
  posts.ts      — post CRUD routes (list, get, create, update, delete)
  comments.ts   — comment routes (nested under /posts/:postId)
  index.ts      — server entry — imports all route files, calls docs(), starts server
  selfcheck.ts  — runnable end-to-end test suite
```

## Multi-file example: Blog API

The `blog/` directory demonstrates how to split routes across files. The pattern is:

1. **`blog/setup.ts`** — creates the API builder and auth middleware, exports `{ api, auth, docs, app }`. This is your app's shared singleton — every route file imports `api` from here.
2. **`blog/posts.ts`** and **`blog/comments.ts`** — import `api` from `setup.ts` and register their routes via top-level `api()` calls. The `api()` function mutates the shared `app` instance.
3. **`blog/index.ts`** — imports all route files *for their side effects* (the top-level `api()` calls register the routes), then calls `docs()` and starts the server.

```ts
// blog/index.ts
import './posts.js'      // side effect: registers post routes
import './comments.js'   // side effect: registers comment routes
import { docs, app } from './setup.js'
docs()
serve(app)
```

**Route import order matters** when you have overlapping paths — Hono matches routes in registration order. List the most specific routes before the less specific ones (`/posts/latest` before `/posts/:id`).

Run with:

```bash
nub blog/index.ts
```

## Relationship to Encore

This is a thin (~200 line) wrapper on `@hono/zod-openapi` that mimics Encore's function-based API declaration style. It doesn't try to replicate Encore's infrastructure-as-code features (databases, Pub/Sub, secrets, etc.) — it stays at the HTTP routing + docs layer, which is the part that makes Encore feel immediately productive.
