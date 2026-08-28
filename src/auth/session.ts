import type { Context } from "hono";
import { APIError, type SecurityScheme } from "../openapi.js";
import { expiredCookie, parseCookies, serializeCookie } from "./cookie.js";
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

const CSRF_FIELD = "_csrf";

/**
 * Build a session strategy handle.
 */
export function buildSessionStrategy(name: string, opts: SessionStrategyOptions): SessionStrategy {
  const secret = opts.secret;
  const cookieName = opts.cookieName ?? "sid";
  const ttlSeconds = opts.ttlSeconds ?? 604800;
  const httpOnly = opts.httpOnly ?? true;
  const sameSite = opts.sameSite ?? "Lax";
  const secure = opts.secure ?? false;
  const path = opts.path ?? "/";
  const csrf = opts.csrf ?? false;
  const store: SessionStore = opts.store ?? createMemorySessionStore();

  const cookieBase = { maxAge: ttlSeconds, path, httpOnly, secure, sameSite };

  async function readSid(c: Context): Promise<string | null> {
    const cookies = parseCookies(c.req.header("Cookie"));
    const raw = cookies[cookieName];
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

  async function verifyCsrfToken(c: Context, data: Record<string, unknown>): Promise<boolean> {
    if (csrf === false) return true;
    const expected = data[CSRF_FIELD];
    if (typeof expected !== "string") return false;
    const provided = c.req.header("x-csrf-token");
    if (!provided) return false;
    return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(provided));
  }

  return {
    name,
    scheme: { type: "apiKey", in: "cookie", name: cookieName },
    async middleware(c) {
      const sid = await readSid(c);
      if (!sid) throw new APIError(401, "Unauthorized");
      const data = await store.get(sid);
      if (!data) throw new APIError(401, "Session expired");
      if (isMutating(c.req.method) && !(await verifyCsrfToken(c, data))) {
        throw new APIError(403, "CSRF token invalid");
      }
      return data;
    },
    async create(c, data) {
      const sid = randomToken(32);
      const signature = await hmacSign(secret, sid);
      // When CSRF is enforced, seed a token so the session always has a `_csrf`
      // to validate against. The client fetches it via generateCsrf()/a GET
      // endpoint before a mutating request.
      const sessionData = csrf ? { ...data, [CSRF_FIELD]: randomToken(24) } : { ...data };
      await store.set(sid, sessionData, ttlSeconds);
      const cookie = serializeCookie(cookieName, `${sid}.${signature}`, cookieBase);
      c.header("Set-Cookie", cookie);
      return cookie;
    },
    async destroy(c) {
      const sid = await readSid(c);
      if (sid) await store.delete(sid);
      const cookie = expiredCookie(cookieName, { path, httpOnly, secure, sameSite });
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
