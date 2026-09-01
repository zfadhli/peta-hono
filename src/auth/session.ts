import type { Context } from "hono";
import { APIError } from "../errors.js";
import type { SecurityScheme } from "../openapi.js";
import {
  type CookieSerializeOptions,
  cookieNameFor,
  expiredCookie,
  parseCookies,
  serializeCookie,
} from "./cookie.js";
import { hmacSign, hmacVerify, randomToken, timingSafeEqual } from "./crypto.js";
import { createMemorySessionStore, type SessionStore } from "./store.js";

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

const CSRF_FIELD = "_csrf";

/**
 * Build a session strategy handle.
 */
export function buildSessionStrategy(name: string, opts: SessionStrategyOptions): SessionStrategy {
  const secret = opts.secret;
  const cookieName = opts.cookieName ?? "sid";
  const ttlSeconds = opts.ttlSeconds ?? 604800;

  // Cookie attributes — the `cookie` block overrides the legacy top-level flags,
  // and `secure` now defaults to TRUE (the Pilcrow baseline). Dev-over-http is an
  // explicit opt-out (`secure: false`).
  const cookieOpts = opts.cookie ?? {};
  const httpOnly = cookieOpts.httpOnly ?? opts.httpOnly ?? true;
  const sameSite = cookieOpts.sameSite ?? opts.sameSite ?? "Lax";
  const secure = cookieOpts.secure ?? opts.secure ?? true;
  const path = cookieOpts.path ?? opts.path ?? "/";
  const hostPrefix = cookieOpts.hostPrefix ?? false;
  const resolvedCookieName = cookieNameFor(cookieName, hostPrefix);

  // CSRF mode. Default `"origin"`; `true` aliases `"double-submit"`.
  const csrfRaw = opts.csrf ?? "origin";
  const csrf: false | "origin" | "double-submit" =
    csrfRaw === true ? "double-submit" : csrfRaw === false ? false : csrfRaw;
  const origin = opts.origin;
  const allowedOrigins = Array.isArray(origin) ? origin : origin ? [origin] : [];
  if (csrf === "origin" && allowedOrigins.length === 0) {
    throw new Error(
      'Session CSRF "origin" mode requires an `origin` option (string or string[]); set `origin`, or choose `csrf: "double-submit"` or `csrf: false`.',
    );
  }

  const store: SessionStore = opts.store ?? createMemorySessionStore();

  const cookieBase: CookieSerializeOptions = {
    maxAge: ttlSeconds,
    path,
    httpOnly,
    secure,
    sameSite,
    hostPrefix,
  };

  async function readSid(c: Context): Promise<string | null> {
    const cookies = parseCookies(c.req.header("Cookie"));
    const raw = cookies[resolvedCookieName];
    if (!raw) return null;
    const dot = raw.lastIndexOf(".");
    if (dot === -1) return null;
    const sid = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    if (!(await hmacVerify(secret, sid, sig))) return null;
    return sid;
  }

  async function getSession(c: Context): Promise<Record<string, unknown> | null> {
    const sid = await readSid(c);
    if (!sid) return null;
    return store.get(sid);
  }

  async function verifyDoubleSubmitToken(
    c: Context,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const expected = data[CSRF_FIELD];
    if (typeof expected !== "string") return false;
    const provided = c.req.header("x-csrf-token");
    if (!provided) return false;
    return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(provided));
  }

  /** `csrf: "origin"` — rejects a cross-site mutating request (no client token). */
  function verifyOrigin(c: Context): boolean {
    const secFetchSite = c.req.header("Sec-Fetch-Site");
    if (secFetchSite === "cross-site") return false;
    // Non-browser clients send no Origin — CSRF is a browser-attack vector.
    const originHeader = c.req.header("Origin");
    if (originHeader === null || originHeader === undefined) return true;
    return allowedOrigins.includes(originHeader);
  }

  return {
    name,
    scheme: { type: "apiKey", in: "cookie", name: resolvedCookieName },
    async middleware(c) {
      const sid = await readSid(c);
      if (!sid) throw new APIError(401, "Unauthorized");
      const data = await store.get(sid);
      if (!data) throw new APIError(401, "Session expired");
      if (isMutating(c.req.method)) {
        if (csrf === "origin" && !verifyOrigin(c)) {
          throw new APIError(403, "CSRF origin check failed");
        }
        if (csrf === "double-submit" && !(await verifyDoubleSubmitToken(c, data))) {
          throw new APIError(403, "CSRF token invalid");
        }
      }
      return data;
    },
    async create(c, data) {
      const sid = randomToken(32);
      const signature = await hmacSign(secret, sid);
      // Seed an in-session token when CSRF is on, so double-submit mode always has
      // a `_csrf` to validate against. The client fetches it via generateCsrf()/a
      // GET endpoint before a mutating request. (origin mode doesn't need it.)
      const sessionData = csrf !== false ? { ...data, [CSRF_FIELD]: randomToken(24) } : { ...data };
      await store.set(sid, sessionData, ttlSeconds);
      // Pass the BASE name (prefix is applied by serializeCookie via `hostPrefix`).
      const cookie = serializeCookie(cookieName, `${sid}.${signature}`, cookieBase);
      c.header("Set-Cookie", cookie);
      return cookie;
    },
    async destroy(c) {
      const sid = await readSid(c);
      if (sid) await store.delete(sid);
      const cookie = expiredCookie(cookieName, {
        path,
        httpOnly,
        secure,
        sameSite,
        hostPrefix,
      });
      c.header("Set-Cookie", cookie);
      return cookie;
    },
    async get(c) {
      return getSession(c);
    },
    async generateCsrf(c) {
      const sid = await readSid(c);
      if (!sid) throw new APIError(401, "No active session");
      const data = (await store.get(sid)) ?? {};
      const token = randomToken(24);
      await store.set(sid, { ...data, [CSRF_FIELD]: token }, ttlSeconds);
      return token;
    },
    async verifyCsrf(c, token) {
      const data = await getSession(c);
      if (!data) return false;
      const expected = data[CSRF_FIELD];
      if (typeof expected !== "string") return false;
      return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(token));
    },
  };
}

function isMutating(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
