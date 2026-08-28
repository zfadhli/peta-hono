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
export function cookieNameFor(name: string, hostPrefix?: boolean): string {
  return hostPrefix ? `__Host-${name}` : name;
}

/** Split a raw `Cookie` header into `{ name: value }`. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Serialize a `Set-Cookie` value. */
export function serializeCookie(
  name: string,
  value: string,
  opts: CookieSerializeOptions = {},
): string {
  const hostPrefix = opts.hostPrefix ?? false;
  const securePrefix = opts.securePrefix ?? false;

  if (hostPrefix) {
    if (opts.domain) throw new Error("__Host- cookies cannot set a Domain attribute");
    if (opts.path !== undefined && opts.path !== "/") {
      throw new Error(`__Host- cookies require Path=/ (got Path=${opts.path})`);
    }
  }
  if (securePrefix && !opts.secure && !hostPrefix) {
    throw new Error("__Secure- cookies require the Secure attribute");
  }
  // RFC-6265bis: SameSite=None requires Secure, else the browser rejects the cookie.
  if (opts.sameSite === "None" && !opts.secure && !hostPrefix) {
    throw new Error('SameSite="None" requires the Secure attribute');
  }

  const cookieName = hostPrefix ? `__Host-${name}` : securePrefix ? `__Secure-${name}` : name;
  const path = hostPrefix ? "/" : opts.path;

  let s = `${cookieName}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (path) s += `; Path=${path}`;
  if (opts.domain) s += `; Domain=${opts.domain}`;
  if (opts.httpOnly) s += "; HttpOnly";
  if (hostPrefix || opts.secure) s += "; Secure";
  if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
  if (opts.priority) s += `; Priority=${opts.priority}`;
  return s;
}

/** A cookie that has expired (used to clear a client stored cookie). */
export function expiredCookie(name: string, opts: CookieSerializeOptions = {}): string {
  return serializeCookie(name, "", { ...opts, maxAge: 0 });
}

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
export function createCookieTransport(opts: CookieTransportOptions): CookieTransport {
  const options: CookieSerializeOptions = {
    path: opts.path ?? "/",
    httpOnly: opts.httpOnly ?? true,
    secure: opts.secure ?? true,
    sameSite: opts.sameSite ?? "Lax",
    maxAge: opts.maxAge,
    hostPrefix: opts.hostPrefix ?? false,
  };
  // The actual cookie name on the wire carries the `__Host-` prefix (if any).
  const resolvedName = cookieNameFor(opts.name, opts.hostPrefix);
  return {
    read(c) {
      const value = parseCookies(c.req.header("Cookie"))[resolvedName];
      return value === undefined || value === "" ? null : value;
    },
    set(c, value) {
      c.header("Set-Cookie", serializeCookie(opts.name, value, options));
    },
    clear(c) {
      c.header("Set-Cookie", expiredCookie(opts.name, options));
    },
  };
}
