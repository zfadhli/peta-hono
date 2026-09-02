import type { Env } from "hono";
import { Hono } from "hono";
import type { Schema } from "hono/types";
import { type RouteConfig, type RouteHandler, type SecurityScheme } from "./spec.js";
export type { HttpMethod, Method, ParamToken } from "./paths.js";
export { hasParamTokens, normalizeMethod, PARAM_HAS_RE, PARAM_TOKEN_RE, parseParamTokens, SUPPORTED_METHODS, toOapiPath, } from "./paths.js";
export type { AuthScheme, OAuth2Flows, RouteConfig, RouteResolver, SecurityScheme, } from "./spec.js";
export type { ArkType } from "./validation.js";
export { arktypeValidator } from "./validation.js";
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
}
//# sourceMappingURL=openapi.d.ts.map