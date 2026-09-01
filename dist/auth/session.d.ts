import type { Context } from "hono";
import type { SecurityScheme } from "../openapi.js";
import { type SessionStore } from "./store.js";
/**
 * Built-in cookie-session strategy.
 *
 * The session id travels in a signed cookie (`sid.signature`, HMAC-SHA256) and
 * the session payload lives in a pluggable `SessionStore`. The guard middleware
 * reads the cookie, verifies the signature, loads the session, and yields it as
 * `req.auth`; invalid/expired/missing sessions throw 401.
 *
 * CSRF defaults to `"origin"` (the Pilcrow baseline): mutating requests whose
 * `Origin`/`Sec-Fetch-Site` is cross-site are rejected 403 with no client token
 * (browsers send these headers automatically). Configure `origin` (a string or
 * string[] of allowed origins) to use it; `"double-submit"` keeps the classic
 * `x-csrf-token` behavior; `true` is an alias for `"double-submit"`; `false`
 * disables CSRF.
 *
 * ponytail: signing (integrity) only, not encryption. The cookie is `Secure` by
 * default now (set `cookie.secure: false` — or a top-level `secure: false` — for
 * dev-over-http). Upgrade path: encrypt the cookie payload (iron) and/or bind the
 * CSRF token to the session + origin.
 */
/** Cookie attribute block for the session cookie (overrides the legacy top-level flags). */
export interface SessionCookieOptions {
    /** `Secure` flag. Default `true` (set `false` for dev-over-http). */
    secure?: boolean;
    /** `SameSite` attribute (default `"Lax"`). */
    sameSite?: "Lax" | "Strict" | "None";
    /** Cookie path (default `"/"`). */
    path?: string;
    /** `HttpOnly` flag (default true). */
    httpOnly?: boolean;
    /** Rename the cookie to `__Host-sid` and force `Secure` + `Path=/` + no `Domain`. */
    hostPrefix?: boolean;
}
/** CSRF mode: `"origin"` (default), `"double-submit"`, or `false` (off). `true` aliases `"double-submit"`. */
export type SessionCsrf = boolean | "origin" | "double-submit";
export interface SessionStrategyOptions {
    /** HMAC secret for signing the session cookie. Required. */
    secret: string;
    /** Cookie name (default `"sid"`). */
    cookieName?: string;
    /** Session lifetime in seconds (default 604800 = 7 days). */
    ttlSeconds?: number;
    /** `HttpOnly` flag (default true). Legacy top-level form of `cookie.httpOnly`. */
    httpOnly?: boolean;
    /** `SameSite` attribute (default `"Lax"`). Legacy top-level form of `cookie.sameSite`. */
    sameSite?: "Lax" | "Strict" | "None";
    /** `Secure` flag (default `true`). Legacy top-level form of `cookie.secure`. */
    secure?: boolean;
    /** Cookie path (default `"/"`). Legacy top-level form of `cookie.path`. */
    path?: string;
    /** Session store (default in-memory). Supply a durable store in prod. */
    store?: SessionStore;
    /**
     * CSRF mode on mutating requests (default `"origin"`).
     * `"origin"` requires the `origin` option; `"double-submit"`/`true` requires a
     * client `x-csrf-token` (via `generateCsrf`); `false` restores legacy.
     */
    csrf?: SessionCsrf;
    /**
     * Allowed origins for `csrf: "origin"` mode (the `Origin` header must match).
     * Required (throws) when `csrf` is `"origin"` (the default) and unset.
     */
    origin?: string | string[];
    /** Cookie attribute block (defaults to `secure: true`). Overrides the legacy top-level flags. */
    cookie?: SessionCookieOptions;
}
export interface SessionStrategy {
    /** The auth-gate name (used as `{ auth: name }`). */
    name: string;
    /** OpenAPI security scheme (apiKey/in:cookie). */
    scheme: SecurityScheme;
    /** Guard middleware — yields the session payload as `req.auth`. */
    middleware: (c: Context) => Promise<Record<string, unknown>>;
    /**
     * Start a session (login/register): store payload + set cookie. Sets the cookie
     * on the Hono context (for plain-object handlers) AND returns the `Set-Cookie`
     * value, so a handler that returns a raw `Response` (e.g. an OAuth `onSuccess`)
     * can attach it to its own response.
     */
    create(c: Context, data: Record<string, unknown>): Promise<string>;
    /** Destroy the current session and clear the cookie. Returns the `Set-Cookie` value. */
    destroy(c: Context): Promise<string>;
    /** Read the current session payload (no throw), or `null`. */
    get(c: Context): Promise<Record<string, unknown> | null>;
    /** Generate (or return the existing) CSRF token bound to the session. */
    generateCsrf(c: Context): Promise<string>;
    /** Constant-time CSRF token check against the session. */
    verifyCsrf(c: Context, token: string): Promise<boolean>;
}
/**
 * Build a session strategy handle.
 */
export declare function buildSessionStrategy(name: string, opts: SessionStrategyOptions): SessionStrategy;
//# sourceMappingURL=session.d.ts.map