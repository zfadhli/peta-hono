import type { Context } from "hono";
import { type SecurityScheme } from "../openapi.js";
import { type SessionStore } from "./store.js";
/**
 * Built-in cookie-session strategy.
 *
 * The session id travels in a signed cookie (`sid.signature`, HMAC-SHA256) and
 * the session payload lives in a pluggable `SessionStore`. The guard middleware
 * reads the cookie, verifies the signature, loads the session, and yields it as
 * `req.auth`; invalid/expired/missing sessions throw 401.
 *
 * ponytail: signing (integrity) only, not encryption, and CSRF is opt-in via
 * double-submit token (SameSite=Lax is the default mitigation). The cookie is
 * NOT `Secure` by default (dev over http); set `secure: true` in production.
 * Upgrade path: encrypt the cookie payload (iron) and/or add a true CSRF token
 * that's bound to the session and origin.
 */
export interface SessionStrategyOptions {
    /** HMAC secret for signing the session cookie. Required. */
    secret: string;
    /** Cookie name (default `"sid"`). */
    cookieName?: string;
    /** Session lifetime in seconds (default 604800 = 7 days). */
    ttlSeconds?: number;
    /** `HttpOnly` flag (default true). */
    httpOnly?: boolean;
    /** `SameSite` attribute (default `"Lax"`). */
    sameSite?: "Lax" | "Strict" | "None";
    /** `Secure` flag (default false — set true on https). */
    secure?: boolean;
    /** Cookie path (default `"/"`). */
    path?: string;
    /** Session store (default in-memory). Supply a durable store in prod. */
    store?: SessionStore;
    /** Enforce CSRF on mutating requests via a double-submit token (default false). */
    csrf?: boolean;
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