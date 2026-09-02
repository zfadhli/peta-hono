// OpenAPIHono orchestrator — Hono dispatch + route storage + docs mounting.
//
// The five responsibilities of the original ~809-LOC file now live in focused
// modules (ADR-011): errors.ts (kernel), paths.ts (grammar), validation.ts
// (coercion + validator), registry.ts (schema hoisting/hashing) and spec.ts
// (spec emission + route model types). This module only wires them together:
// it stores StoredRoute[], owns the per-instance ComponentRegistry, and
// delegates spec building to buildSpec. Public exports are re-exported here
// for barrel stability — `import { OpenAPIHono } from "peta-hono"` is unchanged.
import { type } from "arktype";
import { Hono } from "hono";
import { APIError, createErrorHandler } from "./errors.js";
import { normalizeMethod, parseParamTokens, toOapiPath } from "./paths.js";
import { buildSpec, resolveSuccessCode, } from "./spec.js";
import { arktypeValidator } from "./validation.js";
// Path & method grammar lives in src/paths.ts — single source per ADR-010.
export { hasParamTokens, normalizeMethod, PARAM_HAS_RE, PARAM_TOKEN_RE, parseParamTokens, SUPPORTED_METHODS, toOapiPath, } from "./paths.js";
export { arktypeValidator } from "./validation.js";
export class OpenAPIHono extends Hono {
    _routes = [];
    _components = {
        schemas: new Map(),
        securitySchemes: new Map(),
    };
    constructor(...args) {
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
    openapi(config, handler) {
        const method = normalizeMethod(config.method);
        if (!config.path.startsWith("/")) {
            throw new Error(`Path must start with "/": ${config.path}`);
        }
        const oapiPath = toOapiPath(config.path);
        const paramTokens = parseParamTokens(config.path);
        // Build middlewares from request schemas
        const mws = [];
        if (config.request?.params) {
            mws.push(arktypeValidator("param", config.request.params));
        }
        else if (paramTokens.length > 0) {
            // Auto-generate params schema from path tokens — optional `:id?` becomes "string?"
            const paramsDef = {};
            for (const { name, optional } of paramTokens)
                paramsDef[name] = optional ? "string?" : "string";
            mws.push(arktypeValidator("param", type(paramsDef)));
        }
        if (config.request?.query)
            mws.push(arktypeValidator("query", config.request.query));
        if (config.request?.headers)
            mws.push(arktypeValidator("header", config.request.headers));
        if (config.request?.body)
            mws.push(arktypeValidator("json", config.request.body));
        // User-defined middlewares
        if (config.middleware)
            mws.push(...config.middleware);
        // Store route for spec generation
        this._routes.push({ method, oapiPath, config, handler });
        // Register the Hono route
        // ponytail: Hono's .on() has 5+ overloads; typed spread dispatch not worth the complexity
        const dispatch = this.on.bind(this);
        dispatch(method, config.path, ...mws, async (c) => {
            // Hono's valid() is typed via Input generics that don't apply to our dynamic
            // validator registration; narrow c.req to a simple callable signature.
            // Cast is on c.req (not extracting valid) to preserve `this` binding.
            const creq = c.req;
            const req = {};
            // Flatten path params to top level (Encore-style: handler({ name }) not handler({ params: { name } }))
            if (paramTokens.length > 0) {
                Object.assign(req, creq.valid("param"));
            }
            if (config.request?.body)
                req.body = creq.valid("json");
            if (config.request?.query)
                req.query = creq.valid("query");
            if (config.request?.headers)
                req.headers = creq.valid("header");
            // Inject auth context set by auth middleware via c.set('auth', ctx)
            const authCtx = c.get("auth");
            if (authCtx !== undefined)
                req.auth = authCtx;
            // Expose Hono context for handlers that need it (e.g., session save/destroy)
            req.c = c;
            const result = await handler(req);
            // If handler returned a Response directly, use it as-is
            if (result instanceof Response)
                return result;
            // Success status: shared policy with the spec emitter (spec.ts
            // resolveSuccessCode) so runtime responses and documentation never drift.
            const successCode = resolveSuccessCode(config.status, Object.keys(config.responses ?? {}));
            if (result === null) {
                return c.body(null, Number(successCode));
            }
            return c.json(result, Number(successCode));
        });
    }
    /** Emit an OpenAPI 3.0 JSON endpoint. */
    doc(url, config) {
        this.get(url, async (c) => {
            return c.json(await buildSpec(this._routes, this._components, config));
        });
    }
    /** Register an OpenAPI security scheme (e.g. bearer, apiKey). */
    registerSecurityScheme(name, scheme) {
        this._components.securitySchemes.set(name, scheme);
    }
}
//# sourceMappingURL=openapi.js.map