import { type JsonSchema, type } from "arktype";
import type { Context, Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { Schema } from "hono/types";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import { APIError, createErrorHandler } from "./errors.js";
import type { Method } from "./paths.js";
import { hasParamTokens, normalizeMethod, parseParamTokens, toOapiPath } from "./paths.js";
import { type ComponentRegistry, getErrorSchemaRef, schemaToOA } from "./registry.js";
import { type ArkType, arktypeValidator, isObjectSchema } from "./validation.js";

// Validator re-export (ADR-011 step 3) — barrel stability for deep imports of
// `arktypeValidator` via openapi.ts; the public barrel imports it from index.ts.
export { arktypeValidator } from "./validation.js";

// --- Web Crypto helpers ---
// sha1Hex / stable-name hoisting / $defs rewriting live in src/registry.ts (ADR-011 step 4).

// --- Types ---

// ArkType + coercion live in src/validation.ts (ADR-011 step 3).
// Re-export for barrel stability: consumers may import { ArkType } from "./openapi.js" (or "peta-hono").
export type { ArkType } from "./validation.js";

// --- Auth scheme (for OpenAPI security scheme registration) ---

/** OAuth2 authorization-code flow (Google, GitHub, ...). */
export type OAuth2Flows = {
  authorizationCode: {
    authorizationUrl: string;
    tokenUrl: string;
    /** scope → human description. */
    scopes: Record<string, string>;
  };
};

/**
 * The OpenAPI security scheme a caller passes to `auth(name, mw, scheme?)`.
 * This is the stable, narrow input set (http bearer/basic, apiKey header/query)
 * matching v0.5.4. It is intentionally narrower than what the library can
 * *emit* — see `SecurityScheme`. Keeping this narrow means callers who construct
 * a scheme to pass to `auth()` (and any exhaustive switch over this type) are
 * unaffected by the built-in-strategy additions.
 */
export type AuthScheme =
  | { type: "http"; scheme: "bearer" | "basic" }
  | { type: "apiKey"; in: "header" | "query"; name: string };

/**
 * The full set of OpenAPI security schemes the library can emit, including the
 * cookie-based `apiKey` (`in: "cookie"`) and the `oauth2` variant that the
 * built-in strategies contribute. This is the type of `components.securitySchemes`
 * entries — use it when *reading* the emitted spec; use `AuthScheme` when
 * *passing* a scheme to `auth()`. Widening this does not affect the `auth()`
 * input contract.
 */
export type SecurityScheme =
  | AuthScheme
  | { type: "apiKey"; in: "cookie"; name: string }
  | { type: "oauth2"; flows: OAuth2Flows };

// --- OpenAPI output types (minimal: only what we emit) ---

interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchema;
  description?: string;
}

interface OpenAPIResponse {
  description?: string;
  content?: { "application/json": { schema: JsonSchema } };
}

interface OpenAPIRequestBody {
  required: boolean;
  content: { "application/json": { schema: JsonSchema } };
}

interface OpenAPIOperation {
  operationId: string;
  responses: Record<string, OpenAPIResponse>;
  tags?: string[];
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  deprecated?: boolean;
}

interface OpenAPIComponents {
  schemas?: Record<string, JsonSchema>;
  securitySchemes?: Record<string, SecurityScheme>;
}

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components: OpenAPIComponents;
}

// --- Route config ---

export interface RouteConfig {
  method: Method;
  path: string; // Hono-style /:param
  request?: {
    body?: ArkType;
    query?: ArkType;
    headers?: ArkType;
    params?: ArkType;
  };
  responses?: Record<number, ArkType>;
  tags?: string[];
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  middleware?: MiddlewareHandler[];
  status?: number;
  /** Override auto-generated operationId (useful for SDK generation). */
  operationId?: string;
  /** Mark operation as deprecated in OpenAPI docs. */
  deprecated?: boolean;
  /** Suppress the auto-documented 400 that path `:param` routes get (noise). */
  hide400?: boolean;
}

/** Handler signature: receives flat request object, returns JSON-serializable object or null (→ 204). */
type RouteHandler = (
  req: Record<string, unknown>,
) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;

interface StoredRoute {
  method: string;
  oapiPath: string; // OpenAPI-style /{param}
  config: RouteConfig;
  handler: RouteHandler;
}

// Component registry (schemas + securitySchemes maps) lives in src/registry.ts
// (ADR-011 step 4): OpenAPIHono owns the per-instance registry and passes it to
// the pure schemaToOA / getErrorSchemaRef functions.

// --- Helpers ---

export type { HttpMethod, Method, ParamToken } from "./paths.js";
// Path & method grammar lives in src/paths.ts — single source per ADR-010.
// Re-export for barrel stability: consumers may import { Method, normalizeMethod } from "./openapi.js"
export {
  hasParamTokens,
  normalizeMethod,
  PARAM_HAS_RE,
  PARAM_TOKEN_RE,
  parseParamTokens,
  SUPPORTED_METHODS,
  toOapiPath,
} from "./paths.js";

// --- OpenAPIHono ---

export class OpenAPIHono<
  E extends Env = Env,
  S extends Schema = Schema,
  BasePath extends string = "/",
> extends Hono<E, S, BasePath> {
  private _routes: StoredRoute[] = [];
  private _components: ComponentRegistry = {
    schemas: new Map<string, JsonSchema>(),
    securitySchemes: new Map<string, SecurityScheme>(),
  };

  constructor(...args: ConstructorParameters<typeof Hono>) {
    super(...args);
    // Default error handler — single chokepoint for validation errors (thrown
    // by arktypeValidator) and any other thrown errors. Uses the shared
    // createErrorHandler policy; createApi() overrides with debug-aware variant.
    const defaultErrorHandler = createErrorHandler();
    this.onError(defaultErrorHandler);
    // Unmatched-route 404 — route through the same error policy so it returns
    // application/json {error} instead of Hono's default text/plain "404 Not
    // Found", unifying the two 404 shapes (fail.notFound() and unmatched route)
    // through the single chokepoint. The default handler (no debug) is used so
    // there are no details to leak; createApi()'s debug-aware onError is separate.
    this.notFound((c) => defaultErrorHandler(new APIError(404, "Not Found"), c));
  }

  /** Register an API endpoint with ArkType validation and OpenAPI metadata. */
  openapi(config: RouteConfig, handler: RouteHandler): void {
    const method = normalizeMethod(config.method);
    if (!config.path.startsWith("/")) {
      throw new Error(`Path must start with "/": ${config.path}`);
    }
    const oapiPath = toOapiPath(config.path);
    const paramTokens = parseParamTokens(config.path);

    // Build middlewares from request schemas
    const mws: MiddlewareHandler[] = [];

    if (config.request?.params) {
      mws.push(arktypeValidator("param", config.request.params));
    } else if (paramTokens.length > 0) {
      // Auto-generate params schema from path tokens — optional `:id?` becomes "string?"
      const paramsDef: Record<string, string> = {};
      for (const { name, optional } of paramTokens)
        paramsDef[name] = optional ? "string?" : "string";
      mws.push(arktypeValidator("param", type(paramsDef)));
    }

    if (config.request?.query) mws.push(arktypeValidator("query", config.request.query));
    if (config.request?.headers) mws.push(arktypeValidator("header", config.request.headers));
    if (config.request?.body) mws.push(arktypeValidator("json", config.request.body));

    // User-defined middlewares
    if (config.middleware) mws.push(...config.middleware);

    // Store route for spec generation
    this._routes.push({ method, oapiPath, config, handler });

    // Register the Hono route
    // ponytail: Hono's .on() has 5+ overloads; typed spread dispatch not worth the complexity
    const dispatch = this.on.bind(this) as unknown as (
      method: string,
      path: string,
      ...handlers: MiddlewareHandler[]
    ) => void;
    dispatch(method, config.path, ...mws, async (c: Context) => {
      // Hono's valid() is typed via Input generics that don't apply to our dynamic
      // validator registration; narrow c.req to a simple callable signature.
      // Cast is on c.req (not extracting valid) to preserve `this` binding.
      const creq = c.req as unknown as {
        valid(target: string): Record<string, unknown>;
      };
      const req: Record<string, unknown> = {};

      // Flatten path params to top level (Encore-style: handler({ name }) not handler({ params: { name } }))
      if (paramTokens.length > 0) {
        Object.assign(req, creq.valid("param"));
      }
      if (config.request?.body) req.body = creq.valid("json");
      if (config.request?.query) req.query = creq.valid("query");
      if (config.request?.headers) req.headers = creq.valid("header");

      // Inject auth context set by auth middleware via c.set('auth', ctx)
      const authCtx = (c as unknown as { get(key: string): unknown }).get("auth");
      if (authCtx !== undefined) req.auth = authCtx;

      // Expose Hono context for handlers that need it (e.g., session save/destroy)
      req.c = c;

      const result = await handler(req);

      // If handler returned a Response directly, use it as-is
      if (result instanceof Response) return result;

      // Determine status: explicit status first, else the LOWEST declared
      // 2xx/3xx, else 200. The "lowest" (not "first") matters because
      // Object.keys() enumerates integer-like keys in ascending numeric order,
      // so with {200, 201} declared the lowest wins regardless of source order.
      // When more than one 2xx/3xx is declared, set `status` explicitly.
      const successCode =
        config.status?.toString() ??
        Object.keys(config.responses ?? {}).find((k) => k.startsWith("2") || k.startsWith("3")) ??
        "200";

      if (result === null) {
        return c.body(null, Number(successCode) as StatusCode);
      }
      return c.json(result, Number(successCode) as ContentfulStatusCode);
    });
  }

  /** Emit an OpenAPI 3.0 JSON endpoint. */
  doc(url: string, config: { openapi?: string; info: { title: string; version: string } }): void {
    this.get(url, async (c) => {
      return c.json(await this._buildSpec(config));
    });
  }

  /** Register an OpenAPI security scheme (e.g. bearer, apiKey). */
  registerSecurityScheme(name: string, scheme: SecurityScheme): void {
    this._components.securitySchemes.set(name, scheme);
  }

  // --- Spec building ---

  private async _buildSpec(config: {
    openapi?: string;
    info: { title: string; version: string };
  }): Promise<OpenAPISpec> {
    const paths: Record<string, Record<string, OpenAPIOperation>> = {};
    const seenOperationIds = new Set<string>();
    const baseCounts = new Map<string, number>();

    for (const route of this._routes) {
      const pathItem = paths[route.oapiPath] ?? {};
      const baseId =
        route.config.operationId ??
        `${route.method}_${route.oapiPath.replace(/[{}]/g, "").replace(/\//g, "_")}`;
      let operationId = baseId;
      if (seenOperationIds.has(operationId)) {
        let n = (baseCounts.get(baseId) ?? 1) + 1;
        while (seenOperationIds.has(`${baseId}_${n}`)) n++;
        operationId = `${baseId}_${n}`;
        baseCounts.set(baseId, n);
      } else {
        baseCounts.set(baseId, 1);
      }
      seenOperationIds.add(operationId);
      const op: OpenAPIOperation = {
        operationId,
        responses: await this._buildResponses(route.config),
      };

      if (route.config.tags) op.tags = route.config.tags;
      if (route.config.summary) op.summary = route.config.summary;
      if (route.config.description) op.description = route.config.description;
      if (route.config.security) op.security = route.config.security;
      if (route.config.deprecated) op.deprecated = true;

      // Parameters (path + query + header)
      const params: OpenAPIParameter[] = [];
      if (route.config.request?.params) {
        await this._addObjectParams(params, route.config.request.params, "path");
      }
      if (route.config.request?.query) {
        await this._addObjectParams(params, route.config.request.query, "query");
      }
      if (route.config.request?.headers) {
        await this._addObjectParams(params, route.config.request.headers, "header");
      }
      if (params.length > 0) op.parameters = params;

      // Request body
      if (route.config.request?.body) {
        op.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: await this._schemaToOA(route.config.request.body),
            },
          },
        };
      }

      pathItem[route.method] = op;
      paths[route.oapiPath] = pathItem;
    }

    const spec: OpenAPISpec = {
      openapi: config.openapi ?? "3.0.0",
      info: config.info,
      paths,
      components: {},
    };

    // Register named security schemes
    if (this._components.securitySchemes.size > 0) {
      spec.components.securitySchemes = Object.fromEntries(this._components.securitySchemes);
    }

    // Register named schemas
    if (this._components.schemas.size > 0) {
      spec.components.schemas = Object.fromEntries(this._components.schemas);
    }

    return spec;
  }

  private async _buildResponses(config: RouteConfig): Promise<Record<string, OpenAPIResponse>> {
    const responses: Record<string, OpenAPIResponse> = {};

    // Standard OpenAPI descriptions for user-declared success codes
    const descByCode: Record<string, string> = {
      "200": "OK",
      "201": "Created",
      "202": "Accepted",
      "204": "No Content",
    };

    if (config.responses) {
      for (const [code, schema] of Object.entries(config.responses)) {
        if (code === "204") {
          responses[code] = { description: "No Content" };
        } else {
          responses[code] = {
            description: descByCode[code] ?? `Response ${code}`,
            content: {
              "application/json": { schema: await this._schemaToOA(schema) },
            },
          };
        }
      }
    }

    // Determine success code: explicit status, else the LOWEST declared 2xx/3xx
    // (JS enumerates integer-like keys in ascending order, so "first" in source
    // order is meaningless), else 200. When multiple 2xx/3xx are declared, set
    // `status` explicitly to get a non-lowest default.
    const successCode =
      config.status?.toString() ??
      Object.keys(responses).find((k) => k.startsWith("2") || k.startsWith("3")) ??
      "200";
    if (!responses[successCode]) {
      responses[successCode] = {
        description: descByCode[successCode] ?? "Success",
      };
    }

    // Framework-guaranteed error responses (zero-config, share one schema component)
    // 400 Bad Request — any endpoint with validated body/query/headers/params
    //                 OR path has `:param` (auto-generated params schema via hasParamTokens).
    //                 ponytail: auto-generated params means `GET /:id` documents 400 even
    //                 without explicit body/query validation. The params are validated via
    //                 arktypeValidator("param") (b6354f3), so it's intentional; benign
    //                 false-positive if the param string never actually 400s. Guard
    //                 `if (!responses["400"])` respects explicit `responses:{400: schema}`,
    //                 which REPLACES the auto doc. Set `hide400: true` to suppress the
    //                 auto 400 entirely (e.g. a pure `:param` route); a user-declared
    //                 `responses:{400}` is still honored.
    // 401 Unauthorized — any endpoint behind a registered auth scheme
    const errorRef = await this._getErrorSchemaRef();
    const addFrameworkError = async (code: number, description: string) => {
      const key = String(code);
      if (!responses[key]) {
        responses[key] = {
          description,
          content: {
            "application/json": { schema: errorRef },
          },
        };
      }
    };

    if (!config.hide400 && !responses["400"]) {
      const hasValidation =
        !!config.request?.body ||
        !!config.request?.query ||
        !!config.request?.headers ||
        !!config.request?.params ||
        hasParamTokens(config.path);
      if (hasValidation) {
        await addFrameworkError(400, "Bad Request");
      }
    }
    if (config.security && !responses["401"]) {
      await addFrameworkError(401, "Unauthorized");
    }

    // 404 Not Found — auto-inject when endpoint has path params (:id → resource lookup)
    // ponytail: heuristic — path params strongly imply resource lookup. User can override
    // by declaring an explicit 404 response, which the guard (`!responses["404"]`) respects.
    // False positives (documenting 404 on endpoints that never throw it) are benign spec noise.
    // Ceiling: heuristic covers ~95% of resource routes. Upgrade: add an explicit
    // `documentNotFound` opt-in or `responses: {404: schema}` when false positives matter
    // or 404 needs a custom schema.
    if (!responses["404"] && hasParamTokens(config.path)) {
      await addFrameworkError(404, "Not Found");
    }

    // Default 500 (if not already declared by the user)
    if (!responses["500"]) {
      responses["500"] = {
        description: "Internal Server Error",
        content: {
          "application/json": { schema: errorRef },
        },
      };
    }

    return responses;
  }

  // Framework-error schema ref is memoized per-instance registry in registry.ts
  // (ADR-011 step 4).
  private async _getErrorSchemaRef(): Promise<JsonSchema> {
    return getErrorSchemaRef(this._components);
  }

  /**
   * Convert an ArkType schema → OpenAPI Schema Object (delegates to registry.ts,
   * ADR-011 step 4): strips $schema, hoists $defs to components/schemas under
   * content-hash stable names, rewrites all $ref pointers, module-scoped cache.
   */
  private async _schemaToOA(schema: ArkType): Promise<JsonSchema> {
    return schemaToOA(schema, this._components);
  }

  /** Walk an ArkType object schema and produce OpenAPI parameter objects. */
  private async _addObjectParams(
    params: OpenAPIParameter[],
    schema: ArkType,
    inLocation: "path" | "query" | "header",
  ): Promise<void> {
    // Use _schemaToOA (not raw toJsonSchema) so $defs are hoisted and refs rewritten
    const json = await this._schemaToOA(schema);
    if (!isObjectSchema(json) || !json.properties) return;

    const required = new Set<string>(json.required ?? []);
    for (const [name, prop] of Object.entries(json.properties)) {
      if (!prop) continue;
      // ponytail: Hono's c.req.header() lowercases via Fetch Headers; spec
      // emits lowercase header param names so runtime and docs match. Users
      // should declare header schemas with lowercase keys.
      const paramName = inLocation === "header" ? name.toLowerCase() : name;
      const param: OpenAPIParameter = {
        name: paramName,
        in: inLocation,
        required: required.has(name),
        schema: prop,
      };
      const desc = (prop as { description?: string }).description;
      if (desc) param.description = desc;
      params.push(param);
    }
  }
}
