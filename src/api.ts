import { apiReference } from "@scalar/hono-api-reference";
import { type Type, type } from "arktype";
import type { Context, Env, MiddlewareHandler } from "hono";
import { APIError, type AuthScheme, createErrorHandler, OpenAPIHono } from "./openapi.js";
import { type Method, normalizeMethod, parseParamTokens } from "./paths.js";

export type { HttpMethod, Method } from "./paths.js";
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
  badGateway: (msg = "Bad Gateway") => new APIError(502, msg),
  serviceUnavailable: (msg = "Service Unavailable") => new APIError(503, msg),
  gatewayTimeout: (msg = "Gateway Timeout") => new APIError(504, msg),
};

/** Alias for `fail` — noun form for callers who prefer `throw errors.notFound()`. */
export const errors = fail;
/** Alias for `fail` — explicit HTTP error helpers. */
export const httpErrors = fail;

// --- Internal type utilities ---

type AnyArkType = Type<any, any>;

/** Extract the inferred output type from an ArkType instance. */
type ArkInfer<T> = T extends { infer: infer I } ? I : never;

/** Single param token → record, handling optional `?` and regex `{...}`. */
type ParamRecord<S extends string> = S extends `${infer N}{${string}}?`
  ? { [K in N]?: string }
  : S extends `${infer N}?`
    ? { [K in N]?: string }
    : S extends `${infer N}{${string}}`
      ? { [K in N]: string }
      : { [K in S]: string };

/** Build `{ name: string }` / `{ name?: string }` from a path like `/hello/:name` or `/posts/:id?`. */
type ParamsFromPath<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? ParamRecord<Param> & ParamsFromPath<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? ParamRecord<Param>
    : {};

/**
 * The request object the handler receives — inferred from the config generics.
 * Path params are flat top-level keys (Encore-style).
 * Body / query / headers are nested under their own keys.
 */
type ReqFor<P extends string, B, Q, H, E extends Env = Env> = ParamsFromPath<P> &
  (B extends AnyArkType ? { body: ArkInfer<B> } : {}) &
  (Q extends AnyArkType ? { query: ArkInfer<Q> } : {}) &
  (H extends AnyArkType ? { headers: ArkInfer<H> } : {}) & {
    c: Context<E>;
  };

/** Add `auth: Auth` to req only when Auth is not undefined (no-auth app). */
type AuthField<Auth> = [Auth] extends [undefined] ? {} : { auth: Auth };

/** Shared config fields for api() overloads — minus the `auth` key. */
type RouteFields<P extends string, B, Q, H> = {
  method: Method;
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
  operationId?: string;
  deprecated?: boolean;
};

/** RouteFields without method/path — used for method shorthands like api.get(path, config, handler) */
type RouteFieldsWithoutMethodPath<P extends string, B, Q, H> = Omit<
  RouteFields<P, B, Q, H>,
  "method" | "path"
>;

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
export function createApi<Auth = undefined, E extends Env = Env>(
  opts: { title?: string; version?: string; debug?: boolean } = {},
) {
  const app = new OpenAPIHono<E>();

  // Global error handler — single chokepoint via shared createErrorHandler policy.
  // Replaces the default handler installed by OpenAPIHono with a debug-aware variant
  // that is safely gated by NODE_ENV=production (warns and redacts in prod).
  app.onError(createErrorHandler(opts.debug));

  const auths = new Map<string, MiddlewareHandler>();
  const authSchemes = new Map<string, AuthScheme>();

  function auth(name: string, mw: (c: Context<E>) => Promise<Auth> | Auth, scheme?: AuthScheme) {
    // Wrap the return-based auth fn into a Hono middleware that stores the
    // auth context on c for the handler wrapper to read via c.get('auth').
    const wrapped: MiddlewareHandler = async (c, next) => {
      const ctx = await mw(c as Context<E>);
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
    handler: (req: ReqFor<P, B, Q, H, E>) => Promise<any> | any,
  ): void;

  // Overload 2: with auth → req gets `auth: Auth` (typed via createApi<Auth>)
  function api<
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    config: RouteFields<P, B, Q, H> & { auth: string },
    handler: (req: ReqFor<P, B, Q, H, E> & AuthField<Auth>) => Promise<any> | any,
  ): void;

  function api<
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    config: RouteFields<P, B, Q, H> & { auth?: string },
    handler: (req: ReqFor<P, B, Q, H, E> & { auth: Auth }) => Promise<any> | any,
  ) {
    // Method normalization is case-insensitive and uses the single
    // normalizeMethod helper (same message as OpenAPIHono) for consistency.
    const normalized = normalizeMethod(config.method);
    const method = normalized.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

    const paramTokens = parseParamTokens(config.path);

    // Build request schemas
    const request: {
      body?: AnyArkType;
      query?: AnyArkType;
      headers?: AnyArkType;
      params?: AnyArkType;
    } = {};
    if (paramTokens.length > 0) {
      request.params = type(
        Object.fromEntries(
          paramTokens.map(({ name, optional }) => [name, optional ? "string?" : "string"]),
        ),
      );
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
        operationId: config.operationId,
        deprecated: config.deprecated,
      },
      (req) => handler(req as ReqFor<P, B, Q, H, E> & { auth: Auth }),
    );
  }

  // --- Method shorthands: api.get(path, config, handler) etc. ---

  function makeMethodHelper<M extends Method>(method: M) {
    function helper<
      P extends string,
      B extends AnyArkType | undefined,
      Q extends AnyArkType | undefined,
      H extends AnyArkType | undefined,
    >(
      path: P,
      config: RouteFieldsWithoutMethodPath<P, B, Q, H> & { auth?: undefined },
      handler: (req: ReqFor<P, B, Q, H, E>) => Promise<any> | any,
    ): void;
    function helper<
      P extends string,
      B extends AnyArkType | undefined,
      Q extends AnyArkType | undefined,
      H extends AnyArkType | undefined,
    >(
      path: P,
      config: RouteFieldsWithoutMethodPath<P, B, Q, H> & { auth: string },
      handler: (req: ReqFor<P, B, Q, H, E> & AuthField<Auth>) => Promise<any> | any,
    ): void;
    function helper<
      P extends string,
      B extends AnyArkType | undefined,
      Q extends AnyArkType | undefined,
      H extends AnyArkType | undefined,
    >(
      path: P,
      config: RouteFieldsWithoutMethodPath<P, B, Q, H> & { auth?: string },
      handler: (req: ReqFor<P, B, Q, H, E> & { auth: Auth }) => Promise<any> | any,
    ): void {
      // ponytail: cast to impl signature — overloads stay strict outside, one handler cast for Auth distribution
      const apiImpl = api as unknown as (
        config: RouteFields<P, B, Q, H> & { auth?: string },
        handler: (req: ReqFor<P, B, Q, H, E> & { auth: Auth }) => any,
      ) => void;
      apiImpl(
        { ...config, method, path } as RouteFields<P, B, Q, H> & {
          auth?: string;
        },
        handler as (req: ReqFor<P, B, Q, H, E> & { auth: Auth }) => Promise<any> | any,
      );
    }
    return helper;
  }

  const apiWithHelpers = api as typeof api & {
    get: ReturnType<typeof makeMethodHelper>;
    post: ReturnType<typeof makeMethodHelper>;
    put: ReturnType<typeof makeMethodHelper>;
    patch: ReturnType<typeof makeMethodHelper>;
    del: ReturnType<typeof makeMethodHelper>;
    delete: ReturnType<typeof makeMethodHelper>;
  };

  apiWithHelpers.get = makeMethodHelper("GET");
  apiWithHelpers.post = makeMethodHelper("POST");
  apiWithHelpers.put = makeMethodHelper("PUT");
  apiWithHelpers.patch = makeMethodHelper("PATCH");
  apiWithHelpers.del = makeMethodHelper("DELETE");
  apiWithHelpers.delete = apiWithHelpers.del;

  function docs(specPath?: string, uiPath?: string): void;
  function docs(options: { specPath?: string; uiPath?: string }): void;
  function docs(
    specPathOrOpts: string | { specPath?: string; uiPath?: string } = "/openapi.json",
    uiPath = "/docs",
  ) {
    let specPath: string;
    let resolvedUiPath: string;
    if (typeof specPathOrOpts === "object" && specPathOrOpts !== null) {
      specPath = specPathOrOpts.specPath ?? "/openapi.json";
      resolvedUiPath = specPathOrOpts.uiPath ?? "/docs";
    } else {
      specPath = specPathOrOpts as string;
      resolvedUiPath = uiPath;
    }
    app.doc(specPath, {
      openapi: "3.0.0",
      info: {
        title: opts.title ?? "API",
        version: opts.version ?? "1.0.0",
      },
    });
    app.get(resolvedUiPath, apiReference({ spec: { url: specPath } }));
  }

  return { app, api: apiWithHelpers, auth, docs };
}
