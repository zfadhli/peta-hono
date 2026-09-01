import { apiReference } from "@scalar/hono-api-reference";
import { type } from "arktype";
import { buildAuthStrategy, buildJwtStrategy, buildOAuthStrategy, buildSessionStrategy, } from "./auth/index.js";
import { createErrorHandler } from "./errors.js";
import { OpenAPIHono } from "./openapi.js";
import { normalizeMethod, parseParamTokens } from "./paths.js";
// Error kernel moved to src/errors.ts (ADR-011 step 2). Re-export APIError +
// the named helpers so the public barrel (src/index.ts) keeps a stable shape
// via api.ts, and the validator can throw APIError without a circular import.
export { APIError, errors, fail, httpErrors } from "./errors.js";
// --- Create the API builder ---
/**
 * Create an Encore-style API builder on top of Hono + OpenAPI.
 *
 * ```ts
 * const { api, auth, docs, app } = createApi<{ user: { id: string } }>({ title: 'My API' })
 *
 * auth('required', async (c) => {
 *   const token = c.req.header('Authorization')
 *   if (!token?.startsWith('Bearer ')) throw fail.unauthorized()
 *   return { user: { id: 'alice' } }   // returned value becomes req.auth
 * })
 *
 * // Classic form
 * api(
 *   { method: 'GET', path: '/hello/:name', auth: 'required' },
 *   async ({ name, auth }) => ({ message: `Hello ${name}! (${auth.user.id})` }),
 * )
 *
 * // Shorthand form — mirrors Hono's app.get()
 * api.get('/hello/:name', { auth: 'required' }, async ({ name }) => ({ message: `Hello ${name}!` }))
 *
 * docs()
 * ```
 */
export function createApi(opts = {}) {
    const app = new OpenAPIHono();
    // Global error handler — single chokepoint via shared createErrorHandler policy.
    // Replaces the default handler installed by OpenAPIHono with a debug-aware variant
    // that reveals `{ error, stack }` only under an explicit NODE_ENV=development|test
    // (dev-only), and redacts to `{"error":"Internal Server Error"}` otherwise.
    app.onError(createErrorHandler(opts.debug));
    const auths = new Map();
    const authSchemes = new Map();
    // Shared registration used by both the public `auth()` and the built-in
    // strategies. Every registered auth is ALWAYS documented as protected: a
    // route with `{auth}` emits 401 + a `security` requirement. The optional
    // `scheme` only controls the lock-icon KIND; when omitted we publish a
    // default bearer scheme so the `security` requirement still resolves to a
    // real `components.securitySchemes` entry (no dangling ref, lock icon shows).
    // Internal: accepts the wide `SecurityScheme` (the built-in strategies need
    // cookie/oauth2); the public `auth()` narrows its own `scheme` to `AuthScheme`.
    function registerAuth(name, mw, scheme) {
        // Wrap the return-based auth fn into a Hono middleware that stores the
        // auth context on c for the handler wrapper to read via c.get('auth').
        const wrapped = async (c, next) => {
            const ctx = await mw(c);
            c.set("auth", ctx);
            await next();
        };
        auths.set(name, wrapped);
        const resolvedScheme = scheme ?? { type: "http", scheme: "bearer" };
        authSchemes.set(name, resolvedScheme);
        app.registerSecurityScheme(name, resolvedScheme);
    }
    function auth(name, mw, scheme) {
        registerAuth(name, mw, scheme);
    }
    // --- Built-in auth strategies (session / jwt / oauth) ---
    function registerSessionStrategy(name, opts) {
        const handle = buildSessionStrategy(name, opts);
        registerAuth(name, handle.middleware, handle.scheme);
        return handle;
    }
    function registerJwtStrategy(name, opts) {
        const handle = buildJwtStrategy(name, opts);
        registerAuth(name, handle.middleware, handle.scheme);
        return handle;
    }
    function registerOAuthStrategy(name, opts) {
        const handle = buildOAuthStrategy(name, opts);
        // OAuth is a *flow*, not a request guard: document the scheme and mount the
        // /start + /callback routes. Protect downstream routes with a jwt/session gate.
        app.registerSecurityScheme(name, handle.scheme);
        handle.mount(app);
        return handle;
    }
    function registerAuthStrategy(name, spec) {
        const handle = buildAuthStrategy(name, spec);
        if ("middleware" in handle && handle.middleware) {
            registerAuth(name, handle.middleware, handle.scheme);
        }
        else {
            app.registerSecurityScheme(name, handle.scheme);
        }
        if ("mount" in handle && handle.mount)
            handle.mount(app);
        return handle;
    }
    const authWithStrategies = auth;
    authWithStrategies.strategy = registerAuthStrategy;
    authWithStrategies.session = registerSessionStrategy;
    authWithStrategies.jwt = registerJwtStrategy;
    authWithStrategies.oauth = registerOAuthStrategy;
    function api(config, handler) {
        // Method normalization is case-insensitive and uses the single
        // normalizeMethod helper (same message as OpenAPIHono) for consistency.
        const normalized = normalizeMethod(config.method);
        const method = normalized.toUpperCase();
        const paramTokens = parseParamTokens(config.path);
        // Build request schemas
        const request = {};
        if (paramTokens.length > 0) {
            request.params = type(Object.fromEntries(paramTokens.map(({ name, optional }) => [name, optional ? "string?" : "string"])));
        }
        if (config.body)
            request.body = config.body;
        if (config.query)
            request.query = config.query;
        if (config.headers)
            request.headers = config.headers;
        // Build response schemas
        const responses = {};
        for (const [code, schema] of Object.entries(config.responses ?? {})) {
            responses[Number(code)] = schema;
        }
        // Build auth + custom middleware list
        const mws = [];
        if (config.auth) {
            const mw = auths.get(config.auth);
            if (!mw) {
                throw new Error(`api(): auth '${config.auth}' is not registered. Call auth('${config.auth}', middleware) before using it.`);
            }
            mws.push(mw);
        }
        if (config.middleware) {
            mws.push(...config.middleware);
        }
        // Attach OpenAPI security whenever the endpoint is auth-gated. `authSchemes`
        // is always populated (auth() registers a default scheme even without the
        // `scheme` arg), so every `{auth}` route is documented as protected — 401 +
        // a `security` requirement + the matching `components.securitySchemes` entry.
        const security = config.auth && authSchemes.has(config.auth) ? [{ [config.auth]: [] }] : undefined;
        app.openapi({
            method,
            path: config.path,
            request: Object.keys(request).length > 0 ? request : undefined,
            responses,
            tags: config.tags,
            summary: config.summary,
            description: config.description,
            security,
            middleware: mws.length > 0 ? mws : undefined,
            status: config.status,
            operationId: config.operationId,
            deprecated: config.deprecated,
            hide400: config.hide400,
        }, (req) => handler(req));
    }
    // --- Method shorthands: api.get(path, config, handler) etc. ---
    function makeMethodHelper(method) {
        function helper(path, config, handler) {
            // ponytail: cast to impl signature — overloads stay strict outside, one handler cast for Auth distribution
            const apiImpl = api;
            apiImpl({ ...config, method, path }, handler);
        }
        return helper;
    }
    const apiWithHelpers = api;
    apiWithHelpers.get = makeMethodHelper("GET");
    apiWithHelpers.post = makeMethodHelper("POST");
    apiWithHelpers.put = makeMethodHelper("PUT");
    apiWithHelpers.patch = makeMethodHelper("PATCH");
    apiWithHelpers.del = makeMethodHelper("DELETE");
    apiWithHelpers.delete = apiWithHelpers.del;
    function docs(specPathOrOpts = "/openapi.json", uiPath = "/docs") {
        let specPath;
        let resolvedUiPath;
        if (typeof specPathOrOpts === "object" && specPathOrOpts !== null) {
            specPath = specPathOrOpts.specPath ?? "/openapi.json";
            resolvedUiPath = specPathOrOpts.uiPath ?? "/docs";
        }
        else {
            specPath = specPathOrOpts;
            resolvedUiPath = uiPath;
        }
        app.doc(specPath, {
            openapi: "3.0.0",
            info: {
                title: opts.title ?? "API",
                // Default to 0.0.0 rather than a confidently-wrong 1.0.0 for a pre-1.0
                // library — consumers must override `version` to publish an accurate spec.
                version: opts.version ?? "0.0.0",
            },
        });
        app.get(resolvedUiPath, apiReference({ spec: { url: specPath } }));
    }
    return { app, api: apiWithHelpers, auth: authWithStrategies, docs };
}
//# sourceMappingURL=api.js.map