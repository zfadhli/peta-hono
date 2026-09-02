import type { JsonSchema } from "arktype";
import type { MiddlewareHandler } from "hono";
import type { Method } from "./paths.js";
import { type ArkType } from "./validation.js";
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
export type AuthScheme = {
    type: "http";
    scheme: "bearer" | "basic";
} | {
    type: "apiKey";
    in: "header" | "query";
    name: string;
};
/**
 * The full set of OpenAPI security schemes the library can emit, including the
 * cookie-based `apiKey` (`in: "cookie"`) and the `oauth2` variant that the
 * built-in strategies contribute. This is the type of `components.securitySchemes`
 * entries — use it when *reading* the emitted spec; use `AuthScheme` when
 * *passing* a scheme to `auth()`. Widening this does not affect the `auth()`
 * input contract.
 */
export type SecurityScheme = AuthScheme | {
    type: "apiKey";
    in: "cookie";
    name: string;
} | {
    type: "oauth2";
    flows: OAuth2Flows;
};
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
interface OpenAPIParameter {
    name: string;
    in: "path" | "query" | "header";
    required: boolean;
    schema: JsonSchema;
    description?: string;
}
interface OpenAPIResponse {
    description?: string;
    content?: {
        "application/json": {
            schema: JsonSchema;
        };
    };
}
interface OpenAPIRequestBody {
    required: boolean;
    content: {
        "application/json": {
            schema: JsonSchema;
        };
    };
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
    info: {
        title: string;
        version: string;
    };
    paths: Record<string, Record<string, OpenAPIOperation>>;
    components: OpenAPIComponents;
}
export interface RouteConfig {
    method: Method;
    path: string;
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
    /**
     * Named resource resolvers. Run AFTER param/body/query/header validation and
     * AFTER auth middleware, immediately before the handler. Each receives the
     * assembled request; results are assigned to req[key]. Throws go through onError.
     * Resolvers are runtime-only and are NOT emitted into the OpenAPI document.
     */
    resolve?: Record<string, RouteResolver>;
}
/** Handler signature: receives flat request object, returns JSON-serializable object or null (→ 204). */
export type RouteHandler = (req: Record<string, unknown>) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
/**
 * A resource resolver: reads the validated flat request (path params flat at top
 * level, body/query/headers nested, `auth` when the route is gated, `c` Hono
 * Context) and returns the resource to inject under its resolver key. May throw
 * APIError — errors flow through app.onError the same way handler throws do.
 *
 * This is the LOOSE model-level type (mirrors `RouteHandler`): strict per-route
 * inference lives in api.ts's `api()`/`ApiMethodHelper` overloads. spec.ts must
 * not import api.ts (ADR-011 layering), so it stores/forwards the loose shape.
 */
export type RouteResolver = (req: Record<string, unknown>) => unknown | Promise<unknown>;
/** A registered route: drives both Hono dispatch and spec emission. */
export interface StoredRoute {
    method: string;
    oapiPath: string;
    config: RouteConfig;
    handler: RouteHandler;
}
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
export declare function resolveSuccessCode(status: number | undefined, responseKeys: readonly string[]): string;
/** Emit the OpenAPI 3.0 document for all registered routes. */
export declare function buildSpec(routes: readonly StoredRoute[], components: ComponentRegistry, config: {
    openapi?: string;
    info: {
        title: string;
        version: string;
    };
}): Promise<OpenAPISpec>;
export {};
//# sourceMappingURL=spec.d.ts.map