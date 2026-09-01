import { type Type } from "arktype";
import type { Context, Env, MiddlewareHandler } from "hono";
import { type AuthStrategySpec, type JwtStrategy, type JwtStrategyOptions, type OAuthStrategy, type OAuthStrategyOptions, type SessionStrategy, type SessionStrategyOptions, type StrategyFor } from "./auth/index.js";
import { type AuthScheme, OpenAPIHono, type SecurityScheme } from "./openapi.js";
import { type Method } from "./paths.js";
export { APIError, errors, fail, httpErrors } from "./errors.js";
export type { HttpMethod, Method } from "./paths.js";
export type { AuthScheme, SecurityScheme };
type AnyArkType = Type<any, any>;
/** Extract the inferred output type from an ArkType instance. */
type ArkInfer<T> = T extends {
    infer: infer I;
} ? I : never;
/** Single param token → record, handling optional `?` and regex `{...}`. */
type ParamRecord<S extends string> = S extends `${infer N}{${string}}?` ? {
    [K in N]?: string;
} : S extends `${infer N}?` ? {
    [K in N]?: string;
} : S extends `${infer N}{${string}}` ? {
    [K in N]: string;
} : {
    [K in S]: string;
};
/** Build `{ name: string }` / `{ name?: string }` from a path like `/hello/:name` or `/posts/:id?`. */
type ParamsFromPath<P extends string> = P extends `${string}:${infer Param}/${infer Rest}` ? ParamRecord<Param> & ParamsFromPath<`/${Rest}`> : P extends `${string}:${infer Param}` ? ParamRecord<Param> : {};
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
type ReqFor<P extends string, B, Q, H, E extends Env = Env> = ParamsFromPath<P> & (B extends AnyArkType ? {
    body: ArkInfer<B>;
} : {}) & (Q extends AnyArkType ? {
    query: ArkInfer<Q>;
} : {}) & (H extends AnyArkType ? {
    headers: ArkInfer<H>;
} : {}) & {
    c: Context<E>;
};
/** Add `auth: Auth` to req only when Auth is not undefined (no-auth app). */
type AuthField<Auth> = [Auth] extends [undefined] ? {} : {
    auth: Auth;
};
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
type RouteFieldsWithoutMethodPath<P extends string, B, Q, H> = Omit<RouteFields<P, B, Q, H>, "method" | "path">;
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
    <P extends string, B extends AnyArkType | undefined, Q extends AnyArkType | undefined, H extends AnyArkType | undefined>(path: P, config: RouteFieldsWithoutMethodPath<P, B, Q, H> & {
        auth?: undefined;
    }, handler: (req: ReqFor<P, B, Q, H, E>) => Promise<any> | any): void;
    <P extends string, B extends AnyArkType | undefined, Q extends AnyArkType | undefined, H extends AnyArkType | undefined>(path: P, config: RouteFieldsWithoutMethodPath<P, B, Q, H> & {
        auth: string;
    }, handler: (req: ReqFor<P, B, Q, H, E> & AuthField<Auth>) => Promise<any> | any): void;
};
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
export declare function createApi<Auth = undefined, E extends Env = Env>(opts?: {
    title?: string;
    version?: string;
    debug?: boolean;
}): {
    app: OpenAPIHono<E, import("hono").Schema, "/">;
    api: {
        <P extends string, B extends AnyArkType | undefined, Q extends AnyArkType | undefined, H extends AnyArkType | undefined>(config: RouteFields<P, B, Q, H> & {
            auth?: undefined;
        }, handler: (req: ReqFor<P, B, Q, H, E>) => Promise<any> | any): void;
        <P extends string, B extends AnyArkType | undefined, Q extends AnyArkType | undefined, H extends AnyArkType | undefined>(config: RouteFields<P, B, Q, H> & {
            auth: string;
        }, handler: (req: ReqFor<P, B, Q, H, E> & AuthField<Auth>) => Promise<any> | any): void;
    } & {
        get: ApiMethodHelper<Auth, E>;
        post: ApiMethodHelper<Auth, E>;
        put: ApiMethodHelper<Auth, E>;
        patch: ApiMethodHelper<Auth, E>;
        del: ApiMethodHelper<Auth, E>;
        delete: ApiMethodHelper<Auth, E>;
    };
    auth: ((name: string, mw: (c: Context<E>) => Promise<Auth> | Auth, scheme?: AuthScheme) => void) & {
        strategy<Spec extends AuthStrategySpec>(name: string, spec: Spec): StrategyFor<Spec>;
        session(name: string, opts: SessionStrategyOptions): SessionStrategy;
        jwt(name: string, opts: JwtStrategyOptions): JwtStrategy;
        oauth(name: string, opts: OAuthStrategyOptions): OAuthStrategy;
    };
    docs: {
        (specPath?: string, uiPath?: string): void;
        (options: {
            specPath?: string;
            uiPath?: string;
            /** Guard the docs routes. A raw Hono middleware, or a registered auth name. */
            auth?: MiddlewareHandler | string;
        }): void;
    };
};
//# sourceMappingURL=api.d.ts.map