// OpenAPI document model + spec emission — extracted from src/openapi.ts
// (ADR-011 step 5). Pure functions over explicit inputs: the routes array and
// the per-instance ComponentRegistry are passed in, never held as module state,
// so emission is testable without Hono and instances never share mutation.
//
// Layering: spec.ts → registry.ts (schemaToOA/getErrorSchemaRef) + validation.ts
// (ArkType/isObjectSchema) + paths.ts (hasParamTokens). Nothing here imports
// openapi.ts, so the orchestrator can depend on this module acyclically.

import type { JsonSchema } from "arktype";
import type { MiddlewareHandler } from "hono";
import type { Method } from "./paths.js";
import { hasParamTokens } from "./paths.js";
import { getErrorSchemaRef, schemaToOA } from "./registry.js";
import { type ArkType, isObjectSchema } from "./validation.js";

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

// --- Component registry (the spec-document aggregate) ---

/**
 * Per-instance component maps, materialized into `components` at emission.
 * `schemas` is fed by registry.ts (schemaToOA hoists $defs here); security
 * schemes are registered via OpenAPIHono. The registry object is owned by the
 * OpenAPIHono instance and passed explicitly to every pure emission function.
 */
export interface ComponentRegistry {
  schemas: Map<string, JsonSchema>;
  securitySchemes: Map<string, SecurityScheme>;
}

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

// --- Route model ---

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
export type RouteHandler = (
  req: Record<string, unknown>,
) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;

/** A registered route: drives both Hono dispatch and spec emission. */
export interface StoredRoute {
  method: string;
  oapiPath: string; // OpenAPI-style /{param}
  config: RouteConfig;
  handler: RouteHandler;
}

// --- Success-code policy ---

/**
 * Success status: explicit `status` wins, else the LOWEST declared 2xx/3xx
 * response, else 200. "Lowest" (not "first") matters because Object.keys()
 * enumerates integer-like keys in ascending numeric order — with {200, 201}
 * declared the lowest wins regardless of source order. When more than one
 * 2xx/3xx is declared, set `status` explicitly.
 *
 * Shared by the runtime dispatch (OpenAPIHono.openapi — actual response status)
 * and the spec emitter (buildResponses — which response gets the "Success"
 * description), so the two can never drift apart.
 */
export function resolveSuccessCode(
  status: number | undefined,
  responseKeys: readonly string[],
): string {
  return (
    status?.toString() ?? responseKeys.find((k) => k.startsWith("2") || k.startsWith("3")) ?? "200"
  );
}

// --- Spec emission ---

/** Emit the OpenAPI 3.0 document for all registered routes. */
export async function buildSpec(
  routes: readonly StoredRoute[],
  components: ComponentRegistry,
  config: { openapi?: string; info: { title: string; version: string } },
): Promise<OpenAPISpec> {
  const paths: Record<string, Record<string, OpenAPIOperation>> = {};
  const seenOperationIds = new Set<string>();
  const baseCounts = new Map<string, number>();

  for (const route of routes) {
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
      responses: await buildResponses(route.config, components),
    };

    if (route.config.tags) op.tags = route.config.tags;
    if (route.config.summary) op.summary = route.config.summary;
    if (route.config.description) op.description = route.config.description;
    if (route.config.security) op.security = route.config.security;
    if (route.config.deprecated) op.deprecated = true;

    // Parameters (path + query + header)
    const params: OpenAPIParameter[] = [];
    if (route.config.request?.params) {
      await addObjectParams(params, route.config.request.params, "path", components);
    }
    if (route.config.request?.query) {
      await addObjectParams(params, route.config.request.query, "query", components);
    }
    if (route.config.request?.headers) {
      await addObjectParams(params, route.config.request.headers, "header", components);
    }
    if (params.length > 0) op.parameters = params;

    // Request body
    if (route.config.request?.body) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: await schemaToOA(route.config.request.body, components),
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
  if (components.securitySchemes.size > 0) {
    spec.components.securitySchemes = Object.fromEntries(components.securitySchemes);
  }

  // Register named schemas
  if (components.schemas.size > 0) {
    spec.components.schemas = Object.fromEntries(components.schemas);
  }

  return spec;
}

/**
 * Build the `responses` map for one route: user-declared responses plus the
 * framework-guaranteed error responses (400/401/404/500), all sharing one
 * deduped `{ error: string }` schema component.
 */
async function buildResponses(
  config: RouteConfig,
  components: ComponentRegistry,
): Promise<Record<string, OpenAPIResponse>> {
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
            "application/json": { schema: await schemaToOA(schema, components) },
          },
        };
      }
    }
  }

  // Determine success code: explicit status, else the LOWEST declared 2xx/3xx
  // (JS enumerates integer-like keys in ascending order, so "first" in source
  // order is meaningless), else 200. When multiple 2xx/3xx are declared, set
  // `status` explicitly to get a non-lowest default.
  const successCode = resolveSuccessCode(config.status, Object.keys(responses));
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
  const errorRef = await getErrorSchemaRef(components);
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

/** Walk an ArkType object schema and produce OpenAPI parameter objects. */
async function addObjectParams(
  params: OpenAPIParameter[],
  schema: ArkType,
  inLocation: "path" | "query" | "header",
  components: ComponentRegistry,
): Promise<void> {
  // Use schemaToOA (not raw toJsonSchema) so $defs are hoisted and refs rewritten
  const json = await schemaToOA(schema, components);
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
