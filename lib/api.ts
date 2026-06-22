import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { apiReference } from '@scalar/hono-api-reference'
import type { MiddlewareHandler } from 'hono'

// --- Public error class ---

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

// --- Auth scheme type (for OpenAPI security scheme registration) ---

export type AuthScheme =
  | { type: 'http'; scheme: 'bearer' | 'basic' }
  | { type: 'apiKey'; in: 'header' | 'query'; name: string }

// --- Internal type utilities ---

type AnyZodType = z.ZodType<any, any, any>

/** Extract `:name` tokens from a Hono-style path. */
type PathParam<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? Param | PathParam<Rest>
    : P extends `${string}:${infer Param}`
      ? Param
      : never

/** Build `{ name: string }` from a path like `/hello/:name`. */
type ParamsFromPath<P extends string> = {
  [K in PathParam<P> & string]: string
}

/**
 * The request object the handler receives — inferred from the config generics.
 * Path params are flat top-level keys (Encore-style).
 * Body / query / headers are nested under their own keys.
 */
type ReqFor<P extends string, B, Q, H> = ParamsFromPath<P> &
  (B extends AnyZodType ? { body: z.infer<B> } : {}) &
  (Q extends AnyZodType ? { query: z.infer<Q> } : {}) &
  (H extends AnyZodType ? { headers: z.infer<H> } : {})

// --- Create the API builder ---

/**
 * Create an Encore-style API builder on top of Hono + OpenAPI.
 *
 * ```ts
 * const { api, auth, docs, app } = createApi({ title: 'My API' })
 *
 * auth('required', async (c, next) => {
 *   if (!c.req.header('Authorization')) return c.json({ error: 'unauthorized' }, 401)
 *   await next()
 * })
 *
 * const hello = api(
 *   { method: 'GET', path: '/hello/:name', auth: 'required' },
 *   async ({ name }) => ({ message: `Hello ${name}!` }),
 * )
 *
 * docs()
 * ```
 */
export function createApi(opts: { title?: string; version?: string } = {}) {
  const app = new OpenAPIHono()

  // Global error handler — prevents leaking internal error details to clients
  app.onError((err, c) => {
    if (err instanceof APIError) {
      return c.json({ error: err.message }, err.status as any)
    }
    // ponytail: logs the full error server-side, sends generic message to client.
    // Add a `debug` option to createApi() to send full error details in dev mode.
    console.error(err)
    return c.json({ error: 'Internal Server Error' }, 500 as any)
  })

  const auths = new Map<string, MiddlewareHandler>()
  const authSchemes = new Map<string, AuthScheme>()

  function auth(name: string, mw: MiddlewareHandler, scheme?: AuthScheme) {
    auths.set(name, mw)
    if (scheme) {
      authSchemes.set(name, scheme)
      app.openAPIRegistry.registerComponent('securitySchemes', name, scheme)
    }
  }

  function api<P extends string, B extends AnyZodType | undefined, Q extends AnyZodType | undefined, H extends AnyZodType | undefined>(
    config: {
      method: string
      path: P
      body?: B
      query?: Q
      headers?: H
      responses?: Record<number, AnyZodType>
      auth?: string
      middleware?: MiddlewareHandler[]
      tags?: string[]
      summary?: string
      description?: string
      status?: number
    },
    handler: (req: ReqFor<P, B, Q, H>) => Promise<any> | any,
  ) {
    // Normalize method to lowercase (accept 'GET' or 'get')
    const raw = config.method.toLowerCase()
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(raw)) {
      throw new Error(
        `api(): method '${config.method}' is not supported. Use one of: GET, POST, PUT, PATCH, DELETE`,
      )
    }
    const method = raw as 'get' | 'post' | 'put' | 'patch' | 'delete'

    // Convert :name to {name} for OpenAPI
    const oapiPath = config.path.replace(/:(\w+)/g, '{$1}')
    const paramNames = [...config.path.matchAll(/:(\w+)/g)].map((m) => m[1]!)

    // Build OpenAPI request shape
    const request: Record<string, any> = {}
    if (paramNames.length > 0) {
      request.params = z.object(
        Object.fromEntries(paramNames.map((n) => [n, z.string()])),
      )
    }
    if (config.body) {
      request.body = { content: { 'application/json': { schema: config.body } } }
    }
    if (config.query) request.query = config.query
    if (config.headers) request.headers = config.headers

    // Build response schemas, injecting a default 500 error schema
    const responses: Record<string, any> = {}
    for (const [code, schema] of Object.entries(config.responses ?? {})) {
      // 204 No Content has no body — don't wrap in content
      if (code === '204') {
        responses[code] = { description: 'No Content' }
      } else {
        responses[code] = { content: { 'application/json': { schema } } }
      }
    }
    if (!responses['500']) {
      responses['500'] = {
        content: {
          'application/json': {
            schema: z.object({ error: z.string() }),
          },
        },
      }
    }

    // Determine success status: explicit `status`, first 2xx/3xx key, or 200
    const successCode = config.status?.toString()
      ?? Object.keys(responses).find((k) => k.startsWith('2') || k.startsWith('3'))
      ?? '200'

    // Auto-add 204 response if it's the success code and not declared
    if (successCode === '204' && !responses['204']) {
      responses['204'] = { description: 'No Content' }
    }

    // Build auth + custom middleware list
    const mws: MiddlewareHandler[] = []
    if (config.auth) {
      const mw = auths.get(config.auth)
      if (!mw) {
        throw new Error(
          `api(): auth '${config.auth}' is not registered. Call auth('${config.auth}', middleware) before using it.`,
        )
      }
      mws.push(mw)
    }
    if (config.middleware) {
      mws.push(...config.middleware)
    }

    // Attach OpenAPI security if the endpoint uses a registered auth scheme
    const security = config.auth && authSchemes.has(config.auth)
      ? [{ [config.auth]: [] as string[] }]
      : undefined

    const route = createRoute({
      method,
      path: oapiPath,
      request: Object.keys(request).length > 0 ? request : undefined,
      responses,
      tags: config.tags,
      summary: config.summary,
      description: config.description,
      security,
    })

    // ponytail: handler cast to `any` — the dynamic route config has `any` response types
    // that TypeScript can't reconcile. Runtime behavior is correct.
    const routeConfig = mws.length > 0 ? { ...route, middleware: mws } : route
    ;(app.openapi as any)(routeConfig, async (c: any) => {
      try {
        const req: any = {}
        if (paramNames.length > 0) {
          Object.assign(req, c.req.valid('param'))
        }
        if (config.body) req.body = c.req.valid('json')
        if (config.query) req.query = c.req.valid('query')
        if (config.headers) req.headers = c.req.valid('header')

        const result = await handler(req)
        // Return null → c.body(null, status) for 204 No Content. undefined falls through to c.json().
        if (result === null) {
          return c.body(null, Number(successCode))
        }
        return c.json(result, Number(successCode))
      } catch (e) {
        if (e instanceof APIError) {
          return c.json({ error: e.message }, e.status)
        }
        throw e
      }
    })
  }

  function docs(specPath = '/openapi.json', uiPath = '/docs') {
    app.doc(specPath, {
      openapi: '3.0.0',
      info: {
        title: opts.title ?? 'API',
        version: opts.version ?? '1.0.0',
      },
    })
    app.get(uiPath, apiReference({ spec: { url: specPath } }))
  }

  return { app, api, auth, docs }
}
