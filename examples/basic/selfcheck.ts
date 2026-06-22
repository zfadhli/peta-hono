// ponytail: no test framework, just a runnable self-check with asserts.
// Each test hits a live endpoint and throws on mismatch.
// Exit code = number of failures.

import { createAdaptorServer } from '@hono/node-server'
import app from './routes.js'

const failures: string[] = []

function assert(condition: boolean, label: string) {
  if (!condition) failures.push(label)
}

// Boot a test server on a random port
const server = createAdaptorServer({ fetch: app.fetch })
const port = await new Promise<number>((resolve) => {
  server.listen(0, () => {
    const addr = server.address()
    resolve(typeof addr === 'object' && addr ? addr.port : 0)
  })
})
const baseUrl = `http://localhost:${port}`

try {
  // 1. Hello — happy path
  const r1 = await fetch(`${baseUrl}/hello/world`, { headers: { Authorization: 'Bearer secret' } })
  const j1: any = await r1.json()
  assert(r1.status === 200, 'hello status')
  assert(j1.message === 'Hello world!', 'hello body')

  // 2. Hello — no auth
  const r2 = await fetch(`${baseUrl}/hello/world`)
  const j2: any = await r2.json()
  assert(r2.status === 401, 'hello no auth status')
  assert(j2.error === 'Unauthorized', 'hello no auth body')

  // 3. Create thing — happy path
  const r3 = await fetch(`${baseUrl}/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
    body: JSON.stringify({ name: 'test', count: 5 }),
  })
  const j3: any = await r3.json()
  assert(r3.status === 201, 'things status')
  assert(typeof j3.id === 'string', 'things id type')
  assert(j3.userId === 'alice', 'things userId from auth')

  // 4. Create thing — count too high
  const r4 = await fetch(`${baseUrl}/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
    body: JSON.stringify({ name: 'test', count: 500 }),
  })
  const j4: any = await r4.json()
  assert(r4.status === 400, 'things high count status')
  assert(j4.error === 'count too high', 'things high count body')

  // 5. Create thing — bad body (empty name, missing count)
  const r5 = await fetch(`${baseUrl}/things`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer secret' },
    body: JSON.stringify({ name: '' }),
  })
  const j5: any = await r5.json()
  assert(r5.status === 400, 'things bad body status')
  assert(typeof j5.error === 'string', 'things bad body format')

  // 6. Search — happy path
  const r6 = await fetch(`${baseUrl}/search?q=hello`, { headers: { Authorization: 'Bearer secret' } })
  const j6: any = await r6.json()
  assert(r6.status === 200, 'search status')
  assert(Array.isArray(j6.results), 'search results type')
  assert(j6.total === 10, 'search default limit')

  // 7. Search — missing query
  const r7 = await fetch(`${baseUrl}/search`, { headers: { Authorization: 'Bearer secret' } })
  const j7: any = await r7.json()
  assert(r7.status === 400, 'search missing query status')

  // 8. OpenAPI spec
  const r8 = await fetch(`${baseUrl}/openapi.json`)
  const spec: any = await r8.json()
  assert(r8.status === 200, 'spec status')
  const paths = Object.keys(spec.paths)
  assert(paths.includes('/hello/{name}'), 'spec has hello')
  assert(paths.includes('/things'), 'spec has things')
  assert(paths.includes('/search'), 'spec has search')

  // 9. Docs UI
  const r9 = await fetch(`${baseUrl}/docs`)
  assert(r9.status === 200, 'docs status')
  const html = await r9.text()
  assert(html.includes('Scalar'), 'docs content')
} finally {
  server.close()
}

if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} test(s)`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(failures.length)
} else {
  console.log('All self-checks passed ✓')
}
