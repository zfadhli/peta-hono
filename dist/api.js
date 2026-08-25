import { apiReference } from "@scalar/hono-api-reference";
import { type } from "arktype";
import { APIError, createErrorHandler, normalizeMethod, OpenAPIHono, } from "./openapi.js";
// Re-export APIError (defined in openapi.ts) so the public barrel keeps a
// stable shape via api.ts. See issue #4: APIError moved to openapi.ts so the
// validator can throw it without a circular import.
export { APIError };
// --- Named error helpers per HTTP status ---
export const fail = {
    badRequest: (msg = "Bad Request") => new APIError(400, msg),
    unauthorized: (msg = "Unauthorized") => new APIError(401, msg),
    forbidden: (msg = "Forbidden") => new APIError(403, msg),
    notFound: (msg = "Not Found") => new APIError(404, msg),
    conflict: (msg = "Conflict") => new APIError(409, msg),
    unprocessableEntity: (msg = "Unprocessable Entity") => new APIError(422, msg),
    tooManyRequests: (msg = "Too Many Requests") => new APIError(429, msg),
    internalServerError: (msg = "Internal Server Error") => new APIError(500, msg),
};
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
 * const hello = api(
 *   { method: 'GET', path: '/hello/:name', auth: 'required' },
 *   async ({ name, auth }) => ({ message: `Hello ${name}! (${auth.user.id})` }),
 * )
 *
 * docs()
 * ```
 */
export function createApi(opts = {}) {
    const app = new OpenAPIHono();
    // Global error handler — single chokepoint via shared createErrorHandler policy.
    // Replaces the default handler installed by OpenAPIHono with a debug-aware variant
    // that is safely gated by NODE_ENV=production (warns and redacts in prod).
    app.onError(createErrorHandler(opts.debug));
    const auths = new Map();
    const authSchemes = new Map();
    function auth(name, mw, scheme) {
        // Wrap the return-based auth fn into a Hono middleware that stores the
        // auth context on c for the handler wrapper to read via c.get('auth').
        const wrapped = async (c, next) => {
            const ctx = await mw(c);
            c.set("auth", ctx);
            await next();
        };
        auths.set(name, wrapped);
        if (scheme) {
            authSchemes.set(name, scheme);
            app.registerSecurityScheme(name, scheme);
        }
    }
    function api(config, handler) {
        // Method normalization is case-insensitive and uses the single
        // normalizeMethod helper (same message as OpenAPIHono) for consistency.
        const normalized = normalizeMethod(config.method);
        const method = normalized.toUpperCase();
        const paramNames = [...config.path.matchAll(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g)].map((m) => m[1]);
        // Build request schemas
        const request = {};
        if (paramNames.length > 0) {
            request.params = type(Object.fromEntries(paramNames.map((n) => [n, "string"])));
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
        // Attach OpenAPI security if the endpoint uses a registered auth scheme
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
        }, (req) => handler(req));
    }
    function docs(specPath = "/openapi.json", uiPath = "/docs") {
        app.doc(specPath, {
            openapi: "3.0.0",
            info: {
                title: opts.title ?? "API",
                version: opts.version ?? "1.0.0",
            },
        });
        app.get(uiPath, apiReference({ spec: { url: specPath } }));
    }
    return { app, api, auth, docs };
}
//# sourceMappingURL=api.js.map