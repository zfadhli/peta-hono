import { type Type } from "arktype";
import type { Context, MiddlewareHandler } from "hono";
import { APIError, type AuthScheme, OpenAPIHono } from "./openapi.js";
export type { AuthScheme };
export { APIError };
export declare const fail: {
    badRequest: (msg?: string) => APIError;
    unauthorized: (msg?: string) => APIError;
    forbidden: (msg?: string) => APIError;
    notFound: (msg?: string) => APIError;
    conflict: (msg?: string) => APIError;
    unprocessableEntity: (msg?: string) => APIError;
    tooManyRequests: (msg?: string) => APIError;
    internalServerError: (msg?: string) => APIError;
};
type AnyArkType = Type<any, any>;
/** Extract the inferred output type from an ArkType instance. */
type ArkInfer<T> = T extends {
    infer: infer I;
} ? I : never;
/** Strip regex `{...}` and optional `?` suffix from a param token. */
type StripParam<S extends string> = S extends `${infer Name}{${string}}` ? StripParam<Name> : S extends `${infer Name}?` ? Name : S;
/** Extract `:name` tokens from a Hono-style path (handles :name, :name{regex}, :name?, etc.). */
type PathParam<P extends string> = P extends `${string}:${infer Param}/${infer Rest}` ? StripParam<Param> | PathParam<`/${Rest}`> : P extends `${string}:${infer Param}` ? StripParam<Param> : never;
/** Build `{ name: string }` from a path like `/hello/:name`. */
type ParamsFromPath<P extends string> = {
    [K in PathParam<P> & string]: string;
};
/**
 * The request object the handler receives — inferred from the config generics.
 * Path params are flat top-level keys (Encore-style).
 * Body / query / headers are nested under their own keys.
 */
type ReqFor<P extends string, B, Q, H> = ParamsFromPath<P> & (B extends AnyArkType ? {
    body: ArkInfer<B>;
} : {}) & (Q extends AnyArkType ? {
    query: ArkInfer<Q>;
} : {}) & (H extends AnyArkType ? {
    headers: ArkInfer<H>;
} : {}) & {
    c: Context;
};
/** Add `auth: Auth` to req only when Auth is not undefined (no-auth app). */
type AuthField<Auth> = [Auth] extends [undefined] ? {} : {
    auth: Auth;
};
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
export declare function createApi<Auth = undefined>(opts?: {
    title?: string;
    version?: string;
    debug?: boolean;
}): {
    app: OpenAPIHono<import("hono").Env, import("hono").Schema, "/">;
    api: {
        <P extends string, B extends AnyArkType | undefined, Q extends AnyArkType | undefined, H extends AnyArkType | undefined>(config: RouteFields<P, B, Q, H> & {
            auth?: undefined;
        }, handler: (req: ReqFor<P, B, Q, H>) => Promise<any> | any): void;
        <P extends string, B extends AnyArkType | undefined, Q extends AnyArkType | undefined, H extends AnyArkType | undefined>(config: RouteFields<P, B, Q, H> & {
            auth: string;
        }, handler: (req: ReqFor<P, B, Q, H> & AuthField<Auth>) => Promise<any> | any): void;
    };
    auth: (name: string, mw: (c: Context) => Promise<Auth> | Auth, scheme?: AuthScheme) => void;
    docs: (specPath?: string, uiPath?: string) => void;
};
//# sourceMappingURL=api.d.ts.map