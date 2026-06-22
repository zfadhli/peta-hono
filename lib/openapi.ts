import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { type, ArkErrors } from 'arktype'
import type { MiddlewareHandler, Env } from 'hono'
import type { Schema } from 'hono/types'

// --- Types ---

export type ArkType = ReturnType<typeof type>

export interface RouteConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string // Hono-style /:param
  request?: {
    body?: ArkType
    query?: ArkType
    headers?: ArkType
    params?: ArkType
  }
  responses?: Record<number, ArkType>
  tags?: string[]
  summary?: string
  description?: string
  security?: Record<string, string[]>[]
  middleware?: MiddlewareHandler[]
  status?: number
}

interface StoredRoute {
  method: string
  oapiPath: string // OpenAPI-style /{param}
  config: RouteConfig
  handler: Function
  hook?: Function
}

// --- Helpers ---

/** Convert /:param → /{param} for OpenAPI 3.0 paths. */
function toOapiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

/** Normalize method to lowercase. */
function normalizeMethod(m: string): string {
  const lower = m.toLowerCase()
  if (!['get', 'post', 'put', 'patch', 'delete'].includes(lower)) {
    throw new Error(`Unsupported method: ${m}`)
  }
  return lower
}

/**
 * Build a set of field names expected to be numeric from an ArkType object schema.
 * Uses introspection via .json on each required/optional entry.
 */
function getNumericFields(schema: any): Set<string> {
  const numeric = new Set<string>()
  const struct = schema?.inner?.structure
  if (!struct) return numeric

  const scan = (list: any[]) => {
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]
      const val = entry?.value
      const j = val?.json
      if (j?.domain === 'number') numeric.add(entry.key)
      else if (Array.isArray(j) && (j[0] === 'number' || j[1] === 'number')) {
        // 'string | number' union
        numeric.add(entry.key)
      }
    }
  }

  if (struct.required) scan(struct.required)
  if (struct.optional) scan(struct.optional)
  return numeric
}

/**
 * Coerce string values to numbers for fields the schema expects as numeric.
 * Query params always arrive as strings; this bridges the gap.
 */
function coerceNumbers(schema: any, data: Record<string, unknown>): Record<string, unknown> {
  const numeric = getNumericFields(schema)
  if (numeric.size === 0) return data
  const out: Record<string, unknown> = { ...data }
  for (const key of numeric) {
    const val = data[key]
    if (typeof val === 'string' && val !== '') {
      const num = Number(val)
      if (!isNaN(num)) out[key] = num
    }
  }
  return out
}

/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers for numeric fields before validation.
 */
export function arktypeValidator(target: 'json' | 'query' | 'header' | 'param', schema: any): MiddlewareHandler {
  return validator(target, (value: any, c) => {
    // Apply coercion before validation (mostly for query/header string→number)
    const data = schema?.inner?.structure
      ? coerceNumbers(schema, value ?? {})
      : (value ?? {})

    const result = schema(data)
    if (result instanceof ArkErrors) {
      return c.json({ error: result.summary }, 400 as any)
    }
    return result
  })
}

// --- OpenAPIHono ---

export class OpenAPIHono<
  E extends Env = Env,
  S extends Schema = Schema,
  BasePath extends string = '/',
> extends Hono<E, S, BasePath> {
  private _routes: StoredRoute[] = []
  private _components: {
    schemas: Map<string, any>
    securitySchemes: Map<string, any>
  } = { schemas: new Map(), securitySchemes: new Map() }

  /** Register an API endpoint with ArkType validation and OpenAPI metadata. */
  openapi(
    config: RouteConfig,
    handler: (c: any) => any,
    hook?: Function,
  ) {
    const method = normalizeMethod(config.method)
    const oapiPath = toOapiPath(config.path)
    const paramNames = [...config.path.matchAll(/:(\w+)/g)].map(m => m[1]!)

    // Build middlewares from request schemas
    const mws: MiddlewareHandler[] = []

    if (config.request?.params) {
      mws.push(arktypeValidator('param', config.request.params))
    } else if (paramNames.length > 0) {
      // Auto-generate params schema from path tokens
      const paramsDef: Record<string, string> = {}
      for (const name of paramNames) paramsDef[name] = 'string'
      mws.push(arktypeValidator('param', type(paramsDef)))
    }

    if (config.request?.query) mws.push(arktypeValidator('query', config.request.query))
    if (config.request?.headers) mws.push(arktypeValidator('header', config.request.headers))
    if (config.request?.body) mws.push(arktypeValidator('json', config.request.body))

    // User-defined middlewares
    if (config.middleware) mws.push(...config.middleware)

    // Store route for spec generation
    this._routes.push({ method, oapiPath, config, handler, hook })

    // Register the Hono route
    const mw = mws.length > 0 ? mws : undefined

    ;(this as any).on(method, config.path, ...(mw ?? []), async (c: any) => {
      try {
        const req: any = {}

        // Flatten path params to top level (Encore-style: handler({ name }) not handler({ params: { name } }))
        if (paramNames.length > 0) {
          Object.assign(req, c.req.valid('param'))
        }
        if (config.request?.body) req.body = c.req.valid('json')
        if (config.request?.query) req.query = c.req.valid('query')
        if (config.request?.headers) req.headers = c.req.valid('header')

        const result = await handler(req)

        // Determine status: explicit status, first 2xx/3xx in declared responses, or 200
        const successCode = config.status?.toString()
          ?? Object.keys(config.responses ?? {}).find(k => k.startsWith('2') || k.startsWith('3'))
          ?? '200'

        if (result === null) {
          return c.body(null, Number(successCode) as any)
        }
        return c.json(result, Number(successCode) as any)
      } catch (e: any) {
        throw e
      }
    })
  }

  /** Emit an OpenAPI 3.0 JSON endpoint. */
  doc(url: string, config: { openapi?: string; info: { title: string; version: string } }) {
    this.get(url, (c) => {
      return c.json(this._buildSpec(config))
    })
  }

  /** Access to the component registry. */
  get openAPIRegistry() {
    return {
      registerComponent: (type: 'schemas' | 'securitySchemes', name: string, value: any) => {
        this._components[type].set(name, value)
      },
    }
  }

  // --- Spec building ---

  private _buildSpec(config: { openapi?: string; info: { title: string; version: string } }) {
    const paths: Record<string, any> = {}

    for (const route of this._routes) {
      const pathItem = paths[route.oapiPath] ?? {}
      const op: Record<string, any> = {
        operationId: `${route.method}_${route.oapiPath.replace(/[{}]/g, '').replace(/\//g, '_')}`,
        responses: this._buildResponses(route.config),
      }

      if (route.config.tags) op.tags = route.config.tags
      if (route.config.summary) op.summary = route.config.summary
      if (route.config.description) op.description = route.config.description
      if (route.config.security) op.security = route.config.security

      // Parameters (path + query + header)
      const params: any[] = []
      if (route.config.request?.params) {
        this._addObjectParams(params, route.config.request.params, 'path')
      }
      if (route.config.request?.query) {
        this._addObjectParams(params, route.config.request.query, 'query')
      }
      if (route.config.request?.headers) {
        this._addObjectParams(params, route.config.request.headers, 'header')
      }
      if (params.length > 0) op.parameters = params

      // Request body
      if (route.config.request?.body) {
        op.requestBody = {
          required: true,
          content: { 'application/json': { schema: this._schemaToOA(route.config.request.body) } },
        }
      }

      pathItem[route.method] = op
      paths[route.oapiPath] = pathItem
    }

    const spec: any = {
      openapi: config.openapi ?? '3.0.0',
      info: config.info,
      paths,
      components: {},
    }

    // Register named security schemes
    if (this._components.securitySchemes.size > 0) {
      spec.components.securitySchemes = Object.fromEntries(this._components.securitySchemes)
    }

    // Register named schemas
    if (this._components.schemas.size > 0) {
      spec.components.schemas = Object.fromEntries(this._components.schemas)
    }

    return spec
  }

  private _buildResponses(config: RouteConfig): Record<string, any> {
    const responses: Record<string, any> = {}

    if (config.responses) {
      for (const [code, schema] of Object.entries(config.responses)) {
        if (code === '204') {
          responses[code] = { description: 'No Content' }
        } else {
          responses[code] = {
            content: { 'application/json': { schema: this._schemaToOA(schema) } },
          }
        }
      }
    }

    // Determine success code: explicit status, first 2xx/3xx in declared responses, or 200
    const successCode = config.status?.toString()
      ?? Object.keys(responses).find(k => k.startsWith('2') || k.startsWith('3'))
      ?? '200'
    if (!responses[successCode]) {
      responses[successCode] = { description: 'Success' }
    }

    // Default 500 (if not already declared by the user)
    if (!responses['500']) {
      const errSchema = type({ error: 'string' })
      responses['500'] = {
        content: { 'application/json': { schema: this._schemaToOA(errSchema) } },
      }
    }

    return responses
  }

  /**
   * Convert an ArkType schema → OpenAPI Schema Object.
   * Uses ArkType's toJsonSchema(), strips $schema, hoists $defs to components.
   */
  private _schemaToOA(schema: any): any {
    const json: any = schema?.toJsonSchema?.() ?? schema
    // Remove JSON Schema draft meta-schema (not valid in OpenAPI 3.0)
    delete json.$schema

    // Hoist $defs to components/schemas (registered inline)
    if (json.$defs) {
      for (const [name, def] of Object.entries(json.$defs)) {
        if (!this._components.schemas.has(name)) {
          this._components.schemas.set(name, def)
        }
      }
      delete json.$defs
    }

    // Replace $ref with #/components/schemas/ reference
    // ponytail: simple string replacement; $defs are emitted inline for now
    return json
  }

  /** Walk an ArkType object schema and produce OpenAPI parameter objects. */
  private _addObjectParams(params: any[], schema: any, inLocation: 'path' | 'query' | 'header') {
    const json: any = schema?.toJsonSchema?.() ?? schema
    if (json.type !== 'object' || !json.properties) return

    const required = new Set<string>(json.required ?? [])
    for (const [name, prop] of Object.entries(json.properties)) {
      const propObj = prop as any
      const param: any = {
        name,
        in: inLocation,
        required: required.has(name),
        schema: propObj,
      }
      // OpenAPI 3.0 requires schema + type info at param level
      if (propObj.description) param.description = propObj.description
      params.push(param)
    }
  }
}

/** Create a route config (type-check helper). */
export function createRoute(config: RouteConfig): RouteConfig {
  return config
}
