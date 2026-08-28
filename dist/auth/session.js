import { APIError } from "../openapi.js";
import { cookieNameFor, expiredCookie, parseCookies, serializeCookie, } from "./cookie.js";
import { hmacSign, hmacVerify, randomToken, timingSafeEqual } from "./crypto.js";
import { createMemorySessionStore } from "./store.js";
const CSRF_FIELD = "_csrf";
/**
 * Build a session strategy handle.
 */
export function buildSessionStrategy(name, opts) {
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
    const csrf = csrfRaw === true ? "double-submit" : csrfRaw === false ? false : csrfRaw;
    const origin = opts.origin;
    const allowedOrigins = Array.isArray(origin) ? origin : origin ? [origin] : [];
    if (csrf === "origin" && allowedOrigins.length === 0) {
        throw new Error('Session CSRF "origin" mode requires an `origin` option (string or string[]); set `origin`, or choose `csrf: "double-submit"` or `csrf: false`.');
    }
    const store = opts.store ?? createMemorySessionStore();
    const cookieBase = {
        maxAge: ttlSeconds,
        path,
        httpOnly,
        secure,
        sameSite,
        hostPrefix,
    };
    async function readSid(c) {
        const cookies = parseCookies(c.req.header("Cookie"));
        const raw = cookies[resolvedCookieName];
        if (!raw)
            return null;
        const dot = raw.lastIndexOf(".");
        if (dot === -1)
            return null;
        const sid = raw.slice(0, dot);
        const sig = raw.slice(dot + 1);
        if (!(await hmacVerify(secret, sid, sig)))
            return null;
        return sid;
    }
    async function getSession(c) {
        const sid = await readSid(c);
        if (!sid)
            return null;
        return store.get(sid);
    }
    async function verifyDoubleSubmitToken(c, data) {
        const expected = data[CSRF_FIELD];
        if (typeof expected !== "string")
            return false;
        const provided = c.req.header("x-csrf-token");
        if (!provided)
            return false;
        return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(provided));
    }
    /** `csrf: "origin"` — rejects a cross-site mutating request (no client token). */
    function verifyOrigin(c) {
        const secFetchSite = c.req.header("Sec-Fetch-Site");
        if (secFetchSite === "cross-site")
            return false;
        // Non-browser clients send no Origin — CSRF is a browser-attack vector.
        const originHeader = c.req.header("Origin");
        if (originHeader === null || originHeader === undefined)
            return true;
        return allowedOrigins.includes(originHeader);
    }
    return {
        name,
        scheme: { type: "apiKey", in: "cookie", name: resolvedCookieName },
        async middleware(c) {
            const sid = await readSid(c);
            if (!sid)
                throw new APIError(401, "Unauthorized");
            const data = await store.get(sid);
            if (!data)
                throw new APIError(401, "Session expired");
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
            if (sid)
                await store.delete(sid);
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
            if (!sid)
                throw new APIError(401, "No active session");
            const data = (await store.get(sid)) ?? {};
            const token = randomToken(24);
            await store.set(sid, { ...data, [CSRF_FIELD]: token }, ttlSeconds);
            return token;
        },
        async verifyCsrf(c, token) {
            const data = await getSession(c);
            if (!data)
                return false;
            const expected = data[CSRF_FIELD];
            if (typeof expected !== "string")
                return false;
            return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(token));
        },
    };
}
function isMutating(method) {
    return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
//# sourceMappingURL=session.js.map