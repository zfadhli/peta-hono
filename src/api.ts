import { apiReference } from "@scalar/hono-api-reference";
import { type Type, type } from "arktype";
import type { Context, Env, MiddlewareHandler } from "hono";
import {
  type AuthStrategySpec,
  buildAuthStrategy,
  buildJwtStrategy,
  buildOAuthStrategy,
  buildSessionStrategy,
  type FlowApp,
  type JwtStrategy,
  type JwtStrategyOptions,
  type OAuthStrategy,
  type OAuthStrategyOptions,
  type SessionStrategy,
  type SessionStrategyOptions,
  type StrategyFor,
} from "./auth/index.js";
import { createErrorHandler } from "./errors.js";
import { type AuthScheme, OpenAPIHono, type SecurityScheme } from "./openapi.js";
import { type Method, normalizeMethod, parseParamTokens } from "./paths.js";

// Error kernel moved to src/errors.ts (ADR-011 step 2). Re-export APIError +
// the named helpers so the public barrel (src/index.ts) keeps a stable shape
// via api.ts, and the validator can throw APIError without a circular import.
export { APIError, errors, fail, httpErrors } from "./errors.js";
export type { HttpMethod, Method } from "./paths.js";
// Re-export AuthScheme (narrow input) + SecurityScheme (wide emitted) so
// consumers can import them from api.ts as before. AuthScheme is what you pass
// to auth(); SecurityScheme is what the library emits for securitySchemes.
export type { AuthScheme, SecurityScheme };

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
 * The request object a handler receives — inferred from the config generics.
 * Path params are flat top-level keys (Encore-style); body / query / headers are
 * nested under their own keys.
 *
 * Note for consumers: if your editor reports `Property 'auth' does not exist on
 * type 'ReqFor<...>'`, the route config is missing `auth: "required"` — the
 * handler only receives `auth` on an app whose routes declare it, or when the app
 * is registered with `createApi<Auth>`. Add `auth: "required"` to the config (or
 * register the app with the `Auth` generic) and the property appears.
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
  /** Suppress the auto-documented 400 that path `:param` routes get (noise). */
  hide400?: boolean;
};

/** RouteFields without method/path — used for method shorthands like api.get(path, config, handler) */
type RouteFieldsWithoutMethodPath<P extends string, B, Q, H> = Omit<
  RouteFields<P, B, Q, H>,
  "method" | "path"
>;

/**
 * Explicit shorthand helper type — preserves both overloads.
 * Do NOT use `ReturnType<typeof makeMethodHelper>` here: `ReturnType` on an
 * overloaded function collapses to the last (implementation) signature
 * `auth?: string` → `req & { auth: Auth }`, losing the `auth:"required"`
 * → `AuthField<Auth>` distinction. With `Auth=undefined` the collapsed
 * signature incorrectly allows `api.get("/x", {auth:"required"}, ({auth})=>...)`
 * because `auth: Auth` becomes `auth: undefined` (present), while the
 * two-overload form correctly requires `AuthField<undefined>={}` (absent) and
 * errors on the negative case. Classic `api({method,path,auth})` kept the
 * two overloads directly, so it still errored; shorthands did not.
 * Explicit interface keeps the negative case a type error.
 */
type ApiMethodHelper<Auth, E extends Env> = {
  <
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    path: P,
    config: RouteFieldsWithoutMethodPath<P, B, Q, H> & { auth?: undefined },
    handler: (req: ReqFor<P, B, Q, H, E>) => Promise<any> | any,
  ): void;
  <
    P extends string,
    B extends AnyArkType | undefined,
    Q extends AnyArkType | undefined,
    H extends AnyArkType | undefined,
  >(
    path: P,
    config: RouteFieldsWithoutMethodPath<P, B, Q, H> & { auth: string },
    handler: (req: ReqFor<P, B, Q, H, E> & AuthField<Auth>) => Promise<any> | any,
  ): void;
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
  // that reveals `{ error, stack }` only under an explicit NODE_ENV=development|test
  // (dev-only), and redacts to `{"error":"Internal Server Error"}` otherwise.
  app.onError(createErrorHandler(opts.debug));

  const auths = new Map<string, MiddlewareHandler>();
  const authSchemes = new Map<string, SecurityScheme>();

  // Shared registration used by both the public `auth()` and the built-in
  // strategies. Every registered auth is ALWAYS documented as protected: a
  // route with `{auth}` emits 401 + a `security` requirement. The optional
  // `scheme` only controls the lock-icon KIND; when omitted we publish a
  // default bearer scheme so the `security` requirement still resolves to a
  // real `components.securitySchemes` entry (no dangling ref, lock icon shows).
  // Internal: accepts the wide `SecurityScheme` (the built-in strategies need
  // cookie/oauth2); the public `auth()` narrows its own `scheme` to `AuthScheme`.
  function registerAuth(
    name: string,
    mw: (c: Context) => Promise<unknown> | unknown,
    scheme?: SecurityScheme,
  ) {
    // Wrap the return-based auth fn into a Hono middleware that stores the
    // auth context on c for the handler wrapper to read via c.get('auth').
    const wrapped: MiddlewareHandler = async (c, next) => {
      const ctx = await mw(c as unknown as Context);
      (c as unknown as { set(key: string, value: unknown): void }).set("auth", ctx);
      await next();
    };
    auths.set(name, wrapped);
    const resolvedScheme = scheme ?? { type: "http", scheme: "bearer" };
    authSchemes.set(name, resolvedScheme);
    app.registerSecurityScheme(name, resolvedScheme);
  }

  function auth(name: string, mw: (c: Context<E>) => Promise<Auth> | Auth, scheme?: AuthScheme) {
    registerAuth(name, mw, scheme);
  }

  // --- Built-in auth strategies (session / jwt / oauth) ---

  function registerSessionStrategy(name: string, opts: SessionStrategyOptions): SessionStrategy {
    const handle = buildSessionStrategy(name, opts);
    registerAuth(name, handle.middleware, handle.scheme);
    return handle;
  }

  function registerJwtStrategy(name: string, opts: JwtStrategyOptions): JwtStrategy {
    const handle = buildJwtStrategy(name, opts);
    registerAuth(name, handle.middleware, handle.scheme);
    return handle;
  }

  function registerOAuthStrategy(name: string, opts: OAuthStrategyOptions): OAuthStrategy {
    const handle = buildOAuthStrategy(name, opts);
    // OAuth is a *flow*, not a request guard: document the scheme and mount the
    // /start + /callback routes. Protect downstream routes with a jwt/session gate.
    app.registerSecurityScheme(name, handle.scheme);
    handle.mount(app as unknown as FlowApp);
    return handle;
  }

  function registerAuthStrategy<S extends AuthStrategySpec>(name: string, spec: S): StrategyFor<S> {
    const handle = buildAuthStrategy(name, spec);
    if ("middleware" in handle && handle.middleware) {
      registerAuth(name, handle.middleware, handle.scheme);
    } else {
      app.registerSecurityScheme(name, handle.scheme);
    }
    if ("mount" in handle && handle.mount) handle.mount(app as unknown as FlowApp);
    return handle;
  }

  const authWithStrategies = auth as typeof auth & {
    strategy<Spec extends AuthStrategySpec>(name: string, spec: Spec): StrategyFor<Spec>;
    session(name: string, opts: SessionStrategyOptions): SessionStrategy;
    jwt(name: string, opts: JwtStrategyOptions): JwtStrategy;
    oauth(name: string, opts: OAuthStrategyOptions): OAuthStrategy;
  };
  authWithStrategies.strategy = registerAuthStrategy;
  authWithStrategies.session = registerSessionStrategy;
  authWithStrategies.jwt = registerJwtStrategy;
  authWithStrategies.oauth = registerOAuthStrategy;

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

    // Attach OpenAPI security whenever the endpoint is auth-gated. `authSchemes`
    // is always populated (auth() registers a default scheme even without the
    // `scheme` arg), so every `{auth}` route is documented as protected — 401 +
    // a `security` requirement + the matching `components.securitySchemes` entry.
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
        hide400: config.hide400,
      },
      (req) => handler(req as ReqFor<P, B, Q, H, E> & { auth: Auth }),
    );
  }

  // --- Method shorthands: api.get(path, config, handler) etc. ---

  function makeMethodHelper<M extends Method>(method: M): ApiMethodHelper<Auth, E> {
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
    get: ApiMethodHelper<Auth, E>;
    post: ApiMethodHelper<Auth, E>;
    put: ApiMethodHelper<Auth, E>;
    patch: ApiMethodHelper<Auth, E>;
    del: ApiMethodHelper<Auth, E>;
    delete: ApiMethodHelper<Auth, E>;
  };

  apiWithHelpers.get = makeMethodHelper("GET");
  apiWithHelpers.post = makeMethodHelper("POST");
  apiWithHelpers.put = makeMethodHelper("PUT");
  apiWithHelpers.patch = makeMethodHelper("PATCH");
  apiWithHelpers.del = makeMethodHelper("DELETE");
  apiWithHelpers.delete = apiWithHelpers.del;

  /**
   * Resolve the `docs({ auth })` guard to a concrete middleware. A function is
   * used as-is (raw Hono middleware); a string is looked up against the
   * registered auths (the same names `api({ auth })` accepts). An unknown name
   * throws — mirroring `api()` so an unregistered guard fails fast rather than
   * silently leaving docs open. `auths` stores the wrapped middleware, so a
   * string guard rejects via the same throw-to-onError path as route auth.
   */
  function resolveDocsGuard(auth: MiddlewareHandler | string): MiddlewareHandler {
    if (typeof auth === "function") return auth;
    const mw = auths.get(auth);
    if (!mw) {
      throw new Error(
        `docs(): auth '${auth}' is not registered. Call auth('${auth}', middleware) before using it.`,
      );
    }
    return mw;
  }

  // Resolve auth → middleware for docs (or undefined if not guarding). `DocsOptions`
  // is the options-object form; `auth` (optional) gates the spec + UI routes.
  type DocsOptions = {
    specPath?: string;
    uiPath?: string;
    /** Guard the docs routes. A raw Hono middleware, or a registered auth name. */
    auth?: MiddlewareHandler | string;
  };

  const docsImpl = (specPathOrOpts: string | DocsOptions = "/openapi.json", uiPath = "/docs") => {
    let specPath: string;
    let resolvedUiPath: string;
    let guard: MiddlewareHandler | undefined;
    if (typeof specPathOrOpts === "object" && specPathOrOpts !== null) {
      specPath = specPathOrOpts.specPath ?? "/openapi.json";
      resolvedUiPath = specPathOrOpts.uiPath ?? "/docs";
      if (specPathOrOpts.auth !== undefined) {
        guard = resolveDocsGuard(specPathOrOpts.auth);
      }
    } else {
      specPath = specPathOrOpts as string;
      resolvedUiPath = uiPath;
    }

    // Auth-guarded docs: register the guard BEFORE mounting so Hono runs the
    // middleware first (`app.use` after `app.get` does NOT guard — Hono matches
    // in registration order, so a use() registered after a route runs after it).
    // The spec is an exact path; the UI is guarded with a glob (`/docs/*`) so
    // both the base page and any Scalar sub-path are covered.
    if (guard !== undefined) {
      app.use(specPath, guard);
      app.use(`${resolvedUiPath}/*`, guard);
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
  };

  function docs(specPath?: string, uiPath?: string): void;
  function docs(options: DocsOptions): void;
  function docs(specPathOrOpts: string | DocsOptions = "/openapi.json", uiPath = "/docs"): void {
    docsImpl(specPathOrOpts, uiPath);
  }

  return { app, api: apiWithHelpers, auth: authWithStrategies, docs };
}
