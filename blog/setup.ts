// Shared API builder singleton — every route file imports `api` and `auth` from here.
// ESM modules are singletons, so all routes register on the same `app` instance.

import { createApi } from '../lib/api.js'

const { api, auth, docs, app } = createApi({
  title: 'Blog API',
  version: '1.0.0',
})

// Auth middleware: required for write operations, skip for reads.
// The third argument registers a Bearer auth security scheme in OpenAPI docs.
auth('required', async (c, next) => {
  const token = c.req.header('Authorization')
  if (!token?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}, { type: 'http', scheme: 'bearer' })

export { api, auth, docs, app }
