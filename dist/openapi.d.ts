import { type Type } from "arktype";
import type { Context, Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { Schema } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Method } from "./paths.js";
/** Any ArkType type instance — has toJsonSchema() and is callable for validation. */
export type ArkType = Type<any, any>;
export type AuthScheme = {
    type: "http";
    scheme: "bearer" | "basic";
} | {
    type: "apiKey";
    in: "header" | "query";
    name: string;
};
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
}
/** Single error policy — shared by OpenAPIHono and createApi (via createErrorHandler). */
export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>;
export declare function createErrorHandler(debug?: boolean): ErrorHandler;
/** Handler signature: receives flat request object, returns JSON-serializable object or null (→ 204). */
type RouteHandler = (req: Record<string, unknown>) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
/**
 * Typed HTTP error. Thrown from handlers (and the validator) to route errors
 * through `app.onError` — the single chokepoint for all error responses.
 */
export declare class APIError extends Error {
    status: ContentfulStatusCode;
    constructor(status: ContentfulStatusCode, message: string);
}
export type { HttpMethod, Method, ParamToken } from "./paths.js";
export { hasParamTokens, normalizeMethod, PARAM_HAS_RE, PARAM_TOKEN_RE, parseParamTokens, SUPPORTED_METHODS, toOapiPath, } from "./paths.js";
/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers/booleans (deep, element-wise for arrays and nested objects)
 * before validation so query/header strings pass typed schemas.
 */
export declare function arktypeValidator(target: "json" | "query" | "header" | "param", schema: ArkType): MiddlewareHandler;
export declare class OpenAPIHono<E extends Env = Env, S extends Schema = Schema, BasePath extends string = "/"> extends Hono<E, S, BasePath> {
    private _routes;
    private _components;
    constructor(...args: ConstructorParameters<typeof Hono>);
    /** Register an API endpoint with ArkType validation and OpenAPI metadata. */
    openapi(config: RouteConfig, handler: RouteHandler): void;
    /** Emit an OpenAPI 3.0 JSON endpoint. */
    doc(url: string, config: {
        openapi?: string;
        info: {
            title: string;
            version: string;
        };
    }): void;
    /** Register an OpenAPI security scheme (e.g. bearer, apiKey). */
    registerSecurityScheme(name: string, scheme: AuthScheme): void;
    private _buildSpec;
    private _buildResponses;
    private _errorSchemaRef;
    private _getErrorSchemaRef;
    /**
     * Convert an ArkType schema → OpenAPI Schema Object.
     * Uses ArkType's toJsonSchema(), strips $schema, hoists $defs to components/schemas
     * with content-hash stable names, and rewrites all $ref pointers accordingly.
     */
    private _schemaToOA;
    /** Walk an ArkType object schema and produce OpenAPI parameter objects. */
    private _addObjectParams;
}
//# sourceMappingURL=openapi.d.ts.map