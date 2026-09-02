import type { Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { Schema } from "hono/types";
import type { Method } from "./paths.js";
import { type ArkType } from "./validation.js";
export { arktypeValidator } from "./validation.js";
export type { ArkType } from "./validation.js";
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
/** Handler signature: receives flat request object, returns JSON-serializable object or null (→ 204). */
type RouteHandler = (req: Record<string, unknown>) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
export type { HttpMethod, Method, ParamToken } from "./paths.js";
export { hasParamTokens, normalizeMethod, PARAM_HAS_RE, PARAM_TOKEN_RE, parseParamTokens, SUPPORTED_METHODS, toOapiPath, } from "./paths.js";
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
    registerSecurityScheme(name: string, scheme: SecurityScheme): void;
    private _buildSpec;
    private _buildResponses;
    private _getErrorSchemaRef;
    /**
     * Convert an ArkType schema → OpenAPI Schema Object (delegates to registry.ts,
     * ADR-011 step 4): strips $schema, hoists $defs to components/schemas under
     * content-hash stable names, rewrites all $ref pointers, module-scoped cache.
     */
    private _schemaToOA;
    /** Walk an ArkType object schema and produce OpenAPI parameter objects. */
    private _addObjectParams;
}
//# sourceMappingURL=openapi.d.ts.map