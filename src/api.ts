import { apiReference } from "@scalar/hono-api-reference";
import { type Type, type } from "arktype";
import type { Context, MiddlewareHandler } from "hono";
import { APIError, type AuthScheme, OpenAPIHono } from "./openapi.js";

// Re-export AuthScheme so consumers can import it from api.ts as before
export type { AuthScheme };
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

// --- Internal type utilities ---

type AnyArkType = Type<any, any>;

/** Extract `:name` tokens from a Hono-style path. */
type PathParam<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParam<Rest>
  : P extends `${string}:${infer Param}`
    ? Param
    : never;

/** Build `{ name: string }` from a path like `/hello/:name`. */
type ParamsFromPath<P extends string> = {
  [K in PathParam<P> & string]: string;
};

/**
 * The request object the handler receives — inferred from the config generics.
 * Path params are flat top-level keys (Encore-style).
 * Body / query / headers are nested under their own keys.
 */
type ReqFor<P extends string, B, Q, H> = ParamsFromPath<P> &
  (B extends AnyArkType ? { body: Record<string, any> } : {}) &
  (Q extends AnyArkType ? { query: Record<string, any> } : {}) &
  (H extends AnyArkType ? { headers: Record<string, any> } : {}) & {
    c: Context;
  };

/** Add `auth: Auth` to req only when Auth is not undefined (no-auth app). */
type AuthField<Auth> = [Auth] extends [undefined] ? {} : { auth: Auth };

/** Shared config fields for api() overloads — minus the `auth` key. */
type RouteFields<P extends string, B, Q, H> = {
  method: string;
  path: P;
  body?: B;
  query?: Q;
  headers?: H;
  responses?: Record<number, AnyArkType>;
  middleware?: MiddlewareHandler[];
  tags?: string[];
  summary?: string;
  description?: string;
  status?: number;
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
export function createApi<Auth = undefined>(opts: { title?: string; version?: string } = {}) {
  const app = new OpenAPIHono();

  // Global error handler — prevents leaking internal error details to clients
  app.onError((err, c) => {
    if (err instanceof APIError) {
      return c.json({ error: err.message }, err.status);
    }
    // ponytail: logs the full error server-side, sends generic message to client.
    // Add a `debug` option to createApi() to send full error details in dev mode.
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  const auths = new Map<string, MiddlewareHandler>();
  const authSchemes = new Map<string, AuthScheme>();

  function auth(name: string, mw: (c: Context) => Promise<Auth> | Auth, scheme?: AuthScheme) {
    // Wrap the return-based auth fn into a Hono middleware that stores the
    // auth context on c for the handler wrapper to read via c.get('auth').
    const wrapped: MiddlewareHandler = async (c, next) => {
      const ctx = await mw(c);
      (c as unknown as { set(key: string, value: unknown): void }).set("auth", ctx);
      await next();
    };
    auths.set(name, wrapped);
    if (scheme) {
      authSchemes.set(name, scheme);
      app.registerSecurityScheme(name, scheme);
    }
  }

  // Overload 1: no auth → req has no `auth` field
  function api<
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    config: RouteFields<P, B, Q, H> & { auth?: undefined },
    handler: (req: ReqFor<P, B, Q, H>) => Promise<any> | any,
  ): void;

  // Overload 2: with auth → req gets `auth: Auth` (typed via createApi<Auth>)
  function api<
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    config: RouteFields<P, B, Q, H> & { auth: string },
    handler: (req: ReqFor<P, B, Q, H> & AuthField<Auth>) => Promise<any> | any,
  ): void;

  function api<
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    config: RouteFields<P, B, Q, H> & { auth?: string },
    handler: (req: ReqFor<P, B, Q, H> & { auth: Auth }) => Promise<any> | any,
  ) {
    // Normalize method to lowercase (accept 'GET' or 'get')
    const raw = config.method.toLowerCase();
    if (!["get", "post", "put", "patch", "delete"].includes(raw)) {
      throw new Error(
        `api(): method '${config.method}' is not supported. Use one of: GET, POST, PUT, PATCH, DELETE`,
      );
    }
    const method = raw.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

    const paramNames = [...config.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);

    // Build request schemas
    const request: {
      body?: AnyArkType;
      query?: AnyArkType;
      headers?: AnyArkType;
      params?: AnyArkType;
    } = {};
    if (paramNames.length > 0) {
      request.params = type(Object.fromEntries(paramNames.map((n) => [n, "string"])));
    }
    if (config.body) request.body = config.body;
    if (config.query) request.query = config.query;
    if (config.headers) request.headers = config.headers;

    // Build response schemas
    const responses: Record<number, AnyArkType> = {};
    for (const [code, schema] of Object.entries(config.responses ?? {})) {
      responses[Number(code)] = schema;
    }

    // Build auth + custom middleware list
    const mws: MiddlewareHandler[] = [];
    if (config.auth) {
      const mw = auths.get(config.auth);
      if (!mw) {
        throw new Error(
          `api(): auth '${config.auth}' is not registered. Call auth('${config.auth}', middleware) before using it.`,
        );
      }
      mws.push(mw);
    }
    if (config.middleware) {
      mws.push(...config.middleware);
    }

    // Attach OpenAPI security if the endpoint uses a registered auth scheme
    const security =
      config.auth && authSchemes.has(config.auth) ? [{ [config.auth]: [] as string[] }] : undefined;

    app.openapi(
      {
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
      },
      (req) => handler(req as ReqFor<P, B, Q, H> & { auth: Auth }),
    );
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
