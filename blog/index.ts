// Route files are imported for side effects — calling api() at the top level
// registers each route on the shared app from setup.ts.
import './posts.js'
import './comments.js'

import { docs, app } from './setup.js'
import { serve } from '@hono/node-server'

// Mount docs AFTER all routes are registered
docs()

serve(app, (info) => {
  console.log(`Blog API → http://localhost:${info.port}`)
  console.log(`Docs (Scalar) → http://localhost:${info.port}/docs`)
  console.log(`OpenAPI spec → http://localhost:${info.port}/openapi.json`)
})
