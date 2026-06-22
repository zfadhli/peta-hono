import { createApi, APIError } from '../lib/api.js'
import { type } from 'arktype'

const { api, auth, docs, app } = createApi({
  title: 'Encore-style Hono API',
  version: '1.0.0',
})

// --- Auth middleware --------------------------------------------------------
// The third argument registers a Bearer auth security scheme in OpenAPI docs.

auth('required', async (c, next) => {
  const token = c.req.header('Authorization')
  if (!token?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}, { type: 'http', scheme: 'bearer' })

// --- 1. GET /hello/:name — path params (Encore-style) ----------------------

api(
  { method: 'GET', path: '/hello/:name', tags: ['Hello'], summary: 'Say hello to someone', auth: 'required' },
  async ({ name }) => ({
    message: `Hello ${name}!`,
  }),
)

// --- 2. POST /things — body validation + APIError --------------------------

api(
  {
    method: 'POST',
    path: '/things',
    tags: ['Things'],
    summary: 'Create a new thing',
    body: type({
      name: 'string >= 1',
      count: 'number.integer > 0',
    }),
    responses: { 201: type({ id: 'string' }) },
    auth: 'required',
  },
  async ({ body }) => {
    if (body.count > 100) {
      throw new APIError(400, 'count too high')
    }
    return { id: crypto.randomUUID() }
  },
)

// --- 3. GET /search — query params -----------------------------------------

api(
  {
    method: 'GET',
    path: '/search',
    tags: ['Search'],
    summary: 'Search for things',
    query: type({
      q: 'string',
      limit: '1 <= number.integer <= 100 = 10',
    }),
    auth: 'required',
  },
  async ({ query }) => {
    const results = Array.from({ length: query.limit }, (_, i) => ({
      id: i + 1,
      title: `${query.q} result ${i + 1}`,
    }))
    return { results, total: results.length }
  },
)

// --- Mount OpenAPI docs ----------------------------------------------------

// ponytail: no auth on docs — protect it in production if needed.
docs()

export default app
