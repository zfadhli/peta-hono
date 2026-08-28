/**
 * Minimal RFC-6265 / RFC-6265bis cookie parsing, serialization, and transport.
 *
 * No dependency beyond `hono` (type-only, for `Context`) and `encodeURIComponent`.
 * The serializer enforces the host/secure cookie contracts:
 *   - `__Host-` prefix ⇒ `Secure` + `Path=/` + no `Domain` (throws otherwise).
 *   - `__Secure-` prefix ⇒ `Secure` required (does NOT force `Path=/`).
 *   - `SameSite=None` ⇒ `Secure` required (RFC-6265bis).
 */
import type { Context } from "hono";
export interface CookieSerializeOptions {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    domain?: string;
    priority?: "low" | "medium" | "high";
    /**
     * Rename the cookie to `__Host-<name>` and force `Secure` + `Path=/` + no
     * `Domain` (the browser contract for `__Host-`). Passing `domain` or a
     * non-`/` `path` with a host prefix throws.
     */
    hostPrefix?: boolean;
    /**
     * Rename the cookie to `__Secure-<name>` and require `Secure` (throws if the
     * cookie is not Secure). Unlike `hostPrefix`, does NOT force `Path=/`.
     */
    securePrefix?: boolean;
}
/** The wire cookie name, applying the `__Host-` prefix when `hostPrefix` is set. */
export declare function cookieNameFor(name: string, hostPrefix?: boolean): string;
/** Split a raw `Cookie` header into `{ name: value }`. */
export declare function parseCookies(header: string | null | undefined): Record<string, string>;
/** Serialize a `Set-Cookie` value. */
export declare function serializeCookie(name: string, value: string, opts?: CookieSerializeOptions): string;
/** A cookie that has expired (used to clear a client stored cookie). */
export declare function expiredCookie(name: string, opts?: CookieSerializeOptions): string;
/** Configuration for a `CookieTransport` — an opaque bearer token in a cookie. */
export interface CookieTransportOptions {
    /** Cookie name (the `__Host-`/`__Secure-` prefix is applied via `hostPrefix`). */
    name: string;
    /**
     * Scope the cookie so it is not sent to unrelated endpoints (default `"/"`).
     * Note: `__Host-` cookies force `Path=/`, so a non-`/` path requires omitting
     * `hostPrefix` (use `secure` + `securePrefix` for the `__Secure-` variant).
     */
    path?: string;
    /** Default `false` (lets `path` scoping work; `__Host-` forces `Path=/`). */
    hostPrefix?: boolean;
    /** Default `true`. */
    secure?: boolean;
    /** Default `"Lax"`. */
    sameSite?: "Lax" | "Strict" | "None";
    /** Default `true`. */
    httpOnly?: boolean;
    /** Cookie lifetime in seconds; omit for a session cookie. */
    maxAge?: number;
}
/** A read/set/clear helper for an opaque bearer token transported in a cookie. */
export interface CookieTransport {
    /** Read the cookie value from the request, or `null` when absent/empty. */
    read(c: Context): string | null;
    /** Set the cookie on the response. */
    set(c: Context, value: string): void;
    /** Clear the cookie on the response (emits a `Max-Age=0` cookie). */
    clear(c: Context): void;
}
/**
 * Build a `CookieTransport` for an opaque bearer token (e.g. a refresh token)
 * that travels as an HttpOnly cookie. Defaults to HttpOnly + Secure + SameSite=Lax.
 */
export declare function createCookieTransport(opts: CookieTransportOptions): CookieTransport;
//# sourceMappingURL=cookie.d.ts.map