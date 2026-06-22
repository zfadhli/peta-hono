/**
 * Self-check for lib/openapi.ts spike.
 * Three assertions:
 *   1. /openapi.json emits minimum/maximum in spec
 *   2. Query param coercion works (string "5" → number 5)
 *   3. Bad body returns 400 with error summary
 */

import { type } from 'arktype'
import { OpenAPIHono, createRoute } from './openapi.js'

const app = new OpenAPIHono()

// ── POST /things — body with numeric range ────────────────────────
app.openapi(createRoute({
  method: 'POST',
  path: '/things',
  summary: 'Create a thing',
  request: {
    body: type({
      name: 'string >= 1',
      count: '1 <= number.integer <= 100',
    }),
  },
  responses: { 201: type({ id: 'string' }) },
}), async ({ body }) => {
  return { id: crypto.randomUUID() }
})

// ── GET /search — query with coercing number ──────────────────────
app.openapi(createRoute({
  method: 'GET',
  path: '/search',
  summary: 'Search things',
  request: {
    query: type({
      q: 'string',
      limit: '1 <= number.integer <= 100',
    }),
  },
}), async ({ query }) => {
  return { q: query.q, limit: query.limit }
})

// ── OpenAPI docs ──────────────────────────────────────────────────
app.doc('/openapi.json', {
  info: { title: 'Spike API', version: '0.0.1' },
})

// ── Run checks ────────────────────────────────────────────────────
let passed = 0
let failed = 0

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✅ ${name}`)
  } catch (e: any) {
    failed++
    console.log(`  ❌ ${name}: ${e.message}`)
  }
}

// ── Assertion 1: OpenAPI spec has minimum/maximum ─────────────────
async function assertSpec() {
  const res = await app.request('/openapi.json')
  if (res.status !== 200) throw new Error(`spec endpoint returned ${res.status}`)

  const spec: any = await res.json()

  // Check POST /things body has minimum/maximum on count
  const postThing = spec.paths?.['/things']?.post
  if (!postThing) throw new Error('POST /things not in spec')
  const bodySchema = postThing.requestBody?.content?.['application/json']?.schema
  if (!bodySchema) throw new Error('request body schema missing')
  const count = bodySchema?.properties?.count
  if (!count) throw new Error('count property missing in body schema')
  if (count.minimum !== 1) throw new Error(`expected minimum:1, got ${count.minimum}`)
  if (count.maximum !== 100) throw new Error(`expected maximum:100, got ${count.maximum}`)
  if (count.type !== 'integer') throw new Error(`expected type:integer, got ${count.type}`)

  // Check GET /search query parameter has minimum/maximum
  const getSearch = spec.paths?.['/search']?.get
  if (!getSearch) throw new Error('GET /search not in spec')
  const limitParam = getSearch.parameters?.find((p: any) => p.name === 'limit')
  if (!limitParam) throw new Error('limit query param missing')
  if (limitParam.schema?.minimum !== 1) throw new Error(`expected schema.minimum:1, got ${limitParam.schema?.minimum}`)
  if (limitParam.schema?.maximum !== 100) throw new Error(`expected schema.maximum:100, got ${limitParam.schema?.maximum}`)
}

// ── Assertion 2: Coercion ─────────────────────────────────────────
async function assertCoercion() {
  const res = await app.request('/search?q=foo&limit=5')
  if (res.status !== 200) throw new Error(`search returned ${res.status}`)
  const body: any = await res.json()
  if (typeof body.limit !== 'number') throw new Error(`expected limit to be number, got ${typeof body.limit}`)
  if (body.limit !== 5) throw new Error(`expected limit=5, got ${body.limit}`)
  if (body.q !== 'foo') throw new Error(`expected q=foo, got ${body.q}`)
}

// ── Assertion 3: Validation error returns 400 ─────────────────────
async function assertValidation() {
  const res = await app.request('/things', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', count: 0 }),
  })
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`)
  const body: any = await res.json()
  if (!body.error) throw new Error(`expected error field in response`)
  if (typeof body.error !== 'string' || body.error.length === 0) throw new Error(`error must be a non-empty string`)
}

// ── Run ───────────────────────────────────────────────────────────
console.log('=== OpenAPIHono spike self-check ===')
console.log()

await check('OpenAPI spec has minimum/maximum', assertSpec)
await check('Query coercion string→number', assertCoercion)
await check('Validation error returns 400', assertValidation)

console.log()
console.log(`Result: ${passed}/3 passed, ${failed} failed`)

if (failed > 0) process.exit(1)
