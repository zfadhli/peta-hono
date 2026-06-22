import { createApi, fail } from '../../src/index.js'
import { type } from 'arktype'

const { api, auth, docs, app } = createApi<{ user: { id: string } }>({
  title: 'Encore-style Hono API',
  version: '1.0.0',
})

// --- Auth middleware --------------------------------------------------------
// Return-based: throw to reject, return value becomes req.auth in handlers.
// The third argument registers a Bearer auth security scheme in OpenAPI docs.

auth('required', async (c) => {
  const token = c.req.header('Authorization')
  if (!token?.startsWith('Bearer ')) throw fail.unauthorized()
  return { user: { id: 'alice' } }
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
    responses: { 201: type({ id: 'string', userId: 'string' }) },
    auth: 'required',
  },
  async ({ body, auth }) => {
    if (body.count > 100) {
      throw fail.badRequest('count too high')
    }
    return { id: crypto.randomUUID(), userId: auth.user.id }
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
